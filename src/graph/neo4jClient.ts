/**
 * neo4jClient.ts
 *
 * Connection to Neo4j (official neo4j-driver): settings, driver lifecycle, value conversion and
 * read-only query execution for the dashboard and the AI tools.
 */

import neo4j, { Driver, Integer, isDate, isDateTime, isDuration, isLocalDateTime, isLocalTime, isNode, isPath, isPoint, isRelationship, isTime } from 'neo4j-driver';
import { loadConfig } from '../utils/configManager';
import { debug } from '../utils/logger';

export interface GraphSettings {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  database: string | undefined;
  autoSync: boolean;
  /** where the settings came from, for the status page */
  source: 'env' | 'config' | 'none';
}

/** NEO4J_* environment variables > config.json "neo4j" > defaults. */
export function graphSettings(): GraphSettings {
  const c = loadConfig().neo4j || {};
  const env = process.env;
  const fromEnv = !!env.NEO4J_URI;
  const enabled = fromEnv ? env.NEO4J_ENABLED !== '0' : !!c.enabled;
  return {
    enabled,
    uri: env.NEO4J_URI || c.uri || 'bolt://localhost:7687',
    user: env.NEO4J_USER || env.NEO4J_USERNAME || c.user || 'neo4j',
    password: env.NEO4J_PASSWORD || c.password || '',
    database: env.NEO4J_DATABASE || c.database || undefined,
    autoSync: env.NEO4J_AUTO_SYNC ? env.NEO4J_AUTO_SYNC !== '0' : c.autoSync ?? true,
    source: fromEnv ? 'env' : c.enabled ? 'config' : 'none'
  };
}

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let driver: Driver | null = null;
let driverKey = '';

/** The shared driver for the current settings (recreated when they change). */
export function getDriver(): Driver {
  const s = graphSettings();
  if (!s.enabled) throw new GraphError(409, 'Neo4j is not configured - set it up on the Graph page or with NEO4J_URI / NEO4J_PASSWORD');
  const key = JSON.stringify([s.uri, s.user, s.password]);
  if (!driver || key !== driverKey) {
    void driver?.close().catch(() => undefined);
    driver = neo4j.driver(s.uri, neo4j.auth.basic(s.user, s.password), {
      disableLosslessIntegers: true,
      connectionAcquisitionTimeout: 10000,
      connectionTimeout: 10000,
      maxConnectionPoolSize: 20
    });
    driverKey = key;
    debug(`Neo4j driver created for ${s.uri}`);
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  const d = driver;
  driver = null;
  driverKey = '';
  if (d) await d.close().catch(() => undefined);
}

export function sessionOptions(mode: 'READ' | 'WRITE') {
  const db = graphSettings().database;
  return { defaultAccessMode: mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE, ...(db ? { database: db } : {}) };
}

/** Neo4j values -> plain JSON (nodes, relationships, paths, temporal and spatial types). */
export function toPlain(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  if (Integer.isInteger(v)) return (v as Integer).toNumber();
  if (isNode(v)) return { _type: 'node', id: v.elementId, labels: v.labels, properties: toPlain(v.properties) };
  if (isRelationship(v)) {
    return { _type: 'relationship', id: v.elementId, type: v.type, start: v.startNodeElementId, end: v.endNodeElementId, properties: toPlain(v.properties) };
  }
  if (isPath(v)) {
    return {
      _type: 'path',
      nodes: [v.start, ...v.segments.map(s => s.end)].map(toPlain),
      relationships: v.segments.map(s => toPlain(s.relationship))
    };
  }
  if (isDate(v) || isDateTime(v) || isLocalDateTime(v) || isTime(v) || isLocalTime(v) || isDuration(v) || isPoint(v)) return String(v);
  if (Array.isArray(v)) return v.map(toPlain);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toPlain(val);
  return out;
}

/**
 * Statements that can read server files or call administrative procedures are refused even in
 * read mode (Neo4j itself already rejects every write inside a read transaction).
 */
const BLOCKED = [/\bLOAD\s+CSV\b/i, /\bCALL\s+(dbms|apoc|gds)\./i, /\bUSING\s+PERIODIC\b/i, /\bCALL\s*\{[^}]*\}\s*IN\s+TRANSACTIONS\b/i];

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
}

