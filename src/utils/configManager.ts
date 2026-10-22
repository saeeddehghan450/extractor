/**
 * configManager.ts
 *
 * Manages collector configuration and module folder organization
 */

import fs from 'fs';
import path from 'path';
import { COLLECTORS, isKnownCollector } from '../collectors/registry';
import { DEFAULT_EMULATION, EmulationOptions, normalizeEmulation } from '../core/emulation';

export interface CollectorConfig {
  enabled: boolean;
  description: string;
}

export interface Neo4jSettings {
  enabled?: boolean;
  uri?: string;
  user?: string;
  /** prefer the NEO4J_PASSWORD environment variable */
  password?: string;
  database?: string;
  /** sync every finished session and every saved scrape automatically */
  autoSync?: boolean;
}

/** Long-term storage: PostgreSQL (structured data) and SeaweedFS / any S3 store (files). */
export interface StorageSettings {
  postgres?: {
    enabled?: boolean;
    /** postgres://user:password@host:5432/database (prefer the DATABASE_URL environment variable) */
    url?: string;
  };
  s3?: {
    enabled?: boolean;
    /** SeaweedFS S3 gateway, e.g. http://localhost:8333 */
    endpoint?: string;
    accessKeyId?: string;
    /** prefer the S3_SECRET_ACCESS_KEY environment variable */
    secretAccessKey?: string;
    bucket?: string;
    region?: string;
  };
  /** archive every finished session automatically */
  autoArchive?: boolean;
}

export interface Config {
  targetUrl: string;
  headless: boolean;
  slowMo: number;
  /** Optional path to a Chromium executable (also settable via CHROMIUM_PATH). */
  executablePath?: string;
  viewport: { width: number; height: number };
  /** Duration of the performance trace taken on manual/final snapshots. */
  performanceTraceMs: number;
  /** Port used by the web dashboard. */
  port: number;
  /** Default device / network emulation, custom UA / headers and blocked URLs. */
  emulation: EmulationOptions;
  /** Neo4j graph database (NEO4J_* environment variables take precedence). */
  neo4j?: Neo4jSettings;
  /** PostgreSQL + SeaweedFS archive (DATABASE_URL / S3_* environment variables take precedence). */
  storage?: StorageSettings;
  /** Optional defaults for the built-in agent (API keys belong in environment variables). */
  ai?: {
    provider?: 'openai' | 'anthropic';
    model?: string;
    baseURL?: string;
    maxSteps?: number;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    vision?: boolean;
    fallbacks?: boolean;
  };
  collectors: Record<string, CollectorConfig>;
}

const DEFAULTS: Omit<Config, 'collectors'> = {
  targetUrl: 'https://example.com',
  headless: false,
  slowMo: 0,
  viewport: { width: 1280, height: 800 },
  performanceTraceMs: 3000,
  port: 4000,
  emulation: DEFAULT_EMULATION
};

let config: Config | null = null;

export function getConfigPath(): string {
  return path.resolve(process.cwd(), process.env.EXTRACTOR_CONFIG || 'config.json');
}

/**
 * Fill in missing fields so older config files keep working.
 */
export function normalizeConfig(raw: Partial<Config>): Config {
  const collectors: Record<string, CollectorConfig> = {};
  for (const def of COLLECTORS) {
    const existing = raw.collectors?.[def.name];
    collectors[def.name] = {
      enabled: existing?.enabled ?? true,
      description: existing?.description || def.description
    };
  }
  return {
    ...DEFAULTS,
    ...raw,
    viewport: { ...DEFAULTS.viewport, ...(raw.viewport || {}) },
    emulation: normalizeEmulation(raw.emulation),
    collectors
  };
}

/** EXTRACTOR_HEADLESS=1 forces headless mode (e.g. in Docker, where there is no display). */
export function isHeadlessForced(): boolean {
  return /^(1|true|yes)$/i.test(process.env.EXTRACTOR_HEADLESS || '');
}

/**
 * Load configuration from config.json
 */
export function loadConfig(): Config {
  if (config) return config;

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    config = normalizeConfig({});
    return config;
  }

  const data = fs.readFileSync(configPath, 'utf-8');
  try {
    config = normalizeConfig(JSON.parse(data) as Partial<Config>);
  } catch (e) {
    throw new Error(`Invalid JSON in ${configPath}: ${(e as Error).message}`);
  }
  return config;
}

/** Drop the cached config so the next loadConfig() reads the file again. */
export function reloadConfig(): Config {
  config = null;
  return loadConfig();
}

/**
 * Check if a collector is enabled
 */
export function isCollectorEnabled(collectorName: string): boolean {
  const cfg = loadConfig();
  return cfg.collectors[collectorName]?.enabled ?? false;
}

/**
 * Get all enabled collectors
 */
export function getEnabledCollectors(): string[] {
  const cfg = loadConfig();
  return Object.entries(cfg.collectors)
    .filter(([, c]) => c.enabled)
    .map(([name]) => name);
}

/** Map of collector name -> enabled flag. */
export function getCollectorFlags(): Record<string, boolean> {
  const cfg = loadConfig();
  return Object.fromEntries(Object.entries(cfg.collectors).map(([name, c]) => [name, c.enabled]));
}

/**
 * Enable a collector
 */
export function enableCollector(collectorName: string): void {
  setCollectorEnabled(collectorName, true);
}

/**
 * Disable a collector
 */
export function disableCollector(collectorName: string): void {
  setCollectorEnabled(collectorName, false);
}

