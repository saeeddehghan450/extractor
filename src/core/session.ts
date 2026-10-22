/**
 * session.ts
 *
 * One extraction session = one browser, one output folder.
 *
 *  - stream collectors (network, console) record events for the whole session
 *  - page collectors run on every snapshot (click, manual, final)
 *  - on stop (or when the browser is closed) everything is written to
 *    output/<sessionId>/ : analysis.json, session.json and one folder per collector
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext, CDPSession, chromium, Page } from 'playwright';
import { COLLECTORS } from '../collectors/registry';
import { initNetworkCollector } from '../collectors/networkCollector';
import { initConsoleCollector } from '../collectors/consoleCollector';
import { collectElementInfo } from '../collectors/elementsCollector';
import { collectScripts } from '../collectors/scriptsCollector';
import { collectCSS } from '../collectors/cssCollector';
import { collectApplicationData } from '../collectors/applicationCollector';
import { collectSecurityInfo } from '../collectors/securityCollector';
import { collectPerformance } from '../collectors/performanceCollector';
import { collectAccessibilityTree } from '../collectors/accessibilityCollector';
import { collectMediaStats } from '../collectors/mediaCollector';
import { collectWebGLDetails } from '../collectors/webglCollector';
import { collectHeapSnapshot } from '../collectors/memoryCollector';
import { collectServiceWorkerInfo } from '../collectors/serviceWorkerCollector';
import {
  ClickedElementInfo,
  CollectorContext,
  ConsoleRecord,
  DialogRecord,
  NetworkRequestRecord,
  NetworkResponseRecord,
  PageErrorRecord,
  SnapshotReason
} from '../types';
import { createCDPSession } from '../utils/cdpClient';
import { ensureDir, relPath, writeJSON } from '../utils/fileUtils';
import { debug, error, info, success, warn } from '../utils/logger';
import { extractorPageScript } from './pageScript';

export interface SessionOptions {
  url: string;
  headless: boolean;
  slowMo: number;
  executablePath?: string;
  viewport: { width: number; height: number };
  collectors: Record<string, boolean>;
  performanceTraceMs: number;
  outputRoot: string;
}

export type SessionStatus = 'starting' | 'running' | 'stopping' | 'finished' | 'error';

export interface SnapshotSummary {
  seq: number;
  reason: SnapshotReason;
  createdAt: string;
  durationMs: number;
  url: string;
  title: string;
  dir: string;
  file: string;
  screenshot: string | null;
  html: string | null;
  click: Pick<ClickedElementInfo, 'tagName' | 'cssSelector' | 'innerText'> | null;
  collectors: string[];
  errors: Record<string, string>;
}

export interface SessionCounts {
  requests: number;
  responses: number;
  failedRequests: number;
  console: number;
  errors: number;
  dialogs: number;
  clicks: number;
  snapshots: number;
}

export interface SessionSummary {
  id: string;
  url: string;
  currentUrl: string | null;
  title: string | null;
  status: SessionStatus;
  headless: boolean;
  startedAt: string;
  endedAt: string | null;
  collectors: string[];
  counts: SessionCounts;
  snapshots: SnapshotSummary[];
  analysisFile: string | null;
  error: string | null;
}

const MAX_PENDING_CLICK_SNAPSHOTS = 2;

const PAGE_COLLECTORS: Record<string, (ctx: CollectorContext, opts: SessionOptions) => Promise<unknown>> = {
  elements: ctx => collectElementInfo(ctx),
  scripts: ctx => collectScripts(ctx),
  css: ctx => collectCSS(ctx),
  application: ctx => collectApplicationData(ctx),
  security: ctx => collectSecurityInfo(ctx),
  performance: (ctx, opts) => collectPerformance(ctx, opts.performanceTraceMs),
  accessibility: ctx => collectAccessibilityTree(ctx),
  media: ctx => collectMediaStats(ctx),
  webgl: ctx => collectWebGLDetails(ctx),
  memory: ctx => collectHeapSnapshot(ctx),
  serviceWorker: ctx => collectServiceWorkerInfo(ctx)
};

function makeSessionId(url: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let host = 'page';
  try { host = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch { /* keep default */ }
  return `${stamp}-${host.replace(/[^a-zA-Z0-9.-]/g, '_')}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeUrl(input: string): string {
  const url = input.trim();
  if (!url) throw new Error('URL is empty');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  return parsed.toString();
}

export class ExtractorSession extends EventEmitter {
  readonly id: string;
  readonly dir: string;
  readonly options: SessionOptions;
  status: SessionStatus = 'starting';
  startedAt = new Date().toISOString();
  endedAt: string | null = null;
  lastError: string | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSessions = new WeakMap<Page, CDPSession | null>();
  private cache = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private pendingClickSnapshots = 0;
  private seq = 0;
  private finalizing: Promise<void> | null = null;

  readonly clicks: ClickedElementInfo[] = [];
  readonly snapshots: SnapshotSummary[] = [];
  private lastPageState: Record<string, unknown> = {};

  network: { requests: NetworkRequestRecord[]; responses: NetworkResponseRecord[] } = { requests: [], responses: [] };
  consoleData: { logs: ConsoleRecord[]; pageErrors: PageErrorRecord[]; dialogs: DialogRecord[] } = { logs: [], pageErrors: [], dialogs: [] };

  constructor(options: SessionOptions) {
    super();
    this.options = { ...options, url: normalizeUrl(options.url) };
    this.id = makeSessionId(this.options.url);
    this.dir = path.join(options.outputRoot, this.id);
  }

  isEnabled(name: string): boolean {
    return !!this.options.collectors[name];
  }

  get enabledCollectors(): string[] {
    return COLLECTORS.map(c => c.name).filter(n => this.isEnabled(n));
  }

  get isActive(): boolean {
    return this.status === 'starting' || this.status === 'running';
  }

  /** The page snapshots and remote control act on: the most recent open page. */
  get activePage(): Page | null {
    if (this.page && !this.page.isClosed()) return this.page;
    const open = this.context?.pages().filter(p => !p.isClosed()) || [];
    this.page = open.length ? open[open.length - 1] : null;
    return this.page;
  }

  private setStatus(status: SessionStatus) {
    this.status = status;
    this.emit('status', this.summary());
  }

  async start(): Promise<void> {
    ensureDir(this.dir);
    this.writeManifest();
    info(`Session ${this.id}: launching browser (headless=${this.options.headless})`);

    try {
      const executablePath = this.options.executablePath || process.env.CHROMIUM_PATH || undefined;
      this.browser = await chromium.launch({
        headless: this.options.headless,
        slowMo: this.options.slowMo,
        executablePath
      });
      this.context = await this.browser.newContext({
        viewport: this.options.viewport,
        ignoreHTTPSErrors: true
      });

      if (this.isEnabled('network')) {
        const n = initNetworkCollector(this.context, this.dir, {
          onRequest: r => this.emit('request', r),
          onResponse: r => this.emit('response', r)
        });
        this.network = { requests: n.networkRequests, responses: n.networkResponses };
      }
      if (this.isEnabled('console')) {
        const c = initConsoleCollector(this.context, {
          onMessage: m => this.emit('console', m),
          onPageError: e => this.emit('pageerror', e),
          onDialog: d => this.emit('dialog', d)
        });
        this.consoleData = { logs: c.consoleMessages, pageErrors: c.pageErrors, dialogs: c.dialogs };
      }

      await this.context.exposeBinding('__extractorClick', (source, data: ClickedElementInfo) => {
        this.handleClick(source.page, data);
      });
      await this.context.addInitScript(extractorPageScript);

      this.browser.on('disconnected', () => {
        if (this.isActive) {
          warn('Browser was closed. Saving collected data...');
          void this.finalize(false);
        }
      });
      this.context.on('page', p => {
        this.page = p;
        this.attachPage(p);
        this.emit('navigated', { url: p.url() });
      });

      this.page = await this.context.newPage();
      this.setStatus('running');
      info(`Opening page: ${this.options.url}`);
      await this.page.goto(this.options.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {
        // keep the session alive: the user can still navigate / interact
        warn(`Navigation problem: ${(e as Error).message.split('\n')[0]}`);
        this.lastError = (e as Error).message.split('\n')[0];
      });
      this.emit('navigated', { url: this.page.url() });
    } catch (e) {
      this.lastError = (e as Error).message.split('\n')[0];
      if (!this.options.headless && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        this.lastError += ' (no display found - enable headless mode)';
      }
      error(`Session failed to start: ${this.lastError}`);
      this.endedAt = new Date().toISOString();
      this.setStatus('error');
      this.writeManifest();
      await this.browser?.close().catch(() => undefined);
      throw new Error(this.lastError);
    }
  }

  private attachPage(p: Page) {
    p.on('framenavigated', frame => {
      if (frame === p.mainFrame()) this.emit('navigated', { url: frame.url() });
    });
    p.on('close', () => {
      // Closing the last tab in headed mode ends the session
      setTimeout(() => {
        if (this.isActive && this.context && this.context.pages().length === 0) {
          info('All tabs were closed. Saving collected data...');
          void this.finalize(false);
        }
      }, 300);
    });
  }

  private async cdpFor(page: Page): Promise<CDPSession | null> {
    if (this.cdpSessions.has(page)) return this.cdpSessions.get(page)!;
    const cdp = await createCDPSession(page);
    this.cdpSessions.set(page, cdp);
    page.once('close', () => this.cdpSessions.delete(page));
    return cdp;
  }

  private handleClick(page: Page, data: ClickedElementInfo) {
    if (!this.isActive) return;
    this.clicks.push(data);
    this.emit('click', data);
    debug(`Click on <${data.tagName.toLowerCase()}> ${data.cssSelector}`);
    // Never block the page: snapshots are queued and run in the background
    if (this.pendingClickSnapshots >= MAX_PENDING_CLICK_SNAPSHOTS) {
      debug('Too many pending click snapshots, this click is only recorded');
      return;
    }
    this.pendingClickSnapshots++;
    this.snapshot('click', data, page)
      .catch(e => warn(`Click snapshot failed: ${(e as Error).message}`))
      .finally(() => { this.pendingClickSnapshots--; });
  }

  /** Queue a snapshot of the page state. Snapshots run one at a time. */
  snapshot(reason: SnapshotReason, click: ClickedElementInfo | null = null, page?: Page): Promise<SnapshotSummary> {
    const run = this.queue.then(() => this.runSnapshot(reason, click, page));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runSnapshot(reason: SnapshotReason, click: ClickedElementInfo | null, pageArg?: Page): Promise<SnapshotSummary> {
    const page = pageArg && !pageArg.isClosed() ? pageArg : this.activePage;
    if (!page || !this.context) throw new Error('No open page to snapshot');

    const started = Date.now();
    const seq = ++this.seq;
    const snapDir = path.join(this.dir, 'snapshots', `${String(seq).padStart(3, '0')}-${reason}`);
    ensureDir(snapDir);
    info(`Snapshot #${seq} (${reason}) started`);
    this.emit('snapshot-start', { seq, reason });

    const ctx: CollectorContext = {
      page,
      context: this.context,
      cdp: await this.cdpFor(page),
      sessionDir: this.dir,
      seq,
      reason,
      click,
      cache: this.cache,
      network: this.network
    };

    const data: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const [name, fn] of Object.entries(PAGE_COLLECTORS)) {
      if (!this.isEnabled(name)) continue;
      if (page.isClosed()) break;
      try {
        data[name] = await fn(ctx, this.options);
      } catch (e) {
        errors[name] = (e as Error).message.split('\n')[0];
        debug(`${name} collector failed: ${errors[name]}`);
      }
    }

    let screenshot: string | null = null;
    let html: string | null = null;
    let title = '';
    if (!page.isClosed()) {
      try {
        const file = path.join(snapDir, 'screenshot.png');
        await page.screenshot({ path: file, fullPage: false, timeout: 10000 });
        screenshot = relPath(this.dir, file);
      } catch (e) { debug(`screenshot failed: ${String(e)}`); }
      try {
        const file = path.join(snapDir, 'page.html');
        fs.writeFileSync(file, await page.content(), 'utf-8');
        html = relPath(this.dir, file);
      } catch (e) { debug(`save html failed: ${String(e)}`); }
      title = await page.title().catch(() => '');
    }

    const summary: SnapshotSummary = {
      seq,
      reason,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      url: page.isClosed() ? '' : page.url(),
      title,
      dir: relPath(this.dir, snapDir),
      file: relPath(this.dir, path.join(snapDir, 'snapshot.json')),
      screenshot,
      html,
      click: click ? { tagName: click.tagName, cssSelector: click.cssSelector, innerText: (click.innerText || '').slice(0, 120) } : null,
      collectors: Object.keys(data),
      errors
    };

    writeJSON(path.join(snapDir, 'snapshot.json'), {
      meta: { ...summary, sessionId: this.id },
      click,
      ...data,
      counts: this.counts()
    });

    Object.assign(this.lastPageState, data);
    this.snapshots.push(summary);
    this.writeManifest();
    success(`Snapshot #${seq} (${reason}) saved in ${summary.durationMs} ms`);
    this.emit('snapshot', summary);
    return summary;
  }

  /** Take a final snapshot (if the page is still open), write everything and close the browser. */
  stop(): Promise<void> {
    return this.finalize(true);
  }

  private finalize(withFinalSnapshot: boolean): Promise<void> {
    if (this.finalizing) return this.finalizing;
    this.finalizing = (async () => {
      if (this.status === 'error') return;
      this.setStatus('stopping');
      await this.queue.catch(() => undefined);

      if (withFinalSnapshot && this.activePage && this.browser?.isConnected()) {
        try {
          await this.snapshot('final');
        } catch (e) {
          warn(`Final snapshot failed: ${(e as Error).message}`);
        }
      }

      try {
        this.writeResults();
      } catch (e) {
        this.lastError = (e as Error).message;
        error(`Failed to write results: ${this.lastError}`);
      }

      await this.browser?.close().catch(() => undefined);
      this.endedAt = new Date().toISOString();
      this.setStatus('finished');
      this.writeManifest();
      success(`Session ${this.id} saved -> ${this.dir}`);
    })();
    return this.finalizing;
  }

  private moduleData(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this.isEnabled('network')) out.network = this.network;
    if (this.isEnabled('console')) out.console = this.consoleData;
    for (const name of Object.keys(PAGE_COLLECTORS)) {
      if (this.isEnabled(name) && name in this.lastPageState) out[name] = this.lastPageState[name];
    }
    return out;
  }

  private writeResults() {
    const modules = this.moduleData();
    for (const [name, data] of Object.entries(modules)) {
      writeJSON(path.join(this.dir, name, `${name}.json`), data);
    }
    const analysis = {
      meta: {
        sessionId: this.id,
        createdAt: new Date().toISOString(),
        startedAt: this.startedAt,
        targetUrl: this.options.url,
        finalUrl: this.snapshots.length ? this.snapshots[this.snapshots.length - 1].url : null,
        collectors: this.enabledCollectors,
        counts: this.counts(),
        note: this.snapshots.length
          ? 'Page-state collectors contain the data of the latest snapshot; every snapshot is stored in snapshots/.'
          : 'No snapshot was taken (browser closed before any click/snapshot) - only stream collectors are available.'
      },
      clicks: this.clicks,
      snapshots: this.snapshots,
      ...modules
    };
    writeJSON(path.join(this.dir, 'analysis.json'), analysis);
  }

  counts(): SessionCounts {
    return {
      requests: this.network.requests.length,
      responses: this.network.responses.length,
      failedRequests: this.network.requests.filter(r => r.failure).length,
      console: this.consoleData.logs.length,
      errors: this.consoleData.pageErrors.length + this.consoleData.logs.filter(l => l.type === 'error').length,
      dialogs: this.consoleData.dialogs.length,
      clicks: this.clicks.length,
      snapshots: this.snapshots.length
    };
  }

  summary(): SessionSummary {
    const page = this.status === 'running' ? this.activePage : null;
    return {
      id: this.id,
      url: this.options.url,
      currentUrl: page ? page.url() : null,
      title: null,
      status: this.status,
      headless: this.options.headless,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      collectors: this.enabledCollectors,
      counts: this.counts(),
      snapshots: this.snapshots,
      analysisFile: fs.existsSync(path.join(this.dir, 'analysis.json')) ? 'analysis.json' : null,
      error: this.lastError
    };
  }

  private writeManifest() {
    try {
      writeJSON(path.join(this.dir, 'session.json'), this.summary());
    } catch (e) {
      debug(`Could not write session manifest: ${(e as Error).message}`);
    }
  }

  // --- remote control (used by the dashboard) -------------------------------

  private requirePage(): Page {
    const page = this.activePage;
    if (!this.isActive || !page) throw new Error('Session is not running');
    return page;
  }

  async screenshot(): Promise<Buffer> {
    return this.requirePage().screenshot({ type: 'jpeg', quality: 60, timeout: 10000 });
  }

  async click(x: number, y: number): Promise<void> {
    await this.requirePage().mouse.click(x, y);
  }

  async scroll(deltaY: number): Promise<void> {
    await this.requirePage().mouse.wheel(0, deltaY);
  }

  async type(text: string): Promise<void> {
    await this.requirePage().keyboard.type(text);
  }

  async press(key: string): Promise<void> {
    await this.requirePage().keyboard.press(key);
  }

  async navigate(url: string): Promise<void> {
    await this.requirePage().goto(normalizeUrl(url), { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<void> {
    const page = this.requirePage();
    if (action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
    else if (action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded' });
    else await page.reload({ waitUntil: 'domcontentloaded' });
  }
}
