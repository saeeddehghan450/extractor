/**
 * live.service.ts
 *
 * Screencast hub for /ws/live: streams the session's page as JPEG frames (CDP Page.startScreencast,
 * frames are only produced when the page repaints) to every connected client, and applies mouse /
 * keyboard input and the scraper's element-picking commands to the page.
 *
 * Binary messages (server -> client): [uint32 header length][JSON header {w,h,sx,sy,ts}][JPEG bytes]
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CDPSession, Page } from 'playwright';
import { WebSocket } from 'ws';
import { controller } from '../../core/controller';
import { ExtractorSession } from '../../core/session';
import { boxesFor, hoverAt, pickAt } from '../../scraper/scraper';
import { debug } from '../../utils/logger';

export type LiveMessage =
  | { t: 'mouse'; a: 'click' | 'move' | 'down' | 'up' | 'dblclick'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { t: 'wheel'; x: number; y: number; dy: number; dx?: number }
  | { t: 'key'; key: string }
  | { t: 'text'; text: string }
  | { t: 'nav'; url: string }
  | { t: 'history'; action: 'back' | 'forward' | 'reload' }
  | { t: 'hover'; seq: number; x: number; y: number }
  | { t: 'pick'; seq: number; x: number; y: number; itemSelector?: string }
  | { t: 'boxes'; seq: number; specs: { key: string; selector: string; itemSelector?: string }[] };

const MAX_BUFFERED = 4 * 1024 * 1024;

@Injectable()
export class LiveService implements OnModuleDestroy {
  private clients = new Set<WebSocket>();
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private lastFrame: Buffer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ensuring: Promise<void> = Promise.resolve();
  private wired = new WeakSet<ExtractorSession>();
  private readonly onSession = (s: ExtractorSession) => this.wireSession(s);

  constructor() {
    controller.on('session', this.onSession);
  }

  onModuleDestroy(): void {
    controller.off('session', this.onSession);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.stopCast();
  }

  private wireSession(s: ExtractorSession) {
    if (this.wired.has(s)) return;
    this.wired.add(s);
    s.on('status', () => { this.broadcastStatus(); this.ensure(); });
    s.on('navigated', (d: { url: string }) => this.broadcastJSON({ t: 'navigated', url: d.url }));
  }

  add(ws: WebSocket): void {
    this.clients.add(ws);
    if (controller.current) this.wireSession(controller.current);
    this.sendJSON(ws, this.status());
    if (this.lastFrame && this.page && !this.page.isClosed()) ws.send(this.lastFrame);
    if (!this.timer) this.timer = setInterval(() => this.ensure(), 1000);
    this.ensure();
  }

  remove(ws: WebSocket): void {
    if (!this.clients.delete(ws)) return;
    if (!this.clients.size) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.ensure();
    }
  }

  private status() {
    const s = controller.active;
    const page = s?.activePage;
    const vp = page?.viewportSize() || s?.summary().viewport || null;
    return { t: 'status', running: !!s, sessionId: s?.id ?? null, url: page?.url() ?? null, viewport: vp };
  }

  private broadcastStatus() {
    this.broadcastJSON(this.status());
  }

  sendJSON(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  private broadcastJSON(data: unknown) {
    for (const ws of this.clients) this.sendJSON(ws, data);
  }

  /** Make the screencast follow the active page (serialized, so calls never overlap). */
  private ensure() {
    this.ensuring = this.ensuring.then(() => this.doEnsure()).catch(e => debug(`screencast: ${(e as Error).message}`));
  }

  private async doEnsure() {
    const target = this.clients.size ? controller.active?.activePage ?? null : null;
    if (target === this.page && (!target || !target.isClosed())) return;
    await this.stopCast();
    this.page = target;
    this.broadcastStatus();
    if (!target) return;

    const cdp = await target.context().newCDPSession(target);
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number; scrollOffsetX?: number; scrollOffsetY?: number; timestamp?: number } }) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
      const header = Buffer.from(JSON.stringify({
        w: f.metadata.deviceWidth,
        h: f.metadata.deviceHeight,
        sx: f.metadata.scrollOffsetX ?? 0,
        sy: f.metadata.scrollOffsetY ?? 0,
        ts: f.metadata.timestamp ?? Date.now() / 1000
      }));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(header.length, 0);
      const msg = Buffer.concat([prefix, header, Buffer.from(f.data, 'base64')]);
      this.lastFrame = msg;
      for (const ws of this.clients) {
        // a slow client skips frames instead of falling behind
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(msg);
      }
    });
    const vp = target.viewportSize() || { width: 1280, height: 800 };
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: Math.min(1920, vp.width * 2),
      maxHeight: Math.min(1920, vp.height * 2),
      everyNthFrame: 1
    });
    debug('screencast started');
  }

  private async stopCast() {
    const cdp = this.cdp;
    this.cdp = null;
    this.lastFrame = null;
    if (cdp) {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    }
  }

  /** Apply one client message. Replies to picker requests carry the request's seq. */
  async handle(ws: WebSocket, msg: LiveMessage): Promise<void> {
    const session = controller.active;
    const page = session?.activePage;
    if (!session || !page) {
      this.sendJSON(ws, { t: 'error', message: 'No running session' });
      return;
    }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    switch (msg.t) {
      case 'mouse': {
        const x = num(msg.x), y = num(msg.y);
        const button = msg.button === 'right' || msg.button === 'middle' ? msg.button : 'left';
        if (msg.a === 'move') await page.mouse.move(x, y);
        else if (msg.a === 'down') { await page.mouse.move(x, y); await page.mouse.down({ button }); }
        else if (msg.a === 'up') { await page.mouse.move(x, y); await page.mouse.up({ button }); }
        else if (msg.a === 'dblclick') await page.mouse.dblclick(x, y, { button });
        else await page.mouse.click(x, y, { button });
        break;
      }
      case 'wheel':
        await page.mouse.move(num(msg.x), num(msg.y));
        await page.mouse.wheel(num(msg.dx), num(msg.dy));
        break;
      case 'key':
        await page.keyboard.press(String(msg.key));
        break;
      case 'text':
        await page.keyboard.type(String(msg.text));
        break;
      case 'nav':
        await session.navigate(String(msg.url));
        break;
      case 'history':
        await session.history(msg.action);
        break;
      case 'hover': {
        const result = await hoverAt(page, num(msg.x), num(msg.y)).catch(() => null);
        this.sendJSON(ws, { t: 'hover', seq: msg.seq, result });
        break;
      }
      case 'pick': {
        const info = await pickAt(page, num(msg.x), num(msg.y), msg.itemSelector).catch(e => {
          this.sendJSON(ws, { t: 'error', message: (e as Error).message.split('\n')[0] });
          return null;
        });
        this.sendJSON(ws, { t: 'picked', seq: msg.seq, info });
        break;
      }
      case 'boxes': {
        const specs = Array.isArray(msg.specs) ? msg.specs.slice(0, 50) : [];
        const groups = await boxesFor(page, specs).catch(() => ({}));
        this.sendJSON(ws, { t: 'boxes', seq: msg.seq, groups });
        break;
      }
      default:
        this.sendJSON(ws, { t: 'error', message: 'Unknown message' });
    }
  }
}
