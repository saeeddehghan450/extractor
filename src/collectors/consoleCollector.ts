/**
 * consoleCollector.ts
 *
 * Collects, for every page of a browser context:
 *  - console logs (log, warn, error, debug, info, ...)
 *  - uncaught page errors
 *  - dialogs (alert, confirm, prompt) - they are dismissed so the page never blocks
 */

import { BrowserContext, Page } from 'playwright';
import { ConsoleRecord, DialogRecord, PageErrorRecord } from '../types';
import { debug } from '../utils/logger';

export interface ConsoleCollectorEvents {
  onMessage?: (m: ConsoleRecord) => void;
  onPageError?: (e: PageErrorRecord) => void;
  onDialog?: (d: DialogRecord) => void;
}

function mapType(t: string): ConsoleRecord['type'] {
  switch (t) {
    case 'log':
    case 'error':
    case 'info':
    case 'debug':
    case 'trace':
      return t;
    case 'warning':
      return 'warn';
    default:
      return 'other';
  }
}

export function initConsoleCollector(context: BrowserContext, events: ConsoleCollectorEvents = {}) {
  const consoleMessages: ConsoleRecord[] = [];
  const pageErrors: PageErrorRecord[] = [];
  const dialogs: DialogRecord[] = [];

  const attach = (page: Page) => {
    page.on('console', msg => {
      const text = msg.text();
      // Our own injected script stays quiet, but never record its internal markers.
      if (text.startsWith('[extractor]')) return;
      const record: ConsoleRecord = {
        timestamp: new Date().toISOString(),
        type: mapType(msg.type()),
        text,
        location: msg.location()
      };
      consoleMessages.push(record);
      events.onMessage?.(record);
    });

    page.on('pageerror', err => {
      const record: PageErrorRecord = {
        timestamp: new Date().toISOString(),
        message: err.message,
        stack: err.stack
      };
      pageErrors.push(record);
      events.onPageError?.(record);
    });

    page.on('dialog', async d => {
      const record: DialogRecord = {
        timestamp: new Date().toISOString(),
        type: d.type(),
        message: d.message()
      };
      dialogs.push(record);
      events.onDialog?.(record);
      try { await d.dismiss(); } catch { /* already handled */ }
    });
  };

  context.pages().forEach(attach);
  context.on('page', attach);

  debug('Console collector activated');

  return { consoleMessages, pageErrors, dialogs };
}
