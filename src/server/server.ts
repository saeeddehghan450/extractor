/**
 * server.ts
 *
 * Web dashboard for the extractor: a small HTTP server (no external dependencies)
 * that serves the UI from /public, exposes a JSON API and streams live events (SSE).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { COLLECTORS } from '../collectors/registry';
import { ExtractorSession, packageVersion } from '../core/session';
import { ControllerError, controller } from '../core/controller';
import { RouteError, handleAiRoute } from './aiRoutes';
import { ScraperRouteError, handleScraperRoute } from './scraperRoutes';
import { attachLiveSocket } from './liveSocket';
import { DEVICE_PRESETS, NETWORK_PRESETS } from '../core/emulation';
import { buildHar } from '../core/har';
import { ReportLang, renderReport } from '../core/report';
import { searchSession } from '../core/search';
import { readJSON } from '../utils/fileUtils';
import {
  OUTPUT_DIR,
  deleteSession,
  getSession,
  isValidSessionId,
  listSessionFiles,
  listSessions,
  resolveSessionFile,
  sessionDir
} from '../core/sessionStore';
import { getCollectorFlags, isHeadlessForced, loadConfig, updateConfig } from '../utils/configManager';
import { PRESETS, applyPreset, isPresetName } from '../utils/presets';
import { error, info, onLog, success, warn } from '../utils/logger';

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.heapsnapshot': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// live session + SSE clients
// ---------------------------------------------------------------------------

const clients = new Set<http.ServerResponse>();

function broadcast(type: string, data: unknown) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

onLog(entry => {
  if (entry.level !== 'DEBUG') broadcast('log', entry);
});

function compactRequest(r: any) {
  return { id: r.id, url: r.url, method: r.method, resourceType: r.resourceType, timestamp: r.timestamp };
}

function compactResponse(r: any) {
  return {
    id: r.id,
    requestId: r.requestId,
    url: r.url,
    method: r.method,
    status: r.status,
    resourceType: r.resourceType,
    contentType: r.contentType,
    size: r.size,
    timestamp: r.timestamp
  };
}

function wireSession(s: ExtractorSession) {
  s.on('status', summary => broadcast('status', summary));
  s.on('request', r => broadcast('request', compactRequest(r)));
  s.on('response', r => broadcast('response', compactResponse(r)));
  s.on('console', m => broadcast('console', m));
  s.on('pageerror', e => broadcast('console', { timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true }));
  s.on('dialog', d => broadcast('console', { timestamp: d.timestamp, type: 'info', text: `[dialog:${d.type}] ${d.message}` }));
  s.on('click', c => broadcast('click', c));
  s.on('snapshot-start', d => broadcast('snapshot-start', d));
  s.on('snapshot', snap => broadcast('snapshot', snap));
  s.on('navigated', d => broadcast('navigated', d));
  s.on('blocked', d => broadcast('blocked', d));

  // counters change constantly; send them at most once per second
  let last = '';
  const timer = setInterval(() => {
    const counts = JSON.stringify(s.counts());
    if (counts !== last) {
      last = counts;
      broadcast('counts', { id: s.id, counts: s.counts() });
    }
    if (!s.isActive) clearInterval(timer);
  }, 1000);
  timer.unref();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function sendFile(res: http.ServerResponse, file: string, download = false) {
  const ext = path.extname(file).toLowerCase();
  const isPublic = file.startsWith(PUBLIC_DIR + path.sep);
  // captured scripts/styles are shown as text, never executed on the dashboard origin
  const type = !isPublic && ['.js', '.css', '.svg', '.txt'].includes(ext) ? 'text/plain; charset=utf-8' : MIME[ext] || 'application/octet-stream';
  const headers: Record<string, string | number> = {
    'Content-Type': type,
    'Content-Length': fs.statSync(file).size,
    'X-Content-Type-Options': 'nosniff'
  };
  // Saved HTML pages are untrusted content: never render them as part of the dashboard origin
  if (ext === '.html' && !isPublic) {
    headers['Content-Security-Policy'] = 'sandbox';
  }
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function requireSession(): ExtractorSession {
  return controller.require();
}

// every session - started from the dashboard, MCP, the gateway or the agent - is shown live
controller.on('session', (s: ExtractorSession) => wireSession(s));

/**
 * Basic protection for a localhost service: state-changing requests must be JSON
 * (forces a CORS preflight for cross-site pages) and must not come from another origin.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * DNS-rebinding protection: only answer requests addressed to localhost or to a host listed in
 * EXTRACTOR_ALLOWED_HOSTS (comma separated, "*" disables the check).
 */
