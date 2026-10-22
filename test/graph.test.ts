/**
 * Neo4j knowledge graph: sync, read-only queries, insights, AI tools and the /api/graph routes.
 *
 * Needs a Neo4j server and is skipped without one:
 *   docker run -d --name neo4j-test -p 7687:7687 -e NEO4J_AUTH=neo4j/testpassword123 neo4j:2026.10.0-community
 *   NEO4J_TEST_URI=bolt://127.0.0.1:7687 NEO4J_TEST_PASSWORD=testpassword123 npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { startFixtureServer } from './fixtureSite';

const uri = process.env.NEO4J_TEST_URI;
const skip = uri ? false : 'set NEO4J_TEST_URI (and NEO4J_TEST_PASSWORD) to run the Neo4j tests';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-graph-'));
process.env.EXTRACTOR_OUTPUT = outputRoot;
process.env.EXTRACTOR_CONFIG = path.join(outputRoot, 'config.json');
process.env.EXTRACTOR_HEADLESS = '1';
if (uri) {
  process.env.NEO4J_URI = uri;
  process.env.NEO4J_USER = process.env.NEO4J_TEST_USER || 'neo4j';
  process.env.NEO4J_PASSWORD = process.env.NEO4J_TEST_PASSWORD || '';
  process.env.NEO4J_AUTO_SYNC = '1';
}

let m: {
  controller: typeof import('../src/core/controller').controller;
  scraper: typeof import('../src/scraper/scraper');
  client: typeof import('../src/graph/neo4jClient');
  sync: typeof import('../src/graph/sync');
  insights: typeof import('../src/graph/insights');
  callTool: typeof import('../src/ai/tools').callTool;
  createServer: typeof import('../src/server/server').createServer;
};
let site: { url: string; close: () => Promise<void> };
let sessionId = '';
const ownSessions: string[] = [];

before(async () => {
  if (skip) return;
  m = {
    controller: (await import('../src/core/controller')).controller,
    scraper: await import('../src/scraper/scraper'),
    client: await import('../src/graph/neo4jClient'),
    sync: await import('../src/graph/sync'),
    insights: await import('../src/graph/insights'),
    callTool: (await import('../src/ai/tools')).callTool,
    createServer: (await import('../src/server/server')).createServer
  };
  m.sync.installAutoSync();
  site = await startFixtureServer();

  // a finished session with a scrape
  const session = await m.controller.start({ url: `${site.url}products`, headless: true });
  sessionId = session.id;
  ownSessions.push(sessionId);
  const recipe = m.scraper.normalizeRecipe({
    name: 'Products',
    itemSelector: 'li.product',
    fields: [{ name: 'title', selector: 'a.title' }, { name: 'link', selector: 'a.title', extract: 'href' }]
  });
  m.scraper.saveScrape(session.dir, recipe, await m.scraper.runRecipe(session.activePage!, recipe));
  await m.controller.stop();
  await m.sync.flushSyncs();
});

after(async () => {
  if (skip) return;
  await m.controller.stopIfActive();
  await m.sync.flushSyncs();
  // remove what the tests wrote (shared Domain / Page nodes of the fixture host included)
  await m.client.runWrite([
    { cypher: 'MATCH (s:Session) WHERE s.id IN $ids OPTIONAL MATCH (s)-[:SCRAPED]->(:Scrape)-[:HAS_RECORD]->(r) DETACH DELETE r', params: { ids: ownSessions } },
    { cypher: 'MATCH (s:Session) WHERE s.id IN $ids OPTIONAL MATCH (s)-[:MADE|LOGGED|CLICKED|SCRAPED]->(n) DETACH DELETE n', params: { ids: ownSessions } },
    { cypher: 'MATCH (s:Session) WHERE s.id IN $ids DETACH DELETE s', params: { ids: ownSessions } },
    { cypher: 'MATCH (p:Page) WHERE p.url STARTS WITH $origin DETACH DELETE p', params: { origin: site.url } },
    { cypher: 'MATCH (d:Domain {name: "127.0.0.1"}) WHERE NOT (d)<--() DELETE d' },
    { cypher: 'MATCH (h:SecurityHeader) WHERE NOT (h)--() DELETE h' }
  ]).catch(() => undefined);
  await m.client.closeDriver();
  await site.close();
  fs.rmSync(outputRoot, { recursive: true, force: true });
});

const count = async (cypher: string, params: Record<string, unknown> = {}) =>
  Number((await m.client.runReadQuery(cypher, params)).rows[0]?.n ?? 0);

test('a finished session is synced automatically, with its scraped records', { skip }, async () => {
  const status = await m.client.graphStatus();
  assert.equal(status.connected, true, status.error);
  assert.match(status.version || '', /Neo4j/);

  assert.equal(await count('MATCH (s:Session {id: $id}) RETURN count(s) AS n', { id: sessionId }), 1);
  assert.ok(await count('MATCH (:Session {id: $id})-[:MADE]->(q:Request)-[:TO]->(:Domain {name: "127.0.0.1"}) RETURN count(q) AS n', { id: sessionId }) >= 3);
  assert.ok(await count('MATCH (:Session {id: $id})-[:VISITED]->(p:Page)-[:ON_DOMAIN]->(:Domain) RETURN count(p) AS n', { id: sessionId }) >= 1);
  assert.ok(await count('MATCH (:Session {id: $id})-[:LOGGED]->(m:ConsoleMessage) RETURN count(m) AS n', { id: sessionId }) >= 1);

  const records = await m.client.runReadQuery(
    `MATCH (:Session {id: $id})-[:SCRAPED]->(x:Scrape)-[:HAS_RECORD]->(r:Record)-[:LINKS_TO]->(p:Page)
     RETURN x.name AS scrape, r.title AS title, p.url AS url ORDER BY r.index`, { id: sessionId });
  assert.deepEqual(records.rows.map(r => r.title), ['Phone A', 'Phone B', 'Phone C, "Pro"']);
  assert.equal(records.rows[0].scrape, 'Products');
  assert.ok(String(records.rows[0].url).endsWith('/p/1-0'));
});

test('syncing again gives the same graph', { skip }, async () => {
  const snapshot = () => m.client.runReadQuery(
    `MATCH (s:Session {id: $id})-[r]->(n) RETURN type(r) AS rel, count(n) AS n ORDER BY rel`, { id: sessionId });
  const before = await snapshot();
  const result = await m.sync.syncSession(sessionId);
  assert.equal(result.records, 3);
  assert.deepEqual((await snapshot()).rows, before.rows);
});

test('queries are read-only and dangerous statements are refused', { skip }, async () => {
  await assert.rejects(m.client.runReadQuery('CREATE (:Hack {x: 1})'), /read|write/i);
  await assert.rejects(m.client.runReadQuery('MATCH (n:Session) DETACH DELETE n'), /read|write/i);
  await assert.rejects(m.client.runReadQuery("LOAD CSV FROM 'file:///etc/passwd' AS l RETURN l"), /not allowed/);
  await assert.rejects(m.client.runReadQuery('CALL dbms.components()'), /not allowed/);
  assert.equal(await count('MATCH (n:Hack) RETURN count(n) AS n'), 0);

  const r = await m.client.runReadQuery('UNWIND range(1, 50) AS i RETURN i', {}, { limit: 10 });
  assert.equal(r.rows.length, 10);
  assert.equal(r.truncated, true);
});

test('every ready-made insight runs, scoped to a session', { skip }, async () => {
  for (const insight of m.insights.INSIGHTS) {
    const r = await m.insights.runInsight(insight.id, sessionId);
    assert.ok(Array.isArray(r.rows), insight.id);
  }
  const overview = await m.insights.runInsight('overview', sessionId);
  assert.equal(overview.rows[0].session, sessionId);
  assert.equal(overview.rows[0].records, 3);
  const failing = await m.insights.runInsight('failing-endpoints', sessionId);
  assert.ok(failing.rows.some(r => r.result === '404'), 'fixture images answer 404');
  await assert.rejects(m.insights.runInsight('nope'), /Unknown insight/);
});

test('AI tools: schema, query, insight and sync', { skip }, async () => {
  const schema = await m.callTool('extractor_graph_schema', {});
  assert.ok(!schema.isError, schema.text);
  assert.match(schema.text, /\(:Session/);
  assert.match(schema.text, /"Record":/);

  const q = await m.callTool('extractor_graph_query', {
    cypher: 'MATCH (s:Session {id: $id})-[:SCRAPED]->(x) RETURN x.name AS name, x.rows AS rows', params: { id: sessionId }
  });
  assert.ok(!q.isError, q.text);
  assert.deepEqual(JSON.parse(q.text).rows, [{ name: 'Products', rows: 3 }]);

  const w = await m.callTool('extractor_graph_query', { cypher: 'CREATE (n:Hack) RETURN n' });
  assert.equal(w.isError, true);

  const ins = await m.callTool('extractor_graph_insight', { id: 'scraped-records', sessionId });
  assert.ok(!ins.isError, ins.text);
  assert.equal(JSON.parse(ins.text).rows[0].records, 3);

  const s = await m.callTool('extractor_graph_sync', { sessionId });
  assert.ok(!s.isError, s.text);
  assert.equal(JSON.parse(s.text).sessionId, sessionId);
});

test('dashboard API: status, query, insights, sync and no password leak', { skip }, async () => {
  const server = m.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json() as any };
  };
  try {
    const status = await call('GET', '/api/graph/status');
    assert.equal(status.data.connected, true);
    assert.equal(status.data.password, undefined);
    assert.equal(status.data.hasPassword, true);

    const q = await call('POST', '/api/graph/query', { cypher: 'MATCH (s:Session {id: $id}) RETURN s', params: { id: sessionId } });
    assert.equal(q.status, 200);
    assert.equal(q.data.rows[0].s._type, 'node');
    assert.deepEqual(q.data.rows[0].s.labels, ['Session']);

    const bad = await call('POST', '/api/graph/query', { cypher: 'CREATE (n:Hack)' });
    assert.equal(bad.status, 400);

    const list = await call('GET', '/api/graph/insights');
    assert.ok(list.data.some((i: any) => i.id === 'third-party-domains'));
    const ins = await call('POST', '/api/graph/insights', { id: 'overview', sessionId });
    assert.equal(ins.data.rows[0].session, sessionId);

    const sync = await call('POST', '/api/graph/sync', { sessionId });
    assert.equal(sync.data.records, 3);

    // the password in config.json is never sent back
    await call('PUT', '/api/config', { neo4j: { password: 'secret-value' } });
    const cfg = await call('GET', '/api/config');
    assert.equal(JSON.stringify(cfg.data).includes('secret-value'), false);
    assert.equal(cfg.data.neo4j.hasPassword, true);

    const badUri = await call('PUT', '/api/graph/config', { uri: 'http://evil' });
    assert.equal(badUri.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});
