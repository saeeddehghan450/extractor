# 📝 CHANGELOG

## 2.7.0 — Long-term storage: PostgreSQL + SeaweedFS

### Added
- Session archive: every file of a finished session goes to SeaweedFS (S3 gateway, official AWS SDK;
  unchanged files are skipped) and the structured data to PostgreSQL (`pg` client, `extractor` schema:
  sessions, requests with headers, console messages, cookies, security headers, scrapes, scraped records as
  `jsonb`, file index). Archiving is idempotent; sessions are archived automatically when they finish.
- Restore archived sessions into the output folder; remove the local copy once every file is verified in
  SeaweedFS (the dashboard then serves files straight from SeaweedFS).
- Read-only SQL over the archive: one `SELECT` / `WITH` / `EXPLAIN` statement, read-only transaction, a
  role that can only read the `extractor` schema, file / dynamic-SQL / settings functions refused.
- AI / MCP tools `extractor_storage_status`, `extractor_sql_query`, `extractor_archive_session`,
  `extractor_list_archived`, `extractor_restore_session` (32 tools in total); the agent's instructions
  explain when to use them.
- Dashboard *Data storage* page (connections, archived sessions with restore / remove local copy, SQL console,
  hand-off to the assistant) and an *Archive* button on session pages.
- `/api/storage/*` endpoints; `postgres:18.6` and `chrislusf/seaweedfs:4.48` services in `docker-compose.yml`;
  storage tests (run with `STORAGE_TEST_DATABASE_URL` / `STORAGE_TEST_S3_ENDPOINT`).

### Security
- The PostgreSQL URL is masked and S3 secrets are never returned by `/api/config` or `/api/storage/status`.

## 2.6.0 — Neo4j knowledge graph

### Added
- Neo4j integration (official `neo4j-driver`, official `neo4j` Docker image): sessions are written into a
  knowledge graph — sessions, pages, domains (with registrable site), requests, scripts, stylesheets,
  cookies, console messages, security headers, clicked elements, scrapes and scraped records. Shared
  entities are merged across sessions; syncing a session again replaces its data.
- Auto-sync when a session finishes and after each saved scrape; *Sync all sessions* for older ones.
- AI / MCP tools `extractor_graph_schema`, `extractor_graph_query` (read-only Cypher),
  `extractor_graph_insight` (11 ready-made analyses) and `extractor_graph_sync` (27 tools in total);
  the agent's instructions explain when to use the graph.
- Dashboard *Knowledge graph* page: connection setup, node counts, read-only Cypher console with table and
  interactive graph views, ready-made insights, *Ask the assistant* / *Analyse with AI* hand-off to the
  assistant. Session pages get *Analyse with AI* and *Send to graph*.
- `/api/graph/*` endpoints, `neo4j` service in `docker-compose.yml`, Neo4j tests (run with `NEO4J_TEST_URI`).

### Security
- Graph queries run in read transactions; `LOAD CSV`, admin procedures and batched writes are refused.
- The Neo4j password is never returned by `/api/config` or `/api/graph/status`.

## 2.5.0 — Interactive scraper and WebSocket live view

- Markdown output: every scrape is also saved as `.md` (title, source URL, row / page count and a table);
  *MD* download in the scraper page; `output: "markdown"` on `extractor_scrape` / `extractor_run_recipe`.

### Added
- Interactive scraper page: open a site, pick elements on the live view (hover highlight, click to add a
  column), automatic detection of repeating lists with item-relative field selectors, editable columns
  (text, link, image/source, attribute, HTML, form value), pagination through a picked "next" element,
  preview, extraction of all pages to CSV (UTF-8 BOM) + JSON, saved recipes.
- WebSocket live view `/ws/live`: CDP screencast frames (sent only on repaint, slow clients skip frames),
  mouse / wheel / keyboard input, element picking and highlight boxes; Host and Origin checks on upgrade.
- MCP tools `extractor_scrape`, `extractor_list_recipes`, `extractor_run_recipe` (23 tools in total).
- Scraper HTTP API (`/api/scraper/*`) and tests for picking, lists, pagination, CSV, recipes, the API and
  the WebSocket protocol.

### Changed
- The live session page shows the browser through the WebSocket view instead of polling screenshots.

## 2.4.0 — MCP server and AI models

