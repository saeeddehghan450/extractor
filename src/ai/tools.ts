/**
 * tools.ts
 *
 * The extractor's tools, defined once and exposed through every channel:
 *  - MCP (stdio + Streamable HTTP)        -> src/mcp/server.ts
 *  - OpenAI / Anthropic tool gateway (/v1) -> src/ai/gateway.ts
 *  - the built-in agent                    -> src/ai/agent.ts
 *
 * Each tool has a zod input schema (validated before running) and returns text plus optional images.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Locator, Page } from 'playwright';
import { COLLECTOR_NAMES } from '../collectors/registry';
import { ControllerError, controller } from '../core/controller';
import { DEVICE_PRESETS, NETWORK_PRESETS } from '../core/emulation';
import { buildHar } from '../core/har';
import { renderReport } from '../core/report';
import { searchSession } from '../core/search';
import { ExtractorSession, packageVersion } from '../core/session';
import { listSessions, sessionDir } from '../core/sessionStore';
import { readJSON, writeJSON } from '../utils/fileUtils';
import { PRESETS, isPresetName } from '../utils/presets';

export interface ToolImage {
  /** base64, without the data: prefix */
  data: string;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface ToolOutput {
  text: string;
  images?: ToolImage[];
  isError?: boolean;
}

export interface ExtractorTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** true when the tool only reads data (MCP readOnlyHint) */
  readOnly: boolean;
  /** true when the tool can lose data or run arbitrary code (MCP destructiveHint) */
  destructive?: boolean;
  run(args: z.infer<S>): Promise<ToolOutput>;
}

const DEFAULT_MAX_CHARS = 20000;

function defineTool<S extends z.ZodObject>(tool: ExtractorTool<S>): ExtractorTool {
  return tool as unknown as ExtractorTool;
}

/** Pretty JSON, clipped to a size a model can take. */
function out(data: unknown, maxChars = DEFAULT_MAX_CHARS): ToolOutput {
  return { text: clip(typeof data === 'string' ? data : JSON.stringify(data, null, 2), maxChars) };
}

