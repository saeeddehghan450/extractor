/**
 * files.ts
 *
 * Sending files: captured session files (untrusted content) and the dashboard (the Next.js export).
 */

import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { isApiPath } from './security';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.har': 'application/json; charset=utf-8',
  '.heapsnapshot': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

/**
 * A file captured from a website: scripts and styles are shown as text and HTML is sandboxed, so
 * nothing captured ever runs on the dashboard's origin.
 */
export function sendSessionFile(res: Response, file: string, download = false): void {
  const ext = path.extname(file).toLowerCase();
  const type = ['.js', '.css', '.svg', '.txt'].includes(ext) ? 'text/plain; charset=utf-8' : MIME[ext] || 'application/octet-stream';
  res.status(200);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', fs.statSync(file).size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (ext === '.html') res.setHeader('Content-Security-Policy', 'sandbox');
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file).replace(/"/g, '')}"`);
  fs.createReadStream(file).pipe(res);
}

/** Folder of the built dashboard (next build -> web/out). */
export const DASHBOARD_DIR = path.resolve(__dirname, '..', '..', '..', 'web', 'out');

function resolveDashboardFile(urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidates = [rel, `${rel}.html`, path.join(rel, 'index.html')];
  for (const c of candidates) {
    const full = path.resolve(DASHBOARD_DIR, '.' + path.sep + c);
    if (full !== DASHBOARD_DIR && !full.startsWith(DASHBOARD_DIR + path.sep)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

/** Serves the dashboard for every GET that is not an API route (SPA fallback to the 404 page). */
export function dashboardMiddleware(req: Request, res: Response, next: NextFunction): void {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path) || req.path.startsWith('/ws/')) return next();
  let file = resolveDashboardFile(req.path);
  let status = 200;
  if (!file) {
    file = resolveDashboardFile('/404.html');
    status = 404;
  }
  if (!file) {
    res.status(503).type('text/plain').send('The dashboard is not built yet - run "npm run build:web".');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.status(status);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // hashed build assets never change
  res.setHeader('Cache-Control', req.path.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', fs.statSync(file).size);
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