### Added
- MCP server (official `@modelcontextprotocol/sdk`) with 20 `extractor_*` tools: session control, page control
  through accessibility snapshots with element refs (like Playwright MCP), and access to every collector of
  running and saved sessions (overview, requests, bodies, console, raw collector data, search, exports).
  Transports: stdio (`npm run mcp`, `dist/mcp/main.js`) and Streamable HTTP (`/mcp` on the dashboard, or
  `npm run mcp -- --port N`). Tool annotations (read-only / destructive) and an `audit-website` prompt.
- Tool gateway for apps without MCP: `/v1/tools` in OpenAI function-calling format (default) or Anthropic
  format, `/v1/tools/call` executing the tool calls a model returned (results shaped as the messages to
  append), `/v1/tools/{name}` for plain calls.
- Built-in agent: OpenAI-compatible provider by default (OpenAI, Ollama, vLLM, LM Studio, OpenRouter, …) and
  Anthropic (`@anthropic-ai/sdk`, Claude Opus 5.5 by default). CLI `npm run agent` and a dashboard
  *AI assistant* page (chat with live tool calls, model settings, MCP connection snippets).
- Security for the machine endpoints: Host-header check against DNS rebinding (`EXTRACTOR_ALLOWED_HOSTS`),
  optional bearer token (`EXTRACTOR_API_TOKEN`).
- Tests: MCP in-memory / HTTP / stdio, gateway formats, host check and token, agent with mock OpenAI and
  Anthropic servers, NDJSON agent API.

### Changed
- One session controller shared by the dashboard, MCP, gateway and agent — sessions started by a model
  show up live in the dashboard.
- Logs go to stderr in MCP stdio mode; the MCP entry point switches to the project root so config and
  output land in the project whatever directory the client starts it from.

## 2.3.0 — Emulation, HAR, HTML report and search

### Added
- Device emulation (9 phone / tablet / desktop profiles), network throttling (Fast 4G, Slow 4G,
  Slow 3G, Offline), custom User-Agent, extra request headers and URL blocking — in the
  dashboard (*Advanced* options, remembered in `config.json`) and as CLI flags.
- HAR 1.2 export (`network/network.har`, with full bodies) and a live HAR download.
- Standalone HTML report (`report.html`, plus on-demand Persian/English report in the dashboard).
- Full-text / regex search inside a session (network, bodies, console, storage, sources).
- Blocked-request counter; device / network badges on sessions.
- Tests for emulation, blocking, HAR, report, search and the new API endpoints.

### Changed
- The live preview keeps portrait devices fully on screen.

## 2.2.0 — Dashboard in TypeScript

### Changed
- The dashboard source moved from `public/js/*.js` to `web/src/*.ts` and is fully typed
  (strict mode, shared API types in `web/src/types.ts`). It is compiled by `tsc -p web`
  to `public/js` (with source maps); the output is not committed.
- The inline theme/language script of `index.html` became `web/src/boot.ts`.
- `npm start` compiles the dashboard first; new scripts `build:web` and `dev:web`;
  `build` and `typecheck` cover both server and dashboard. The Docker image builds it too.

## 2.1.0 — Latest dependencies & Docker

### Changed
- Dependencies updated to the latest releases: Playwright 1.64.1, TypeScript 7.0.2,
  @types/node 26.6.5.
- `ts-node` (unmaintained, incompatible with TypeScript 7) replaced by `tsx` 4.23.15 for
  `npm start`, `npm run extract`, `npm run collectors` and `npm test`.
- tsconfig: `moduleResolution: node` was removed in TypeScript 7 → `NodeNext`.
- `package-lock.json` is now committed (needed for reproducible `npm ci` / Docker builds).
- Node.js 20+ required (Playwright requirement).

### Added
- `Dockerfile` (multi-stage, official Playwright image, non-root, healthcheck), `docker-compose.yml`
  and `.dockerignore`.
- `EXTRACTOR_HEADLESS=1` forces headless mode; the dashboard locks the headless switch.

### Fixed
- Page scripts failed under esbuild-based runners (tsx) because of injected `__name` helpers.

## 2.0.0 — Web dashboard & reliable collectors

### Added
- Web dashboard (`npm start`): live session with browser preview and remote control (click, scroll,
  type, navigate), live network/console/log panels, request inspector, snapshot timeline,
  collectors & presets page, saved-results explorer (overview insights, screenshots, JSON viewer,
  file browser) and settings. Persian (RTL) / English, dark / light theme.
- Session engine (`src/core/session.ts`): one output folder per session, snapshots on every click,
  manual snapshots, final snapshot, graceful finish when the browser/tab is closed.
