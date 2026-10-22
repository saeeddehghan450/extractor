/**
 * error.filter.ts
 *
 * Every error becomes {"error": "<first line of the message>"} with its status code. Domain errors
 * (ControllerError, GraphError, StorageError, ...) carry their own `status`; anything else is a 500.
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { error } from '../../utils/logger';

function statusOf(e: unknown): number {
  if (e instanceof HttpException) return e.getStatus();
  const s = (e as { status?: unknown; statusCode?: unknown }).status ?? (e as { statusCode?: unknown }).statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : 500;
}

function messageOf(e: unknown, status: number): string {
  // body-parser errors
  const type = (e as { type?: string }).type;
  if (type === 'entity.parse.failed') return 'Invalid JSON body';
  if (type === 'entity.too.large') return 'Body too large';
  if (e instanceof HttpException) {
    const r = e.getResponse();
    const m = typeof r === 'string' ? r : (r as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('; ');
    if (typeof m === 'string') return status === 404 && /^Cannot \w+ /.test(m) ? `Unknown endpoint: ${m.replace(/^Cannot /, '')}` : m;
  }
  return ((e as Error)?.message || String(e)).split('\n')[0];
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = statusOf(e);
    const message = messageOf(e, status);
    if (status >= 500) error(`${req.method} ${req.path}: ${message}`);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).setHeader('Cache-Control', 'no-store');
    res.json({ error: message });
  }
}
