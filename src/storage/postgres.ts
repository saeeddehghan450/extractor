/**
 * postgres.ts
 *
 * PostgreSQL (official "pg" client): connection pool, schema migrations and read-only SQL for the
 * dashboard and the AI tools. Everything lives in the "extractor" schema.
 */

import { Pool, PoolClient, types } from 'pg';
import { debug, warn } from '../utils/logger';
import { StorageError, maskUrl, postgresSettings } from './settings';

export const SQL_SCHEMA = `Schema "extractor" (PostgreSQL). Timestamps are timestamptz, JSON columns are jsonb.

sessions        (id PK, url, host, status, started_at, ended_at, device, network, requests, errors,
                 title, summary jsonb, overview jsonb, archived_at, file_count, total_bytes)
requests        (session_id FK, id, url, host, method, resource_type, status, size, duration_ms, failure,
                 content_type, started_at, request_headers jsonb, response_headers jsonb)   PK (session_id, id)
console_messages(session_id FK, seq, type, text, source, line, at)   type: log|info|warning|error|uncaught|dialog
cookies         (session_id FK, domain, name, path, value, secure, http_only, same_site, expires)
security_headers(session_id FK, name, value, present boolean)
scrapes         (id PK, session_id FK, name, url, pages, row_count, scraped_at, recipe jsonb)
scrape_records  (scrape_id FK, idx, data jsonb)          one row per scraped item, columns as JSON keys
files           (session_id FK, path, size, md5, content_type, object_key, uploaded_at)   files stored in SeaweedFS

Every table except sessions references sessions(id) with ON DELETE CASCADE.
Examples:
  SELECT host, count(*) FROM extractor.requests GROUP BY host ORDER BY 2 DESC;
  SELECT r.data->>'title' AS title, r.data->>'price' AS price FROM extractor.scrape_records r JOIN extractor.scrapes s ON s.id = r.scrape_id WHERE s.name = 'Products';`;

const MIGRATIONS = [
  'CREATE SCHEMA IF NOT EXISTS extractor',
  `CREATE TABLE IF NOT EXISTS extractor.sessions (
    id text PRIMARY KEY, url text, host text, status text, started_at timestamptz, ended_at timestamptz,
    device text, network text, requests integer, errors integer, title text,
    summary jsonb, overview jsonb, archived_at timestamptz NOT NULL DEFAULT now(), file_count integer NOT NULL DEFAULT 0,
    total_bytes bigint NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS extractor.requests (
    session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE, id text NOT NULL,
    url text, host text, method text, resource_type text, status integer, size bigint, duration_ms double precision,
    failure text, content_type text, started_at timestamptz, request_headers jsonb, response_headers jsonb,
    PRIMARY KEY (session_id, id))`,
  'CREATE INDEX IF NOT EXISTS requests_host ON extractor.requests (host)',
  `CREATE TABLE IF NOT EXISTS extractor.console_messages (
    session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE, seq integer NOT NULL,
    type text, text text, source text, line integer, at timestamptz, PRIMARY KEY (session_id, seq))`,
  `CREATE TABLE IF NOT EXISTS extractor.cookies (
    session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE, domain text NOT NULL, name text NOT NULL,
    path text NOT NULL, value text, secure boolean, http_only boolean, same_site text, expires timestamptz,
    PRIMARY KEY (session_id, domain, name, path))`,
  `CREATE TABLE IF NOT EXISTS extractor.security_headers (
    session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE, name text NOT NULL, value text,
    present boolean NOT NULL, PRIMARY KEY (session_id, name))`,
  `CREATE TABLE IF NOT EXISTS extractor.scrapes (
    id text PRIMARY KEY, session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE,
    name text, url text, pages integer, row_count integer, scraped_at timestamptz, recipe jsonb)`,
  `CREATE TABLE IF NOT EXISTS extractor.scrape_records (
    scrape_id text NOT NULL REFERENCES extractor.scrapes(id) ON DELETE CASCADE, idx integer NOT NULL, data jsonb NOT NULL,
    PRIMARY KEY (scrape_id, idx))`,
  'CREATE INDEX IF NOT EXISTS scrape_records_data ON extractor.scrape_records USING gin (data)',
  `CREATE TABLE IF NOT EXISTS extractor.files (
    session_id text NOT NULL REFERENCES extractor.sessions(id) ON DELETE CASCADE, path text NOT NULL, size bigint,
    md5 text, content_type text, object_key text, uploaded_at timestamptz, PRIMARY KEY (session_id, path))`
];

