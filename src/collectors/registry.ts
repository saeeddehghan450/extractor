/**
 * registry.ts
 *
 * Single source of truth for the available collectors.
 */

export type CollectorKind = 'stream' | 'page';

export interface CollectorDefinition {
  name: string;
  description: string;
  /** stream collectors listen to events for the whole session, page collectors run per snapshot */
  kind: CollectorKind;
  /** heavy collectors only do their expensive part on manual / final snapshots */
  heavy?: boolean;
}

export const COLLECTORS: CollectorDefinition[] = [
  { name: 'network', description: 'HTTP requests and responses', kind: 'stream' },
  { name: 'console', description: 'Console logs, errors, and dialogs', kind: 'stream' },
  { name: 'elements', description: 'DOM element information', kind: 'page' },
  { name: 'scripts', description: 'JavaScript files and inline scripts', kind: 'page' },
  { name: 'css', description: 'Stylesheets and computed styles', kind: 'page' },
  { name: 'application', description: 'Cookies, local storage, session storage', kind: 'page' },
  { name: 'security', description: 'SSL/TLS and security headers', kind: 'page' },
  { name: 'performance', description: 'Performance traces', kind: 'page', heavy: true },
  { name: 'accessibility', description: 'Accessibility tree', kind: 'page' },
  { name: 'media', description: 'Audio/video element statistics', kind: 'page' },
  { name: 'webgl', description: 'Canvas and WebGL details', kind: 'page' },
  { name: 'memory', description: 'Heap snapshots', kind: 'page', heavy: true },
  { name: 'serviceWorker', description: 'Service worker registration info', kind: 'page' }
];

export const COLLECTOR_NAMES = COLLECTORS.map(c => c.name);

export function isKnownCollector(name: string): boolean {
  return COLLECTOR_NAMES.includes(name);
}
