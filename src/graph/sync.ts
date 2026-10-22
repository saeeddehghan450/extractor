/**
 * sync.ts
 *
 * Writes sessions into Neo4j. Shared entities (Domain, Page, Script, Stylesheet, Cookie,
 * SecurityHeader) are merged across sessions so questions spanning sites and sessions become
 * simple graph queries; per-session data (requests, console, clicks, scrapes) is replaced on
 * every sync, so syncing twice gives the same graph.
 */

import fs from 'fs';
import path from 'path';
import { controller } from '../core/controller';
import type { ExtractorSession } from '../core/session';
import { listSessions, sessionDir } from '../core/sessionStore';
import { readJSON } from '../utils/fileUtils';
import { debug, info, warn } from '../utils/logger';
import { GraphError, cleanError, getDriver, graphSettings, sessionOptions } from './neo4jClient';

export const GRAPH_SCHEMA = `Nodes (key property first):
  (:Session {id, url, host, status, startedAt, endedAt, device, network, requests, errors})
  (:Page {url, host, title})
  (:Domain {name, site})                       site = registrable domain, e.g. "example.co.uk"
  (:Request {uid, sessionId, id, url, method, type, status, size, durationMs, failure, contentType, startedAt})
  (:Script {url, size, sourceMap})   (:Stylesheet {url, size})
  (:Cookie {key, name, domain, path})
  (:ConsoleMessage {uid, sessionId, type, text, source, line, at})   type: log|info|warn|error|uncaught|dialog
  (:SecurityHeader {name})
  (:Element {uid, sessionId, selector, tag, text})                  clicked elements
  (:Scrape {id, sessionId, name, url, pages, rows, scrapedAt})
  (:Record {uid, scrapeId, index, ...one property per scraped column})

Relationships:
  (Session)-[:STARTED_AT]->(Page)
  (Session)-[:VISITED]->(Page)
  (Page)-[:ON_DOMAIN]->(Domain)
  (Session)-[:CONTACTED {requests, bytes, failed, thirdParty}]->(Domain)
  (Session)-[:MADE]->(Request)-[:TO]->(Domain)
  (Request)-[:FROM_PAGE]->(Page)
  (Page)-[:LOADS]->(Script|Stylesheet)-[:SERVED_FROM]->(Domain)
  (Session)-[:SAW_COOKIE {value, secure, httpOnly, sameSite, expires}]->(Cookie)-[:FOR_DOMAIN]->(Domain)
  (Session)-[:LOGGED]->(ConsoleMessage)-[:FROM_SCRIPT]->(Script)
  (Page)-[:HAS_HEADER {value}]->(SecurityHeader)
  (Page)-[:MISSING_HEADER]->(SecurityHeader)
  (Session)-[:CLICKED {at, seq}]->(Element)-[:ON_PAGE]->(Page)
  (Session)-[:SCRAPED]->(Scrape)-[:FROM_PAGE]->(Page)
  (Scrape)-[:HAS_RECORD]->(Record)-[:LINKS_TO]->(Page)            for URL values

Notes: thirdParty compares registrable domains (approximate public-suffix rules). Every Request,
ConsoleMessage, Element, Scrape and Record belongs to exactly one Session.`;

const CONSTRAINTS = [
  'CREATE CONSTRAINT session_id IF NOT EXISTS FOR (n:Session) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT page_url IF NOT EXISTS FOR (n:Page) REQUIRE n.url IS UNIQUE',
  'CREATE CONSTRAINT domain_name IF NOT EXISTS FOR (n:Domain) REQUIRE n.name IS UNIQUE',
  'CREATE CONSTRAINT request_uid IF NOT EXISTS FOR (n:Request) REQUIRE n.uid IS UNIQUE',
  'CREATE CONSTRAINT script_url IF NOT EXISTS FOR (n:Script) REQUIRE n.url IS UNIQUE',
  'CREATE CONSTRAINT stylesheet_url IF NOT EXISTS FOR (n:Stylesheet) REQUIRE n.url IS UNIQUE',
  'CREATE CONSTRAINT cookie_key IF NOT EXISTS FOR (n:Cookie) REQUIRE n.key IS UNIQUE',
  'CREATE CONSTRAINT console_uid IF NOT EXISTS FOR (n:ConsoleMessage) REQUIRE n.uid IS UNIQUE',
  'CREATE CONSTRAINT header_name IF NOT EXISTS FOR (n:SecurityHeader) REQUIRE n.name IS UNIQUE',
  'CREATE CONSTRAINT element_uid IF NOT EXISTS FOR (n:Element) REQUIRE n.uid IS UNIQUE',
  'CREATE CONSTRAINT scrape_id IF NOT EXISTS FOR (n:Scrape) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT record_uid IF NOT EXISTS FOR (n:Record) REQUIRE n.uid IS UNIQUE',
  'CREATE INDEX request_session IF NOT EXISTS FOR (n:Request) ON (n.sessionId)',
  'CREATE INDEX domain_site IF NOT EXISTS FOR (n:Domain) ON (n.site)'
];