- Presets in the CLI (`npm run collectors presets`, `npm run collectors preset <name>`).
- End-to-end tests (`npm test`) with a local fixture site.

### Fixed
- Final analysis was never written: the process exited as soon as the browser closed.
- CSS collector navigated the page away (`page.goto` on each stylesheet).
- Event listeners: CDP was given a `nodeId` as `objectId`; listeners of ancestors are now included.
- CSS/computed styles: the DOM/CSS domains are now enabled before use.
- Heap snapshot, service worker and performance trace collectors returned nothing (wrong CDP usage / race).
- IndexedDB object stores were read asynchronously after the result was returned.
- WebGL collector created contexts on the page's canvases.
- Click listener was installed twice; click selectors were not unique.
- Network collector only watched the first tab and read redirect bodies.

---

# 📝 COMPLETE CHANGELOG

## Implementation: Collector Activation & Module Organization

### Date: December 7, 2025
### Status: ✅ COMPLETE

---

## 📦 Files Created

### Configuration
- **`config.json`** - Master configuration file
  - Target URL configuration
  - Browser settings (headless, slowMo)
  - Enable/disable switches for all 13 collectors
  - Descriptions for each collector

### Utility Modules
- **`src/utils/configManager.ts`** - Configuration management system
  - `loadConfig()` - Load from config.json
  - `isCollectorEnabled()` - Check if collector is active
  - `enableCollector()` / `disableCollector()` - Toggle collectors
  - `getEnabledCollectors()` - List active collectors
  - `createModuleDir()` - Create module-specific folders
  - `ensureModuleDirs()` - Initialize all module directories

- **`src/utils/presets.ts`** - Preset collector profiles
  - Minimal preset (network + console)
  - Performance preset (performance-focused)
  - Security preset (security-focused)
  - DOM preset (DOM-focused)
  - Full preset (everything)

### CLI Tools
- **`src/bin/collector-cli.ts`** - Command-line management tool
  - Commands: list, enable, disable, toggle, status, enable-all, disable-all
  - User-friendly colored output
  - Help/usage information

### Documentation
- **`README.md`** (updated)
  - Complete project documentation
  - Feature descriptions
  - Usage instructions
  - API reference
  - Troubleshooting guide

- **`IMPLEMENTATION.md`** - Technical implementation details
  - What was implemented
  - How to use it
  - Output structure
  - Configuration details

- **`COMMANDS.md`** - Quick command reference
  - All available commands
  - Collector names
  - Example usage
  - Quick presets

- **`INSTALLATION_COMPLETE.md`** - Completion summary
  - Overview of changes
  - Quick start guide
  - Workflows
  - Verification info

- **`QUICK_START.js`** - Interactive guide
  - Visual quick start guide
  - Available commands
  - Common workflows
  - Pro tips

---

## 📝 Files Modified

### Application Logic
- **`src/main.ts`** - Updated to use configuration system
  - Imports `configManager` functions
  - Loads configuration at startup
  - Initializes only enabled collectors
  - Logs enabled collectors on startup
  - Conditionally runs collectors based on config
  - Saves data to module-specific folders
  - Respects browser settings from config

### Build Configuration  
- **`package.json`** - Added CLI script
  - New script: `"collectors": "ts-node src/bin/collector-cli.ts"`
  - Enables `npm run collectors` command

---

## 🎯 Core Features Implemented

### 1. Configuration System
- Load configuration from `config.json`
- Persist settings across runs
- Enable/disable individual collectors
- Query collector status programmatically

### 2. CLI Management
- List all collectors and their status
- Enable/disable collectors
- Toggle collectors on/off
- Check individual collector status
- Batch operations (enable-all/disable-all)

### 3. Module Organization
- Create dedicated folder for each collector
- Save collector data to module folder
- Automatic folder creation
- Organized output structure

### 4. Application Integration
- Load configuration on startup
- Only initialize enabled collectors
- Skip disabled collectors entirely
- Show enabled collectors at startup
- Save data to correct module folders

### 5. Documentation & Guides
- Comprehensive README
- Implementation details
- Quick command reference
- Interactive quick start
- Workflow examples

---

## 🔄 Data Flow

```
config.json
    ↓
configManager.loadConfig()
    ↓
Main application checks isCollectorEnabled()
    ↓
Only enabled collectors are initialized
    ↓
Data collection runs
    ↓
Data saved to /output/<module-name>/
    ↓
Final analysis combines enabled modules
```

---

## 📊 Output Structure

### Before
```
output/
├── click-1763561850014.json
├── click-analysis-*.json
└── responses/
```

