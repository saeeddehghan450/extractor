// Knowledge-graph values (Neo4j nodes / relationships / paths as JSON) and a small force-directed
// canvas renderer for them.

export interface GNode { _type: 'node'; id: string; labels: string[]; properties: Record<string, unknown> }
export interface GRel { _type: 'relationship'; id: string; type: string; start: string; end: string; properties: Record<string, unknown> }
export interface GPath { _type: 'path'; nodes: GNode[]; relationships: GRel[] }

export const isNode = (v: unknown): v is GNode => !!v && typeof v === 'object' && (v as GNode)._type === 'node';
export const isRel = (v: unknown): v is GRel => !!v && typeof v === 'object' && (v as GRel)._type === 'relationship';
export const isPath = (v: unknown): v is GPath => !!v && typeof v === 'object' && (v as GPath)._type === 'path';

const NAME_KEYS = ['name', 'title', 'url', 'text', 'selector', 'id', 'uid', 'key'];

export function nodeCaption(n: GNode): string {
  for (const k of NAME_KEYS) {
    const v = n.properties[k];
    if (v != null && v !== '') return String(v);
  }
  return n.labels[0] || 'node';
}

const PALETTE = ['#6d8cff', '#3ecf8e', '#f5a524', '#f05d6c', '#a78bfa', '#22c3e6', '#f472b6', '#94a3b8', '#eab308', '#14b8a6', '#fb923c', '#818cf8'];
const LABEL_ORDER = ['Session', 'Page', 'Domain', 'Request', 'Script', 'Stylesheet', 'Cookie', 'ConsoleMessage', 'SecurityHeader', 'Element', 'Scrape', 'Record'];
export function labelColor(label: string): string {
  let i = LABEL_ORDER.indexOf(label);
  if (i < 0) i = [...label].reduce((h, c) => h + c.charCodeAt(0), 0);
  return PALETTE[i % PALETTE.length];
}

/** Nodes and relationships found anywhere in the rows. */
export function collectGraph(rows: Record<string, unknown>[]): { nodes: Map<string, GNode>; rels: Map<string, GRel> } {
  const nodes = new Map<string, GNode>();
  const rels = new Map<string, GRel>();
  const visit = (v: unknown) => {
    if (isNode(v)) nodes.set(v.id, v);
    else if (isRel(v)) rels.set(v.id, v);
    else if (isPath(v)) { v.nodes.forEach(visit); v.relationships.forEach(visit); }
    else if (Array.isArray(v)) v.forEach(visit);
  };
  rows.forEach(r => Object.values(r).forEach(visit));
  for (const [id, r] of rels) if (!nodes.has(r.start) || !nodes.has(r.end)) rels.delete(id);
  return { nodes, rels };
}

interface SimNode { n: GNode; x: number; y: number; vx: number; vy: number; fixed: boolean }

