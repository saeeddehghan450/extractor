/**
 * configManager.ts
 *
 * Manages collector configuration and module folder organization
 */

import fs from 'fs';
import path from 'path';
import { COLLECTORS, isKnownCollector } from '../collectors/registry';

export interface CollectorConfig {
  enabled: boolean;
  description: string;
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
  collectors: Record<string, CollectorConfig>;
}

const DEFAULTS: Omit<Config, 'collectors'> = {
  targetUrl: 'https://example.com',
  headless: false,
  slowMo: 0,
  viewport: { width: 1280, height: 800 },
  performanceTraceMs: 3000,
  port: 4000
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
    collectors
  };
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
export function updateConfig(patch: Partial<Config> & { collectors?: Record<string, Partial<CollectorConfig> | boolean> }): Config {
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
