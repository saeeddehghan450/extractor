/**
 * events.service.ts
 *
 * Live events for the dashboard (Server-Sent Events): session status, requests, responses, console,
 * clicks, snapshots, counters and server logs. Every session - started from the dashboard, MCP, the
 * tool gateway or the agent - is wired here.
 */

import { Injectable, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, defer, of, concat } from 'rxjs';
import { controller } from '../../core/controller';
import { ExtractorSession } from '../../core/session';
import { onLog } from '../../utils/logger';

export function compactRequest(r: any) {
  return { id: r.id, url: r.url, method: r.method, resourceType: r.resourceType, timestamp: r.timestamp };
}

export function compactResponse(r: any) {
  return {
    id: r.id, requestId: r.requestId, url: r.url, method: r.method, status: r.status, resourceType: r.resourceType,
    contentType: r.contentType, size: r.size, timestamp: r.timestamp
  };
}

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly events = new Subject<MessageEvent>();
  private readonly onSession = (s: ExtractorSession) => this.wireSession(s);
  private readonly stopLogs: () => void;

  constructor() {
    controller.on('session', this.onSession);
    this.stopLogs = onLog(entry => {
      if (entry.level !== 'DEBUG') this.broadcast('log', entry);
    });
  }

  onModuleDestroy(): void {
    controller.off('session', this.onSession);
    this.stopLogs();
    this.events.complete();
  }

  broadcast(type: string, data: unknown): void {
    this.events.next({ type, data: data as object });
  }

  /** The stream for one client: a "hello" with the current session, then every event. */
  stream(): Observable<MessageEvent> {
    return concat(
      defer(() => of<MessageEvent>({ type: 'hello', data: { session: controller.current ? controller.current.summary() : null } })),
      this.events
    );
  }

  private wireSession(s: ExtractorSession): void {
    s.on('status', summary => this.broadcast('status', summary));
    s.on('request', r => this.broadcast('request', compactRequest(r)));
    s.on('response', r => this.broadcast('response', compactResponse(r)));
    s.on('console', m => this.broadcast('console', m));
    s.on('pageerror', e => this.broadcast('console', { timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true }));
    s.on('dialog', d => this.broadcast('console', { timestamp: d.timestamp, type: 'info', text: `[dialog:${d.type}] ${d.message}` }));
    s.on('click', c => this.broadcast('click', c));
    s.on('snapshot-start', d => this.broadcast('snapshot-start', d));
    s.on('snapshot', snap => this.broadcast('snapshot', snap));
    s.on('navigated', d => this.broadcast('navigated', d));
    s.on('blocked', d => this.broadcast('blocked', d));

    // counters change constantly; send them at most once per second
    let last = '';
    const timer = setInterval(() => {
      const counts = JSON.stringify(s.counts());
      if (counts !== last) {
        last = counts;
        this.broadcast('counts', { id: s.id, counts: s.counts() });
      }
      if (!s.isActive) clearInterval(timer);
    }, 1000);
    timer.unref();
  }
}
