import { api, GraphQueryResult, GraphStatus } from '../api.js';
import { icon } from '../icons.js';
import { fmtNumber, t } from '../i18n.js';
import { $, $$, errMsg, esc, html, toast } from '../util.js';
import type { ViewContext } from '../types.js';

/** Ask the assistant a question: it opens with the message already sent. */
export function askAssistant(message: string): void {
  try { sessionStorage.setItem('dx-ask', message); } catch { /* storage blocked */ }
  location.hash = '#/assistant';
}

const EXAMPLES: { key: string; cypher: string }[] = [
  { key: 'graph.ex.domains', cypher: 'MATCH (s:Session)-[c:CONTACTED]->(d:Domain)\nRETURN s, c, d LIMIT 100' },
  { key: 'graph.ex.thirdParty', cypher: 'MATCH (s:Session)-[c:CONTACTED]->(d:Domain)\nWHERE c.thirdParty\nRETURN d.name AS domain, count(s) AS sessions, sum(c.requests) AS requests\nORDER BY requests DESC LIMIT 25' },
  { key: 'graph.ex.scripts', cypher: 'MATCH (p:Page)-[l:LOADS]->(x)-[r:SERVED_FROM]->(d:Domain)\nRETURN p, l, x, r, d LIMIT 150' },
  { key: 'graph.ex.records', cypher: 'MATCH (x:Scrape)-[h:HAS_RECORD]->(r:Record)\nOPTIONAL MATCH (r)-[l:LINKS_TO]->(p:Page)\nRETURN x, h, r, l, p LIMIT 150' }
];

// ---------------------------------------------------------------------------
// values
// ---------------------------------------------------------------------------

interface GNode { _type: 'node'; id: string; labels: string[]; properties: Record<string, unknown> }
interface GRel { _type: 'relationship'; id: string; type: string; start: string; end: string; properties: Record<string, unknown> }
interface GPath { _type: 'path'; nodes: GNode[]; relationships: GRel[] }

const isNode = (v: unknown): v is GNode => !!v && typeof v === 'object' && (v as GNode)._type === 'node';
const isRel = (v: unknown): v is GRel => !!v && typeof v === 'object' && (v as GRel)._type === 'relationship';
const isPath = (v: unknown): v is GPath => !!v && typeof v === 'object' && (v as GPath)._type === 'path';

const NAME_KEYS = ['name', 'title', 'url', 'text', 'selector', 'id', 'uid', 'key'];

function nodeCaption(n: GNode): string {
  for (const k of NAME_KEYS) {
    const v = n.properties[k];
    if (v != null && v !== '') return String(v);
  }
  return n.labels[0] || 'node';
}

const PALETTE = ['#6d8cff', '#3ecf8e', '#f5a524', '#f05d6c', '#a78bfa', '#22c3e6', '#f472b6', '#94a3b8', '#eab308', '#14b8a6', '#fb923c', '#818cf8'];
const LABEL_ORDER = ['Session', 'Page', 'Domain', 'Request', 'Script', 'Stylesheet', 'Cookie', 'ConsoleMessage', 'SecurityHeader', 'Element', 'Scrape', 'Record'];
function labelColor(label: string): string {
  let i = LABEL_ORDER.indexOf(label);
  if (i < 0) i = [...label].reduce((h, c) => h + c.charCodeAt(0), 0);
  return PALETTE[i % PALETTE.length];
}

function cell(v: unknown): string {
  if (v == null) return '<span class="muted">null</span>';
  if (isNode(v)) {
    return `<span class="gnode" style="--c:${labelColor(v.labels[0] || '')}">${esc(v.labels.join(':'))}</span> <span class="ltr">${esc(nodeCaption(v).slice(0, 120))}</span>`;
  }
  if (isRel(v)) return `<code>[:${esc(v.type)}]</code>`;
  if (isPath(v)) return `<code>${esc(t('graph.path', { n: v.relationships.length }))}</code>`;
  if (typeof v === 'object') return `<code class="ltr">${esc(JSON.stringify(v).slice(0, 400))}</code>`;
  return `<span class="ltr">${esc(String(v).slice(0, 400))}</span>`;
}