/** Run a Cypher query in a READ transaction (writes are rejected by the database). */
export async function runReadQuery(cypher: string, params: Record<string, unknown> = {}, opts: { limit?: number; timeoutMs?: number } = {}): Promise<QueryResult> {
  const text = cypher.trim();
  if (!text) throw new GraphError(400, 'Empty query');
  if (text.length > 20000) throw new GraphError(400, 'Query too long');
  const blocked = BLOCKED.find(re => re.test(text));
  if (blocked) throw new GraphError(400, 'This statement is not allowed here (LOAD CSV, admin procedures and batched writes are blocked)');
  const limit = Math.max(1, Math.min(5000, opts.limit ?? 200));
  const session = getDriver().session(sessionOptions('READ'));
  const started = Date.now();
  try {
    const result = await session.executeRead(tx => tx.run(text, params), { timeout: opts.timeoutMs ?? 30000 });
    const columns = result.records[0]?.keys.map(String) ?? [];
    const rows = result.records.slice(0, limit).map(r => {
      const row: Record<string, unknown> = {};
      for (const key of r.keys) row[String(key)] = toPlain(r.get(key));
      return row;
    });
    return { columns, rows, truncated: result.records.length > limit, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof GraphError) throw e;
    throw new GraphError(400, cleanError(e));
  } finally {
    await session.close();
  }
}

/** Run write statements in one transaction. */
export async function runWrite(statements: { cypher: string; params?: Record<string, unknown> }[]): Promise<void> {
  const session = getDriver().session(sessionOptions('WRITE'));
  try {
    await session.executeWrite(async tx => {
      for (const st of statements) await tx.run(st.cypher, st.params || {});
    });
  } finally {
    await session.close();
  }
}

export function cleanError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const msg = (err.message || String(e)).split('\n')[0];
  if (err.code === 'Neo.ClientError.Security.Unauthorized') return 'Neo4j rejected the user name or password';
  if (err.code === 'ServiceUnavailable' || /ECONNREFUSED|ENOTFOUND|connect/i.test(msg)) return `Cannot reach Neo4j: ${msg}`;
  return msg;
}

export interface GraphStatus {
  enabled: boolean;
  connected: boolean;
  uri: string;
  user: string;
  database: string | null;
  autoSync: boolean;
  source: GraphSettings['source'];
  hasPassword: boolean;
  version?: string;
  error?: string;
  nodes?: Record<string, number>;
  relationships?: Record<string, number>;
}

export async function graphStatus(): Promise<GraphStatus> {
  const s = graphSettings();
  const base: GraphStatus = {
    enabled: s.enabled, connected: false, uri: s.uri, user: s.user, database: s.database ?? null,
    autoSync: s.autoSync, source: s.source, hasPassword: !!s.password
  };
  if (!s.enabled) return base;
  try {
    const d = getDriver();
    const info = await d.getServerInfo(s.database ? { database: s.database } : undefined);
    const session = d.session(sessionOptions('READ'));
    try {
      const labels = await session.executeRead(tx => tx.run(
        'CALL db.labels() YIELD label CALL (label) { MATCH (n) WHERE label IN labels(n) RETURN count(n) AS c } RETURN label, c ORDER BY label'
      ));
      const rels = await session.executeRead(tx => tx.run(
        'CALL db.relationshipTypes() YIELD relationshipType AS t CALL (t) { MATCH ()-[r]->() WHERE type(r) = t RETURN count(r) AS c } RETURN t, c ORDER BY t'
      ));
      return {
        ...base,
        connected: true,
        version: info.agent,
        nodes: Object.fromEntries(labels.records.map(r => [r.get('label'), r.get('c')])),
        relationships: Object.fromEntries(rels.records.map(r => [r.get('t'), r.get('c')]))
      };
    } finally {
      await session.close();
    }
  } catch (e) {
    return { ...base, error: cleanError(e) };
  }
}
