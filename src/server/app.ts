/**
 * app.ts
 *
 * The dashboard server (NestJS on Express): JSON API, Server-Sent Events, the /ws/live WebSocket,
 * MCP and the tool gateway, plus the dashboard itself (the static Next.js export in web/out).
 */

import 'reflect-metadata';
import type { Server } from 'http';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { installAutoSync } from '../graph/sync';
import { installAutoArchive } from '../storage/archive';
import { AppModule } from './app.module';
import { dashboardMiddleware } from './common/files';
import { jsonBodyMiddleware, securityMiddleware } from './common/security';
import { parseLiveMessage } from './live/live.gateway';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // our own logger reports what matters; Nest's route table is noise here
    logger: ['error', 'warn'],
    bodyParser: false
  });
  app.disable('x-powered-by');
  // order matters: security checks, then the dashboard pages, then JSON bodies for the API routes
  app.use(securityMiddleware);
  app.use(dashboardMiddleware);
  app.use(jsonBodyMiddleware());
  // one message per client at a time: live input is applied in order
  app.useWebSocketAdapter(new WsAdapter(app, { messageParser: parseLiveMessage, maxConcurrentMessages: 1 }));
  await app.init();
  installAutoSync();
  installAutoArchive();
  return app;
}

/** An initialised (not yet listening) HTTP server, e.g. for tests: `(await createServer()).listen(0)`. */
export async function createServer(): Promise<Server> {
  const app = await createApp();
  return app.getHttpServer() as Server;
}
