// Thin wrapper around the dashboard API
async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

export const api = {
  meta: () => request('GET', '/api/meta'),
  config: () => request('GET', '/api/config'),
  saveConfig: patch => request('PUT', '/api/config', patch),
  applyPreset: key => request('POST', `/api/presets/${encodeURIComponent(key)}`, {}),

  session: () => request('GET', '/api/session'),
  liveState: () => request('GET', '/api/session/live'),
  start: body => request('POST', '/api/session/start', body),
  snapshot: () => request('POST', '/api/session/snapshot', {}),
  stop: () => request('POST', '/api/session/stop', {}),
  input: body => request('POST', '/api/session/input', body),
  liveRequest: id => request('GET', `/api/session/request/${encodeURIComponent(id)}`),

  sessions: () => request('GET', '/api/sessions'),
  savedSession: id => request('GET', `/api/sessions/${encodeURIComponent(id)}`),
  deleteSession: id => request('DELETE', `/api/sessions/${encodeURIComponent(id)}`),
  files: id => request('GET', `/api/sessions/${encodeURIComponent(id)}/files`),
  fileUrl: (id, path, download = false) =>
    `/api/sessions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  async json(id, path) {
    const res = await fetch(this.fileUrl(id, path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
};
