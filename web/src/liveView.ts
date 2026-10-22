// Live view of the session's page over a WebSocket (/ws/live): JPEG screencast frames drawn on a
// canvas, mouse / keyboard forwarding, element picking and highlight overlays.

export interface Box { x: number; y: number; width: number; height: number }

export interface PickInfo {
  tag: string;
  selector: string;
  box: Box;
  text: string;
  href: string | null;
  src: string | null;
  attributes: Record<string, string>;
  suggestedName: string;
  suggestedExtract: 'text' | 'href' | 'src';
  inItem: { fieldSelector: string; matches: number } | null;
  listCandidates: { itemSelector: string; count: number; fieldSelector: string }[];
}

export interface LiveStatus { running: boolean; sessionId: string | null; url: string | null; viewport: { width: number; height: number } | null }

export interface HighlightGroup { key: string; color: string; boxes: Box[]; label?: string }

export type LiveMode = 'browse' | 'select';

export interface LiveViewOptions {
  onStatus?: (s: LiveStatus) => void;
  onNavigated?: (url: string) => void;
  onError?: (message: string) => void;
  onConnection?: (connected: boolean) => void;
  /** select mode: an element was clicked */
  onPick?: (info: PickInfo) => void;
  /** select mode: list selector to resolve picks against (relative field selectors) */
  itemSelector?: () => string | undefined;
  /** called after the page scrolled or changed, so overlays can be refreshed */
  onFrame?: () => void;
}

