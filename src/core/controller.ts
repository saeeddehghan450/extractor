/**
 * controller.ts
 *
 * The one place that owns the active extraction session. The dashboard, the MCP server,
 * the tool gateway and the AI agent all go through it, so they see (and drive) the same browser.
 */

import { EventEmitter } from 'events';
import { ExtractorSession } from './session';
import { EmulationOptions } from './emulation';
import { OUTPUT_DIR } from './sessionStore';
import { getCollectorFlags, isHeadlessForced, loadConfig } from '../utils/configManager';

export class ControllerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface StartRequest {
  url?: string;
  headless?: boolean;
  collectors?: Record<string, boolean>;
  emulation?: Partial<EmulationOptions>;
}

class SessionController extends EventEmitter {
  current: ExtractorSession | null = null;
  private starting = false;

  get active(): ExtractorSession | null {
    return this.current?.isActive ? this.current : null;
  }

  /** Create and start a session with the config defaults, overridden by `req`. Emits "session". */
  async start(req: StartRequest = {}): Promise<ExtractorSession> {
    if (this.active || this.starting) throw new ControllerError(409, 'A session is already running - stop it first');
    const cfg = loadConfig();
    let session: ExtractorSession;
    try {
      session = new ExtractorSession({
        url: String(req.url || cfg.targetUrl),
        headless: isHeadlessForced() || (typeof req.headless === 'boolean' ? req.headless : cfg.headless),
        slowMo: cfg.slowMo,
        executablePath: cfg.executablePath,
        viewport: cfg.viewport,
        performanceTraceMs: cfg.performanceTraceMs,
        collectors: { ...getCollectorFlags(), ...(req.collectors || {}) },
        outputRoot: OUTPUT_DIR,
        emulation: { ...cfg.emulation, ...(req.emulation && typeof req.emulation === 'object' ? req.emulation : {}) }
      });
    } catch (e) {
      throw new ControllerError(400, (e as Error).message);
    }
    this.starting = true;
    this.current = session;
    this.emit('session', session);
    try {
      await session.start();
    } catch (e) {
      throw new ControllerError(500, `Browser failed to start: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      this.starting = false;
    }
    return session;
  }

  /** The running session, or a 409 error. */
  require(): ExtractorSession {
    const s = this.active;
    if (!s) throw new ControllerError(409, 'No running session - start one first');
    return s;
  }

  async stop(): Promise<ExtractorSession> {
    const s = this.require();
    await s.stop();
    return s;
  }

  async stopIfActive(): Promise<void> {
    if (this.active) await this.active.stop();
  }
}

export const controller = new SessionController();
