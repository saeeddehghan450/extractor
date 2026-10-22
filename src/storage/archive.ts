/**
 * archive.ts
 *
 * Long-term storage of sessions:
 *  - every file of the session folder -> SeaweedFS (S3), skipping files that did not change
 *  - structured data (session, requests, console, cookies, security headers, scrapes + records,
 *    file index) -> PostgreSQL, replaced on every archive so archiving twice gives the same rows
 * and the way back: restoring an archived session into the output folder.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { controller } from '../core/controller';
import type { ExtractorSession } from '../core/session';
import { listSessionFiles, listSessions, sessionDir } from '../core/sessionStore';
import { ensureDir, readJSON } from '../utils/fileUtils';
import { info, warn } from '../utils/logger';
import { cleanPgError, ensureSchema, getPool, withTransaction } from './postgres';
import { cleanS3Error, deleteKeys, downloadTo, ensureBucket, listObjects, putFile, sessionKey } from './objectStore';
import { StorageError, autoArchiveEnabled, postgresSettings, s3Settings } from './settings';

const TYPES: Record<string, string> = {
  '.json': 'application/json', '.har': 'application/json', '.html': 'text/html', '.htm': 'text/html',
  '.md': 'text/markdown', '.csv': 'text/csv', '.txt': 'text/plain', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.map': 'application/json', '.heapsnapshot': 'application/json'
};

export function contentTypeOf(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function md5Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** JSON for jsonb parameters: PostgreSQL rejects \u0000 in text and jsonb, so NUL characters are dropped. */
function toJson(v: unknown): string {
  return JSON.stringify(v).replace(/(?<!\\)((?:\\\\)*)\\u0000/g, '$1');
}

const iso = (v: unknown) => (typeof v === 'string' && v ? v : null);
const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

export interface ArchiveResult {
  sessionId: string;
  files: { total: number; uploaded: number; skipped: number; bytes: number } | null;
  database: { requests: number; console: number; cookies: number; scrapes: number; records: number } | null;
  removedLocal: boolean;
  ms: number;
}

function storageEnabled() {
  const pg = postgresSettings().enabled;
  const s3 = s3Settings().enabled;
  if (!pg && !s3) throw new StorageError(409, 'Storage is not configured - set up PostgreSQL and/or SeaweedFS on the Storage page');
  return { pg, s3 };
}

function resolveFinished(sessionId?: string): string {
  if (!sessionId) {
    const latest = listSessions().find(s => s.analysisFile && s.status === 'finished');
    if (!latest) throw new StorageError(404, 'No finished session to archive');
    return latest.id;
  }
  const cur = controller.current;
  if (cur && cur.id === sessionId && cur.status !== 'finished' && cur.status !== 'error') {
    throw new StorageError(409, 'The session is still running - stop it first (it is archived automatically when it finishes)');
  }
  return sessionId;
}

/** Serialize work per session (auto-archive and a manual archive can overlap). */
const locks = new Map<string, Promise<unknown>>();
function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const job = (locks.get(id) || Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(id, job);
  void job.catch(() => undefined).finally(() => { if (locks.get(id) === job) locks.delete(id); });
  return job;
}

export function archiveSession(sessionId?: string, opts: { removeLocal?: boolean } = {}): Promise<ArchiveResult> {
  let id: string;
  try {
    storageEnabled();
    id = resolveFinished(sessionId);
  } catch (e) {
    return Promise.reject(e);
  }
  return locked(id, () => doArchive(id, opts));
}