let schemaReady = '';

async function ensureSchema() {
  const key = JSON.stringify(graphSettings());
  if (schemaReady === key) return;
  const session = getDriver().session(sessionOptions('WRITE'));
  try {
    for (const c of CONSTRAINTS) await session.run(c);
    schemaReady = key;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MULTI_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'com.br', 'com.cn', 'com.tr', 'co.in', 'co.ir', 'ac.ir', 'org.ir', 'gov.ir', 'com.mx', 'co.za']);

/** Approximate registrable domain ("eTLD+1"). */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.')) return h;
  const parts = h.split('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) && parts.length > 2 ? parts.slice(-3).join('.') : lastTwo;
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:|^wss?:/.test(u.protocol) ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Page key: URL without the fragment. */
function pageUrl(url: string | null | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  return url.split('#')[0];
}

function chunks<T>(arr: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Neo4j property names for scraped columns. */
function propName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'field';
  return ['uid', 'scrapeId', 'index'].includes(clean) ? `f_${clean}` : clean;
}

const clip = (s: unknown, n: number) => (s == null ? null : String(s).slice(0, n));

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

export interface SyncResult {
  sessionId: string;
  live: boolean;
  requests: number;
  domains: number;
  pages: number;
  console: number;
  cookies: number;
  scrapes: number;
  records: number;
  ms: number;
}

interface Loaded {
  id: string;
  dir: string;
  live: boolean;
  analysis: any;
  summary: any;
}

function load(sessionId?: string): Loaded {
  // the session being recorded (also while it is stopping, before its files are written)
  const cur = controller.current;
  if (cur && (!sessionId || sessionId === cur.id) && cur.status !== 'finished' && cur.status !== 'error') {
    return { id: cur.id, dir: cur.dir, live: true, analysis: cur.liveAnalysis(), summary: cur.summary() };
  }
  if (!sessionId) {
    const latest = listSessions().find(s => s.analysisFile);
    if (!latest) throw new GraphError(404, 'No saved session to sync');
    sessionId = latest.id;
  }
  const dir = sessionDir(sessionId);
  const summary = readJSON(path.join(dir, 'session.json'));
  const analysis = readJSON(path.join(dir, 'analysis.json'));
  if (!summary) throw new GraphError(404, `Session ${sessionId} not found`);
  if (!analysis) throw new GraphError(409, `Session ${sessionId} has no analysis.json (it did not finish)`);
  return { id: sessionId, dir, live: false, analysis, summary };
}

function scrapeFiles(dir: string): string[] {
  const d = path.join(dir, 'scrapes');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => path.join(d, f));
}

/** Syncs of one session run one after another (a live sync can still be running when the session finishes). */
const sessionLocks = new Map<string, Promise<unknown>>();

export function syncSession(sessionId?: string): Promise<SyncResult> {
  // read the data now, so a session that is stopping is synced with what it has collected
  let loaded: Loaded;
  try {
    loaded = load(sessionId);
  } catch (e) {
    return Promise.reject(e);
  }
  const previous = sessionLocks.get(loaded.id) || Promise.resolve();
  const job = previous.catch(() => undefined).then(() => writeSession(loaded));
  sessionLocks.set(loaded.id, job);
  void job.catch(() => undefined).finally(() => { if (sessionLocks.get(loaded.id) === job) sessionLocks.delete(loaded.id); });
  return job;
}

