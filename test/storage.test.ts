/**
 * Long-term storage: archiving sessions to PostgreSQL + SeaweedFS, restore, read-only SQL, AI tools
 * and the /api/storage routes.
 *
 * Needs PostgreSQL and SeaweedFS and is skipped without them:
 *   docker run -d --name pg-test -p 5432:5432 -e POSTGRES_USER=extractor -e POSTGRES_PASSWORD=testpassword123 postgres:18.6
 *   docker run -d --name sw-test -p 8333:8333 -e AWS_ACCESS_KEY_ID=extractor -e AWS_SECRET_ACCESS_KEY=testsecret123 \
 *     chrislusf/seaweedfs:4.48 server -dir=/data -s3 -volume.max=0
 *   STORAGE_TEST_DATABASE_URL=postgres://extractor:testpassword123@127.0.0.1:5432/extractor \
 *   STORAGE_TEST_S3_ENDPOINT=http://127.0.0.1:8333 STORAGE_TEST_S3_KEY=extractor STORAGE_TEST_S3_SECRET=testsecret123 npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { startFixtureServer } from './fixtureSite';

const dbUrl = process.env.STORAGE_TEST_DATABASE_URL;
const s3Endpoint = process.env.STORAGE_TEST_S3_ENDPOINT;
const skip = dbUrl && s3Endpoint ? false : 'set STORAGE_TEST_DATABASE_URL and STORAGE_TEST_S3_ENDPOINT to run the storage tests';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-storage-'));
// one fixed bucket: in SeaweedFS every bucket allocates its own volumes
const bucket = 'extractor-test';
process.env.EXTRACTOR_OUTPUT = outputRoot;
process.env.EXTRACTOR_CONFIG = path.join(outputRoot, 'config.json');
process.env.EXTRACTOR_HEADLESS = '1';
delete process.env.NEO4J_URI;
if (!skip) {
  process.env.DATABASE_URL = dbUrl;
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_ACCESS_KEY_ID = process.env.STORAGE_TEST_S3_KEY || '';
  process.env.S3_SECRET_ACCESS_KEY = process.env.STORAGE_TEST_S3_SECRET || '';
  process.env.S3_BUCKET = bucket;
  process.env.STORAGE_AUTO_ARCHIVE = '1';
}

let m: {
  controller: typeof import('../src/core/controller').controller;
  scraper: typeof import('../src/scraper/scraper');
  archive: typeof import('../src/storage/archive');
  pg: typeof import('../src/storage/postgres');
  s3: typeof import('../src/storage/objectStore');
  callTool: typeof import('../src/ai/tools').callTool;
  createServer: typeof import('../src/server/server').createServer;
};
let site: { url: string; close: () => Promise<void> };
let sessionId = '';

before(async () => {
  if (skip) return;
  m = {
    controller: (await import('../src/core/controller')).controller,
    scraper: await import('../src/scraper/scraper'),
    archive: await import('../src/storage/archive'),
    pg: await import('../src/storage/postgres'),
    s3: await import('../src/storage/objectStore'),
    callTool: (await import('../src/ai/tools')).callTool,
    createServer: (await import('../src/server/server')).createServer
  };
  m.archive.installAutoArchive();
  site = await startFixtureServer();
  const session = await m.controller.start({ url: `${site.url}products`, headless: true });
  sessionId = session.id;
  const recipe = m.scraper.normalizeRecipe({
    name: 'Products',
    itemSelector: 'li.product',
    fields: [{ name: 'title', selector: 'a.title' }, { name: 'price', selector: 'span.price' }]
  });
  m.scraper.saveScrape(session.dir, recipe, await m.scraper.runRecipe(session.activePage!, recipe));
  await m.controller.stop();
  await m.archive.flushArchives();
});

after(async () => {
  if (skip) return;
  await m.controller.stopIfActive();
  await m.archive.flushArchives();
  await m.archive.deleteArchived(sessionId).catch(() => undefined);
  await m.pg.closePool();
  m.s3.closeS3();
  await site.close();
  fs.rmSync(outputRoot, { recursive: true, force: true });
});

const sql = async (q: string, params: unknown[] = []) => (await m.pg.runReadOnlySql(q, params)).rows;

test('a finished session is archived automatically: rows in PostgreSQL, files in SeaweedFS', { skip }, async () => {
  const [s] = await sql('SELECT id, status, requests, file_count FROM sessions WHERE id = $1', [sessionId]);
  assert.equal(s.status, 'finished');
  assert.ok(Number(s.requests) >= 3);

  const records = await sql(`SELECT r.data->>'title' AS title, r.data->>'price' AS price FROM scrape_records r
    JOIN scrapes x ON x.id = r.scrape_id WHERE x.session_id = $1 ORDER BY r.idx`, [sessionId]);
  assert.deepEqual(records.map(r => r.title), ['Phone A', 'Phone B', 'Phone C, "Pro"']);
  assert.ok(records.every(r => r.price));

  const failed = await sql('SELECT url, status FROM requests WHERE session_id = $1 AND status >= 400', [sessionId]);
  assert.ok(failed.some(r => String(r.url).includes('/img/')), 'fixture images answer 404');
  assert.ok((await sql('SELECT 1 FROM security_headers WHERE session_id = $1 AND NOT present', [sessionId])).length > 0);

  const files = await sql('SELECT path, size, object_key FROM files WHERE session_id = $1', [sessionId]);
  assert.equal(files.length, Number(s.file_count));
  assert.ok(files.some(f => f.path === 'analysis.json'));
  const { objects } = await m.s3.listObjects(m.s3.sessionKey(sessionId));
  assert.equal(objects.length, files.length);
});

test('archiving again uploads nothing and keeps the same rows', { skip }, async () => {
  const before = await sql('SELECT (SELECT count(*) FROM requests WHERE session_id = $1) AS r, (SELECT count(*) FROM console_messages WHERE session_id = $1) AS c', [sessionId]);
  const r = await m.archive.archiveSession(sessionId);
  assert.equal(r.files!.uploaded, 0);
  assert.equal(r.files!.skipped, r.files!.total);
  assert.deepEqual(await sql('SELECT (SELECT count(*) FROM requests WHERE session_id = $1) AS r, (SELECT count(*) FROM console_messages WHERE session_id = $1) AS c', [sessionId]), before);

  // an object missing from the bucket is uploaded again even though PostgreSQL still lists it
  await m.s3.deleteKeys([m.s3.sessionKey(sessionId, 'analysis.json')]);
  const again = await m.archive.archiveSession(sessionId);
  assert.equal(again.files!.uploaded, 1);
});

test('remove the local copy, serve files from SeaweedFS, restore', { skip }, async () => {
  const local = path.join(outputRoot, sessionId);
  const original = fs.readFileSync(path.join(local, 'analysis.json'), 'utf-8');
  const r = await m.archive.archiveSession(sessionId, { removeLocal: true });
  assert.equal(r.removedLocal, true);
  assert.equal(fs.existsSync(local), false);

  const listed = (await m.archive.listArchived()).find(s => s.id === sessionId)!;
  assert.equal(listed.local, false);
  assert.equal(listed.inObjectStore, true);

  // the dashboard serves the file from SeaweedFS while there is no local copy
  const server = m.createServer();
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/sessions/${sessionId}/file?path=analysis.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-served-from'), 'seaweedfs');
    assert.equal(await res.text(), original);
    const escape = await fetch(`${base}/api/sessions/${sessionId}/file?path=${encodeURIComponent('../../etc/passwd')}`);
    assert.equal(escape.status, 404);
  } finally {
    await new Promise(res => server.close(res));
  }

  const restored = await m.archive.restoreSession(sessionId);
  assert.equal(restored.files, listed.files);
  assert.equal(fs.readFileSync(path.join(local, 'analysis.json'), 'utf-8'), original);
  await assert.rejects(m.archive.restoreSession(sessionId), /already exists locally/);
});

test('SQL is read-only and limited to plain queries', { skip }, async () => {
  const refused = [
    'DELETE FROM sessions',
    'SELECT 1; DELETE FROM sessions',
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT query_to_xml('select 1', true, true, '')",
    "SELECT set_config('role', 'extractor', true)",
    'WITH x AS (DELETE FROM sessions RETURNING 1) SELECT * FROM x',
    'SELECT * FROM pg_authid',
    "COPY sessions TO '/tmp/x'"
  ];
  for (const q of refused) await assert.rejects(m.pg.runReadOnlySql(q), q);
  assert.equal((await sql('SELECT count(*)::int AS n FROM sessions WHERE id = $1', [sessionId]))[0].n, 1);

  const r = await m.pg.runReadOnlySql('SELECT g FROM generate_series(1, 50) g', [], { limit: 10 });
  assert.equal(r.rows.length, 10);
  assert.equal(r.truncated, true);
});

test('AI tools: status, SQL, archive, list and restore', { skip }, async () => {
  const status = await m.callTool('extractor_storage_status', {});
  assert.ok(!status.isError, status.text);
  assert.match(status.text, /scrape_records/);
  assert.match(status.text, /"connected": true/);
  assert.doesNotMatch(status.text, new RegExp(process.env.STORAGE_TEST_S3_SECRET || 'no-secret-set'));

  const q = await m.callTool('extractor_sql_query', { sql: "SELECT count(*)::int AS n FROM scrape_records r JOIN scrapes s ON s.id = r.scrape_id WHERE s.session_id = $1", params: [sessionId] });
  assert.ok(!q.isError, q.text);
  assert.equal(JSON.parse(q.text).rows[0].n, 3);
  assert.equal((await m.callTool('extractor_sql_query', { sql: 'DROP TABLE sessions' })).isError, true);

  const a = await m.callTool('extractor_archive_session', { sessionId });
  assert.ok(!a.isError, a.text);
  const list = await m.callTool('extractor_list_archived', {});
  assert.ok(JSON.parse(list.text).some((s: any) => s.id === sessionId));
  const restore = await m.callTool('extractor_restore_session', { sessionId });
  assert.equal(restore.isError, true, 'local copy exists');
});

test('dashboard API: status without secrets, SQL, archive list', { skip }, async () => {
  const server = m.createServer();
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, text: await res.text() };
  };
  try {
    const st = await call('GET', '/api/storage/status');
    const data = JSON.parse(st.text);
    assert.equal(data.postgres.connected, true);
    assert.equal(data.s3.connected, true);
    assert.equal(st.text.includes(new URL(dbUrl!).password), false, 'database password is masked');
    assert.equal(data.s3.hasSecret, true);

    const q = await call('POST', '/api/storage/sql', { sql: 'SELECT id FROM sessions WHERE id = $1', params: [sessionId] });
    assert.equal(JSON.parse(q.text).rows[0].id, sessionId);
    assert.equal((await call('POST', '/api/storage/sql', { sql: 'TRUNCATE sessions' })).status, 400);

    const list = JSON.parse((await call('GET', '/api/storage/sessions')).text);
    assert.ok(list.some((s: any) => s.id === sessionId && s.local));

    // secrets saved from the dashboard are never sent back
    await call('PUT', '/api/config', { storage: { s3: { secretAccessKey: 'very-secret-value' }, postgres: { url: 'postgres://u:pw-in-url@h/db' } } });
    const cfg = await call('GET', '/api/config');
    assert.equal(cfg.text.includes('very-secret-value'), false);
    assert.equal(cfg.text.includes('pw-in-url'), false);
    assert.equal((await call('PUT', '/api/storage/config', { s3: { endpoint: 'ftp://x' } })).status, 400);
  } finally {
    await new Promise(res => server.close(res));
  }
});