function checkHost(req: http.IncomingMessage) {
  const allowed = (process.env.EXTRACTOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes('*')) return;
  const host = (req.headers.host || '').toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!LOCAL_HOSTS.includes(hostname) && !allowed.includes(hostname) && !allowed.includes(host)) {
    throw new HttpError(403, `Host "${host}" is not allowed (set EXTRACTOR_ALLOWED_HOSTS to allow it)`);
  }
}

function checkOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* invalid */ }
    if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request rejected');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers['content-type'] || '';
    if (req.method !== 'DELETE' && !ct.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  checkOrigin(req);
  if (await handleScraperRoute(req, res, url, readBody)) return;
  const current = controller.current;
  const method = req.method || 'GET';
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const route = `${method} /${parts.join('/')}`;

  // --- meta / config ---
  if (route === 'GET /meta') {
    return sendJSON(res, 200, {
      collectors: COLLECTORS,
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, description: p.description, collectors: p.collectors })),
      outputDir: OUTPUT_DIR,
      forceHeadless: isHeadlessForced(),
      devices: Object.entries(DEVICE_PRESETS).map(([key, d]) => ({ key, label: d.label })),
      networks: Object.entries(NETWORK_PRESETS).map(([key, n]) => ({ key, label: n.label })),
      version: packageVersion()
    });
  }
  if (route === 'GET /config') return sendJSON(res, 200, loadConfig());
  if (route === 'PUT /config') return sendJSON(res, 200, updateConfig(await readBody(req)));
  if (method === 'POST' && parts[0] === 'presets' && parts.length === 2) {
    if (!isPresetName(parts[1])) throw new HttpError(404, 'Unknown preset');
    applyPreset(parts[1]);
    return sendJSON(res, 200, loadConfig());
  }

  // --- live session ---
  if (route === 'GET /session') return sendJSON(res, 200, current ? current.summary() : null);

  if (route === 'GET /session/live') {
    if (!current) return sendJSON(res, 200, null);
    const responses = new Map(current.network.responses.map(r => [r.requestId, r]));
    const requests = current.network.requests.slice(-1000).map(r => {
      const resp = responses.get(r.id);
      return { ...compactRequest(r), response: resp ? compactResponse(resp) : null, failure: r.failure };
    });
    const consoleLines = [
      ...current.consoleData.logs.map(m => ({ ...m })),
      ...current.consoleData.pageErrors.map(e => ({ timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true }))
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-1000);
    return sendJSON(res, 200, { summary: current.summary(), requests, console: consoleLines, clicks: current.clicks.slice(-200) });
  }

  if (route === 'GET /session/har') {
    if (!current) throw new HttpError(404, 'No session');
    const har = buildHar({
      requests: current.network.requests,
      responses: current.network.responses,
      pageUrl: current.options.url,
      startedAt: current.startedAt,
      sessionDir: current.dir,
      creatorVersion: packageVersion()
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${current.id}.har"`,
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(har, null, 2));
  }

  if (route === 'POST /session/start') {
    const body = await readBody(req);
    const session = await controller.start({
      url: body.url,
      headless: body.headless,
      collectors: body.collectors,
      emulation: body.emulation
    });
    return sendJSON(res, 200, session.summary());
  }

  if (route === 'POST /session/snapshot') {
    const snap = await requireSession().snapshot('manual');
    return sendJSON(res, 200, snap);
  }

  if (route === 'POST /session/stop') {
    const s = requireSession();
    await s.stop();
    return sendJSON(res, 200, s.summary());
  }

  if (route === 'GET /session/screenshot') {
    const img = await requireSession().screenshot();
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': img.length });
    return res.end(img);
  }

  if (route === 'POST /session/input') {
    const s = requireSession();
    const body = await readBody(req);
    switch (body.action) {
      case 'click': await s.click(Number(body.x), Number(body.y)); break;
      case 'scroll': await s.scroll(Number(body.deltaY) || 0); break;
      case 'type': await s.type(String(body.text ?? '')); break;
      case 'press': await s.press(String(body.key)); break;
      case 'navigate': await s.navigate(String(body.url)); break;
      case 'back':
      case 'forward':
      case 'reload': await s.history(body.action); break;
      default: throw new HttpError(400, 'Unknown action');
    }
    return sendJSON(res, 200, { ok: true, url: s.activePage?.url() ?? null });
  }

  if (method === 'GET' && parts[0] === 'session' && parts[1] === 'request' && parts[2]) {
    if (!current) throw new HttpError(404, 'No session');
    const id = parts[2];
    const request = current.network.requests.find(r => r.id === id) || null;
    const response = current.network.responses.find(r => r.requestId === id || r.id === id) || null;
    if (!request && !response) throw new HttpError(404, 'Request not found');
    return sendJSON(res, 200, { request, response });
  }

  // --- saved sessions ---
  if (route === 'GET /sessions') return sendJSON(res, 200, listSessions());

  if (parts[0] === 'sessions' && parts[1]) {
    const id = parts[1];
    if (!isValidSessionId(id)) throw new HttpError(400, 'Invalid session id');

    if (method === 'GET' && parts.length === 2) {
      const s = current?.id === id ? current.summary() : getSession(id);
      if (!s) throw new HttpError(404, 'Session not found');
      return sendJSON(res, 200, s);
    }
    if (method === 'DELETE' && parts.length === 2) {
      if (current?.id === id && current.isActive) throw new HttpError(409, 'Stop the session before deleting it');
      if (!deleteSession(id)) throw new HttpError(404, 'Session not found');
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'GET' && parts[2] === 'files') return sendJSON(res, 200, listSessionFiles(id));

    if (method === 'GET' && (parts[2] === 'report' || parts[2] === 'search')) {
      const dir = sessionDir(id);
      const analysis = readJSON(path.join(dir, 'analysis.json'));
      if (!analysis) throw new HttpError(404, 'This session has no analysis.json yet');

      if (parts[2] === 'search') {
        const q = (url.searchParams.get('q') || '').slice(0, 500);
        return sendJSON(res, 200, searchSession(dir, analysis, q, {
          regex: url.searchParams.get('regex') === '1',
          caseSensitive: url.searchParams.get('case') === '1',
          limit: Number(url.searchParams.get('limit')) || undefined
        }));
      }

      const lang: ReportLang = url.searchParams.get('lang') === 'fa' ? 'fa' : 'en';
      const html = renderReport(analysis, readJSON(path.join(dir, 'session.json')), dir, lang);
      const headers: Record<string, string | number> = {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        // the report needs no scripts; it may contain text captured from untrusted pages
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff'
      };
      if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="report-${id}.html"`;
      res.writeHead(200, headers);
      return res.end(html);
    }
    if (method === 'GET' && parts[2] === 'file') {
      const rel = url.searchParams.get('path') || '';
      const file = resolveSessionFile(id, rel);
      if (!file) throw new HttpError(404, 'File not found');
      return sendFile(res, file, url.searchParams.get('download') === '1');
    }
  }

  throw new HttpError(404, `Unknown endpoint: ${route}`);
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ session: controller.current ? controller.current.summary() : null })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function handleStatic(res: http.ServerResponse, pathname: string) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA fallback
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }
  return sendFile(res, file);
}

export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      checkHost(req);
      if (url.pathname === '/mcp' || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/agent/')) {
        checkOrigin(req);
        if (await handleAiRoute(req, res, url, readBody)) return;
      }
      if (url.pathname === '/api/events') return handleEvents(req, res);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return handleStatic(res, url.pathname);
    } catch (e) {
      const status = e instanceof HttpError || e instanceof ControllerError || e instanceof RouteError || e instanceof ScraperRouteError ? e.status : 500;
      const message = (e as Error).message.split('\n')[0];
      if (status >= 500) error(`${req.method} ${url.pathname}: ${message}`);
      if (!res.headersSent) sendJSON(res, status, { error: message });
      else res.end();
    }
  });
  attachLiveSocket(server);
  return server;
}

export async function stopCurrentSession(): Promise<void> {
  await controller.stopIfActive();
}

if (require.main === module) {
  const cfg = loadConfig();
  const port = Number(process.env.PORT) || cfg.port || 4000;
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    success(`Dashboard running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    info(`Output folder: ${OUTPUT_DIR}`);
  });
  server.on('error', e => {
    error(`Server error: ${e.message}`);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    warn('Shutting down...');
    await stopCurrentSession().catch(() => undefined);
    for (const c of clients) c.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
