/**
 * main.ts - starts the dashboard server (npm start / node dist/server/main.js).
 */

import { createApp } from './app';
import { controller } from '../core/controller';
import { OUTPUT_DIR } from '../core/sessionStore';
import { flushSyncs } from '../graph/sync';
import { flushArchives } from '../storage/archive';
import { loadConfig } from '../utils/configManager';
import { error, info, success, warn } from '../utils/logger';

async function main() {
  const cfg = loadConfig();
  const port = Number(process.env.PORT) || cfg.port || 4000;
  const host = process.env.HOST || '127.0.0.1';
  const app = await createApp();
  try {
    await app.listen(port, host);
  } catch (e) {
    error(`Server error: ${(e as Error).message}`);
    process.exit(1);
  }
  success(`Dashboard running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  info(`Output folder: ${OUTPUT_DIR}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    warn('Shutting down...');
    await controller.stopIfActive().catch(() => undefined);
    await Promise.all([flushSyncs(2000), flushArchives(10000)]).catch(() => undefined);
    setTimeout(() => process.exit(0), 3000).unref();
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
