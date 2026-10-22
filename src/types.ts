/**
 * types.ts
 *
 * Shared TypeScript types for the Ultimate DevTools Extractor project.
 */

import type { BrowserContext, CDPSession, Page } from 'playwright';

export interface NetworkRequestRecord {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | null;
  postDataPath?: string | null;
  resourceType: string;
  frameUrl?: string | null;
  isNavigation: boolean;
  failure?: string | null;
}

export interface NetworkResponseRecord {
  id: string;
  requestId: string;
  timestamp: string;
  url: string;
  method: string;
  resourceType: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string;
  size: number | null;
  durationMs: number | null;
  fromServiceWorker: boolean;
  remoteAddress?: { ipAddress: string; port: number } | null;
  securityDetails?: Record<string, unknown> | null;
  bodySnippet?: string | null;
  fullBodyPath?: string | null;
}

export interface ConsoleRecord {
  timestamp: string;
  type: 'log' | 'warn' | 'error' | 'info' | 'debug' | 'trace' | 'other';
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export interface PageErrorRecord {
  timestamp: string;
  message: string;
  stack?: string;
}

export interface DialogRecord {
  timestamp: string;
  type: string;
  message: string;
}

export interface ClickedElementInfo {
  clickedAt: string;
  frameUrl?: string | null;
  tagName: string;
  id?: string | null;
  className?: string | null;
  innerText?: string | null;
  attributes: Record<string, string>;
  cssSelector: string | null;
  xpath?: string | null;
  boundingRect: { x: number; y: number; width: number; height: number };
  pointer?: { x: number; y: number; button: number };
}

export interface CDPEventListener {
  target: string;
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  scriptId?: string;
  lineNumber?: number;
  columnNumber?: number;
  handler: string;
}

export interface StorageInfo {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  indexedDB: Record<string, { version: number | null; objectStores: string[] }>;
  cacheStorage: string[];
}

export type SnapshotReason = 'click' | 'manual' | 'final';

/** Everything a page-state collector may need. */
export interface CollectorContext {
  page: Page;
  context: BrowserContext;
  cdp: CDPSession | null;
  /** Session output directory (absolute). */
  sessionDir: string;
  /** Snapshot sequence number, used to name per-snapshot files. */
  seq: number;
  reason: SnapshotReason;
  click?: ClickedElementInfo | null;
  /** Shared cache that lives for the whole session (e.g. downloaded sources). */
  cache: Map<string, unknown>;
  /** Network data gathered so far (read only). */
  network: { requests: NetworkRequestRecord[]; responses: NetworkResponseRecord[] };
}

export type PageCollector = (ctx: CollectorContext) => Promise<unknown>;
