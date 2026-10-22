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


export type ExtractKind = 'text' | 'href' | 'src' | 'html' | 'attr' | 'value';

export interface ScrapeField {
  name: string;
  selector: string;
  extract: ExtractKind;
  attribute?: string;
}

export interface ScrapeRecipe {
  name?: string;
  url?: string;
  itemSelector?: string;
  fields: ScrapeField[];
  nextSelector?: string;
  maxPages?: number;
}

export type SessionCountsKey = keyof SessionCounts;

// --- live view (WebSocket) ---

export interface Box { x: number; y: number; width: number; height: number }

export interface PickInfo {
  tag: string;
  selector: string;
  box: Box;
  text: string;
  href: string | null;
  src: string | null;
  attributes: Record<string, string>;
  suggestedName: string;
  suggestedExtract: 'text' | 'href' | 'src';
  inItem: { fieldSelector: string; matches: number } | null;
  listCandidates: { itemSelector: string; count: number; fieldSelector: string }[];
}

// --- knowledge graph / storage ---

export interface GraphStatus {
  enabled: boolean;
  connected: boolean;
  uri: string;
  user: string;
  database: string | null;
  autoSync: boolean;
  source: 'env' | 'config' | 'none';
  hasPassword: boolean;
  version?: string;
  error?: string;
  nodes?: Record<string, number>;
  relationships?: Record<string, number>;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
}

export interface GraphSyncResult { sessionId: string; requests: number; domains: number; pages: number; records: number; ms: number }

export interface Insight { id: string; title: string; description: string }

export interface StorageStatus {
  postgres: { enabled: boolean; connected: boolean; url: string; source: string; version?: string; readOnlyRole?: boolean; error?: string; counts?: Record<string, number> };
  s3: { enabled: boolean; connected: boolean; endpoint: string; bucket: string; region: string; accessKeyId: string; hasSecret: boolean; source: string; error?: string; objects?: number; bytes?: number; sessions?: number };
  autoArchive: boolean;
}

export interface ArchivedSession {
  id: string; url: string | null; status: string | null; startedAt: string | null; archivedAt: string | null;
  files: number | null; bytes: number | null; requests: number | null; local: boolean; inObjectStore: boolean;
}

export interface ArchiveResult {
  sessionId: string;
  files: { total: number; uploaded: number; skipped: number; bytes: number } | null;
  database: { requests: number; console: number; cookies: number; scrapes: number; records: number } | null;
  removedLocal: boolean;
}

// --- AI assistant ---

export type Provider = 'openai' | 'anthropic';

export interface ServerAgentConfig {
  provider?: Provider;
  model?: string;
  baseURL?: string;
  hasApiKey?: boolean;
  effort?: string;
  vision?: boolean;
  error?: string;
  tools: { name: string; title: string; readOnly: boolean }[];
}

export type AgentEvent =
  | { type: 'start'; conversationId: string; provider: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; text: string; isError: boolean; images: number }
  | { type: 'done'; text: string; steps: number }
  | { type: 'error'; message: string };