// count(*) and bigint columns as numbers (exact up to 2^53, far beyond these tables)
types.setTypeParser(types.builtins.INT8, v => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

/** Role used for user / model queries: SELECT on the extractor schema only (no file or admin functions). */
const READER_ROLE = 'extractor_reader';

let pool: Pool | null = null;
let poolKey = '';
let migrated = '';
let readerRole = false;

export function getPool(): Pool {
  const s = postgresSettings();
  if (!s.enabled) throw new StorageError(409, 'PostgreSQL is not configured - set it up on the Storage page or with DATABASE_URL');
  if (!pool || poolKey !== s.url) {
    void pool?.end().catch(() => undefined);
    pool = new Pool({ connectionString: s.url, max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    pool.on('error', e => warn(`PostgreSQL pool error: ${e.message}`));
    poolKey = s.url;
    migrated = '';
    debug(`PostgreSQL pool created for ${maskUrl(s.url)}`);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  const p = pool;
  pool = null;
  poolKey = '';
  migrated = '';
  if (p) await p.end().catch(() => undefined);
}

export function cleanPgError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const msg = (err.message || String(e)).split('\n')[0];
  if (err.code === '28P01') return 'PostgreSQL rejected the user name or password';
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || /ECONNREFUSED|ENOTFOUND|timeout/i.test(msg)) return `Cannot reach PostgreSQL: ${msg}`;
  return msg;
}

/** Create the schema and the read-only role (once per connection URL). */
export async function ensureSchema(): Promise<void> {
  const p = getPool();
  if (migrated === poolKey) return;
  const client = await p.connect();
  try {
    for (const m of MIGRATIONS) await client.query(m);
    readerRole = await setupReaderRole(client);
    migrated = poolKey;
  } finally {
    client.release();
  }
}

async function setupReaderRole(client: PoolClient): Promise<boolean> {
  try {
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${READER_ROLE}') THEN CREATE ROLE ${READER_ROLE} NOLOGIN; END IF;
    END $$`);
    await client.query(`GRANT USAGE ON SCHEMA extractor TO ${READER_ROLE}`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA extractor TO ${READER_ROLE}`);
    const member = await client.query(`SELECT pg_has_role(current_user, '${READER_ROLE}', 'MEMBER') AS ok`);
    if (!member.rows[0]?.ok) await client.query(`GRANT ${READER_ROLE} TO CURRENT_USER`);
    return true;
  } catch (e) {
    warn(`PostgreSQL: could not set up the read-only role (${cleanPgError(e)}); queries still run in read-only transactions`);
    return false;
  }
}

/** Run statements in one transaction. */
export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// read-only SQL
// ---------------------------------------------------------------------------

/** Only plain queries; functions that run dynamic SQL, touch server files or change settings are refused. */
const START_RE = /^\s*(\(\s*)*(select|with|table|values|explain)\b/i;
const BLOCKED_RE = /\b(pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|\w*_to_xml\w*|set_config|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|current_setting|copy)\b/i;

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
}

export async function runReadOnlySql(sql: string, params: unknown[] = [], opts: { limit?: number; timeoutMs?: number } = {}): Promise<SqlResult> {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!text) throw new StorageError(400, 'Empty query');
  if (text.length > 20000) throw new StorageError(400, 'Query too long');
  if (!START_RE.test(text)) throw new StorageError(400, 'Only SELECT / WITH / TABLE / VALUES / EXPLAIN queries are allowed');
  if (BLOCKED_RE.test(text)) throw new StorageError(400, 'This function or statement is not allowed here');
  const limit = Math.max(1, Math.min(5000, opts.limit ?? 200));
  const timeout = Math.max(1000, Math.min(120000, opts.timeoutMs ?? 30000));

  try {
    await ensureSchema();
  } catch (e) {
    throw e instanceof StorageError ? e : new StorageError(502, cleanPgError(e));
  }
  const client = await getPool().connect().catch(e => { throw new StorageError(502, cleanPgError(e)); });
  const started = Date.now();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${timeout}`);
    await client.query('SET LOCAL search_path = extractor, pg_catalog');
    if (readerRole) await client.query(`SET LOCAL ROLE ${READER_ROLE}`);
    // the extended protocol accepts exactly one statement
    const result = await client.query({ text, values: params, rowMode: 'array', queryMode: 'extended' } as any);
    const columns: string[] = [];
    for (const f of result.fields) {
      let name = f.name;
      for (let i = 2; columns.includes(name); i++) name = `${f.name}_${i}`;
      columns.push(name);
    }
    const rows = (result.rows as unknown[][]).slice(0, limit).map(r => {
      const row: Record<string, unknown> = {};
      columns.forEach((c, i) => { row[c] = plain(r[i]); });
      return row;
    });
    return { columns, rows, truncated: result.rows.length > limit, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError(400, cleanPgError(e));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (Buffer.isBuffer(v)) return `\\x${v.toString('hex').slice(0, 200)}`;
  return v;
}

export interface PostgresStatus {
  enabled: boolean;
  connected: boolean;
  url: string;
  source: 'env' | 'config' | 'none';
  version?: string;
  readOnlyRole?: boolean;
  error?: string;
  counts?: Record<string, number>;
}

export async function postgresStatus(): Promise<PostgresStatus> {
  const s = postgresSettings();
  const base: PostgresStatus = { enabled: s.enabled, connected: false, url: maskUrl(s.url), source: s.source };
  if (!s.enabled) return base;
  try {
    await ensureSchema();
    const p = getPool();
    const v = await p.query('SHOW server_version');
    const c = await p.query(`SELECT
      (SELECT count(*) FROM extractor.sessions)::int AS sessions,
      (SELECT count(*) FROM extractor.requests)::int AS requests,
      (SELECT count(*) FROM extractor.console_messages)::int AS console_messages,
      (SELECT count(*) FROM extractor.cookies)::int AS cookies,
      (SELECT count(*) FROM extractor.scrapes)::int AS scrapes,
      (SELECT count(*) FROM extractor.scrape_records)::int AS scrape_records,
      (SELECT count(*) FROM extractor.files)::int AS files`);
    return { ...base, connected: true, version: `PostgreSQL ${v.rows[0].server_version}`, readOnlyRole: readerRole, counts: c.rows[0] };
  } catch (e) {
    return { ...base, error: cleanPgError(e) };
  }
}
