// Shapes of the data returned by the dashboard API (mirrors src/core/session.ts on the server)

export type SessionStatus = 'starting' | 'running' | 'stopping' | 'finished' | 'error';
export type SnapshotReason = 'click' | 'manual' | 'final';

export interface SessionCounts {
  requests: number;
  responses: number;
  failedRequests: number;
  console: number;
  errors: number;
  dialogs: number;
  clicks: number;
  snapshots: number;
  blocked?: number;
}

export interface SnapshotSummary {
  seq: number;
  reason: SnapshotReason;
  createdAt: string;
  durationMs: number;
  url: string;
  title: string;
  dir: string;
  file: string;
  screenshot: string | null;
  html: string | null;
  click: { tagName: string; cssSelector: string | null; innerText?: string | null } | null;
  collectors: string[];
  errors: Record<string, string>;
}

export interface SessionSummary {
  id: string;
  url: string;
  currentUrl: string | null;
  title: string | null;
  status: SessionStatus;
  headless: boolean;
  startedAt: string;
  endedAt: string | null;
  collectors: string[];
  counts: SessionCounts;
  snapshots: SnapshotSummary[];
  analysisFile: string | null;
  exports?: { har: string | null; report: string | null };
  viewport?: { width: number; height: number } | null;
  emulation?: EmulationInfo;
  error: string | null;
}

export interface EmulationInfo {
  device: string;
  deviceLabel: string;
  network: string;
  networkLabel: string;
  userAgent: string | null;
  extraHeaders: string[];
  blockPatterns: string[];
}

export interface EmulationOptions {
  device: string;
  network: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  blockPatterns?: string[];
}

export interface CollectorDefinition {
  name: string;
  description: string;
  kind: 'stream' | 'page';
  heavy?: boolean;
}

export interface Preset {
  key: string;
  name: string;
  description: string;
  collectors: Record<string, boolean>;
}

export interface Meta {
  collectors: CollectorDefinition[];
  presets: Preset[];
  outputDir: string;
  forceHeadless: boolean;
  devices: { key: string; label: string }[];
  networks: { key: string; label: string }[];
  version: string;
}

export interface Config {
  targetUrl: string;
  headless: boolean;
  slowMo: number;
  executablePath?: string;
  viewport: { width: number; height: number };
  performanceTraceMs: number;
  port: number;
  emulation: EmulationOptions;
  collectors: Record<string, { enabled: boolean; description: string }>;
}

export interface ConfigPatch {
  targetUrl?: string;
  headless?: boolean;
  slowMo?: number;
  executablePath?: string;
  viewport?: { width: number; height: number };
  performanceTraceMs?: number;
  emulation?: Partial<EmulationOptions>;
  collectors?: Record<string, boolean>;
}

export type MatchKind = 'url' | 'request' | 'response' | 'console' | 'cookie' | 'storage' | 'source';

export interface SearchMatch {
  kind: MatchKind;
  title: string;
  where: string;
  snippet: string;
  start: number;
  end: number;
  requestId?: string;
  file?: string;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
  error?: string;
}

export interface CompactResponse {
  id: string;
  requestId: string;
  url: string;
  method: string;
  status: number;
  resourceType: string;
  contentType: string;
  size: number | null;
  timestamp: string;
}

export interface NetworkRow {
  id: string;
  url?: string;
  method?: string;
  resourceType?: string;
  timestamp?: string;
  failure?: string | null;
  response?: CompactResponse | null;
}

export interface NetworkRequest {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | null;
  resourceType: string;
  failure?: string | null;
}

export interface NetworkResponse {
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
  remoteAddress?: { ipAddress: string; port: number } | null;
  securityDetails?: Record<string, unknown> | null;
  bodySnippet?: string | null;
  fullBodyPath?: string | null;
}

export interface ConsoleLine {
  timestamp: string;
  type: string;
  text: string;
  stack?: string;
  pageError?: boolean;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS';
  message: string;
}

export interface ClickInfo {
  clickedAt: string;
  tagName: string;
  cssSelector: string | null;
}

export interface LiveState {
  summary: SessionSummary;
  requests: NetworkRow[];
  console: ConsoleLine[];
  clicks: ClickInfo[];
}

export interface FileEntry {
  path: string;
  size: number;
}

/** analysis.json - only the parts the dashboard reads are typed, the rest stays open. */
export interface Analysis {
  network?: { requests: NetworkRequest[]; responses: NetworkResponse[] };
  console?: { logs: ConsoleLine[]; pageErrors: { timestamp: string; message: string; stack?: string }[]; dialogs: { timestamp: string; type: string; message: string }[] };
  [module: string]: any;
}

/** Signature of every view module. */
export interface ViewContext {
  setHeader(title: string, subtitle?: string): void;
}
export type Unmount = () => void;
export type MountFn = (el: HTMLElement, params: string[], ctx: ViewContext) => Unmount | void;
