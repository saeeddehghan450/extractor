/**
 * graphRoutes.ts
 *
 *   GET  /api/graph/status                         connection, counts, settings (never the password)
 *   PUT  /api/graph/config   {enabled, uri, user, password, database, autoSync}
 *   POST /api/graph/sync     {sessionId?} | {all: true}
 *   POST /api/graph/query    {cypher, params?, limit?}   read-only
 *   GET  /api/graph/insights                       list of ready-made analyses
 *   POST /api/graph/insights {id, sessionId?, limit?}
 *   GET  /api/graph/schema                         schema text for people and models
 */

import http from 'http';
import { updateConfig } from '../utils/configManager';
import { GraphError, closeDriver, graphStatus, runReadQuery } from '../graph/neo4jClient';
import { listInsights, runInsight } from '../graph/insights';
import { GRAPH_SCHEMA, syncAll, syncSession } from '../graph/sync';

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const URI_RE = /^(bolt|neo4j)(\+s|\+ssc)?:\/\/[^\s/]+(:\d+)?\/?$/i;

export async function handleGraphRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  readBody: (req: http.IncomingMessage) => Promise<any>
): Promise<boolean> {
  const p = url.pathname;
  const method = req.method || 'GET';
  if (!p.startsWith('/api/graph/')) return false;

  if (p === '/api/graph/status' && method === 'GET') {
    sendJSON(res, 200, await graphStatus());
    return true;
  }

  if (p === '/api/graph/config' && method === 'PUT') {
    const body = await readBody(req);
    if (typeof body.uri === 'string' && body.uri.trim() && !URI_RE.test(body.uri.trim())) {
      throw new GraphError(400, 'URI must look like bolt://host:7687 or neo4j://host:7687 (+s / +ssc for TLS)');
    }
    updateConfig({
      neo4j: {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        uri: typeof body.uri === 'string' ? body.uri : undefined,
        user: typeof body.user === 'string' ? body.user : undefined,
        database: typeof body.database === 'string' ? body.database : undefined,
        autoSync: typeof body.autoSync === 'boolean' ? body.autoSync : undefined,
        password: body.password === null ? null : typeof body.password === 'string' ? body.password : undefined
      }
    });
    await closeDriver();
    sendJSON(res, 200, await graphStatus());
    return true;
  }

  if (p === '/api/graph/sync' && method === 'POST') {
    const body = await readBody(req);
    if (body.all) {
      const r = await syncAll();
      sendJSON(res, 200, r);
    } else {
      sendJSON(res, 200, await syncSession(typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined));
    }
    return true;
  }

  if (p === '/api/graph/query' && method === 'POST') {
    const body = await readBody(req);
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
    sendJSON(res, 200, await runReadQuery(String(body.cypher ?? ''), params, { limit: Number(body.limit) || 500 }));
    return true;
  }

  if (p === '/api/graph/insights' && method === 'GET') {
    sendJSON(res, 200, listInsights());
    return true;
  }

  if (p === '/api/graph/insights' && method === 'POST') {
    const body = await readBody(req);
    sendJSON(res, 200, await runInsight(String(body.id ?? ''), typeof body.sessionId === 'string' ? body.sessionId : null, Number(body.limit) || 500));
    return true;
  }

  if (p === '/api/graph/schema' && method === 'GET') {
    sendJSON(res, 200, { schema: GRAPH_SCHEMA });
    return true;
  }

  return false;
}