async function writeSession(loaded: Loaded): Promise<SyncResult> {
  const started = Date.now();
  await ensureSchema();
  const { id, dir, live, analysis: a, summary: s } = loaded;

  const startUrl = pageUrl(s.url) || s.url;
  const startHost = hostOf(s.url) || '';
  const startSite = siteOf(startHost);
  const reqs: any[] = a.network?.requests || [];
  const resps = new Map<string, any>((a.network?.responses || []).map((r: any) => [r.requestId, r]));

  // --- requests + domains
  const requestRows = reqs.map(r => {
    const resp = resps.get(r.id);
    const host = hostOf(r.url);
    return {
      uid: `${id}:${r.id}`,
      id: r.id,
      url: clip(r.url, 2000),
      method: r.method,
      type: r.resourceType,
      status: resp?.status ?? null,
      size: resp?.size ?? null,
      durationMs: resp?.durationMs ?? null,
      failure: r.failure || null,
      contentType: resp?.contentType || null,
      startedAt: r.timestamp,
      host,
      page: pageUrl(r.frameUrl)
    };
  });
  const domainStats = new Map<string, { requests: number; bytes: number; failed: number }>();
  for (const r of requestRows) {
    if (!r.host) continue;
    const d = domainStats.get(r.host) || { requests: 0, bytes: 0, failed: 0 };
    d.requests++;
    d.bytes += r.size || 0;
    if (r.failure || (r.status ?? 0) >= 400) d.failed++;
    domainStats.set(r.host, d);
  }
  const domainRows = [...domainStats.entries()].map(([name, d]) => ({ name, site: siteOf(name), ...d, thirdParty: siteOf(name) !== startSite }));

  // --- pages: start page, documents, snapshot pages
  const pages = new Map<string, { url: string; host: string | null; title: string | null }>();
  const addPage = (url: string | null | undefined, title: string | null = null) => {
    const u = pageUrl(url);
    if (!u) return;
    const prev = pages.get(u);
    pages.set(u, { url: u, host: hostOf(u), title: title || prev?.title || null });
  };
  addPage(s.url);
  for (const r of reqs) if (r.resourceType === 'document') addPage(r.url);
  for (const snap of s.snapshots || []) addPage(snap.url, snap.title || null);
  addPage(a.elements?.overview?.url, a.elements?.overview?.title || null);
  for (const r of requestRows) if (r.page) addPage(r.page);
  const mainPage = pageUrl(a.elements?.overview?.url) || pageUrl(a.security?.location) || startUrl;
  addPage(mainPage);

  // --- scripts / stylesheets (loaded by the page of the latest snapshot)
  const scriptRows = (a.scripts?.external || []).filter((x: any) => x.src).map((x: any) => ({
    url: clip(x.src, 2000), host: hostOf(x.src), site: hostOf(x.src) ? siteOf(hostOf(x.src)!) : null, size: x.size ?? null, sourceMap: x.sourceMappingURL || null
  }));
  const styleRows = (a.css?.stylesheets || []).filter((x: any) => x.href).map((x: any) => ({
    url: clip(x.href, 2000), host: hostOf(x.href), site: hostOf(x.href) ? siteOf(hostOf(x.href)!) : null, size: x.size ?? null
  }));

  // --- cookies
  const cookieRows = (a.application?.cookies || []).map((c: any) => {
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    return {
      key: `${domain}|${c.name}|${c.path || '/'}`, name: c.name, domain, site: domain ? siteOf(domain) : null, path: c.path || '/',
      value: clip(c.value, 4000), secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || null,
      expires: typeof c.expires === 'number' && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null
    };
  });

  // --- console
  const scriptUrls = new Set(scriptRows.map((x: any) => x.url));
  const consoleRows = [
    ...(a.console?.logs || []).map((l: any, i: number) => ({
      uid: `${id}:log:${i}`, type: l.type, text: clip(l.text, 4000), source: l.location?.url || null, line: l.location?.lineNumber ?? null, at: l.timestamp
    })),
    ...(a.console?.pageErrors || []).map((e: any, i: number) => ({
      uid: `${id}:err:${i}`, type: 'uncaught', text: clip(`${e.message}${e.stack ? `\n${e.stack}` : ''}`, 4000), source: null, line: null, at: e.timestamp
    })),
    ...(a.console?.dialogs || []).map((d: any, i: number) => ({
      uid: `${id}:dlg:${i}`, type: 'dialog', text: clip(`[${d.type}] ${d.message}`, 4000), source: null, line: null, at: d.timestamp
    }))
  ].slice(0, 20000).map(m => ({ ...m, script: m.source && scriptUrls.has(m.source) ? m.source : null }));

  // --- security headers of the main document
  const sec = a.security;
  const presentHeaders = sec ? Object.entries(sec.securityHeaders || {}).filter(([, v]) => v != null).map(([name, value]) => ({ name, value: clip(value, 2000) })) : [];
  const missingHeaders: string[] = sec?.missingHeaders || [];

  // --- clicks
  const clickRows = (a.clicks || []).map((c: any, i: number) => ({
    uid: `${id}:click:${i}`, seq: i + 1, at: c.clickedAt, selector: clip(c.cssSelector, 1000), tag: String(c.tagName || '').toLowerCase(),
    text: clip(c.innerText, 300), page: pageUrl(c.frameUrl)
  }));
  for (const c of clickRows) if (c.page) addPage(c.page);

  // --- scrapes
  const scrapeRows: any[] = [];
  const recordRows: any[] = [];
  for (const file of scrapeFiles(dir)) {
    const data = readJSON<any>(file);
    if (!data?.rows) continue;
    const scrapeId = `${id}:${path.basename(file, '.json')}`;
    const fromPage = pageUrl(data.startUrl || data.url);
    if (fromPage) addPage(fromPage);
    scrapeRows.push({
      id: scrapeId, name: data.recipe?.name || path.basename(file, '.json'), url: data.startUrl || data.url || null,
      pages: data.pages ?? 1, rows: data.rows.length, scrapedAt: data.scrapedAt || null, page: fromPage
    });
    data.rows.slice(0, 50000).forEach((row: Record<string, unknown>, index: number) => {
      const props: Record<string, unknown> = {};
      const links: { url: string; host: string | null; site: string | null }[] = [];
      for (const [k, v] of Object.entries(row)) {
        if (v == null) continue;
        props[propName(k)] = clip(v, 4000);
        const u = pageUrl(String(v));
        if (u && u.length < 2000) { const host = hostOf(u); links.push({ url: u, host, site: host ? siteOf(host) : null }); }
      }
      recordRows.push({ uid: `${scrapeId}:${index}`, scrapeId, index, props, links });
    });
  }
  const allPages = [...pages.values()];

  // --- write
  const driver = getDriver();
  const session = driver.session(sessionOptions('WRITE'));
  try {
    // 1) drop this session's own nodes and its links to shared nodes
    await session.executeWrite(async tx => {
      await tx.run(`MATCH (s:Session {id: $id})
        OPTIONAL MATCH (s)-[:SCRAPED]->(:Scrape)-[:HAS_RECORD]->(r:Record)
        DETACH DELETE r`, { id });
      await tx.run(`MATCH (s:Session {id: $id})
        OPTIONAL MATCH (s)-[:MADE|LOGGED|CLICKED|SCRAPED]->(n)
        DETACH DELETE n`, { id });
      await tx.run('MATCH (s:Session {id: $id})-[rel]->() DELETE rel', { id });
    });

    // 2) session, pages, domains
    await session.executeWrite(async tx => {
      await tx.run(`MERGE (s:Session {id: $id})
        SET s.url = $url, s.host = $host, s.status = $status, s.startedAt = $startedAt, s.endedAt = $endedAt,
            s.device = $device, s.network = $network, s.requests = $requests, s.errors = $errors, s.syncedAt = $now`, {
        id, url: s.url, host: startHost, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt ?? null,
        device: s.emulation?.deviceLabel ?? null, network: s.emulation?.networkLabel ?? null,
        requests: s.counts?.requests ?? reqs.length, errors: s.counts?.errors ?? 0, now: new Date().toISOString()
      });
      for (const batch of chunks(allPages)) {
        await tx.run(`UNWIND $rows AS p
          MERGE (pg:Page {url: p.url}) SET pg.host = p.host, pg.title = coalesce(p.title, pg.title)
          WITH pg, p WHERE p.host IS NOT NULL
          MERGE (d:Domain {name: p.host}) ON CREATE SET d.site = p.site
          MERGE (pg)-[:ON_DOMAIN]->(d)`, { rows: batch.map(p => ({ ...p, site: p.host ? siteOf(p.host) : null })) });
      }
      for (const batch of chunks(domainRows)) {
        await tx.run(`MATCH (s:Session {id: $id})
          UNWIND $rows AS d
          MERGE (dm:Domain {name: d.name}) SET dm.site = d.site
          MERGE (s)-[c:CONTACTED]->(dm)
          SET c.requests = d.requests, c.bytes = d.bytes, c.failed = d.failed, c.thirdParty = d.thirdParty`, { id, rows: batch });
      }
      await tx.run(`MATCH (s:Session {id: $id}) MATCH (p:Page {url: $url}) MERGE (s)-[:STARTED_AT]->(p)`, { id, url: startUrl });
      await tx.run(`MATCH (s:Session {id: $id}) UNWIND $urls AS u MATCH (p:Page {url: u}) MERGE (s)-[:VISITED]->(p)`, {
        id, urls: allPages.map(p => p.url)
      });
    });

    // 3) requests
    for (const batch of chunks(requestRows)) {
      await session.executeWrite(tx => tx.run(`MATCH (s:Session {id: $id})
        UNWIND $rows AS r
        CREATE (q:Request {uid: r.uid, sessionId: $id, id: r.id, url: r.url, method: r.method, type: r.type, status: r.status,
                           size: r.size, durationMs: r.durationMs, failure: r.failure, contentType: r.contentType, startedAt: r.startedAt})
        CREATE (s)-[:MADE]->(q)
        WITH q, r
        CALL (q, r) { WITH q, r WHERE r.host IS NOT NULL MATCH (d:Domain {name: r.host}) MERGE (q)-[:TO]->(d) }
        CALL (q, r) { WITH q, r WHERE r.page IS NOT NULL MATCH (p:Page {url: r.page}) MERGE (q)-[:FROM_PAGE]->(p) }`, { id, rows: batch }));
    }

    // 4) scripts, stylesheets, headers, cookies
    await session.executeWrite(async tx => {
      await tx.run(`MATCH (p:Page {url: $page})
        UNWIND $rows AS x
        MERGE (sc:Script {url: x.url}) SET sc.size = x.size, sc.sourceMap = x.sourceMap
        MERGE (p)-[:LOADS]->(sc)
        WITH sc, x WHERE x.host IS NOT NULL
        MERGE (d:Domain {name: x.host}) ON CREATE SET d.site = x.site MERGE (sc)-[:SERVED_FROM]->(d)`, { page: mainPage, rows: scriptRows });
      await tx.run(`MATCH (p:Page {url: $page})
        UNWIND $rows AS x
        MERGE (st:Stylesheet {url: x.url}) SET st.size = x.size
        MERGE (p)-[:LOADS]->(st)
        WITH st, x WHERE x.host IS NOT NULL
        MERGE (d:Domain {name: x.host}) ON CREATE SET d.site = x.site MERGE (st)-[:SERVED_FROM]->(d)`, { page: mainPage, rows: styleRows });
      if (sec) {
        await tx.run(`MATCH (p:Page {url: $page})
          OPTIONAL MATCH (p)-[old:HAS_HEADER|MISSING_HEADER]->(:SecurityHeader) DELETE old`, { page: mainPage });
        await tx.run(`MATCH (p:Page {url: $page})
          UNWIND $present AS h MERGE (sh:SecurityHeader {name: h.name}) MERGE (p)-[r:HAS_HEADER]->(sh) SET r.value = h.value`, { page: mainPage, present: presentHeaders });
        await tx.run(`MATCH (p:Page {url: $page})
          UNWIND $missing AS name MERGE (sh:SecurityHeader {name: name}) MERGE (p)-[:MISSING_HEADER]->(sh)`, { page: mainPage, missing: missingHeaders });
      }
      await tx.run(`MATCH (s:Session {id: $id})
        UNWIND $rows AS c
        MERGE (ck:Cookie {key: c.key}) SET ck.name = c.name, ck.domain = c.domain, ck.path = c.path
        MERGE (s)-[r:SAW_COOKIE]->(ck)
        SET r.value = c.value, r.secure = c.secure, r.httpOnly = c.httpOnly, r.sameSite = c.sameSite, r.expires = c.expires
        WITH ck, c WHERE c.domain <> ''
        MERGE (d:Domain {name: c.domain}) ON CREATE SET d.site = c.site MERGE (ck)-[:FOR_DOMAIN]->(d)`, { id, rows: cookieRows });
    });

    // 5) console, clicks
    for (const batch of chunks(consoleRows)) {
      await session.executeWrite(tx => tx.run(`MATCH (s:Session {id: $id})
        UNWIND $rows AS m
        CREATE (c:ConsoleMessage {uid: m.uid, sessionId: $id, type: m.type, text: m.text, source: m.source, line: m.line, at: m.at})
        CREATE (s)-[:LOGGED]->(c)
        WITH c, m WHERE m.script IS NOT NULL
        MATCH (sc:Script {url: m.script}) MERGE (c)-[:FROM_SCRIPT]->(sc)`, { id, rows: batch }));
    }
    await session.executeWrite(tx => tx.run(`MATCH (s:Session {id: $id})
      UNWIND $rows AS c
      CREATE (e:Element {uid: c.uid, sessionId: $id, selector: c.selector, tag: c.tag, text: c.text})
      CREATE (s)-[:CLICKED {at: c.at, seq: c.seq}]->(e)
      WITH e, c WHERE c.page IS NOT NULL
      MATCH (p:Page {url: c.page}) MERGE (e)-[:ON_PAGE]->(p)`, { id, rows: clickRows }));

    // 6) scrapes and their records
    await session.executeWrite(tx => tx.run(`MATCH (s:Session {id: $id})
      UNWIND $rows AS x
      CREATE (sc:Scrape {id: x.id, sessionId: $id, name: x.name, url: x.url, pages: x.pages, rows: x.rows, scrapedAt: x.scrapedAt})
      CREATE (s)-[:SCRAPED]->(sc)
      WITH sc, x WHERE x.page IS NOT NULL
      MATCH (p:Page {url: x.page}) MERGE (sc)-[:FROM_PAGE]->(p)`, { id, rows: scrapeRows }));
    for (const batch of chunks(recordRows, 500)) {
      await session.executeWrite(tx => tx.run(`UNWIND $rows AS r
        MATCH (sc:Scrape {id: r.scrapeId})
        CREATE (rec:Record {uid: r.uid, scrapeId: r.scrapeId, index: r.index})
        SET rec += r.props
        CREATE (sc)-[:HAS_RECORD]->(rec)
        WITH rec, r
        UNWIND r.links AS link
        MERGE (p:Page {url: link.url}) ON CREATE SET p.host = link.host
        MERGE (rec)-[:LINKS_TO]->(p)
        WITH p, link WHERE link.host IS NOT NULL
        MERGE (d:Domain {name: link.host}) ON CREATE SET d.site = link.site
        MERGE (p)-[:ON_DOMAIN]->(d)`, { rows: batch }));
    }
  } catch (e) {
    throw new GraphError(502, `Neo4j sync failed: ${cleanError(e)}`);
  } finally {
    await session.close();
  }

  const result: SyncResult = {
    sessionId: id, live,
    requests: requestRows.length, domains: domainRows.length, pages: allPages.length, console: consoleRows.length,
    cookies: cookieRows.length, scrapes: scrapeRows.length, records: recordRows.length, ms: Date.now() - started
  };
  debug(`Neo4j: synced ${id} in ${result.ms} ms`);
  return result;
}

