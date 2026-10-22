// Global client state + live event stream
import { api } from './api.js';
import type {
  ClickInfo, CompactResponse, Config, ConsoleLine, LogEntry, Meta, NetworkRow, SessionCounts, SessionSummary, SnapshotReason, SnapshotSummary
} from './types.js';

/** Events delivered by the server (SSE) plus the client-side "connection" event. */
export interface EventMap {
  connection: boolean;
  hello: { session: SessionSummary | null };
  status: SessionSummary | null;
  request: NetworkRow;
  response: CompactResponse;
  console: ConsoleLine;
  log: LogEntry;
  click: ClickInfo;
  'snapshot-start': { seq: number; reason: SnapshotReason };
  snapshot: SnapshotSummary;
  navigated: { url: string };
  counts: { id: string; counts: SessionCounts };
}
export type EventType = keyof EventMap;
type Listener<K extends EventType> = (data: EventMap[K]) => void;
type AnyListener = <K extends EventType>(type: K, data: EventMap[K]) => void;

export interface LiveData {
  sessionId: string | null;
  rows: Map<string, NetworkRow>;
  order: string[];
  console: ConsoleLine[];
  logs: LogEntry[];
  clicks: ClickInfo[];
  pending: EventMap['snapshot-start'] | null;
}

export const state: {
  meta: Meta | null;
  config: Config | null;
  connected: boolean;
  session: SessionSummary | null;
  live: LiveData;
} = {
  meta: null,
  config: null,
  connected: false,
  session: null,
  live: resetLive()
};

function resetLive(): LiveData {
  return { sessionId: null, rows: new Map(), order: [], console: [], logs: [], clicks: [], pending: null };
}

const listeners = new Map<EventType, Set<Listener<any>>>();
const anyListeners = new Set<AnyListener>();

export function on<K extends EventType>(type: K, fn: Listener<K>): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
  return () => { listeners.get(type)!.delete(fn); };
}

/** Listen to every event. */
export function onAny(fn: AnyListener): () => void {
  anyListeners.add(fn);
  return () => { anyListeners.delete(fn); };
}

export function emit<K extends EventType>(type: K, data: EventMap[K]): void {
  (listeners.get(type) || new Set()).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  anyListeners.forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });
}

const MAX_ROWS = 3000;
const MAX_LINES = 2000;

function ensureSession(summary: SessionSummary | null) {
  if (!summary) return;
  if (state.live.sessionId !== summary.id) {
    state.live = resetLive();
    state.live.sessionId = summary.id;
  }
}

function upsertRow(id: string, patch: Partial<NetworkRow>) {
  const rows = state.live.rows;
  let row = rows.get(id);
  if (!row) {
    row = { id };
    rows.set(id, row);
    state.live.order.push(id);
    if (state.live.order.length > MAX_ROWS) rows.delete(state.live.order.shift()!);
  }
  Object.assign(row, patch);
}

function pushLine<T>(list: T[], item: T, max = MAX_LINES) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export async function loadLive(): Promise<void> {
  const data = await api.liveState();
  if (!data) { state.session = null; return; }
  state.session = data.summary;
  state.live = resetLive();
  state.live.sessionId = data.summary.id;
  for (const r of data.requests) upsertRow(r.id, r);
  state.live.console = data.console;
  state.live.clicks = data.clicks;
}

export function connectEvents(): EventSource {
  const es = new EventSource('/api/events');
  es.onopen = () => { state.connected = true; emit('connection', true); };
  es.onerror = () => { state.connected = false; emit('connection', false); };

  const handle = <K extends EventType>(type: K, fn?: (data: EventMap[K]) => void) =>
    es.addEventListener(type, ev => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as EventMap[K];
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