export function drawGraph(canvas: HTMLCanvasElement, tip: HTMLElement, data: { nodes: Map<string, GNode>; rels: Map<string, GRel> }): () => void {
  const ctx = canvas.getContext('2d')!;
  // labels are URLs and identifiers: always left-to-right, also in the Persian UI
  canvas.dir = 'ltr';
  const css = getComputedStyle(document.documentElement);
  const textColor = css.getPropertyValue('--text-2').trim() || '#aaa';
  const lineColor = css.getPropertyValue('--border').trim() || '#555';
  const W = () => canvas.clientWidth;
  const H = () => canvas.clientHeight;
  const sims = new Map<string, SimNode>();
  let i = 0;
  const count = data.nodes.size;
  for (const n of data.nodes.values()) {
    const a = (i++ / Math.max(1, count)) * Math.PI * 2;
    const r = Math.min(W(), H()) * 0.3;
    sims.set(n.id, { n, x: W() / 2 + Math.cos(a) * r, y: H() / 2 + Math.sin(a) * r, vx: 0, vy: 0, fixed: false });
  }
  const links = [...data.rels.values()].map(r => ({ r, a: sims.get(r.start)!, b: sims.get(r.end)! }));
  const degree = new Map<string, number>();
  links.forEach(l => { degree.set(l.a.n.id, (degree.get(l.a.n.id) || 0) + 1); degree.set(l.b.n.id, (degree.get(l.b.n.id) || 0) + 1); });
  const radius = (s: SimNode) => 6 + Math.min(10, Math.sqrt(degree.get(s.n.id) || 0) * 2);

  let alpha = 1;
  let raf = 0;
  let hover: SimNode | null = null;
  let drag: SimNode | null = null;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W() * dpr);
    canvas.height = Math.round(H() * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const step = () => {
    const nodes = [...sims.values()];
    // repulsion
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const p = nodes[a], q = nodes[b];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        if (d2 > 250000) continue;
        const f = (2600 / d2) * alpha;
        const d = Math.sqrt(d2);
        p.vx -= (dx / d) * f; p.vy -= (dy / d) * f;
        q.vx += (dx / d) * f; q.vy += (dy / d) * f;
      }
    }
    // springs
    for (const { a, b } of links) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 110) * 0.02 * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // centre + integrate
    for (const s of nodes) {
      s.vx += (W() / 2 - s.x) * 0.002 * alpha;
      s.vy += (H() / 2 - s.y) * 0.002 * alpha;
      if (s.fixed) { s.vx = s.vy = 0; continue; }
      s.vx *= 0.6; s.vy *= 0.6;
      s.x = Math.max(12, Math.min(W() - 12, s.x + s.vx));
      s.y = Math.max(12, Math.min(H() - 12, s.y + s.vy));
    }
    alpha = Math.max(0, alpha * 0.985);
  };

  const draw = () => {
    ctx.clearRect(0, 0, W(), H());
    ctx.lineWidth = 1;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    for (const { r, a, b } of links) {
      const hot = hover && (hover === a || hover === b);
      ctx.strokeStyle = hot ? labelColor(hover!.n.labels[0] || '') : lineColor;
      ctx.globalAlpha = hot ? 1 : 0.7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // arrow head
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const rb = radius(b) + 2;
      const tx = b.x - Math.cos(ang) * rb, ty = b.y - Math.sin(ang) * rb;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang - 0.4) * 7, ty - Math.sin(ang - 0.4) * 7);
      ctx.lineTo(tx - Math.cos(ang + 0.4) * 7, ty - Math.sin(ang + 0.4) * 7);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      if (hot || links.length < 40) {
        ctx.fillStyle = textColor;
        ctx.fillText(r.type, (a.x + b.x) / 2 + 3, (a.y + b.y) / 2 - 3);
      }
    }
    ctx.globalAlpha = 1;
    for (const s of sims.values()) {
      const rr = radius(s);
      ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = labelColor(s.n.labels[0] || '');
      ctx.fill();
      if (s === hover) { ctx.lineWidth = 3; ctx.strokeStyle = textColor; ctx.stroke(); ctx.lineWidth = 1; }
      if (sims.size < 60 || s === hover) {
        ctx.fillStyle = textColor;
        ctx.fillText(nodeCaption(s.n).replace(/^https?:\/\//, '').slice(0, 28), s.x + rr + 3, s.y + 3);
      }
    }
  };

  const loop = () => {
    if (alpha > 0.01 || drag) step();
    draw();
    raf = requestAnimationFrame(loop);
  };

  const at = (e: PointerEvent): SimNode | null => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best: SimNode | null = null;
    for (const s of sims.values()) {
      if (Math.hypot(s.x - x, s.y - y) <= radius(s) + 3) best = s;
    }
    return best;
  };

  canvas.onpointerdown = e => {
    drag = at(e);
    if (drag) { drag.fixed = true; canvas.setPointerCapture(e.pointerId); alpha = Math.max(alpha, 0.3); }
  };
  canvas.onpointermove = e => {
    const rect = canvas.getBoundingClientRect();
    if (drag) {
      drag.x = e.clientX - rect.left; drag.y = e.clientY - rect.top;
      alpha = Math.max(alpha, 0.3);
      return;
    }
    hover = at(e);
    canvas.style.cursor = hover ? 'grab' : 'default';
    if (hover) {
      tip.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = hover.n.labels.join(':');
      tip.appendChild(title);
      for (const [k, v] of Object.entries(hover.n.properties).slice(0, 12)) {
        const row = document.createElement('div');
        const key = document.createElement('span');
        key.className = 'muted';
        key.textContent = k;
        const val = document.createElement('span');
        val.className = 'ltr';
        val.textContent = ' ' + String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 160);
        row.append(key, val);
        tip.appendChild(row);
      }
      tip.style.display = 'block';
      tip.style.left = `${Math.min(e.clientX - rect.left + 14, W() - 280)}px`;
      tip.style.top = `${e.clientY - rect.top + 14}px`;
    } else tip.style.display = 'none';
  };
  canvas.onpointerup = () => { if (drag) drag.fixed = false; drag = null; };
  canvas.onpointerleave = () => { hover = null; tip.style.display = 'none'; };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  loop();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

