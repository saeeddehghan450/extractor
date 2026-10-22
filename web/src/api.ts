// Thin wrapper around the dashboard API
import type {
  Analysis, Config, ConfigPatch, FileEntry, LiveState, Meta, NetworkRequest, NetworkResponse, SessionSummary, SnapshotSummary
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

export const api = {
  meta: () => request<Meta>('GET', '/api/meta'),
  config: () => request<Config>('GET', '/api/config'),
  saveConfig: (patch: ConfigPatch) => request<Config>('PUT', '/api/config', patch),
  applyPreset: (key: string) => request<Config>('POST', `/api/presets/${encodeURIComponent(key)}`, {}),

  session: () => request<SessionSummary | null>('GET', '/api/session'),
  liveState: () => request<LiveState | null>('GET', '/api/session/live'),
  start: (body: { url?: string; headless?: boolean }) => request<SessionSummary>('POST', '/api/session/start', body),
  snapshot: () => request<SnapshotSummary>('POST', '/api/session/snapshot', {}),
  stop: () => request<SessionSummary>('POST', '/api/session/stop', {}),
  input: (body: InputAction) => request<{ ok: boolean; url: string | null }>('POST', '/api/session/input', body),
  liveRequest: (id: string) =>
    request<{ request: NetworkRequest | null; response: NetworkResponse | null }>('GET', `/api/session/request/${encodeURIComponent(id)}`),

  sessions: () => request<SessionSummary[]>('GET', '/api/sessions'),
  savedSession: (id: string) => request<SessionSummary>('GET', `/api/sessions/${sid(id)}`),
  deleteSession: (id: string) => request<{ ok: boolean }>('DELETE', `/api/sessions/${sid(id)}`),
  files: (id: string) => request<FileEntry[]>('GET', `/api/sessions/${sid(id)}/files`),
  fileUrl: (id: string, path: string, download = false) =>
    `/api/sessions/${sid(id)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  async json<T = Analysis>(id: string, path: string): Promise<T> {
    const res = await fetch(api.fileUrl(id, path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }
};
