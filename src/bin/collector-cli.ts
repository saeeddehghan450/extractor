#!/usr/bin/env node

/**
 * collector-cli.ts
 * 
 * CLI utility to manage collector configuration
 * 
 * Usage:
 *   ts-node src/bin/collector-cli.ts list
 *   ts-node src/bin/collector-cli.ts enable <collector>
 *   ts-node src/bin/collector-cli.ts disable <collector>
 *   ts-node src/bin/collector-cli.ts enable-all
 *   ts-node src/bin/collector-cli.ts disable-all
 */

import { 
  loadConfig, 
  enableCollector, 
  disableCollector, 
  getEnabledCollectors,
  isCollectorEnabled,
  saveConfig
} from '../utils/configManager';

const command = process.argv[2];
const arg = process.argv[3];

function printUsage() {
  console.log(`
Collector CLI - Manage data collection modules

Usage:
  ts-node src/bin/collector-cli.ts <command> [collector-name]

Commands:
  list              - List all collectors and their status
  enable <name>     - Enable a specific collector
  disable <name>    - Disable a specific collector
  enable-all        - Enable all collectors
  disable-all       - Disable all collectors
  toggle <name>     - Toggle a collector on/off
  status <name>     - Show status of a specific collector

Collector Names:
  - network
  - console
  - elements
  - scripts
  - css
  - application
  - security
  - performance
  - accessibility
  - media
  - webgl
  - memory
  - serviceWorker

Examples:
  ts-node src/bin/collector-cli.ts list
  ts-node src/bin/collector-cli.ts enable network
  ts-node src/bin/collector-cli.ts disable memory
  ts-node src/bin/collector-cli.ts toggle console
  `);
}

try {
  const config = loadConfig();

  switch (command) {
    case 'list': {
      console.log('\n📊 Collector Status:');
      console.log('─'.repeat(60));
      const collectors = Object.entries(config.collectors);
      collectors.forEach(([name, cfg]) => {
        const status = cfg.enabled ? '✓ ENABLED' : '✗ disabled';
        const statusColor = cfg.enabled ? '\x1b[32m' : '\x1b[90m';
        const reset = '\x1b[0m';
        console.log(`${statusColor}${status.padEnd(12)}${reset} ${name.padEnd(15)} - ${cfg.description}`);
      });
      console.log('─'.repeat(60));
      const enabledCount = Object.values(config.collectors).filter(c => c.enabled).length;
      console.log(`\nTotal: ${enabledCount}/${collectors.length} collectors enabled\n`);
      break;
    }

    case 'enable': {
      if (!arg) {
        console.error('❌ Error: Please specify a collector name');
        printUsage();
        process.exit(1);
      }
      if (!config.collectors[arg]) {
        console.error(`❌ Error: Unknown collector "${arg}"`);
        process.exit(1);
      }
      enableCollector(arg);
      console.log(`✓ Enabled: ${arg}`);
      break;
    }

    case 'disable': {
      if (!arg) {
        console.error('❌ Error: Please specify a collector name');
        printUsage();
        process.exit(1);
      }
      if (!config.collectors[arg]) {
        console.error(`❌ Error: Unknown collector "${arg}"`);
        process.exit(1);
      }
      disableCollector(arg);
      console.log(`✓ Disabled: ${arg}`);
      break;
    }

    case 'enable-all': {
      const cfg = loadConfig();
      Object.keys(cfg.collectors).forEach(name => {
        cfg.collectors[name].enabled = true;
      });
      saveConfig(cfg);
      console.log(`✓ All collectors enabled`);
      break;
    }

    case 'disable-all': {
      const cfg = loadConfig();
      Object.keys(cfg.collectors).forEach(name => {
        cfg.collectors[name].enabled = false;
      });
      saveConfig(cfg);
      console.log(`✓ All collectors disabled`);
      break;
    }

    case 'toggle': {
      if (!arg) {
        console.error('❌ Error: Please specify a collector name');
        printUsage();
        process.exit(1);
      }
      if (!config.collectors[arg]) {
        console.error(`❌ Error: Unknown collector "${arg}"`);
        process.exit(1);
      }
      const isEnabled = isCollectorEnabled(arg);
      if (isEnabled) {
        disableCollector(arg);
        console.log(`✓ Toggled OFF: ${arg}`);
      } else {
        enableCollector(arg);
        console.log(`✓ Toggled ON: ${arg}`);
      }
      break;
    }

    case 'status': {
      if (!arg) {
        console.error('❌ Error: Please specify a collector name');
        printUsage();
        process.exit(1);
      }
      if (!config.collectors[arg]) {
        console.error(`❌ Error: Unknown collector "${arg}"`);
        process.exit(1);
      }
      const isEnabled = isCollectorEnabled(arg);
      const statusText = isEnabled ? 'ENABLED' : 'disabled';
      const statusColor = isEnabled ? '\x1b[32m' : '\x1b[90m';
      const reset = '\x1b[0m';
      console.log(`\n${statusColor}${arg}: ${statusText}${reset}`);
      console.log(`Description: ${config.collectors[arg].description}\n`);
      break;
    }

    default: {
      console.log('⚠️  Invalid command');
      printUsage();
      process.exit(1);
    }
  }
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`❌ Error: ${errorMsg}`);
  process.exit(1);
}
