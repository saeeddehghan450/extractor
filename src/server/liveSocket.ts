/**
 * liveSocket.ts
 *
 * WebSocket endpoint /ws/live: streams the session's page as JPEG frames (CDP Page.startScreencast,
 * frames are only produced when the page repaints) and forwards mouse / keyboard input and the
 * scraper's element-picking commands back to the page.
 *
 * Binary messages (server -> client): [uint32 header length][JSON header][JPEG bytes]
 * Text messages: JSON, see ClientMessage / the replies below.
 */

import http from 'http';
import { Duplex } from 'stream';
import { CDPSession, Page } from 'playwright';
import { WebSocket, WebSocketServer } from 'ws';
import { controller } from '../core/controller';
import { ExtractorSession } from '../core/session';
import { boxesFor, hoverAt, pickAt } from '../scraper/scraper';
import { debug, warn } from '../utils/logger';

type ClientMessage =
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

class ScreencastHub {
  private clients = new Set<WebSocket>();
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private lastFrame: Buffer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ensuring: Promise<void> = Promise.resolve();
  private wired = new WeakSet<ExtractorSession>();

  constructor() {
    controller.on('session', (s: ExtractorSession) => this.wireSession(s));
  }

  private wireSession(s: ExtractorSession) {
    if (this.wired.has(s)) return;
    this.wired.add(s);
    s.on('status', () => { this.broadcastStatus(); this.ensure(); });
    s.on('navigated', (d: { url: string }) => this.broadcastJSON({ t: 'navigated', url: d.url }));
  }

  add(ws: WebSocket) {
    this.clients.add(ws);
    if (controller.current) this.wireSession(controller.current);
    this.sendJSON(ws, this.status());
    if (this.lastFrame && this.page && !this.page.isClosed()) ws.send(this.lastFrame);
    if (!this.timer) this.timer = setInterval(() => this.ensure(), 1000);
    this.ensure();
  }

  remove(ws: WebSocket) {
    this.clients.delete(ws);
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

  private sendJSON(ws: WebSocket, data: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  private broadcastJSON(data: unknown) {
    for (const ws of this.clients) this.sendJSON(ws, data);
  }

  /** Make the screencast follow the active page (serialized, so calls never overlap). */
  ensure() {
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
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number; offsetTop: number; pageScaleFactor: number; scrollOffsetX?: number; scrollOffsetY?: number; timestamp?: number } }) => {
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

  /** Handle one message from a client. Replies to picker requests carry the request's seq. */
  async handle(ws: WebSocket, msg: ClientMessage) {
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

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  socket.destroy();
}

/** Attach /ws/live to an HTTP server (same Host / Origin rules as the HTTP API). */
export function attachLiveSocket(server: http.Server): void {
  const hub = new ScreencastHub();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws/live') return rejectUpgrade(socket, 404, 'Not Found');

    const allowed = (process.env.EXTRACTOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    const host = (req.headers.host || '').toLowerCase();
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    if (!allowed.includes('*') && !LOCAL_HOSTS.includes(hostname) && !allowed.includes(hostname) && !allowed.includes(host)) {
      return rejectUpgrade(socket, 403, 'Host not allowed');
    }
    // browsers always send Origin on WebSocket upgrades: only the dashboard's own origin may connect
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* invalid */ }
      if (originHost !== req.headers.host) return rejectUpgrade(socket, 403, 'Cross-origin connection rejected');
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    hub.add(ws);
    // input is applied in order: each message waits for the previous one
    let queue = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; } catch { return; }
      queue = queue.then(() => hub.handle(ws, msg)).catch(e => {
        const message = (e as Error).message.split('\n')[0];
        warn(`live input failed: ${message}`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'error', message }));
      });
    });
    ws.on('close', () => hub.remove(ws));
    ws.on('error', () => hub.remove(ws));
  });
}