### After
```
output/
├── network/
│   ├── network-*.json
│   └── click-*/
├── console/
│   └── console-*.json
├── elements/
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
└── analysis-*.json (combined)
```

---

## 🎛️ 13 Collectors Now Controllable

1. **network** - HTTP requests/responses
2. **console** - Logs and errors
3. **elements** - DOM elements
4. **scripts** - JavaScript files
5. **css** - Stylesheets
6. **application** - Storage data
7. **security** - Security info
8. **performance** - Metrics
9. **accessibility** - A11y tree
10. **media** - Audio/video
11. **webgl** - Canvas/WebGL
12. **memory** - Heap snapshots
13. **serviceWorker** - Service workers

---

## 📋 CLI Commands

### Management
- `npm run collectors list` - Show all collectors
- `npm run collectors enable <name>` - Activate collector
- `npm run collectors disable <name>` - Deactivate collector
- `npm run collectors toggle <name>` - Switch on/off
- `npm run collectors status <name>` - Check status

### Batch
- `npm run collectors enable-all` - Activate all
- `npm run collectors disable-all` - Deactivate all

### Usage
- `npm start` - Start collection with enabled collectors

---

## 🔧 Configuration Format

```json
{
  "targetUrl": "https://example.com",
  "headless": false,
  "slowMo": 80,
  "collectors": {
    "network": {
      "enabled": true,
      "description": "..."
    },
    ...
  }
}
```

---

## ✨ Key Improvements

✅ **Granular Control**
- Enable/disable any collector independently
- Mix and match collectors as needed

✅ **Organized Output**
- Each module gets dedicated folder
- Easy to find and analyze data
- Logical file structure

✅ **Easy Management**
- Simple CLI commands
- No code changes needed
- Visual status indicators

✅ **Persistent Configuration**
- Settings saved in config.json
- Survives application restarts
- Can edit manually if needed

✅ **Resource Efficient**
- Only run collectors you need
- Reduce memory/disk usage
- Disable expensive collectors

✅ **Flexible**
- Quickly switch between profiles
- Different workflows supported
- Batch operations available

✅ **Bonus Presets**
- Minimal configuration
- Performance analysis
- Security focused
- DOM analysis
- Full analysis

---

## 🧪 Testing & Verification

✅ TypeScript compilation - No errors
✅ CLI commands - Working and tested
✅ Configuration loading - Verified
✅ Module organization - Implemented
✅ Documentation - Complete

---

## 📚 Documentation Generated

1. **README.md** - Main project documentation
2. **IMPLEMENTATION.md** - Technical details
3. **COMMANDS.md** - Command reference
4. **QUICK_START.js** - Interactive guide
5. **INSTALLATION_COMPLETE.md** - This document
6. **Code comments** - Throughout source files

---

## 🚀 Usage Examples

### Minimal Setup
```bash
npm run collectors disable-all
npm run collectors enable network
npm run collectors enable console
npm start
```

### Performance Analysis
```bash
npm run collectors disable-all
npm run collectors enable performance
npm run collectors enable media
npm run collectors enable memory
npm start
```

### Full Analysis
```bash
npm run collectors enable-all
npm start
```

---

## 🎓 Learning Resources

1. **For CLI usage:** Read `COMMANDS.md`
2. **For quick start:** Run `node QUICK_START.js`
3. **For details:** Check `README.md`
4. **For implementation:** See `IMPLEMENTATION.md`
5. **For configuration:** Edit `config.json`

---

## ✅ Completion Checklist

- [x] Configuration system created
- [x] CLI tool implemented
- [x] Main application updated
- [x] Module organization implemented
- [x] Documentation complete
- [x] Code compiles without errors
- [x] CLI tested and working
- [x] Examples documented
- [x] Quick start guide created
- [x] All 13 collectors controllable

---

## 🎉 Result

Your data extraction tool now has:
- ✅ Full collector control
- ✅ Module-based organization
- ✅ Easy CLI management
- ✅ Persistent configuration
- ✅ Comprehensive documentation

**Ready to use!**

---

## 📞 Support

For issues or questions:
1. Check `README.md` for general help
2. See `COMMANDS.md` for command help
3. Review `IMPLEMENTATION.md` for technical details
4. Check `config.json` for configuration help

---

**Implementation Date:** December 7, 2025
**Status:** ✅ COMPLETE
**Testing:** ✅ VERIFIED
**Documentation:** ✅ COMPLETE

Enjoy your new collector management system! 🚀