/** Sync every finished session (and the running one). */
export async function syncAll(): Promise<{ synced: SyncResult[]; failed: { sessionId: string; error: string }[] }> {
  const synced: SyncResult[] = [];
  const failed: { sessionId: string; error: string }[] = [];
  const ids = listSessions().filter(s => s.analysisFile).map(s => s.id);
  if (controller.active && !ids.includes(controller.active.id)) ids.unshift(controller.active.id);
  for (const id of ids) {
    try {
      synced.push(await syncSession(id));
    } catch (e) {
      failed.push({ sessionId: id, error: (e as Error).message });
    }
  }
  return { synced, failed };
}

/** Background sync used by auto-sync: never throws, logs the outcome. */
export function syncInBackground(sessionId: string, reason: string): void {
  const s = graphSettings();
  if (!s.enabled || !s.autoSync) return;
  const job = syncSession(sessionId)
    .then(r => info(`Neo4j: ${reason} - session ${r.sessionId} synced (${r.requests} requests, ${r.records} records)`))
    .catch(e => warn(`Neo4j auto-sync failed: ${(e as Error).message}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

const pending = new Set<Promise<void>>();

/** Wait for background syncs (used before the process exits). */
export async function flushSyncs(timeoutMs = 15000): Promise<void> {
  // a sync for a session that just finished starts on the next tick
  await new Promise(r => setImmediate(r));
  if (!pending.size) return;
  await Promise.race([Promise.all([...pending]), new Promise(r => setTimeout(r, timeoutMs).unref())]);
}

let autoSyncInstalled = false;

/** Sync every session into Neo4j when it finishes (only while Neo4j is enabled with autoSync). */
export function installAutoSync(): void {
  if (autoSyncInstalled) return;
  autoSyncInstalled = true;
  controller.on('session', (session: ExtractorSession) => {
    session.on('status', (summary: { status: string }) => {
      // session.json is written right after the status changes, so start on the next tick
      if (summary.status === 'finished') setImmediate(() => syncInBackground(session.id, 'session finished'));
    });
  });
}