async function doArchive(id: string, opts: { removeLocal?: boolean }): Promise<ArchiveResult> {
  const started = Date.now();
  const { pg, s3 } = storageEnabled();
  const dir = sessionDir(id);
  const summary = readJSON<any>(path.join(dir, 'session.json'));
  const analysis = readJSON<any>(path.join(dir, 'analysis.json'));
  if (!summary) throw new StorageError(404, `Session ${id} not found in the output folder`);
  if (!analysis) throw new StorageError(409, `Session ${id} has no analysis.json (it did not finish)`);

  // --- files -> SeaweedFS
  const entries = listSessionFiles(id);
  let fileRows: { path: string; size: number; md5: string; content_type: string; object_key: string }[] = [];
  let filesResult: ArchiveResult['files'] = null;
  if (s3) {
    const previous = new Map<string, { size: number; md5: string }>();
    if (pg) {
      try {
        await ensureSchema();
        const r = await getPool().query('SELECT path, size, md5 FROM extractor.files WHERE session_id = $1', [id]);
        for (const row of r.rows) previous.set(row.path, { size: Number(row.size), md5: row.md5 });
      } catch (e) {
        throw new StorageError(502, `PostgreSQL: ${cleanPgError(e)}`);
      }
    }
    let uploaded = 0;
    try {
      await ensureBucket();
      // what is really in the bucket (the index in PostgreSQL may describe another bucket or be stale)
      const stored = new Map((await listObjects(sessionKey(id))).objects.map(o => [o.key, o.size]));
      fileRows = await mapLimit(entries, 8, async f => {
        const full = path.join(dir, f.path);
        const md5 = await md5Of(full);
        const key = sessionKey(id, f.path);
        const prev = previous.get(f.path);
        if (!prev || prev.size !== f.size || prev.md5 !== md5 || stored.get(key) !== f.size) {
          await putFile(key, full, contentTypeOf(f.path));
          uploaded++;
        }
        return { path: f.path, size: f.size, md5, content_type: contentTypeOf(f.path), object_key: key };
      });
      // objects of files that no longer exist locally
      const wanted = new Set(fileRows.map(f => f.object_key));
      const stale = [...stored.keys()].filter(k => !wanted.has(k));
      if (stale.length) await deleteKeys(stale);
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError(502, `SeaweedFS: ${cleanS3Error(e)}`);
    }
    filesResult = { total: fileRows.length, uploaded, skipped: fileRows.length - uploaded, bytes: fileRows.reduce((n, f) => n + f.size, 0) };
  }

  // --- structured data -> PostgreSQL
  let dbResult: ArchiveResult['database'] = null;
  if (pg) {
    try {
      dbResult = await withTransaction(c => writeRows(c, id, dir, summary, analysis, fileRows, s3));
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError(502, `PostgreSQL: ${cleanPgError(e)}`);
    }
  }

  let removedLocal = false;
  if (opts.removeLocal) {
    if (!s3) throw new StorageError(409, 'Local files can only be removed when SeaweedFS keeps a copy');
    // never delete the only copy: every file must be in the bucket with the same size
    const stored = new Map((await listObjects(sessionKey(id))).objects.map(o => [o.key, o.size]));
    const missing = fileRows.filter(f => stored.get(f.object_key) !== f.size);
    if (missing.length) throw new StorageError(500, `Not removing the local copy: ${missing.length} files are missing in SeaweedFS (e.g. ${missing[0].path})`);
    fs.rmSync(dir, { recursive: true, force: true });
    removedLocal = true;
  }
  return { sessionId: id, files: filesResult, database: dbResult, removedLocal, ms: Date.now() - started };
}

