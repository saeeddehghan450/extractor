# Ultimate DevTools Extractor

A comprehensive browser automation and data extraction tool built with TypeScript and Playwright. Extract and analyze complete browser state including network traffic, console logs, DOM elements, scripts, styles, performance metrics, and much more.

## Features

### 🔌 13 Modular Collectors

Each data collection module can be independently enabled/disabled:

1. **Network** - HTTP requests/responses with headers and bodies
2. **Console** - Logs, warnings, errors, and browser dialogs
3. **Elements** - DOM element information and CDP listeners
4. **Scripts** - JavaScript files and inline scripts
5. **CSS** - Stylesheets and computed styles
6. **Application** - Cookies, local storage, session storage, IndexedDB
7. **Security** - SSL/TLS and security headers
8. **Performance** - Performance traces and metrics
9. **Accessibility** - Accessibility tree
10. **Media** - Audio/video element statistics
11. **WebGL** - Canvas and WebGL details
12. **Memory** - Heap snapshots
13. **Service Worker** - Service worker registration info

### 📁 Module-Based Output

Each collector's data is automatically organized into its own folder:
```
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
└── analysis-1763561850014.json (combined analysis)
```

### ⚙️ Configuration System

Easily control which collectors are active via `config.json`:

```json
{
  "targetUrl": "https://www.i2ocr.com/pdf-ocr-persian",
  "headless": false,
  "slowMo": 80,
  "collectors": {
    "network": { "enabled": true, "description": "..." },
    "console": { "enabled": true, "description": "..." },
    ...
  }
}
```

### 🎯 Real-time Click Tracking

- Automatically injects click listeners into pages
- Captures click event metadata instantly
- Saves partial snapshots immediately (non-blocking)
- Runs full data collection in background
- Prevents blocking of page behavior (e.g., captcha)

## Installation

```bash
npm install
```

## Usage

### Start Data Collection

```bash
npm start
```

This will:
1. Load configuration from `config.json`
2. Launch a Chromium browser
3. Navigate to the target URL
4. Listen for clicks and collect data as you interact
5. Export all collected data when you close the browser

### Manage Collectors

Use the collector CLI to enable/disable modules:

```bash
# List all collectors and their status
npm run collectors list

# Enable a specific collector
npm run collectors enable network
npm run collectors enable console

# Disable a specific collector
npm run collectors disable memory
npm run collectors disable webgl

# Toggle a collector on/off
npm run collectors toggle performance

# Check status of a single collector
npm run collectors status console

# Enable all collectors
npm run collectors enable-all

# Disable all collectors
npm run collectors disable-all
```

### Example Workflows

**Minimal Configuration** - Only collect network and console:
```bash
npm run collectors disable-all
npm run collectors enable network
npm run collectors enable console
npm run collectors enable elements
npm start
```

**Performance Analysis** - Focus on performance metrics:
```bash
npm run collectors disable-all
npm run collectors enable performance
npm run collectors enable media
npm run collectors enable webgl
npm start
```

**Full Analysis** - Collect everything:
```bash
npm run collectors enable-all
npm start
```

## Output Structure

### Final Analysis
- **`analysis-<timestamp>.json`** - Combined analysis containing all enabled collectors' data
- **`<collector-name>/<collector-name>-<timestamp>.json`** - Individual collector data files

### Click Data
- **`click-<timestamp>.partial.json`** - Quick snapshot saved immediately on click
- **`click-<timestamp>.json`** - Full detailed analysis (saved in background)
- **`click-<timestamp>.html`** - HTML snapshot of the page
- **`click-<timestamp>.png`** - Screenshot
- **`<collector-name>/click-<timestamp>/`** - Collector-specific click data

## Configuration

Edit `config.json` to customize:

```json
{
  "targetUrl": "https://your-target-url.com",
  "headless": false,           // Set to true for headless mode
  "slowMo": 80,                // Slow down browser actions (ms)
  "collectors": { ... }        // Enable/disable specific collectors
}
```

## Project Structure

```
├── config.json                 # Collector configuration
├── package.json               # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── main.ts               # Main entry point
│   ├── types.ts              # TypeScript type definitions
│   ├── bin/
│   │   └── collector-cli.ts   # CLI for managing collectors
│   ├── collectors/            # Data collection modules
│   │   ├── networkCollector.ts
│   │   ├── consoleCollector.ts
│   │   ├── elementsCollector.ts
│   │   ├── scriptsCollector.ts
│   │   ├── cssCollector.ts
│   │   ├── applicationCollector.ts
│   │   ├── securityCollector.ts
│   │   ├── performanceCollector.ts
│   │   ├── accessibilityCollector.ts
│   │   ├── mediaCollector.ts
│   │   ├── webglCollector.ts
│   │   ├── memoryCollector.ts
│   │   └── serviceWorkerCollector.ts
│   └── utils/
│       ├── configManager.ts   # Configuration management
│       ├── cdpClient.ts       # Chrome DevTools Protocol
│       ├── fileUtils.ts       # File utilities
│       └── logger.ts          # Logging utilities
└── output/                    # Generated data (organized by module)
```

## API Reference

### configManager.ts

```typescript
// Load configuration
loadConfig(): Config

// Check if collector is enabled
isCollectorEnabled(collectorName: string): boolean

// Get all enabled collectors
getEnabledCollectors(): string[]

// Enable/disable collectors
enableCollector(collectorName: string): void
disableCollector(collectorName: string): void

// Create module directory
createModuleDir(outputDir: string, moduleName: string): string

// Ensure all module directories exist
ensureModuleDirs(outputDir: string): void
```

## Advanced Usage

### Custom Target URLs

Set via environment variable:
```bash
TARGET_URL=https://example.com npm start
```

### Programmatic Usage

```typescript
import { isCollectorEnabled, enableCollector } from './src/utils/configManager';

// Check if enabled
if (isCollectorEnabled('network')) {
  // Handle network collection
}

// Enable dynamically
enableCollector('performance');
```

## Performance Considerations

- **Network Collector**: Stores response bodies on disk (can use significant space)
- **Memory Collector**: Heap snapshots can be large; disable if disk space is limited
- **Performance Traces**: Can be 10-50 MB depending on page activity
- **slowMo Setting**: Increase for slower systems; decrease for faster collection

## Troubleshooting

### Configuration not loading
- Ensure `config.json` exists in project root
- Check JSON syntax is valid

### Collectors not enabled
- Use `npm run collectors list` to verify status
- Check that collector name matches exactly (case-sensitive)

### Out of memory
- Disable memory-intensive collectors (memory, webgl)
- Enable only required collectors

### Browser not launching
- Ensure Playwright dependencies are installed: `npm install`
- Check Chromium is not already running

## License

MIT

## Author

Saeed Dehghan
