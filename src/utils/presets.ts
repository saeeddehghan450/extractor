/**
 * presets.ts
 * 
 * Pre-configured collector presets for common use cases
 */

import { loadConfig, saveConfig } from './configManager';

export const PRESETS = {
  minimal: {
    name: 'Minimal',
    description: 'Only network and console collection',
    collectors: {
      network: true,
      console: true,
      elements: false,
      scripts: false,
      css: false,
      application: false,
      security: false,
      performance: false,
      accessibility: false,
      media: false,
      webgl: false,
      memory: false,
      serviceWorker: false
    }
  },

  performance: {
    name: 'Performance Analysis',
    description: 'Focus on performance metrics',
    collectors: {
      network: true,
      console: true,
      elements: false,
      scripts: false,
      css: false,
      application: false,
      security: false,
      performance: true,
      accessibility: false,
      media: true,
      webgl: true,
      memory: true,
      serviceWorker: false
    }
  },

  security: {
    name: 'Security Analysis',
    description: 'Focus on security and application data',
    collectors: {
      network: true,
      console: true,
      elements: false,
      scripts: true,
      css: false,
      application: true,
      security: true,
      performance: false,
      accessibility: false,
      media: false,
      webgl: false,
      memory: false,
      serviceWorker: true
    }
  },

  dom: {
    name: 'DOM Analysis',
    description: 'Focus on DOM and styling',
    collectors: {
      network: false,
      console: true,
      elements: true,
      scripts: true,
      css: true,
      application: true,
      security: false,
      performance: false,
      accessibility: true,
      media: false,
      webgl: false,
      memory: false,
      serviceWorker: false
    }
  },

  full: {
    name: 'Full Analysis',
    description: 'Collect everything',
    collectors: {
      network: true,
      console: true,
      elements: true,
      scripts: true,
      css: true,
      application: true,
      security: true,
      performance: true,
      accessibility: true,
      media: true,
      webgl: true,
      memory: true,
      serviceWorker: true
    }
  }
};

/**
 * Apply a preset configuration
 */
export type PresetName = keyof typeof PRESETS;

export function applyPreset(presetName: PresetName): void {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const config = loadConfig();
  for (const [collectorName, enabled] of Object.entries(preset.collectors)) {
    if (config.collectors[collectorName]) config.collectors[collectorName].enabled = enabled;
  }

  saveConfig(config);
}

export function isPresetName(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}

/**
 * List all available presets
 */
export function listPresets(): void {
  console.log('\n📋 Available Presets:\n');
  Object.entries(PRESETS).forEach(([key, preset]) => {
    const values = Object.values(preset.collectors);
    const enabledCount = values.filter(v => v).length;
    console.log(`  ${key.padEnd(12)} - ${preset.name}`);
    console.log(`                   ${preset.description}`);
    console.log(`                   (${enabledCount}/${values.length} collectors)`);
    console.log();
  });
}