export function setCollectorEnabled(collectorName: string, enabled: boolean): void {
  if (!isKnownCollector(collectorName)) throw new Error(`Unknown collector "${collectorName}"`);
  const cfg = loadConfig();
  cfg.collectors[collectorName].enabled = enabled;
  saveConfig(cfg);
}

/**
 * Merge a partial update into the config and persist it.
 */
export function updateConfig(patch: Partial<Omit<Config, 'emulation' | 'neo4j' | 'storage'>> & {
  neo4j?: Omit<Neo4jSettings, 'password'> & { password?: string | null };
  storage?: {
    postgres?: { enabled?: boolean; url?: string | null };
    s3?: { enabled?: boolean; endpoint?: string; accessKeyId?: string; secretAccessKey?: string | null; bucket?: string; region?: string };
    autoArchive?: boolean;
  };
  collectors?: Record<string, Partial<CollectorConfig> | boolean>;
  emulation?: Partial<EmulationOptions>;
}): Config {
  const cfg = loadConfig();
  const next: Config = { ...cfg };

  if (typeof patch.targetUrl === 'string') next.targetUrl = patch.targetUrl.trim();
  if (typeof patch.headless === 'boolean') next.headless = patch.headless;
  if (typeof patch.slowMo === 'number' && patch.slowMo >= 0) next.slowMo = Math.round(patch.slowMo);
  if (typeof patch.performanceTraceMs === 'number' && patch.performanceTraceMs >= 0) {
    next.performanceTraceMs = Math.round(patch.performanceTraceMs);
  }
  if (typeof patch.port === 'number' && patch.port > 0) next.port = Math.round(patch.port);
  if (typeof patch.executablePath === 'string') {
    next.executablePath = patch.executablePath.trim() || undefined;
  }
  if (patch.viewport && typeof patch.viewport === 'object') {
    const w = Number(patch.viewport.width);
    const h = Number(patch.viewport.height);
    next.viewport = {
      width: w >= 320 ? Math.round(w) : cfg.viewport.width,
      height: h >= 240 ? Math.round(h) : cfg.viewport.height
    };
  }
  if (patch.neo4j && typeof patch.neo4j === 'object') {
    const n = { ...(cfg.neo4j || {}) };
    const p = patch.neo4j;
    if (typeof p.enabled === 'boolean') n.enabled = p.enabled;
    if (typeof p.autoSync === 'boolean') n.autoSync = p.autoSync;
    for (const k of ['uri', 'user', 'database'] as const) {
      if (typeof p[k] === 'string') n[k] = p[k]!.trim() || undefined;
    }
    // empty string keeps the stored password, null removes it
    if (p.password === null) delete n.password;
    else if (typeof p.password === 'string' && p.password) n.password = p.password;
    next.neo4j = n;
  }
  if (patch.storage && typeof patch.storage === 'object') {
    const st: StorageSettings = { ...(cfg.storage || {}) };
    const p = patch.storage;
    if (typeof p.autoArchive === 'boolean') st.autoArchive = p.autoArchive;
    if (p.postgres && typeof p.postgres === 'object') {
      const pg = { ...(st.postgres || {}) };
      if (typeof p.postgres.enabled === 'boolean') pg.enabled = p.postgres.enabled;
      // empty string keeps the stored URL (it contains the password), null removes it
      if (p.postgres.url === null) delete pg.url;
      else if (typeof p.postgres.url === 'string' && p.postgres.url.trim()) pg.url = p.postgres.url.trim();
      st.postgres = pg;
    }
    if (p.s3 && typeof p.s3 === 'object') {
      const s3 = { ...(st.s3 || {}) };
      if (typeof p.s3.enabled === 'boolean') s3.enabled = p.s3.enabled;
      for (const k of ['endpoint', 'accessKeyId', 'bucket', 'region'] as const) {
        if (typeof p.s3[k] === 'string') s3[k] = p.s3[k]!.trim() || undefined;
      }
      if (p.s3.secretAccessKey === null) delete s3.secretAccessKey;
      else if (typeof p.s3.secretAccessKey === 'string' && p.s3.secretAccessKey) s3.secretAccessKey = p.s3.secretAccessKey;
      st.s3 = s3;
    }
    next.storage = st;
  }
  if (patch.emulation && typeof patch.emulation === 'object') {
    next.emulation = normalizeEmulation({ ...cfg.emulation, ...patch.emulation });
  }
  if (patch.collectors) {
    next.collectors = { ...cfg.collectors };
    for (const [name, value] of Object.entries(patch.collectors)) {
      if (!isKnownCollector(name)) continue;
      const enabled = typeof value === 'boolean' ? value : value.enabled;
      if (typeof enabled === 'boolean') next.collectors[name] = { ...next.collectors[name], enabled };
    }
  }

  saveConfig(next);
  return next;
}

/**
 * Save configuration to file
 */
export function saveConfig(cfg: Config): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  config = cfg;
}

/**
 * Create module-specific output directory
 */
export function createModuleDir(outputDir: string, moduleName: string): string {
  const moduleDir = path.join(outputDir, moduleName);
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }
  return moduleDir;
}

/**
 * Get all module directories
 */
export function getModuleDirs(outputDir: string): string[] {
  const cfg = loadConfig();
  return Object.keys(cfg.collectors).map(name => path.join(outputDir, name));
}

/**
 * Ensure all module directories exist
 */
export function ensureModuleDirs(outputDir: string): void {
  const cfg = loadConfig();
  for (const collectorName of Object.keys(cfg.collectors)) {
    createModuleDir(outputDir, collectorName);
  }
}