const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class LiveView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private hoverBox: HTMLElement;
  private placeholder: HTMLElement;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private seq = 0;
  private pending = new Map<number, (data: any) => void>();
  private meta = { w: 1280, h: 800, sx: 0, sy: 0 };
  private decoding = false;
  private nextFrame: ArrayBuffer | null = null;
  private lastScroll = '';
  private moveTimer = 0;
  private hoverTimer = 0;
  private typed = '';
  private typedTimer = 0;
  private groups: HighlightGroup[] = [];
  mode: LiveMode = 'browse';
  frames = 0;
  connected = false;

  constructor(container: HTMLElement, private opts: LiveViewOptions = {}) {
    this.el = container;
    container.classList.add('liveview');
    container.tabIndex = 0;
    container.innerHTML = `
      <canvas></canvas>
      <div class="lv-overlay"><div class="lv-hover" hidden><span></span></div></div>
      <div class="lv-placeholder"><span class="spinner"></span></div>`;
    this.canvas = container.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.overlay = container.querySelector('.lv-overlay')!;
    this.hoverBox = container.querySelector('.lv-hover')!;
    this.placeholder = container.querySelector('.lv-placeholder')!;
    this.bindInput();
    this.connect();
  }

  // ------------------------------------------------------------------ socket
  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/live`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.opts.onConnection?.(true);
    };
    ws.onclose = () => {
      this.connected = false;
      this.opts.onConnection?.(false);
      for (const resolve of this.pending.values()) resolve(null);
      this.pending.clear();
      if (!this.closed) setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
    ws.onmessage = ev => {
      if (ev.data instanceof ArrayBuffer) this.onFrame(ev.data);
      else this.onJSON(JSON.parse(ev.data as string));
    };
  }

  private onJSON(msg: any) {
    switch (msg.t) {
      case 'status':
        if (msg.viewport) {
          this.meta.w = msg.viewport.width;
          this.meta.h = msg.viewport.height;
          this.el.style.setProperty('--lv-ratio', `${msg.viewport.width} / ${msg.viewport.height}`);
          this.el.style.setProperty('--lv-w', String(msg.viewport.width));
          this.el.style.setProperty('--lv-h', String(msg.viewport.height));
        }
        this.placeholder.hidden = !!msg.running && this.frames > 0;
        this.opts.onStatus?.(msg as LiveStatus);
        break;
      case 'navigated':
        this.opts.onNavigated?.(msg.url);
        break;
      case 'error':
        this.opts.onError?.(msg.message);
        break;
      default:
        if (typeof msg.seq === 'number' && this.pending.has(msg.seq)) {
          this.pending.get(msg.seq)!(msg);
          this.pending.delete(msg.seq);
        }
    }
  }

  private onFrame(buf: ArrayBuffer) {
    // keep only the newest frame while one is decoding
    if (this.decoding) {
      this.nextFrame = buf;
      return;
    }
    this.decoding = true;
    const view = new DataView(buf);
    const headerLen = view.getUint32(0);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
    const jpeg = new Blob([new Uint8Array(buf, 4 + headerLen)], { type: 'image/jpeg' });
    createImageBitmap(jpeg).then(bitmap => {
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width;
        this.canvas.height = bitmap.height;
      }
      this.ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      this.meta = { w: header.w, h: header.h, sx: header.sx, sy: header.sy };
      this.el.style.setProperty('--lv-ratio', `${header.w} / ${header.h}`);
      this.el.style.setProperty('--lv-w', String(header.w));
      this.el.style.setProperty('--lv-h', String(header.h));
      this.frames++;
      this.placeholder.hidden = true;
      const scroll = `${header.sx},${header.sy},${header.w},${header.h}`;
      if (scroll !== this.lastScroll) {
        this.lastScroll = scroll;
        this.opts.onFrame?.();
      }
    }).catch(() => undefined).finally(() => {
      this.decoding = false;
      if (this.nextFrame) {
        const next = this.nextFrame;
        this.nextFrame = null;
        this.onFrame(next);
      }
    });
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Send a message and wait for the reply carrying the same seq. */
  request<T = any>(msg: Record<string, unknown>): Promise<T | null> {
    const seq = ++this.seq;
    return new Promise(resolve => {
      if (this.ws?.readyState !== WebSocket.OPEN) return resolve(null);
      this.pending.set(seq, resolve);
      this.send({ ...msg, seq });
      setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          resolve(null);
        }
      }, 15000);
    });
  }

  // ------------------------------------------------------------------ input
  /** Pointer position in page CSS pixels. */
  private toPage(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * this.meta.w),
      y: Math.round(((e.clientY - r.top) / r.height) * this.meta.h)
    };
  }

  private bindInput() {
    const ov = this.overlay;
    ov.addEventListener('mousemove', e => {
      const p = this.toPage(e);
      if (this.mode === 'select') {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = window.setTimeout(async () => {
          const res = await this.request<{ result: { box: Box; label: string } | null }>({ t: 'hover', ...p });
          this.showHover(res?.result || null);
        }, 60);
      } else if (!this.moveTimer) {
        // ~20 moves per second are enough for hover effects
        this.moveTimer = window.setTimeout(() => { this.moveTimer = 0; }, 50);
        this.send({ t: 'mouse', a: 'move', ...p });
      }
    });
    ov.addEventListener('mouseleave', () => this.showHover(null));
    ov.addEventListener('click', async e => {
      this.el.focus();
      const p = this.toPage(e);
      if (this.mode === 'select') {
        const res = await this.request<{ info: PickInfo | null }>({ t: 'pick', ...p, itemSelector: this.opts.itemSelector?.() });
        if (res?.info) this.opts.onPick?.(res.info);
        return;
      }
      this.ripple(e);
      this.send({ t: 'mouse', a: 'click', ...p });
    });
    ov.addEventListener('dblclick', e => {
      if (this.mode !== 'browse') return;
      this.send({ t: 'mouse', a: 'dblclick', ...this.toPage(e) });
    });
    ov.addEventListener('contextmenu', e => e.preventDefault());
    ov.addEventListener('wheel', e => {
      e.preventDefault();
      this.send({ t: 'wheel', ...this.toPage(e), dy: Math.round(e.deltaY), dx: Math.round(e.deltaX) });
      this.showHover(null);
    }, { passive: false });

    this.el.addEventListener('keydown', e => {
      if (this.mode !== 'browse') return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.typed += e.key;
        clearTimeout(this.typedTimer);
        this.typedTimer = window.setTimeout(() => this.flushTyped(), 80);
      } else if (SPECIAL_KEYS.has(e.key) || ((e.ctrlKey || e.metaKey) && e.key.length === 1)) {
        e.preventDefault();
        this.flushTyped();
        this.send({ t: 'key', key: (e.ctrlKey || e.metaKey) && e.key.length === 1 ? `Control+${e.key}` : e.key });
      }
    });
  }

  private flushTyped() {
    clearTimeout(this.typedTimer);
    if (this.typed) this.send({ t: 'text', text: this.typed });
    this.typed = '';
  }

  private ripple(e: MouseEvent) {
    const r = this.el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.left = `${e.clientX - r.left}px`;
    d.style.top = `${e.clientY - r.top}px`;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }

  // ------------------------------------------------------------------ overlays
  private place(node: HTMLElement, b: Box) {
    node.style.left = `${(b.x / this.meta.w) * 100}%`;
    node.style.top = `${(b.y / this.meta.h) * 100}%`;
    node.style.width = `${(b.width / this.meta.w) * 100}%`;
    node.style.height = `${(b.height / this.meta.h) * 100}%`;
  }

  private showHover(res: { box: Box; label: string } | null) {
    if (!res || this.mode !== 'select') {
      this.hoverBox.hidden = true;
      return;
    }
    this.place(this.hoverBox, res.box);
    this.hoverBox.querySelector('span')!.textContent = res.label;
    this.hoverBox.hidden = false;
  }

  /** Draw groups of boxes (e.g. every match of a field) over the page. */
  setHighlights(groups: HighlightGroup[]) {
    this.groups = groups;
    this.overlay.querySelectorAll('.lv-box').forEach(n => n.remove());
    // fields on the same element share one label ("title, title_url") instead of overlapping
    const labelled = new Map<string, HTMLElement>();
    for (const g of groups) {
      g.boxes.forEach((b, i) => {
        const n = document.createElement('div');
        n.className = 'lv-box';
        n.style.setProperty('--c', g.color);
        if (i === 0 && g.label) {
          const at = `${b.x},${b.y}`;
          const first = labelled.get(at);
          if (first) first.dataset.label += `, ${g.label}`;
          else { n.dataset.label = g.label; labelled.set(at, n); }
        }
        this.place(n, b);
        this.overlay.appendChild(n);
      });
    }
  }

  get highlights(): HighlightGroup[] {
    return this.groups;
  }

  setMode(mode: LiveMode) {
    this.mode = mode;
    this.el.classList.toggle('select-mode', mode === 'select');
    if (mode === 'browse') this.showHover(null);
  }

  navigate(url: string) { this.send({ t: 'nav', url }); }
  history(action: 'back' | 'forward' | 'reload') { this.send({ t: 'history', action }); }

  destroy() {
    this.closed = true;
    this.ws?.close();
    clearTimeout(this.moveTimer);
    clearTimeout(this.hoverTimer);
    clearTimeout(this.typedTimer);
  }
}
