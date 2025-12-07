/**
 * configManager.ts
 * 
 * Manages collector configuration and module folder organization
 */

import fs from 'fs';
import path from 'path';

export interface CollectorConfig {
  enabled: boolean;
  description: string;
}

export interface Config {
  targetUrl: string;
  headless: boolean;
  slowMo: number;
  collectors: Record<string, CollectorConfig>;
}

let config: Config | null = null;

/**
 * Load configuration from config.json
 */
export function loadConfig(): Config {
  if (config) return config;

  const configPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found at ${configPath}`);
  }

  const data = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(data) as Config;
  return config;
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
    .filter(([_, config]) => config.enabled)
    .map(([name, _]) => name);
}

/**
 * Enable a collector
 */
export function enableCollector(collectorName: string): void {
  const cfg = loadConfig();
  if (cfg.collectors[collectorName]) {
    cfg.collectors[collectorName].enabled = true;
    saveConfig(cfg);
  }
}

/**
 * Disable a collector
 */
export function disableCollector(collectorName: string): void {
  const cfg = loadConfig();
  if (cfg.collectors[collectorName]) {
    cfg.collectors[collectorName].enabled = false;
    saveConfig(cfg);
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(cfg: Config): void {
  const configPath = path.resolve(process.cwd(), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
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
  return Object.keys(cfg.collectors).map(name => 
    path.join(outputDir, name)
  );
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