export function clip(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated: ${text.length - maxChars} more characters - narrow the request (filters, path, limit) to see the rest]`;
}

// ---------------------------------------------------------------------------
// session data: the running session (live) or a saved one
// ---------------------------------------------------------------------------

interface SessionData {
  id: string;
  dir: string;
  live: boolean;
  analysis: any;
  summary: any;
}

function loadSessionData(sessionId?: string): SessionData {
  const active = controller.active;
  if (!sessionId || sessionId === active?.id) {
    if (active) {
      return { id: active.id, dir: active.dir, live: true, analysis: active.liveAnalysis(), summary: active.summary() };
    }
    if (sessionId) throw new ControllerError(404, `Session ${sessionId} not found`);
    const latest = listSessions().find(s => s.analysisFile);
    if (!latest) throw new ControllerError(404, 'No session yet - start one with extractor_start_session');
    sessionId = latest.id;
  }
  const dir = sessionDir(sessionId);
  const summary = readJSON(path.join(dir, 'session.json'));
  if (!summary) throw new ControllerError(404, `Session ${sessionId} not found`);
  const analysis = readJSON(path.join(dir, 'analysis.json'));
  if (!analysis) throw new ControllerError(409, `Session ${sessionId} has no analysis.json (it did not finish)`);
  return { id: sessionId, dir, live: false, analysis, summary };
}

const sessionIdArg = z.string().optional()
  .describe('Session id. Omit to use the running session, or the most recent saved session when none is running.');

function compactSummary(s: any) {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
    currentUrl: s.currentUrl,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    device: s.emulation?.deviceLabel,
    network: s.emulation?.networkLabel,
    collectors: s.collectors,
    counts: s.counts,
    snapshots: (s.snapshots || []).map((n: any) => ({
      seq: n.seq,
      reason: n.reason,
      url: n.url,
      click: n.click ? `<${String(n.click.tagName).toLowerCase()}> ${n.click.cssSelector}` : undefined,
      errors: Object.keys(n.errors || {}).length ? n.errors : undefined
    })),
    exports: s.exports,
    error: s.error || undefined
  };
}

// ---------------------------------------------------------------------------
// page helpers
// ---------------------------------------------------------------------------

function activePage(): { session: ExtractorSession; page: Page } {
  const session = controller.require();
  const page = session.activePage;
  if (!page) throw new ControllerError(409, 'The session has no open page');
  return { session, page };
}

const targetArgs = {
  ref: z.string().optional().describe('Element ref from extractor_page_snapshot, e.g. "e12" (preferred)'),
  selector: z.string().optional().describe('CSS selector, used when no ref is given'),
  role: z.string().optional().describe('ARIA role (button, link, textbox, ...), used with "name"'),
  name: z.string().optional().describe('Accessible name for "role"'),
  text: z.string().optional().describe('Visible text of the element'),
  element: z.string().optional().describe('Human-readable description of the element, for the log')
};

function locate(page: Page, a: { ref?: string; selector?: string; role?: string; name?: string; text?: string }): Locator {
  if (a.ref) return page.getByRef(a.ref);
  if (a.selector) return page.locator(a.selector).first();
  if (a.role) return page.getByRole(a.role as Parameters<Page['getByRole']>[0], a.name ? { name: a.name } : undefined).first();
  if (a.text) return page.getByText(a.text).first();
  throw new ControllerError(400, 'Give the element as ref, selector, role (+ name) or text');
}

async function pageState(page: Page) {
  return { url: page.url(), title: await page.title().catch(() => '') };
}

const ACTION_TIMEOUT = 10000;

// ---------------------------------------------------------------------------
// findings overview
// ---------------------------------------------------------------------------

function overview(a: any) {
  const nav = a.performance?.timing?.navigation;
  const reqs: any[] = a.network?.requests || [];
  const resps = new Map<string, any>((a.network?.responses || []).map((r: any) => [r.requestId, r]));
  const failing = reqs
    .filter(r => r.failure || (resps.get(r.id)?.status ?? 0) >= 400)
    .slice(0, 20)
    .map(r => ({ id: r.id, method: r.method, url: r.url, status: resps.get(r.id)?.status ?? null, failure: r.failure || undefined }));
  const errors = [
    ...(a.console?.pageErrors || []).map((e: any) => e.message),
    ...(a.console?.logs || []).filter((l: any) => l.type === 'error').map((l: any) => l.text)
  ].slice(0, 20);
  return {
    page: a.elements?.overview && {
      title: a.elements.overview.title,
      url: a.elements.overview.url,
      elements: a.elements.overview.elementCount,
      forms: (a.elements.overview.forms || []).map((f: any) => ({ action: f.action, method: f.method, fields: f.fields.map((x: any) => x.name || x.id || x.type) })),
      headings: (a.elements.overview.headings || []).slice(0, 15)
    },
    security: a.security && {
      secureContext: a.security.isSecureContext,
      tls: a.security.certificate ? { protocol: a.security.certificate.protocol, issuer: a.security.certificate.issuer, validTo: a.security.certificate.validTo } : null,
      missingHeaders: a.security.missingHeaders,
      mixedContent: (a.security.mixedContent || []).length,
      cookieIssues: (a.security.cookieIssues || []).length
    },
    performance: a.performance && {
      ttfbMs: nav?.ttfb,
      domContentLoadedMs: nav?.domContentLoaded,
      loadMs: nav?.load,
      fcpMs: a.performance.timing?.paint?.['first-contentful-paint'],
      lcpMs: a.performance.timing?.largestContentfulPaint?.time,
      cls: a.performance.timing?.cumulativeLayoutShift,
      jsHeapUsedBytes: a.performance.metrics?.JSHeapUsedSize,
      requestsByType: a.performance.timing?.resources?.byType
    },
    accessibility: a.accessibility && { issues: a.accessibility.issueCount, sample: (a.accessibility.issues || []).slice(0, 10) },
    storage: a.application && {
      cookies: (a.application.cookies || []).map((c: any) => c.name),
      localStorageKeys: Object.keys(a.application.storageInfo?.localStorage || {}),
      indexedDB: Object.keys(a.application.storageInfo?.indexedDB || {})
    },
    sources: {
      scripts: a.scripts?.external?.length,
      inlineScripts: a.scripts?.inlineCount,
      stylesheets: a.css?.stylesheets?.length,
      sourceMaps: (a.scripts?.external || []).filter((s: any) => s.sourceMappingURL).map((s: any) => s.src)
    },
    failingRequests: failing,
    consoleErrors: errors
  };
}

function getPath(obj: any, dotted?: string): unknown {
  if (!dotted) return obj;
  let cur = obj;
  for (const part of dotted.split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const deviceKeys = Object.keys(DEVICE_PRESETS) as [string, ...string[]];
const networkKeys = Object.keys(NETWORK_PRESETS) as [string, ...string[]];
const presetKeys = Object.keys(PRESETS) as [string, ...string[]];
const collectorKeys = COLLECTOR_NAMES as [string, ...string[]];

export const TOOLS: ExtractorTool[] = [
  // --- session control -------------------------------------------------------
  defineTool({
    name: 'extractor_start_session',
    title: 'Start extraction session',
    description:
      'Open a URL in a new browser session and start recording everything DevTools can see (network, console, DOM, scripts, ' +
      'CSS, storage, security, performance, accessibility, ...). Only one session runs at a time. Every click on the page ' +
      'takes a full snapshot. Finish with extractor_stop_session to save the results.',
    input: z.object({
      url: z.string().describe('Page to open, e.g. https://example.com'),
      device: z.enum(deviceKeys).optional().describe('Device to emulate (default: desktop)'),
      network: z.enum(networkKeys).optional().describe('Network throttling preset (default: none)'),
      preset: z.enum(presetKeys).optional().describe('Collector preset: minimal, performance, security, dom or full'),
      collectors: z.array(z.enum(collectorKeys)).optional().describe('Exact list of collectors to enable (overrides preset)'),
      userAgent: z.string().optional(),
      extraHeaders: z.record(z.string(), z.string()).optional().describe('Headers sent with every request, e.g. {"Authorization": "Bearer …"}'),
      blockPatterns: z.array(z.string()).optional().describe('URL patterns to block: plain text = URL contains, * = whole-URL wildcard'),
      headless: z.boolean().optional().describe('Run without a window (default: true for tool calls)')
    }),
    readOnly: false,
    async run(a) {
      let collectors: Record<string, boolean> | undefined;
      if (a.collectors?.length) collectors = Object.fromEntries(COLLECTOR_NAMES.map(n => [n, a.collectors!.includes(n)]));
      else if (a.preset && isPresetName(a.preset)) collectors = { ...PRESETS[a.preset].collectors };
      const s = await controller.start({
        url: a.url,
        headless: a.headless ?? true,
        collectors,
        emulation: {
          ...(a.device ? { device: a.device } : {}),
          ...(a.network ? { network: a.network } : {}),
          ...(a.userAgent ? { userAgent: a.userAgent } : {}),
          ...(a.extraHeaders ? { extraHeaders: a.extraHeaders } : {}),
          ...(a.blockPatterns ? { blockPatterns: a.blockPatterns } : {})
        }
      });
      return out({ ...compactSummary(s.summary()), hint: 'Use extractor_page_snapshot to see the page, extractor_click / extractor_type to interact.' });
    }
  }),

  defineTool({
    name: 'extractor_stop_session',
    title: 'Stop and save session',
    description: 'Take a final snapshot, save everything (analysis.json, HAR, HTML report, one folder per collector) and close the browser.',
    input: z.object({}),
    readOnly: false,
    async run() {
      const s = await controller.stop();
      return out({ ...compactSummary(s.summary()), outputDir: s.dir });
    }
  }),

  defineTool({
    name: 'extractor_session_status',
    title: 'Session status',
    description: 'Status, counters and snapshots of the running session (or of a saved session when sessionId is given).',
    input: z.object({ sessionId: sessionIdArg }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      return out({ live: d.live, ...compactSummary(d.summary) });
    }
  }),

  defineTool({
    name: 'extractor_take_snapshot',
    title: 'Take snapshot',
    description: 'Run every enabled page-state collector now (DOM, scripts, CSS, storage, security, performance trace, heap, ...) and save a screenshot.',
    input: z.object({}),
    readOnly: false,
    async run() {
      const snap = await controller.require().snapshot('manual');
      return out(snap);
    }
  }),

  // --- page control ------------------------------------------------------------
  defineTool({
    name: 'extractor_navigate',
    title: 'Navigate',
    description: 'Go to a URL in the running session, or go back / forward / reload.',
    input: z.object({
      url: z.string().optional().describe('URL to open (required for action "goto")'),
      action: z.enum(['goto', 'back', 'forward', 'reload']).optional().describe('Default: goto')
    }),
    readOnly: false,
    async run(a) {
      const { session, page } = activePage();
      const action = a.action || 'goto';
      if (action === 'goto') {
        if (!a.url) throw new ControllerError(400, 'url is required');
        await session.navigate(a.url);
      } else {
        await session.history(action);
      }
      return out(await pageState(page));
    }
  }),

  defineTool({
    name: 'extractor_page_snapshot',
    title: 'Page snapshot (accessibility tree)',
    description:
      'Accessibility snapshot of the current page as YAML, with element refs like [ref=e12]. Use the refs with ' +
      'extractor_click and extractor_type. Cheaper and more reliable than screenshots.',
    input: z.object({
      maxChars: z.number().int().min(1000).max(200000).optional().describe('Maximum characters to return (default 20000)')
    }),
    readOnly: true,
    async run(a) {
      const { page } = activePage();
      const snapshot = await page.ariaSnapshot({ mode: 'ai' });
      const state = await pageState(page);
      return { text: clip(`Page: ${state.title}\nURL: ${state.url}\n\n${snapshot}`, a.maxChars ?? DEFAULT_MAX_CHARS) };
    }
  }),

  defineTool({
    name: 'extractor_click',
    title: 'Click',
    description: 'Click an element of the current page. The click is recorded and triggers a full snapshot (listeners, styles, network, ...).',
    input: z.object({ ...targetArgs, doubleClick: z.boolean().optional() }),
    readOnly: false,
    async run(a) {
      const { page } = activePage();
      const target = locate(page, a);
      if (a.doubleClick) await target.dblclick({ timeout: ACTION_TIMEOUT });
      else await target.click({ timeout: ACTION_TIMEOUT });
      await page.waitForLoadState('domcontentloaded', { timeout: ACTION_TIMEOUT }).catch(() => undefined);
      return out({ clicked: a.element || a.ref || a.selector || a.text || a.name, ...(await pageState(page)) });
    }
  }),

  defineTool({
    name: 'extractor_type',
    title: 'Type text',
    description: 'Fill a text field of the current page (replaces its value), optionally pressing Enter afterwards.',
    input: z.object({
      ...targetArgs,
      value: z.string().describe('Text to enter'),
      submit: z.boolean().optional().describe('Press Enter after typing'),
      slowly: z.boolean().optional().describe('Type key by key (triggers key handlers) instead of filling at once')
    }),
    readOnly: false,
    async run(a) {
      const { page } = activePage();
      const target = locate(page, a);
      if (a.slowly) {
        await target.click({ timeout: ACTION_TIMEOUT });
        await target.pressSequentially(a.value, { timeout: ACTION_TIMEOUT });
      } else {
        await target.fill(a.value, { timeout: ACTION_TIMEOUT });
      }
      if (a.submit) await target.press('Enter', { timeout: ACTION_TIMEOUT });
      return out({ typed: a.value.length, ...(await pageState(page)) });
    }
  }),

  defineTool({
    name: 'extractor_press_key',
    title: 'Press key',
    description: 'Press a key or shortcut on the current page, e.g. "Enter", "Escape", "ArrowDown", "Control+a".',
    input: z.object({ key: z.string() }),
    readOnly: false,
    async run(a) {
      const { session, page } = activePage();
      await session.press(a.key);
      return out(await pageState(page));
    }
  }),

  defineTool({
    name: 'extractor_scroll',
    title: 'Scroll',
    description: 'Scroll the current page vertically by deltaY pixels (negative = up).',
    input: z.object({ deltaY: z.number() }),
    readOnly: false,
    async run(a) {
      const { session, page } = activePage();
      await session.scroll(a.deltaY);
      const y = await page.evaluate(() => window.scrollY).catch(() => null);
      return out({ scrollY: y });
    }
  }),

  defineTool({
    name: 'extractor_screenshot',
    title: 'Screenshot',
    description: 'Screenshot of the current page (JPEG). Prefer extractor_page_snapshot for finding elements.',
    input: z.object({ fullPage: z.boolean().optional() }),
    readOnly: true,
    async run(a) {
      const { page } = activePage();
      const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: !!a.fullPage, timeout: ACTION_TIMEOUT });
      const state = await pageState(page);
      return { text: `Screenshot of ${state.url} (${state.title})`, images: [{ data: buf.toString('base64'), mimeType: 'image/jpeg' }] };
    }
  }),

  defineTool({
    name: 'extractor_evaluate',
    title: 'Run JavaScript in the page',
    description:
      'Evaluate a JavaScript function in the current page and return its JSON result, e.g. "() => document.title". ' +
      'Runs with the page\'s privileges; it can change the page.',
    input: z.object({ function: z.string().describe('A function expression: () => { ... }') }),
    readOnly: false,
    destructive: true,
    async run(a) {
      const { page } = activePage();
      const result = await page.evaluate(`(async () => { const __fn = (${a.function}); return await __fn(); })()`);
      return out(result === undefined ? 'undefined' : result);
    }
  }),

  // --- data ----------------------------------------------------------------------
  defineTool({
    name: 'extractor_list_sessions',
    title: 'List saved sessions',
    description: 'Saved extraction sessions, newest first.',
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    readOnly: true,
    async run(a) {
      const list = listSessions().slice(0, a.limit ?? 20).map(s => ({
        id: s.id, url: s.url, status: s.status, startedAt: s.startedAt, device: s.emulation?.deviceLabel, counts: s.counts
      }));
      return out({ running: controller.active?.id ?? null, sessions: list });
    }
  }),

  defineTool({
    name: 'extractor_get_overview',
    title: 'Findings overview',
    description:
      'The main findings of a session in one call: page structure, security (TLS, missing headers, cookie issues), ' +
      'performance (TTFB, LCP, CLS, ...), accessibility issues, storage, sources, failing requests and console errors.',
    input: z.object({ sessionId: sessionIdArg }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      return out({ sessionId: d.id, live: d.live, counts: d.summary.counts, ...overview(d.analysis) });
    }
  }),

  defineTool({
    name: 'extractor_list_requests',
    title: 'List network requests',
    description: 'Network requests of a session with status, type, size and timing. Use extractor_get_request for headers and bodies.',
    input: z.object({
      sessionId: sessionIdArg,
      urlContains: z.string().optional(),
      resourceType: z.string().optional().describe('document, script, stylesheet, image, font, xhr, fetch, ...'),
      method: z.string().optional(),
      status: z.enum(['all', 'ok', 'error', 'failed']).optional().describe('error = HTTP >= 400, failed = no response (blocked, network error)'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional()
    }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      const resps = new Map<string, any>((d.analysis.network?.responses || []).map((r: any) => [r.requestId, r]));
      const rows = (d.analysis.network?.requests || []).filter((r: any) => {
        const resp = resps.get(r.id);
        if (a.urlContains && !r.url.toLowerCase().includes(a.urlContains.toLowerCase())) return false;
        if (a.resourceType && r.resourceType !== a.resourceType) return false;
        if (a.method && r.method.toUpperCase() !== a.method.toUpperCase()) return false;
        if (a.status === 'failed' && !r.failure) return false;
        if (a.status === 'error' && !((resp?.status ?? 0) >= 400)) return false;
        if (a.status === 'ok' && !(resp && resp.status < 400)) return false;
        return true;
      });
      const offset = a.offset ?? 0;
      const limit = a.limit ?? 100;
      return out({
        total: rows.length,
        offset,
        requests: rows.slice(offset, offset + limit).map((r: any) => {
          const resp = resps.get(r.id);
          return {
            id: r.id, method: r.method, url: r.url, type: r.resourceType,
            status: resp?.status ?? null, failure: r.failure || undefined,
            size: resp?.size ?? null, durationMs: resp?.durationMs ?? null, contentType: resp?.contentType || undefined
          };
        })
      });
    }
  }),

  defineTool({
    name: 'extractor_get_request',
    title: 'Request details',
    description: 'Headers, post data and response body of one network request (id from extractor_list_requests).',
    input: z.object({
      sessionId: sessionIdArg,
      requestId: z.string(),
      includeBody: z.boolean().optional().describe('Include the response body (default true)'),
      maxBodyChars: z.number().int().min(100).max(200000).optional().describe('Default 8000')
    }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      const req = (d.analysis.network?.requests || []).find((r: any) => r.id === a.requestId);
      if (!req) throw new ControllerError(404, `Request ${a.requestId} not found`);
      const resp = (d.analysis.network?.responses || []).find((r: any) => r.requestId === a.requestId);
      let body: string | null = null;
      if (resp && a.includeBody !== false) {
        body = resp.bodySnippet ?? null;
        if (resp.fullBodyPath) {
          try { body = fs.readFileSync(path.join(d.dir, resp.fullBodyPath), 'utf-8'); } catch { /* keep snippet */ }
        }
        if (body) body = clip(body, a.maxBodyChars ?? 8000);
      }
      return out({
        request: { id: req.id, method: req.method, url: req.url, type: req.resourceType, headers: req.headers, postData: req.postData || undefined, failure: req.failure || undefined },
        response: resp ? {
          status: resp.status, statusText: resp.statusText, headers: resp.headers, size: resp.size, durationMs: resp.durationMs,
          remoteAddress: resp.remoteAddress, tls: resp.securityDetails || undefined, body
        } : null
      }, 60000);
    }
  }),

  defineTool({
    name: 'extractor_console_messages',
    title: 'Console messages',
    description: 'Console messages, uncaught errors and dialogs of a session.',
    input: z.object({
      sessionId: sessionIdArg,
      level: z.enum(['all', 'error', 'warn']).optional().describe('error = errors only, warn = warnings and errors'),
      contains: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional()
    }),
    readOnly: true,
    async run(a) {
      const c = loadSessionData(a.sessionId).analysis.console || { logs: [], pageErrors: [], dialogs: [] };
      let lines: any[] = [
        ...c.logs.map((l: any) => ({ t: l.timestamp, type: l.type, text: l.text, at: l.location?.url ? `${l.location.url}:${l.location.lineNumber}` : undefined })),
        ...c.pageErrors.map((e: any) => ({ t: e.timestamp, type: 'error', text: e.message, uncaught: true, stack: e.stack })),
        ...c.dialogs.map((d: any) => ({ t: d.timestamp, type: 'dialog', text: `[${d.type}] ${d.message}` }))
      ].sort((x, y) => String(x.t).localeCompare(String(y.t)));
      if (a.level === 'error') lines = lines.filter(l => l.type === 'error');
      if (a.level === 'warn') lines = lines.filter(l => l.type === 'error' || l.type === 'warn');
      if (a.contains) lines = lines.filter(l => l.text.toLowerCase().includes(a.contains!.toLowerCase()));
      const limit = a.limit ?? 200;
      return out({ total: lines.length, messages: lines.slice(-limit) });
    }
  }),

  defineTool({
    name: 'extractor_get_collector_data',
    title: 'Collector data',
    description:
      'Raw data of one collector (elements, scripts, css, application, security, performance, accessibility, media, webgl, ' +
      'memory, serviceWorker, network, console). Use "path" (dot notation, e.g. "overview.forms" or "storageInfo.localStorage") ' +
      'to get a part of it.',
    input: z.object({
      sessionId: sessionIdArg,
      collector: z.enum(collectorKeys),
      path: z.string().optional(),
      maxChars: z.number().int().min(1000).max(200000).optional()
    }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      if (!(a.collector in d.analysis)) {
        throw new ControllerError(404, `No ${a.collector} data in this session (collector disabled, or no snapshot taken yet)`);
      }
      const value = getPath(d.analysis[a.collector], a.path);
      if (value === undefined) throw new ControllerError(404, `Path "${a.path}" not found in ${a.collector}`);
      return out(value, a.maxChars ?? DEFAULT_MAX_CHARS);
    }
  }),

  defineTool({
    name: 'extractor_search',
    title: 'Search session',
    description:
      'Full-text (or regex) search across request URLs, headers, post data, response bodies, console, cookies, storage ' +
      'and downloaded JS/CSS sources. Good for finding API keys, tokens, endpoints or where a value comes from.',
    input: z.object({
      sessionId: sessionIdArg,
      query: z.string().min(1),
      regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional()
    }),
    readOnly: true,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      const res = searchSession(d.dir, d.analysis, a.query, { regex: a.regex, caseSensitive: a.caseSensitive, limit: a.limit ?? 50 });
      if (res.error) return { text: res.error, isError: true };
      return out({
        total: res.matches.length,
        truncated: res.truncated,
        matches: res.matches.map(m => ({ kind: m.kind, where: m.where, title: m.title, requestId: m.requestId, file: m.file, snippet: m.snippet }))
      });
    }
  }),

  defineTool({
    name: 'extractor_export',
    title: 'Export',
    description:
      'Write an export file and return its path: "har" (HTTP Archive 1.2 with bodies), "report" (standalone HTML report) ' +
      'or "analysis" (complete JSON).',
    input: z.object({
      sessionId: sessionIdArg,
      format: z.enum(['har', 'report', 'analysis']),
      language: z.enum(['en', 'fa']).optional().describe('Report language (default en)')
    }),
    readOnly: false,
    async run(a) {
      const d = loadSessionData(a.sessionId);
      let file: string;
      if (a.format === 'har') {
        if (!d.analysis.network) throw new ControllerError(409, 'The network collector was not enabled in this session');
        file = path.join(d.dir, 'network', d.live ? 'network-live.har' : 'network.har');
        if (d.live || !fs.existsSync(file)) {
          writeJSON(file, buildHar({
            requests: d.analysis.network.requests,
            responses: d.analysis.network.responses,
            pageUrl: d.summary.url,
            startedAt: d.summary.startedAt,
            sessionDir: d.dir,
            creatorVersion: packageVersion()
          }));
        }
      } else if (a.format === 'report') {
        const lang = a.language || 'en';
        file = path.join(d.dir, lang === 'en' && !d.live ? 'report.html' : `report-${lang}${d.live ? '-live' : ''}.html`);
        fs.writeFileSync(file, renderReport(d.analysis, d.summary, d.dir, lang), 'utf-8');
      } else {
        file = path.join(d.dir, d.live ? 'analysis-live.json' : 'analysis.json');
        if (d.live) writeJSON(file, d.analysis);
      }
      return out({ sessionId: d.id, format: a.format, path: file, bytes: fs.statSync(file).size });
    }
  })
];

export function findTool(name: string): ExtractorTool | undefined {
  return TOOLS.find(t => t.name === name);
}

/**
 * Validate the arguments and run a tool. Never throws: problems come back as isError outputs,
 * so a model can read them and correct itself.
 */
export async function callTool(name: string, args: unknown): Promise<ToolOutput> {
  const tool = findTool(name);
  if (!tool) return { text: `Unknown tool "${name}". Available: ${TOOLS.map(t => t.name).join(', ')}`, isError: true };
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return { text: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  try {
    return await tool.run(parsed.data);
  } catch (e) {
    return { text: `${name} failed: ${(e as Error).message.split('\n')[0]}`, isError: true };
  }
}

/** JSON Schema of a tool's input (for OpenAI / Anthropic tool definitions). */
export function jsonSchemaOf(tool: ExtractorTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
