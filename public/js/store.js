// Global client state + live event stream
import { api } from './api.js';

const listeners = new Map();

export const state = {
  meta: null,
  config: null,
  connected: false,
  session: null, // live session summary
  live: resetLive()
};

function resetLive() {
  return { sessionId: null, rows: new Map(), order: [], console: [], logs: [], clicks: [], pending: null };
}

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function emit(type, data) {
  (listeners.get(type) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  (listeners.get('*') || []).forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });
}

const MAX_ROWS = 3000;
const MAX_LINES = 2000;

function ensureSession(summary) {
  if (!summary) return;
  if (state.live.sessionId !== summary.id) {
    state.live = resetLive();
    state.live.sessionId = summary.id;
  }
}

function upsertRow(id, patch) {
  const rows = state.live.rows;
  let row = rows.get(id);
  if (!row) {
    row = { id };
    rows.set(id, row);
    state.live.order.push(id);
    if (state.live.order.length > MAX_ROWS) rows.delete(state.live.order.shift());
  }
  Object.assign(row, patch);
}

function pushLine(list, item, max = MAX_LINES) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export async function loadLive() {
  const data = await api.liveState();
  if (!data) { state.session = null; return; }
  state.session = data.summary;
  state.live = resetLive();
  state.live.sessionId = data.summary.id;
  for (const r of data.requests) upsertRow(r.id, r);
  state.live.console = data.console;
  state.live.clicks = data.clicks;
}

export function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => { state.connected = true; emit('connection', true); };
  es.onerror = () => { state.connected = false; emit('connection', false); };

  const handle = (type, fn) => es.addEventListener(type, ev => {
    const data = JSON.parse(ev.data);
    fn?.(data);
    emit(type, data);
  });

  handle('hello', d => {
    if (d.session && d.session.id !== state.live.sessionId) {
      loadLive().then(() => emit('status', state.session)).catch(() => undefined);
    } else {
      state.session = d.session;
    }
  });
  handle('status', s => { ensureSession(s); state.session = s; });
  handle('request', r => { upsertRow(r.id, r); });
  handle('response', r => { if (r.requestId) upsertRow(r.requestId, { response: r }); });
  handle('console', m => pushLine(state.live.console, m));
  handle('log', l => pushLine(state.live.logs, l, 500));
  handle('click', c => pushLine(state.live.clicks, c, 500));
  handle('snapshot-start', d => { state.live.pending = d; });
  handle('snapshot', s => {
    state.live.pending = null;
    if (state.session) {
      state.session.snapshots = [...(state.session.snapshots || []), s];
      state.session.counts = { ...state.session.counts, snapshots: state.session.snapshots.length };
    }
  });
  handle('navigated', d => { if (state.session) state.session.currentUrl = d.url; });
  handle('counts', d => { if (state.session && state.session.id === d.id) state.session.counts = d.counts; });
  return es;
}
