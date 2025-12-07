/**
 * consoleCollector.ts
 * 
 * Collects:
 *  - console logs (log, warn, error, debug, info)
 *  - page errors
 *  - dialogs (alert, confirm, prompt)
 */

import { Page } from 'playwright';
import { ConsoleRecord, PageErrorRecord } from '../types';
import { debug } from '../utils/logger';

export function initConsoleCollector(page: Page) {
  const consoleMessages: ConsoleRecord[] = [];
  const pageErrors: PageErrorRecord[] = [];
  const dialogs: any[] = [];

  // Listen to console events
  page.on('console', msg => {
    // Map Playwright types to allowed ConsoleRecord types
    let type: ConsoleRecord['type'];
    switch (msg.type()) {
      case 'log':
      case 'error':
      case 'info':
      case 'debug':
        type = msg.type() as ConsoleRecord['type'];
        break;
      case 'warning':
        type = 'warn';
        break;
      default:
        // Skip unsupported types
        return;
    }
    consoleMessages.push({
      timestamp: new Date().toISOString(),
      type,
      text: msg.text(),
      location: msg.location ? msg.location() : undefined
    });
  });

  // Listen to page errors
  page.on('pageerror', err => {
    pageErrors.push({
      timestamp: new Date().toISOString(),
      message: err.message,
      stack: err.stack
    });
  });

  // Listen to dialogs
  page.on('dialog', async d => {
    dialogs.push({
      timestamp: new Date().toISOString(),
      type: d.type(),
      message: d.message()
    });
    try { await d.dismiss(); } catch {}
  });

  debug('Console collector activated');

  return { consoleMessages, pageErrors, dialogs };
}
