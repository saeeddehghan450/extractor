/**
 * security.ts
 *
 * Protection for a service that drives a browser on this machine:
 *  - Host check on every request and WebSocket upgrade (DNS rebinding): only localhost or the
 *    hosts in EXTRACTOR_ALLOWED_HOSTS (comma separated, "*" disables the check)
 *  - Origin check: requests from another origin are rejected (EXTRACTOR_ALLOWED_ORIGINS lists exceptions)
 *  - state-changing API requests must be JSON (forces a CORS preflight for cross-site pages)
 *  - optional bearer token (EXTRACTOR_API_TOKEN) on /mcp and /v1
 */

import type { IncomingMessage } from 'http';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** null when the Host header is allowed, otherwise the reason. */
export function hostProblem(req: IncomingMessage): string | null {
  const allowed = (process.env.EXTRACTOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes('*')) return null;
  const host = (req.headers.host || '').toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (LOCAL_HOSTS.includes(hostname) || allowed.includes(hostname) || allowed.includes(host)) return null;
  return `Host "${host}" is not allowed (set EXTRACTOR_ALLOWED_HOSTS to allow it)`;
}

/**
 * null when the request comes from the dashboard's own origin, from an origin listed in
 * EXTRACTOR_ALLOWED_ORIGINS (e.g. the Next.js dev server), or from a non-browser client.
 */
export function originProblem(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  let parsed: URL | null = null;
  try { parsed = new URL(origin); } catch { /* invalid */ }
  if (parsed && parsed.host === req.headers.host) return null;
  const allowed = (process.env.EXTRACTOR_ALLOWED_ORIGINS || '').split(',').map(o => o.trim().replace(/\/$/, '').toLowerCase()).filter(Boolean);
  if (parsed && allowed.includes(parsed.origin.toLowerCase())) return null;
  return 'Cross-origin request rejected';
}

const API_PREFIXES = ['/api/', '/v1/', '/mcp'];
export const isApiPath = (p: string) => API_PREFIXES.some(prefix => p === prefix.replace(/\/$/, '') || p.startsWith(prefix));

/**
 * First middleware of the app: Host check for everything, Origin + JSON checks for the API.
 * Requests that fail are answered here, before any parsing or routing.
 */
export function securityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reject = (status: number, message: string) => {
    res.status(status).setHeader('Cache-Control', 'no-store');
    res.json({ error: message });
  };
  const host = hostProblem(req);
  if (host) return reject(403, host);
  const pathname = (req.originalUrl || req.url || '/').split('?')[0];
  if (!isApiPath(pathname)) return next();

  const origin = originProblem(req);
  if (origin) return reject(403, origin);
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE' && req.method !== 'OPTIONS') {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return reject(415, 'Content-Type must be application/json');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/** JSON bodies up to 1 MB, with readable errors. */
export function jsonBodyMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const parse = json({ limit: '1mb' });
  return (req, res, next) => parse(req, res, err => {
    if (!err) return next();
    const type = (err as { type?: string }).type;
    const status = type === 'entity.too.large' ? 413 : (err as { status?: number }).status || 400;
    const message = type === 'entity.parse.failed' ? 'Invalid JSON body' : type === 'entity.too.large' ? 'Body too large' : (err as Error).message;
    res.status(status).setHeader('Cache-Control', 'no-store');
    res.json({ error: message });
  });
}

/** EXTRACTOR_API_TOKEN, when set, is required as a bearer token. */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.EXTRACTOR_API_TOKEN;
    if (!token) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if ((req.headers.authorization || '') !== `Bearer ${token}`) throw new UnauthorizedException('Missing or invalid bearer token');
    return true;
  }
}
