// Thin wrapper around the dashboard API
import type {
  Analysis, Config, ConfigPatch, EmulationOptions, FileEntry, LiveState, Meta, NetworkRequest, NetworkResponse, SearchResult,
  SessionSummary, SnapshotSummary, ScrapeRecipe
} from './types.js';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && typeof data === 'object' && data.error) || res.statusText);
  return data as T;
}

export type InputAction =
  | { action: 'click'; x: number; y: number }
  | { action: 'scroll'; deltaY: number }
  | { action: 'type'; text: string }
  | { action: 'press'; key: string }
  | { action: 'navigate'; url: string }
  | { action: 'back' | 'forward' | 'reload' };

const sid = (id: string) => encodeURIComponent(id);

export interface GraphStatus {
  enabled: boolean;
  connected: boolean;
  uri: string;
  user: string;
  database: string | null;
  autoSync: boolean;
  source: 'env' | 'config' | 'none';
  hasPassword: boolean;
  version?: string;
  error?: string;
  nodes?: Record<string, number>;
  relationships?: Record<string, number>;
}

export interface GraphQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
}

export interface GraphSyncResult { sessionId: string; requests: number; domains: number; pages: number; records: number; ms: number }

export const api = {
  meta: () => request<Meta>('GET', '/api/meta'),
  config: () => request<Config>('GET', '/api/config'),
  saveConfig: (patch: ConfigPatch) => request<Config>('PUT', '/api/config', patch),
  applyPreset: (key: string) => request<Config>('POST', `/api/presets/${encodeURIComponent(key)}`, {}),

  session: () => request<SessionSummary | null>('GET', '/api/session'),
  liveState: () => request<LiveState | null>('GET', '/api/session/live'),
  start: (body: { url?: string; headless?: boolean; emulation?: Partial<EmulationOptions> }) => request<SessionSummary>('POST', '/api/session/start', body),
  snapshot: () => request<SnapshotSummary>('POST', '/api/session/snapshot', {}),
  stop: () => request<SessionSummary>('POST', '/api/session/stop', {}),
  input: (body: InputAction) => request<{ ok: boolean; url: string | null }>('POST', '/api/session/input', body),
  liveRequest: (id: string) =>
    request<{ request: NetworkRequest | null; response: NetworkResponse | null }>('GET', `/api/session/request/${encodeURIComponent(id)}`),

  liveHarUrl: () => '/api/session/har',

  scraperPreview: (recipe: ScrapeRecipe) =>
    request<{ rows: Record<string, string | null>[]; url: string }>('POST', '/api/scraper/preview', { recipe }),
  scraperRun: (recipe: ScrapeRecipe) =>
    request<{ rows: Record<string, string | null>[]; pages: number; startUrl: string; url: string; stoppedBecause: string; sessionId: string; files: { json: string; csv: string; md: string } | null }>('POST', '/api/scraper/run', { recipe }),
  scraperCount: (selector: string, itemSelector?: string) =>
    request<{ count: number; valid: boolean }>('POST', '/api/scraper/count', { selector, itemSelector }),
  recipes: () => request<(ScrapeRecipe & { updatedAt: string })[]>('GET', '/api/scraper/recipes'),
  saveRecipe: (recipe: ScrapeRecipe) => request<ScrapeRecipe>('POST', '/api/scraper/recipes', { recipe }),
  deleteRecipe: (name: string) => request<{ ok: boolean }>('DELETE', `/api/scraper/recipes/${encodeURIComponent(name)}`),

  graphStatus: () => request<GraphStatus>('GET', '/api/graph/status'),
  graphConfig: (body: { enabled?: boolean; uri?: string; user?: string; password?: string; database?: string; autoSync?: boolean }) =>
    request<GraphStatus>('PUT', '/api/graph/config', body),
  graphQuery: (cypher: string, params: Record<string, unknown> = {}) => request<GraphQueryResult>('POST', '/api/graph/query', { cypher, params }),
  graphInsights: () => request<{ id: string; title: string; description: string }[]>('GET', '/api/graph/insights'),
  graphInsight: (id: string, sessionId?: string) =>
    request<GraphQueryResult & { cypher: string; insight: { id: string; title: string; description: string } }>('POST', '/api/graph/insights', { id, sessionId }),
  graphSync: (sessionId?: string) => request<GraphSyncResult>('POST', '/api/graph/sync', { sessionId }),
  graphSyncAll: () => request<{ synced: GraphSyncResult[]; failed: { sessionId: string; error: string }[] }>('POST', '/api/graph/sync', { all: true }),

  sessions: () => request<SessionSummary[]>('GET', '/api/sessions'),
  savedSession: (id: string) => request<SessionSummary>('GET', `/api/sessions/${sid(id)}`),
  deleteSession: (id: string) => request<{ ok: boolean }>('DELETE', `/api/sessions/${sid(id)}`),
  files: (id: string) => request<FileEntry[]>('GET', `/api/sessions/${sid(id)}/files`),
  fileUrl: (id: string, path: string, download = false) =>
    `/api/sessions/${sid(id)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  reportUrl: (id: string, lang: string, download = false) =>
    `/api/sessions/${sid(id)}/report?lang=${encodeURIComponent(lang)}${download ? '&download=1' : ''}`,
  search: (id: string, q: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}) =>
    request<SearchResult>('GET', `/api/sessions/${sid(id)}/search?q=${encodeURIComponent(q)}${opts.regex ? '&regex=1' : ''}${opts.caseSensitive ? '&case=1' : ''}`),
  async json<T = Analysis>(id: string, path: string): Promise<T> {
    const res = await fetch(api.fileUrl(id, path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }
};
