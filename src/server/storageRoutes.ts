/**
 * storageRoutes.ts
 *
 *   GET    /api/storage/status                     PostgreSQL + SeaweedFS status (never passwords / secrets)
 *   PUT    /api/storage/config   {postgres: {enabled, url}, s3: {enabled, endpoint, accessKeyId, secretAccessKey, bucket, region}, autoArchive}
 *   POST   /api/storage/archive  {sessionId?, removeLocal?} | {all: true}
 *   GET    /api/storage/sessions                    archived sessions
 *   POST   /api/storage/restore  {sessionId, overwrite?}
 *   DELETE /api/storage/sessions/{id}               remove from PostgreSQL and SeaweedFS
 *   POST   /api/storage/sql      {sql, params?, limit?}   read-only
 *   GET    /api/storage/schema
 */

import http from 'http';
import path from 'path';
import { updateConfig } from '../utils/configManager';
import { archiveAll, archiveSession, contentTypeOf, deleteArchived, listArchived, restoreSession } from '../storage/archive';
import { closeS3, getObjectStream, s3Status, sessionKey } from '../storage/objectStore';
import { SQL_SCHEMA, closePool, postgresStatus, runReadOnlySql } from '../storage/postgres';
import { StorageError, autoArchiveEnabled, s3Settings } from '../storage/settings';
import { isValidSessionId } from '../core/sessionStore';

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function storageStatus() {
  const [postgres, s3] = await Promise.all([postgresStatus(), s3Status()]);
  return { postgres, s3, autoArchive: autoArchiveEnabled() };
}

/**
 * Serve a session file from SeaweedFS when it is not in the output folder any more.
 * Returns false when there is no archived copy.
 */
export async function sendArchivedFile(res: http.ServerResponse, sessionId: string, rel: string, download: boolean): Promise<boolean> {
  if (!s3Settings().enabled || !isValidSessionId(sessionId)) return false;
  const clean = path.posix.normalize(rel.replace(/\\/g, '/'));
  if (!clean || clean.startsWith('..') || path.posix.isAbsolute(clean)) return false;
  const obj = await getObjectStream(sessionKey(sessionId, clean)).catch(() => null);
  if (!obj) return false;
  const ext = path.extname(clean).toLowerCase();
  // same rules as local files: captured code is shown as text, saved pages are sandboxed
  const type = ['.js', '.css', '.svg', '.txt'].includes(ext) ? 'text/plain; charset=utf-8'
    : ext === '.json' || ext === '.har' ? 'application/json; charset=utf-8' : contentTypeOf(clean);
  const headers: Record<string, string | number> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'X-Served-From': 'seaweedfs' };
  if (obj.size != null) headers['Content-Length'] = obj.size;
  if (ext === '.html') headers['Content-Security-Policy'] = 'sandbox';
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.posix.basename(clean).replace(/"/g, '')}"`;
  res.writeHead(200, headers);
  obj.body.pipe(res);
  return true;
}

export async function handleStorageRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  readBody: (req: http.IncomingMessage) => Promise<any>
): Promise<boolean> {
  const p = url.pathname;
  const method = req.method || 'GET';
  if (!p.startsWith('/api/storage/')) return false;

  if (p === '/api/storage/status' && method === 'GET') {
    sendJSON(res, 200, await storageStatus());
    return true;
  }

  if (p === '/api/storage/config' && method === 'PUT') {
    const body = await readBody(req);
    const pg = body.postgres && typeof body.postgres === 'object' ? body.postgres : undefined;
    const s3 = body.s3 && typeof body.s3 === 'object' ? body.s3 : undefined;
    if (pg && typeof pg.url === 'string' && pg.url.trim() && !/^postgres(ql)?:\/\/\S+$/i.test(pg.url.trim())) {
      throw new StorageError(400, 'The PostgreSQL URL must look like postgres://user:password@host:5432/database');
    }
    if (s3 && typeof s3.endpoint === 'string' && s3.endpoint.trim() && !/^https?:\/\/\S+$/i.test(s3.endpoint.trim())) {
      throw new StorageError(400, 'The S3 endpoint must be an http(s) URL, e.g. http://localhost:8333');
    }
    if (s3 && typeof s3.bucket === 'string' && s3.bucket.trim() && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3.bucket.trim())) {
      throw new StorageError(400, 'Invalid bucket name (3-63 lower-case letters, digits, dots and dashes)');
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
    updateConfig({
      storage: {
        autoArchive: bool(body.autoArchive),
        postgres: pg ? { enabled: bool(pg.enabled), url: pg.url === null ? null : str(pg.url) } : undefined,
        s3: s3 ? {
          enabled: bool(s3.enabled), endpoint: str(s3.endpoint), accessKeyId: str(s3.accessKeyId), bucket: str(s3.bucket), region: str(s3.region),
          secretAccessKey: s3.secretAccessKey === null ? null : str(s3.secretAccessKey)
        } : undefined
      }
    });
    await closePool();
    closeS3();
    sendJSON(res, 200, await storageStatus());
    return true;
  }

  if (p === '/api/storage/archive' && method === 'POST') {
    const body = await readBody(req);
    if (body.all) sendJSON(res, 200, await archiveAll());
    else sendJSON(res, 200, await archiveSession(typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined, { removeLocal: body.removeLocal === true }));
    return true;
  }

  if (p === '/api/storage/sessions' && method === 'GET') {
    sendJSON(res, 200, await listArchived(Number(url.searchParams.get('limit')) || 200));
    return true;
  }

  if (p.startsWith('/api/storage/sessions/') && method === 'DELETE') {
    const id = decodeURIComponent(p.slice('/api/storage/sessions/'.length));
    if (!isValidSessionId(id)) throw new StorageError(400, 'Invalid session id');
    await deleteArchived(id);
    sendJSON(res, 200, { ok: true });
    return true;
  }

  if (p === '/api/storage/restore' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.sessionId ?? '');
    if (!isValidSessionId(id)) throw new StorageError(400, 'Invalid session id');
    sendJSON(res, 200, await restoreSession(id, { overwrite: body.overwrite === true }));
    return true;
  }

  if (p === '/api/storage/sql' && method === 'POST') {
    const body = await readBody(req);
    const params = Array.isArray(body.params) ? body.params : [];
    sendJSON(res, 200, await runReadOnlySql(String(body.sql ?? ''), params, { limit: Number(body.limit) || 500 }));
    return true;
  }

  if (p === '/api/storage/schema' && method === 'GET') {
    sendJSON(res, 200, { schema: SQL_SCHEMA });
    return true;
  }

  return false;
}
