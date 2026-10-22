/**
 * main.ts
 *
 * Command-line mode of the Ultimate DevTools Extractor.
 *
 * - Launch a browser on the target URL
 * - Every click on the page triggers a snapshot of all enabled collectors
 * - Press "s" for a manual snapshot, "q" (or Ctrl+C) to finish
 * - Closing the browser window also finishes the session
 * - Everything is saved in output/<sessionId>/
 *
 * Usage:
 *   npm run extract -- [--url <url>] [--headless] [--headed] [--duration <seconds>]
 *                      [--device <name>] [--network <preset>] [--user-agent <ua>]
 *                      [--header "Name: value"]... [--block <pattern>]... [--list-devices]
 */

import { ExtractorSession } from './core/session';
import { DEVICE_PRESETS, EmulationOptions, NETWORK_PRESETS } from './core/emulation';
import { OUTPUT_DIR } from './core/sessionStore';
import { getCollectorFlags, isHeadlessForced, loadConfig } from './utils/configManager';
import { error, info, success, warn } from './utils/logger';

function parseArgs(argv: string[]) {
  const args: {
    url?: string;
    headless?: boolean;
    duration?: number;
    emulation: Partial<EmulationOptions> & { extraHeaders: Record<string, string>; blockPatterns: string[] };
  } = { emulation: { extraHeaders: {}, blockPatterns: [] } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' || a === '-u') args.url = argv[++i];
    else if (a === '--headless') args.headless = true;
    else if (a === '--headed') args.headless = false;
    else if (a === '--duration' || a === '-d') args.duration = Number(argv[++i]);
    else if (a === '--device') args.emulation.device = argv[++i];
    else if (a === '--network') args.emulation.network = argv[++i];
    else if (a === '--user-agent') args.emulation.userAgent = argv[++i];
    else if (a === '--block') args.emulation.blockPatterns.push(argv[++i]);
    else if (a === '--header') {
      const h = argv[++i] || '';
      const idx = h.indexOf(':');
      if (idx > 0) args.emulation.extraHeaders[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (a === '--list-devices') {
      console.log('Devices:  ' + Object.keys(DEVICE_PRESETS).join(', '));
      console.log('Networks: ' + Object.keys(NETWORK_PRESETS).join(', '));
      process.exit(0);
    }
    else if (!a.startsWith('-') && !args.url) args.url = a;
  }
  return args;
}

/** CLI flags override the config; headers and block patterns are added to the configured ones. */
function mergeEmulation(base: EmulationOptions, cli: ReturnType<typeof parseArgs>['emulation']): Partial<EmulationOptions> {
  return {
    ...base,
    ...(cli.device ? { device: cli.device } : {}),
    ...(cli.network ? { network: cli.network } : {}),
    ...(cli.userAgent ? { userAgent: cli.userAgent } : {}),
    extraHeaders: { ...(base.extraHeaders || {}), ...cli.extraHeaders },
    blockPatterns: [...(base.blockPatterns || []), ...cli.blockPatterns]
  };
}

async function run() {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  if (args.emulation.device && !DEVICE_PRESETS[args.emulation.device]) {
    throw new Error(`Unknown device "${args.emulation.device}". Available: ${Object.keys(DEVICE_PRESETS).join(', ')}`);
  }
  if (args.emulation.network && !NETWORK_PRESETS[args.emulation.network]) {
    throw new Error(`Unknown network preset "${args.emulation.network}". Available: ${Object.keys(NETWORK_PRESETS).join(', ')}`);
  }
  const collectors = getCollectorFlags();

  info('Enabled collectors:');
  Object.entries(config.collectors).forEach(([name, cfg]) => {
    info(`  [${cfg.enabled ? '✓' : '✗'}] ${name}: ${cfg.description}`);
  });

  const session = new ExtractorSession({
    url: args.url || process.env.TARGET_URL || config.targetUrl,
    headless: isHeadlessForced() || (args.headless ?? config.headless),
    slowMo: config.slowMo,
    executablePath: config.executablePath,
    viewport: config.viewport,
    performanceTraceMs: config.performanceTraceMs,
    collectors,
    outputRoot: OUTPUT_DIR,
    emulation: mergeEmulation(config.emulation, args.emulation)
  });

  await session.start();

  const done = new Promise<void>(resolve => {
    session.on('status', s => { if (s.status === 'finished' || s.status === 'error') resolve(); });
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    info('Finishing session...');
    await session.stop();
  };

  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (key: string) => {
      if (key === '\u0003' || key === 'q') void stop();
      else if (key === 's') {
        session.snapshot('manual').catch(e => warn(`Snapshot failed: ${(e as Error).message}`));
      }
    });
    info('Interact with the page. Keys: [s] snapshot  [q] finish & save  (or just close the browser)');
  } else {
    info('Interact with the page; close the browser or press Ctrl+C to finish & save.');
  }

  if (args.duration && args.duration > 0) {
    setTimeout(() => { void stop(); }, args.duration * 1000);
  }

  await done;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  const summary = session.summary();
  success(`Done. ${summary.counts.requests} requests, ${summary.counts.console} console messages, ${summary.counts.snapshots} snapshots`);
  success(`Results: ${session.dir}`);
  process.exit(summary.status === 'error' ? 1 : 0);
}

run().catch(err => {
  error(`An error occurred: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