/** Nodes and relationships found anywhere in the rows. */
function collectGraph(rows: Record<string, unknown>[]): { nodes: Map<string, GNode>; rels: Map<string, GRel> } {
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

// ---------------------------------------------------------------------------
// force-directed canvas
// ---------------------------------------------------------------------------

interface SimNode { n: GNode; x: number; y: number; vx: number; vy: number; fixed: boolean }

function drawGraph(canvas: HTMLCanvasElement, tip: HTMLElement, data: { nodes: Map<string, GNode>; rels: Map<string, GRel> }): () => void {
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
      const props = Object.entries(hover.n.properties).slice(0, 12)
        .map(([k, v]) => `<div><span class="muted">${esc(k)}</span> <span class="ltr">${esc(String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 160))}</span></div>`).join('');
      html(tip, `<strong>${esc(hover.n.labels.join(':'))}</strong>${props}`);
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

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

export function mount(el: HTMLElement, _params: string[], { setHeader }: ViewContext): () => void {
  setHeader(t('graph.title'), t('graph.subtitle'));
  let status: GraphStatus | null = null;
  let result: (GraphQueryResult & { title?: string }) | null = null;
  let mode: 'table' | 'graph' = 'table';
  let stopGraph: (() => void) | null = null;
  let lastCypher = EXAMPLES[0].cypher;

  html(el, `
    <div class="stack">
      <div class="card" id="gStatusCard"></div>
      <div class="graph-grid">
        <div class="stack" style="min-width:0">
          <div class="card">
            <div class="card-head" style="flex-wrap:wrap">${icon('code')}<h3>${esc(t('graph.console'))}</h3><span class="spacer"></span>
              <span class="muted small">${esc(t('graph.readOnly'))}</span></div>
            <div class="chips" id="gExamples" style="margin-bottom:10px">${EXAMPLES.map((x, i) => `<button class="chip" data-ex="${i}">${esc(t(x.key))}</button>`).join('')}</div>
            <textarea class="input textarea ltr mono" id="gCypher" rows="5" spellcheck="false">${esc(lastCypher)}</textarea>
            <div class="row" style="margin-top:10px">
              <button class="btn primary" id="gRun">${icon('play')}${esc(t('graph.run'))}</button>
              <span class="muted small">Ctrl + Enter</span>
              <span class="spacer"></span>
              <button class="btn sm ghost" id="gAskQuery">${icon('zap')}${esc(t('graph.askAbout'))}</button>
            </div>
          </div>
          <div class="card" id="gResult"><div class="empty">${icon('network')}<p>${esc(t('graph.result.empty'))}</p></div></div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head">${icon('zap')}<h3>${esc(t('graph.ask'))}</h3></div>
            <p class="muted small" style="margin-top:0">${esc(t('graph.ask.hint'))}</p>
            <textarea class="input textarea" id="gAsk" rows="3" placeholder="${esc(t('graph.ask.placeholder'))}"></textarea>
            <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" id="gAskBtn">${icon('zap')}${esc(t('graph.ask.send'))}</button></div>
          </div>
          <div class="card">
            <div class="card-head">${icon('search')}<h3>${esc(t('graph.insights'))}</h3></div>
            <ul class="list-plain insight-list" id="gInsights"><li class="muted small">…</li></ul>
          </div>
        </div>
      </div>
    </div>`);

  // ------------------------------------------------------------ status / setup
  const renderStatus = () => {
    const card = $('#gStatusCard', el);
    const s = status;
    const pill = !s ? '<span class="pill"><span class="spinner"></span></span>'
      : s.connected ? `<span class="pill ok"><span class="dot"></span>${esc(t('graph.connected'))}</span>`
      : s.enabled ? `<span class="pill err"><span class="dot"></span>${esc(t('graph.disconnected'))}</span>`
      : `<span class="pill"><span class="dot"></span>${esc(t('graph.notConfigured'))}</span>`;
    const counts = s?.nodes ? Object.entries(s.nodes).filter(([, n]) => n > 0) : [];
    const fromEnv = s?.source === 'env';
    html(card, `
      <div class="card-head" style="flex-wrap:wrap">${icon('database')}<h3>Neo4j</h3>${pill}
        ${s?.version ? `<span class="muted small ltr">${esc(s.version)} · ${esc(s.uri)}</span>` : ''}
        <span class="spacer"></span>
        <button class="btn sm ghost" id="gRefresh">${icon('refresh')}${esc(t('graph.refresh'))}</button>
        <button class="btn sm" id="gSyncAll" ${s?.connected ? '' : 'disabled'}>${icon('refresh')}${esc(t('graph.syncAll'))}</button>
        <button class="btn sm ghost" id="gSetupToggle">${icon('settings')}${esc(t('graph.setup'))}</button>
      </div>
      ${s?.error ? `<p class="small" style="color:var(--err);margin-top:0">${esc(s.error)}</p>` : ''}
      ${counts.length ? `<div class="chips">${counts.map(([label, n]) => `<button class="chip gcount" data-label="${esc(label)}"><span class="gnode" style="--c:${labelColor(label)}">${esc(label)}</span> ${fmtNumber(n)}</button>`).join('')}</div>`
        : s?.connected ? `<p class="muted small" style="margin:0">${esc(t('graph.emptyDb'))}</p>` : ''}
      <form class="stack" id="gSetup" style="margin-top:14px;${s && !s.connected ? '' : 'display:none'}">
        ${fromEnv ? `<p class="hint" style="margin:0">${esc(t('graph.envNote'))}</p>` : ''}
        <p class="muted small" style="margin:0">${esc(t('graph.setup.hint'))}</p>
        <pre class="code ltr" style="margin:0">docker compose up -d neo4j</pre>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <div class="field"><label for="gUri">URI</label><input class="input ltr" id="gUri" value="${esc(s?.uri || 'bolt://localhost:7687')}" spellcheck="false" ${fromEnv ? 'disabled' : ''}></div>
          <div class="field"><label for="gUser">${esc(t('graph.user'))}</label><input class="input ltr" id="gUser" value="${esc(s?.user || 'neo4j')}" spellcheck="false" ${fromEnv ? 'disabled' : ''}></div>
          <div class="field"><label for="gPass">${esc(t('graph.password'))}</label><input class="input ltr" id="gPass" type="password" autocomplete="off" placeholder="${esc(s?.hasPassword ? t('graph.password.keep') : '')}" ${fromEnv ? 'disabled' : ''}></div>
          <div class="field"><label for="gDb">${esc(t('graph.database'))}</label><input class="input ltr" id="gDb" value="${esc(s?.database || '')}" placeholder="neo4j" spellcheck="false" ${fromEnv ? 'disabled' : ''}></div>
        </div>
        <div class="row">
          <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="gEnabled" ${s?.enabled ? 'checked' : ''} ${fromEnv ? 'disabled' : ''}><span></span></span>${esc(t('graph.enabled'))}</label>
          <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="gAuto" ${s?.autoSync ?? true ? 'checked' : ''} ${fromEnv ? 'disabled' : ''}><span></span></span>${esc(t('graph.autoSync'))}</label>
          <span class="spacer"></span>
          <button class="btn primary" type="submit" ${fromEnv ? 'disabled' : ''}>${icon('check')}${esc(t('graph.saveConnect'))}</button>
        </div>
      </form>`);

    $('#gRefresh', card).onclick = () => void loadStatus();
    $('#gSetupToggle', card).onclick = () => {
      const f = $('#gSetup', card);
      f.style.display = f.style.display === 'none' ? '' : 'none';
    };
    $<HTMLButtonElement>('#gSyncAll', card).onclick = async ev => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      b.innerHTML = `<span class="spinner"></span>${esc(t('graph.syncing'))}`;
      try {
        const r = await api.graphSyncAll();
        toast(t('graph.synced', { n: r.synced.length }), r.failed.length ? 'info' : 'ok');
        if (r.failed.length) toast(r.failed.map(f => `${f.sessionId}: ${f.error}`).join('\n'), 'err', 6000);
      } catch (e) {
        toast(errMsg(e), 'err');
      }
      await loadStatus();
    };
    card.querySelectorAll<HTMLElement>('.gcount').forEach(b => {
      b.onclick = () => {
        const label = b.dataset.label!;
        setCypher(`MATCH (n:\`${label}\`)\nOPTIONAL MATCH (n)-[r]-(m)\nRETURN n, r, m LIMIT 150`);
        void run();
      };
    });
    $<HTMLFormElement>('#gSetup', card).onsubmit = async e => {
      e.preventDefault();
      const v = (id: string) => $<HTMLInputElement>(id, card).value;
      try {
        status = await api.graphConfig({
          enabled: $<HTMLInputElement>('#gEnabled', card).checked,
          autoSync: $<HTMLInputElement>('#gAuto', card).checked,
          uri: v('#gUri'),
          user: v('#gUser'),
          database: v('#gDb'),
          password: v('#gPass')
        });
        toast(status.connected ? t('graph.connected') : status.error || t('graph.disconnected'), status.connected ? 'ok' : 'err');
        renderStatus();
        if (status.connected) void loadInsights();
      } catch (err) {
        toast(errMsg(err), 'err');
      }
    };
  };

  const loadStatus = async () => {
    try {
      status = await api.graphStatus();
    } catch (e) {
      status = { enabled: false, connected: false, uri: '', user: '', database: null, autoSync: true, source: 'none', hasPassword: false, error: errMsg(e) };
    }
    if (el.isConnected) renderStatus();
  };

  // ------------------------------------------------------------ insights
  const loadInsights = async () => {
    const box = $('#gInsights', el);
    try {
      const list = await api.graphInsights();
      html(box, list.map(i => `
        <li><button class="insight-btn" data-id="${esc(i.id)}"><strong>${esc(t(`graph.insight.${i.id}`) === `graph.insight.${i.id}` ? i.title : t(`graph.insight.${i.id}`))}</strong>
          <span class="muted small">${esc(t(`graph.insight.${i.id}.d`) === `graph.insight.${i.id}.d` ? i.description : t(`graph.insight.${i.id}.d`))}</span></button></li>`).join(''));
      box.querySelectorAll<HTMLElement>('[data-id]').forEach(b => {
        b.onclick = async () => {
          $$('.insight-btn', box).forEach(x => x.classList.toggle('active', x === b));
          showLoading();
          try {
            const r = await api.graphInsight(b.dataset.id!);
            setCypher(r.cypher.replace(/^ {6}/gm, ''));
            result = { ...r, title: r.insight.title };
            renderResult();
          } catch (e) {
            showError(errMsg(e));
          }
        };
      });
    } catch (e) {
      box.innerHTML = `<span class="muted small">${esc(errMsg(e))}</span>`;
    }
  };

  // ------------------------------------------------------------ query console
  const cypherBox = () => $<HTMLTextAreaElement>('#gCypher', el);
  const setCypher = (q: string) => { lastCypher = q; cypherBox().value = q; };

  const showLoading = () => {
    stopGraph?.(); stopGraph = null;
    html($('#gResult', el), `<div class="empty"><span class="spinner"></span></div>`);
  };
  const showError = (msg: string) => {
    stopGraph?.(); stopGraph = null;
    html($('#gResult', el), `<div class="ai-msg error">${icon('alert')}<span class="ltr">${esc(msg)}</span></div>`);
  };

  const run = async () => {
    const q = cypherBox().value.trim();
    if (!q) return;
    lastCypher = q;
    showLoading();
    try {
      result = await api.graphQuery(q);
      renderResult();
    } catch (e) {
      showError(errMsg(e));
    }
  };

  const renderResult = () => {
    stopGraph?.(); stopGraph = null;
    const box = $('#gResult', el);
    if (!result) return;
    const g = collectGraph(result.rows);
    const canGraph = g.nodes.size > 0;
    if (!canGraph) mode = 'table';
    else if (result.title === undefined && mode === 'table' && g.rels.size > 0) mode = 'graph';
    html(box, `
      <div class="card-head" style="flex-wrap:wrap">${icon(mode === 'graph' ? 'network' : 'layers')}<h3>${esc(result.title || t('graph.result'))}</h3>
        <span class="muted small">${esc(t('graph.rows', { n: fmtNumber(result.rows.length) }))}${result.truncated ? ' +' : ''} · ${fmtNumber(result.ms)} ms</span>
        <span class="spacer"></span>
        ${canGraph ? `<div class="seg" id="gMode"><button data-m="table" class="${mode === 'table' ? 'active' : ''}">${esc(t('graph.table'))}</button><button data-m="graph" class="${mode === 'graph' ? 'active' : ''}">${esc(t('graph.graph'))}</button></div>` : ''}
        <button class="btn sm ghost" id="gExplain">${icon('zap')}${esc(t('graph.explain'))}</button>
      </div>
      ${!result.rows.length ? `<div class="empty"><p>${esc(t('graph.noRows'))}</p></div>`
        : mode === 'graph' ? `<div class="graph-canvas-wrap"><canvas id="gCanvas"></canvas><div class="graph-tip" id="gTip"></div>
            <div class="graph-legend">${[...new Set([...g.nodes.values()].map(n => n.labels[0] || ''))].map(l => `<span class="gnode" style="--c:${labelColor(l)}">${esc(l)}</span>`).join('')}</div></div>`
        : `<div class="table-wrap" style="max-height:560px"><table class="table">
            <thead><tr>${result.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${result.rows.map(r => `<tr>${result!.columns.map(c => `<td class="gcell">${cell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>`}`);
    box.querySelector('#gMode')?.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('[data-m]');
      if (!b) return;
      mode = b.dataset.m as typeof mode;
      renderResult();
    });
    $('#gExplain', box).onclick = () => {
      const sample = JSON.stringify(result!.rows.slice(0, 30)).slice(0, 6000);
      askAssistant(t('graph.explain.prompt', { query: lastCypher, rows: sample }));
    };
    if (mode === 'graph' && result.rows.length) stopGraph = drawGraph($<HTMLCanvasElement>('#gCanvas', box), $('#gTip', box), g);
  };

  $('#gExamples', el).onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ex]');
    if (!b) return;
    setCypher(EXAMPLES[Number(b.dataset.ex)].cypher);
    void run();
  };
  $('#gRun', el).onclick = () => void run();
  cypherBox().addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); }
  });
  $('#gAskQuery', el).onclick = () => askAssistant(t('graph.askAbout.prompt', { query: cypherBox().value.trim() }));

  const ask = () => {
    const q = $<HTMLTextAreaElement>('#gAsk', el).value.trim();
    if (q) askAssistant(t('graph.ask.prefix') + q);
  };
  $('#gAskBtn', el).onclick = ask;
  $<HTMLTextAreaElement>('#gAsk', el).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });

  renderStatus();
  void loadStatus().then(() => { if (status?.connected) void loadInsights(); else $('#gInsights', el).innerHTML = `<span class="muted small">${esc(t('graph.insights.needDb'))}</span>`; });
  return () => { stopGraph?.(); };
}
