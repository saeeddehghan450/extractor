// Client for the dashboard API (served by the NestJS backend on the same origin)
import type {
  Analysis, ArchiveResult, ArchivedSession, Config, ConfigPatch, EmulationOptions, FileEntry, GraphStatus, GraphSyncResult, Insight,
  LiveState, Meta, NetworkRequest, NetworkResponse, QueryResult, ScrapeRecipe, SearchResult, ServerAgentConfig, SessionSummary,
  SnapshotSummary, StorageStatus
} from './types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  let data: unknown = text;
  if (isJson) data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === 'object' ? (data as { error?: string }).error : undefined;
    throw new Error(message || res.statusText);
  }
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

export type ScrapeRun = {
  rows: Record<string, string | null>[];
  pages: number;
  startUrl: string;
  url: string;
  stoppedBecause: string;
  sessionId: string;
  files: { json: string; csv: string; md: string } | null;
};

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

  scraperPreview: (recipe: ScrapeRecipe) => request<{ rows: Record<string, string | null>[]; url: string }>('POST', '/api/scraper/preview', { recipe }),
  scraperRun: (recipe: ScrapeRecipe) => request<ScrapeRun>('POST', '/api/scraper/run', { recipe }),
  scraperCount: (selector: string, itemSelector?: string) => request<{ count: number; valid: boolean }>('POST', '/api/scraper/count', { selector, itemSelector }),
  recipes: () => request<(ScrapeRecipe & { updatedAt: string })[]>('GET', '/api/scraper/recipes'),
  saveRecipe: (recipe: ScrapeRecipe) => request<ScrapeRecipe>('POST', '/api/scraper/recipes', { recipe }),
  deleteRecipe: (name: string) => request<{ ok: boolean }>('DELETE', `/api/scraper/recipes/${encodeURIComponent(name)}`),

  graphStatus: () => request<GraphStatus>('GET', '/api/graph/status'),
  graphConfig: (body: { enabled?: boolean; uri?: string; user?: string; password?: string; database?: string; autoSync?: boolean }) =>
    request<GraphStatus>('PUT', '/api/graph/config', body),
  graphQuery: (cypher: string, params: Record<string, unknown> = {}) => request<QueryResult>('POST', '/api/graph/query', { cypher, params }),
  graphInsights: () => request<Insight[]>('GET', '/api/graph/insights'),
  graphInsight: (id: string, sessionId?: string) =>
    request<QueryResult & { cypher: string; insight: Insight }>('POST', '/api/graph/insights', { id, sessionId }),
  graphSync: (sessionId?: string) => request<GraphSyncResult>('POST', '/api/graph/sync', { sessionId }),
  graphSyncAll: () => request<{ synced: GraphSyncResult[]; failed: { sessionId: string; error: string }[] }>('POST', '/api/graph/sync', { all: true }),

  storageStatus: () => request<StorageStatus>('GET', '/api/storage/status'),
  storageConfig: (body: {
    postgres?: { enabled?: boolean; url?: string };
    s3?: { enabled?: boolean; endpoint?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string };
    autoArchive?: boolean;
  }) => request<StorageStatus>('PUT', '/api/storage/config', body),
  archivedSessions: () => request<ArchivedSession[]>('GET', '/api/storage/sessions'),
  archiveSession: (sessionId: string, removeLocal = false) => request<ArchiveResult>('POST', '/api/storage/archive', { sessionId, removeLocal }),
  archiveAll: () => request<{ archived: ArchiveResult[]; failed: { sessionId: string; error: string }[] }>('POST', '/api/storage/archive', { all: true }),
  restoreSession: (sessionId: string) => request<{ sessionId: string; files: number; bytes: number }>('POST', '/api/storage/restore', { sessionId }),
  forgetArchived: (sessionId: string) => request<{ ok: boolean }>('DELETE', `/api/storage/sessions/${encodeURIComponent(sessionId)}`),
  storageSql: (sql: string, params: unknown[] = []) => request<QueryResult>('POST', '/api/storage/sql', { sql, params }),
  storageSchema: () => request<{ schema: string }>('GET', '/api/storage/schema'),

  agentConfig: () => request<ServerAgentConfig>('GET', '/api/agent/config'),
  agentReset: (conversationId: string) => request<{ ok: boolean }>('POST', '/api/agent/reset', { conversationId }),

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
