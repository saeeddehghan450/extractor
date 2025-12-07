#!/usr/bin/env node

/**
 * QUICK START GUIDE
 * 
 * Collector Activation & Deactivation System
 */

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                  QUICK START: COLLECTOR CONFIGURATION                     ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 WHAT'S NEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 1. Configurable Collectors (Phablets)
   • Enable/disable any of 13 data collection modules
   • Control what data is collected
   • Reduce resource usage by disabling unnecessary collectors

✅ 2. Module-Based Organization
   • Each collector's data stored in its own folder
   • Organized output structure in /output/ directory
   • Easy to find and manage module-specific data

✅ 3. CLI Control
   • Simple commands to manage collectors
   • Real-time enable/disable without code changes
   • List all available collectors


🚀 GETTING STARTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: Check current collector status
  $ npm run collectors list

  Output shows:
    ✓ ENABLED    network         - HTTP requests and responses
    ✗ disabled   console         - Console logs, errors, and dialogs
    ... (and 11 more collectors)

STEP 2: Enable collectors you need
  $ npm run collectors enable network
  $ npm run collectors enable console

STEP 3: Disable collectors you don't need
  $ npm run collectors disable memory
  $ npm run collectors disable webgl

STEP 4: Start data collection
  $ npm start

  The browser will open and collect data from enabled modules only!


💡 COMMON WORKFLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 MINIMAL (Network + Console Only)
  $ npm run collectors disable-all
  $ npm run collectors enable network
  $ npm run collectors enable console
  $ npm start

📌 PERFORMANCE ANALYSIS
  $ npm run collectors disable-all
  $ npm run collectors enable performance
  $ npm run collectors enable media
  $ npm run collectors enable memory
  $ npm run collectors enable network
  $ npm start

📌 SECURITY ANALYSIS
  $ npm run collectors disable-all
  $ npm run collectors enable security
  $ npm run collectors enable application
  $ npm run collectors enable network
  $ npm run collectors enable serviceWorker
  $ npm start

📌 DOM ANALYSIS
  $ npm run collectors disable-all
  $ npm run collectors enable elements
  $ npm run collectors enable css
  $ npm run collectors enable scripts
  $ npm run collectors enable accessibility
  $ npm run collectors enable console
  $ npm start

📌 FULL ANALYSIS (Everything)
  $ npm run collectors enable-all
  $ npm start


🎮 AVAILABLE COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

npm run collectors list              List all collectors and status
npm run collectors enable <name>     Activate a collector
npm run collectors disable <name>    Deactivate a collector
npm run collectors toggle <name>     Switch on/off
npm run collectors status <name>     Check single collector status
npm run collectors enable-all        Activate all collectors
npm run collectors disable-all       Deactivate all collectors


📚 AVAILABLE COLLECTORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1.  network           - HTTP requests/responses, headers, bodies
2.  console           - Logs, errors, warnings, browser dialogs
3.  elements          - DOM elements, attributes, structure
4.  scripts           - JavaScript files and inline scripts
5.  css               - Stylesheets and computed styles
6.  application       - Cookies, local storage, session storage
7.  security          - SSL/TLS, security headers
8.  performance       - Performance traces and metrics
9.  accessibility     - Accessibility tree information
10. media             - Audio/video element statistics
11. webgl             - Canvas and WebGL details
12. memory            - Heap snapshots
13. serviceWorker     - Service worker registration info


📁 OUTPUT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

output/
├── network/
│   ├── network-1763561850014.json
│   └── click-1763561850014/
├── console/
│   └── console-1763561850014.json
├── elements/
│   └── elements-1763561850014.json
├── scripts/
├── css/
├── application/
├── security/
├── performance/
├── accessibility/
├── media/
├── webgl/
├── memory/
├── serviceWorker/
└── analysis-1763561850014.json (combined from enabled collectors)


⚙️  CONFIGURATION FILE (config.json)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You can also edit config.json directly:

{
  "targetUrl": "https://www.i2ocr.com/pdf-ocr-persian",
  "headless": false,
  "slowMo": 80,
  "collectors": {
    "network": { "enabled": true, "description": "..." },
    "console": { "enabled": true, "description": "..." },
    "elements": { "enabled": false, "description": "..." },
    ...
  }
}


💾 SAVING SETTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All settings are saved to config.json automatically!
  • Your choices persist across application runs
  • Edit config.json manually if needed
  • Use CLI commands for quick changes


🎯 PRO TIPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Start with minimal config → enable as needed
• Disable memory if disk space is limited
• Use performance preset for optimization analysis
• Check npm run collectors list before each run
• Each collector saves to its own folder for easy analysis


📖 MORE INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

See README.md for complete documentation
See IMPLEMENTATION.md for technical details


🎉 READY TO GO!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next steps:
  1. npm run collectors list        (see what's available)
  2. npm run collectors enable ...  (enable what you need)
  3. npm start                       (start collecting data)

Happy collecting! 🚀
`);