async function writeRows(
  c: import('pg').PoolClient, id: string, dir: string, s: any, a: any,
  files: { path: string; size: number; md5: string; content_type: string; object_key: string }[], withFiles: boolean
) {
  await c.query('DELETE FROM extractor.sessions WHERE id = $1', [id]);
  await c.query(`INSERT INTO extractor.sessions (id, url, host, status, started_at, ended_at, device, network, requests, errors, title,
      summary, overview, archived_at, file_count, total_bytes)
    VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, now(), $14, $15)`, [
    id, s.url, hostOf(s.url), s.status, iso(s.startedAt), iso(s.endedAt), s.emulation?.deviceLabel ?? null, s.emulation?.networkLabel ?? null,
    s.counts?.requests ?? a.network?.requests?.length ?? 0, s.counts?.errors ?? 0, a.elements?.overview?.title ?? null,
    toJson(s), toJson(a.elements?.overview ?? null), files.length, files.reduce((n, f) => n + f.size, 0)
  ]);

  const insert = async (table: string, columns: string, types: string, rows: unknown[]) => {
    for (let i = 0; i < rows.length; i += 2000) {
      await c.query(`INSERT INTO extractor.${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(${types}) ON CONFLICT DO NOTHING`,
        [toJson(rows.slice(i, i + 2000))]);
    }
  };

  const resps = new Map<string, any>((a.network?.responses || []).map((r: any) => [r.requestId, r]));
  const requests = (a.network?.requests || []).map((r: any) => {
    const resp = resps.get(r.id);
    return {
      session_id: id, id: r.id, url: clip(r.url, 8000), host: hostOf(r.url), method: r.method, resource_type: r.resourceType,
      status: resp?.status ?? null, size: resp?.size ?? null, duration_ms: resp?.durationMs ?? null, failure: r.failure || null,
      content_type: resp?.contentType || null, started_at: iso(r.timestamp), request_headers: r.headers || null, response_headers: resp?.headers || null
    };
  });
  await insert('requests', 'session_id, id, url, host, method, resource_type, status, size, duration_ms, failure, content_type, started_at, request_headers, response_headers',
    'session_id text, id text, url text, host text, method text, resource_type text, status integer, size bigint, duration_ms double precision, failure text, content_type text, started_at timestamptz, request_headers jsonb, response_headers jsonb', requests);

  const consoleRows = [
    ...(a.console?.logs || []).map((l: any) => ({ type: l.type, text: l.text, source: l.location?.url || null, line: l.location?.lineNumber ?? null, at: l.timestamp })),
    ...(a.console?.pageErrors || []).map((e: any) => ({ type: 'uncaught', text: `${e.message}${e.stack ? `\n${e.stack}` : ''}`, source: null, line: null, at: e.timestamp })),
    ...(a.console?.dialogs || []).map((d: any) => ({ type: 'dialog', text: `[${d.type}] ${d.message}`, source: null, line: null, at: d.timestamp }))
  ].map((m, seq) => ({ session_id: id, seq, ...m, text: clip(m.text, 20000), at: iso(m.at) }));
  await insert('console_messages', 'session_id, seq, type, text, source, line, at',
    'session_id text, seq integer, type text, text text, source text, line integer, at timestamptz', consoleRows);

  const cookies = (a.application?.cookies || []).map((k: any) => ({
    session_id: id, domain: String(k.domain || '').replace(/^\./, ''), name: k.name, path: k.path || '/', value: clip(k.value, 8000),
    secure: !!k.secure, http_only: !!k.httpOnly, same_site: k.sameSite || null,
    expires: typeof k.expires === 'number' && k.expires > 0 ? new Date(k.expires * 1000).toISOString() : null
  }));
  await insert('cookies', 'session_id, domain, name, path, value, secure, http_only, same_site, expires',
    'session_id text, domain text, name text, path text, value text, secure boolean, http_only boolean, same_site text, expires timestamptz', cookies);

  const sec = a.security;
  const headers = sec ? [
    ...Object.entries(sec.securityHeaders || {}).filter(([, v]) => v != null).map(([name, value]) => ({ session_id: id, name, value: clip(value, 4000), present: true })),
    ...(sec.missingHeaders || []).map((name: string) => ({ session_id: id, name, value: null, present: false }))
  ] : [];
  await insert('security_headers', 'session_id, name, value, present', 'session_id text, name text, value text, present boolean', headers);

  let scrapes = 0;
  let records = 0;
  const scrapeDir = path.join(dir, 'scrapes');
  if (fs.existsSync(scrapeDir)) {
    for (const f of fs.readdirSync(scrapeDir).filter(n => n.endsWith('.json')).sort()) {
      const data = readJSON<any>(path.join(scrapeDir, f));
      if (!data?.rows) continue;
      const scrapeId = `${id}:${path.basename(f, '.json')}`;
      await c.query(`INSERT INTO extractor.scrapes (id, session_id, name, url, pages, row_count, scraped_at, recipe)
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`, [
        scrapeId, id, data.recipe?.name || path.basename(f, '.json'), data.startUrl || data.url || null, data.pages ?? 1,
        data.rows.length, iso(data.scrapedAt), toJson(data.recipe ?? null)
      ]);
      await insert('scrape_records', 'scrape_id, idx, data', 'scrape_id text, idx integer, data jsonb',
        data.rows.map((row: unknown, idx: number) => ({ scrape_id: scrapeId, idx, data: row })));
      scrapes++;
      records += data.rows.length;
    }
  }

  if (withFiles) {
    await insert('files', 'session_id, path, size, md5, content_type, object_key, uploaded_at',
      'session_id text, path text, size bigint, md5 text, content_type text, object_key text, uploaded_at timestamptz',
      files.map(f => ({ session_id: id, ...f, uploaded_at: new Date().toISOString() })));
  }
  return { requests: requests.length, console: consoleRows.length, cookies: cookies.length, scrapes, records };
}

/** Archive every finished session of the output folder. */
export async function archiveAll(): Promise<{ archived: ArchiveResult[]; failed: { sessionId: string; error: string }[] }> {
  storageEnabled();
  const archived: ArchiveResult[] = [];
  const failed: { sessionId: string; error: string }[] = [];
  for (const s of listSessions().filter(x => x.analysisFile && x.status === 'finished')) {
    try {
      archived.push(await archiveSession(s.id));
    } catch (e) {
      failed.push({ sessionId: s.id, error: (e as Error).message });
    }
  }
  return { archived, failed };
}

// ---------------------------------------------------------------------------
// archived sessions
// ---------------------------------------------------------------------------

export interface ArchivedSession {
  id: string;
  url: string | null;
  status: string | null;
  startedAt: string | null;
  archivedAt: string | null;
  files: number | null;
  bytes: number | null;
  requests: number | null;
  /** the session folder exists in the output folder */
  local: boolean;
  /** files are in SeaweedFS */
  inObjectStore: boolean;
}

export async function listArchived(limit = 200): Promise<ArchivedSession[]> {
  const { pg, s3 } = storageEnabled();
  const localIds = new Set(listSessions().map(s => s.id));
  if (pg) {
    try {
      await ensureSchema();
      const r = await getPool().query(`SELECT id, url, status, started_at, archived_at, file_count, total_bytes, requests
        FROM extractor.sessions ORDER BY started_at DESC NULLS LAST LIMIT $1`, [limit]);
      return r.rows.map(row => ({
        id: row.id, url: row.url, status: row.status, startedAt: row.started_at?.toISOString?.() ?? null,
        archivedAt: row.archived_at?.toISOString?.() ?? null, files: row.file_count, bytes: Number(row.total_bytes),
        requests: row.requests, local: localIds.has(row.id), inObjectStore: s3 && row.file_count > 0
      }));
    } catch (e) {
      throw new StorageError(502, `PostgreSQL: ${cleanPgError(e)}`);
    }
  }
  // SeaweedFS only: one folder per session
  try {
    await ensureBucket();
    const { prefixes } = await listObjects('sessions/', '/');
    const out: ArchivedSession[] = [];
    for (const p of prefixes.slice(0, limit)) {
      const id = p.split('/')[1];
      const { objects } = await listObjects(p);
      out.push({
        id, url: null, status: null, startedAt: null, archivedAt: null, files: objects.length,
        bytes: objects.reduce((n, o) => n + o.size, 0), requests: null, local: localIds.has(id), inObjectStore: true
      });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  } catch (e) {
    throw new StorageError(502, `SeaweedFS: ${cleanS3Error(e)}`);
  }
}

/** Download an archived session from SeaweedFS into the output folder. */
export function restoreSession(sessionId: string, opts: { overwrite?: boolean } = {}): Promise<{ sessionId: string; files: number; bytes: number }> {
  return locked(sessionId, async () => {
    if (!s3Settings().enabled) throw new StorageError(409, 'Restoring needs SeaweedFS (S3)');
    const dir = sessionDir(sessionId);
    if (fs.existsSync(path.join(dir, 'session.json')) && !opts.overwrite) {
      throw new StorageError(409, `Session ${sessionId} already exists locally (pass overwrite to replace it)`);
    }
    try {
      await ensureBucket();
      const prefix = sessionKey(sessionId);
      const { objects } = await listObjects(prefix);
      if (!objects.length) throw new StorageError(404, `Session ${sessionId} is not in SeaweedFS`);
      let bytes = 0;
      await mapLimit(objects, 8, async o => {
        const rel = o.key.slice(prefix.length);
        const target = path.resolve(dir, rel);
        if (!target.startsWith(dir + path.sep)) return;
        ensureDir(path.dirname(target));
        await downloadTo(o.key, target);
        bytes += o.size;
      });
      return { sessionId, files: objects.length, bytes };
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError(502, `SeaweedFS: ${cleanS3Error(e)}`);
    }
  });
}

/** Remove an archived session from PostgreSQL and SeaweedFS (the local folder is not touched). */
export async function deleteArchived(sessionId: string): Promise<void> {
  const { pg, s3 } = storageEnabled();
  sessionDir(sessionId); // validates the id
  if (s3) {
    const { objects } = await listObjects(sessionKey(sessionId));
    if (objects.length) await deleteKeys(objects.map(o => o.key));
  }
  if (pg) {
    await ensureSchema();
    await getPool().query('DELETE FROM extractor.sessions WHERE id = $1', [sessionId]);
  }
}

// ---------------------------------------------------------------------------
// auto-archive
// ---------------------------------------------------------------------------

const pending = new Set<Promise<void>>();

export function archiveInBackground(sessionId: string, reason: string): void {
  if (!autoArchiveEnabled() || (!postgresSettings().enabled && !s3Settings().enabled)) return;
  const job = archiveSession(sessionId)
    .then(r => info(`Storage: ${reason} - session ${r.sessionId} archived` +
      `${r.files ? ` (${r.files.uploaded} files uploaded, ${r.files.skipped} unchanged)` : ''}${r.database ? ` (${r.database.requests} requests in PostgreSQL)` : ''}`))
    .catch(e => warn(`Storage auto-archive failed: ${(e as Error).message}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

export async function flushArchives(timeoutMs = 30000): Promise<void> {
  await new Promise(r => setImmediate(r));
  if (!pending.size) return;
  await Promise.race([Promise.all([...pending]), new Promise(r => setTimeout(r, timeoutMs).unref())]);
}

let installed = false;

/** Archive every session when it finishes (only while storage is configured with autoArchive). */
export function installAutoArchive(): void {
  if (installed) return;
  installed = true;
  controller.on('session', (session: ExtractorSession) => {
    session.on('status', (summary: { status: string }) => {
      // session.json is written right after the status changes
      if (summary.status === 'finished') setImmediate(() => archiveInBackground(session.id, 'session finished'));
    });
  });
}
