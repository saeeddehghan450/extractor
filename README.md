# Ultimate DevTools Extractor

Extract everything Chrome DevTools can see about a web page — network traffic with bodies, console,
DOM, scripts, styles, cookies and storage, security headers and TLS, performance, accessibility,
media, WebGL, memory and service workers — and explore it in a web dashboard. Scrape data by
clicking on a live picture of the page, link every session in a Neo4j knowledge graph, keep it
long-term in PostgreSQL and SeaweedFS, and let any AI model drive the browser and analyse the
results through MCP or an OpenAI-compatible / Anthropic tool API.

Built with TypeScript, Playwright and the Chrome DevTools Protocol (CDP). The dashboard is a
**Next.js 16 / React 19** app served by a **NestJS 12** server.

![Live session](docs/screenshots/live-session.png)

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation and setup](#installation-and-setup)
  - [Option A — Docker Compose (recommended)](#option-a--docker-compose-recommended)
  - [Option B — Node.js on your machine](#option-b--nodejs-on-your-machine)
  - [Option C — Production build without Docker](#option-c--production-build-without-docker)
  - [Check the installation](#check-the-installation)
- [User guide](#user-guide)
  - [Live session](#live-session)
  - [Interactive scraper](#interactive-scraper)
  - [Collectors and presets](#collectors-and-presets)
  - [Saved results](#saved-results)
  - [Knowledge graph (Neo4j)](#knowledge-graph-neo4j)
  - [Long-term storage (PostgreSQL + SeaweedFS)](#long-term-storage-postgresql--seaweedfs)
  - [AI assistant](#ai-assistant)
  - [Settings, themes, languages and mobile](#settings-themes-languages-and-mobile)
- [MCP server and AI integration](#mcp-server-and-ai-integration)
- [Command line](#command-line)
- [Configuration](#configuration)
- [Output folder](#output-folder)
- [HTTP API reference](#http-api-reference)
- [Architecture](#architecture)
- [Development](#development)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

| Area | What you get |
|------|--------------|
| **Live session** | A real Chromium browser, streamed live into the dashboard over WebSocket and fully controllable (click, scroll, type, navigate). Network table with a request inspector, console, server log, a timeline of snapshots, live counters, device / network emulation, custom headers, URL blocking. |
| **13 collectors** | Network (with bodies), console, DOM, scripts, CSS, application storage, security, performance (trace), accessibility, media, WebGL, memory (heap snapshot), service workers — each can be switched on or off, or chosen with a preset. |
| **Snapshots** | Every click (and every manual / final snapshot) records a screenshot, the page HTML, the clicked element with its styles and event listeners, and the state of every page collector. |
| **Interactive scraper** | Pick the data on the live page; repeating lists are detected automatically; pagination; CSV, JSON and Markdown output; reusable recipes. |
| **Saved results** | Overview with insights, snapshot gallery, network and console explorers, full-text search (including bodies and sources), a JSON tree for every collector, file browser, HAR export and a standalone HTML report. |
| **Knowledge graph** | Sessions, pages, domains, requests, scripts, cookies, console messages, security headers, clicks and scraped records linked in Neo4j; read-only Cypher console with a graph view and 11 ready-made insights. |
| **Long-term storage** | Session files in SeaweedFS (S3 API) and structured data in PostgreSQL; restore, remove local copies, read-only SQL console. |
| **AI** | An MCP server (stdio and Streamable HTTP) with 32 tools, an OpenAI-compatible (default) and Anthropic tool gateway, and a built-in agent that works with OpenAI, Anthropic and any OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenRouter, Groq …). |
| **Dashboard** | English and Persian (RTL), dark and light themes, works on phones. |

---

## Requirements

| | Docker Compose | Node.js on your machine |
|--|----------------|-------------------------|
| Software | Docker Engine 24+ with Compose v2 | Node.js **20.19+** (22 or 24 recommended), npm 10+ |
| Browser | included in the image | downloaded by `npm run setup` (Chromium for Playwright) |
| Optional services | included (Neo4j, PostgreSQL, SeaweedFS) | Docker, to run Neo4j / PostgreSQL / SeaweedFS |
| Memory | ~3 GB for all four containers | ~1 GB for the extractor |

Neo4j, PostgreSQL and SeaweedFS are optional: the live session, scraper, saved results and the AI
features all work without them. Each one adds its own page and AI tools when it is connected.

---

## Installation and setup

### Option A — Docker Compose (recommended)

Runs the extractor and the three optional services with one command. The image is based on the
official Playwright image (Node.js + Chromium + system libraries), runs as a non-root user and
always uses headless mode (a container has no display — you control the page from the dashboard).

**1. Get the code**

```bash
git clone https://github.com/saeeddehghan450/extractor.git
cd extractor
```

**2. Choose passwords** (optional but recommended) — create a `.env` file next to `docker-compose.yml`:

```bash
NEO4J_PASSWORD=change-me-graph
POSTGRES_PASSWORD=change-me-db
S3_ACCESS_KEY_ID=extractor
S3_SECRET_ACCESS_KEY=change-me-files
```

Without it the defaults are `extractor-graph`, `extractor-db` and `extractor` / `extractor-files`.

**3. Build and start**

```bash
docker compose up -d --build
docker compose ps          # wait until every service is "healthy" (about 30 seconds)
```

**4. Open the dashboard** at <http://localhost:4000>. The *Knowledge graph* and *Data storage* pages
should show **Connected** — Compose passes the connection settings to the extractor.

| Service | Image | Address (this machine only) | Purpose |
|---------|-------|------------------------------|---------|
| `extractor` | built from `Dockerfile` | <http://localhost:4000> | dashboard, API, MCP |
| `neo4j` | `neo4j:2026.10.0-community` | <http://localhost:7474> (Browser), `bolt://localhost:7687` | knowledge graph |
| `postgres` | `postgres:18.6` | `localhost:5432` | structured archive |
| `seaweedfs` | `chrislusf/seaweedfs:4.48` | <http://localhost:8333> (S3), <http://localhost:8888> (filer UI) | file archive |

**Everyday commands**

```bash
docker compose logs -f extractor     # follow the logs
docker compose stop                  # stop, keep everything
docker compose down                  # remove the containers, keep the data volumes
docker compose down -v               # remove the containers AND all data
git pull && docker compose up -d --build   # update
```

**Data** lives in named volumes: `extractor-data` (`/data/config.json` and `/data/output/`),
`neo4j-data`, `postgres-data` and `seaweedfs-data`. Copy results out with:

```bash
docker cp devtools-extractor:/data/output ./output
```

**Command line tools inside the container**

```bash
docker compose run --rm extractor node dist/main.js --url https://example.com --duration 30
docker compose run --rm extractor node dist/bin/collector-cli.js preset security
```

**Only the extractor** (without the optional services):

```bash
docker build -t devtools-extractor .
docker run -d --name extractor --init --shm-size=1g \
  -p 127.0.0.1:4000:4000 -v extractor-data:/data devtools-extractor
```

Notes:
- `--shm-size=1g` (`shm_size` in Compose) prevents Chromium crashes on heavy pages.
- All ports are published on `127.0.0.1` only. For remote access put an authenticating HTTPS
  reverse proxy in front and see [Security](#security).
- When you upgrade `playwright` in `package.json`, set `PLAYWRIGHT_VERSION` in the `Dockerfile` to the
  same version.

### Option B — Node.js on your machine

**1. Install**

```bash
git clone https://github.com/saeeddehghan450/extractor.git
cd extractor
npm install
npm run setup        # downloads Chromium for Playwright (once)
```

**2. Start**

```bash
npm start            # builds the dashboard, then starts the server on http://localhost:4000
```

Open <http://localhost:4000>. Use `PORT=5000 npm start` for another port and `HOST=0.0.0.0` to
listen on every interface (read [Security](#security) first). On a machine with a display, sessions
open a visible Chromium window by default; switch on *Headless mode* to control the page from the
dashboard only.

**3. Optional services** — start the official images with Docker and point the extractor at them:

```bash
# Neo4j (knowledge graph)
docker run -d --name neo4j -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
  -e NEO4J_AUTH=neo4j/change-me -v neo4j-data:/data neo4j:2026.10.0-community

# PostgreSQL (structured archive)
docker run -d --name postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=extractor -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=extractor \
  -v pg-data:/var/lib/postgresql postgres:18.6

# SeaweedFS (file archive, S3 API)
docker run -d --name seaweedfs -p 127.0.0.1:8333:8333 \
  -e AWS_ACCESS_KEY_ID=extractor -e AWS_SECRET_ACCESS_KEY=change-me \
  -v sw-data:/data chrislusf/seaweedfs:4.48 server -dir=/data -s3 -volume.max=0
```

Connect them either on the dashboard (**Knowledge graph → Connection**, **Data storage → Connection**;
settings are saved in `config.json`, passwords are never sent back to the browser) or with
environment variables:

```bash
export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=change-me
export DATABASE_URL=postgres://extractor:change-me@localhost:5432/extractor
export S3_ENDPOINT=http://localhost:8333 S3_ACCESS_KEY_ID=extractor S3_SECRET_ACCESS_KEY=change-me
npm start
```

Or simply run `docker compose up -d neo4j postgres seaweedfs` to use the services from the Compose
file with the extractor running locally.

**4. Optional AI model** — the built-in agent needs a model:

```bash
export OPENAI_API_KEY=sk-...                         # OpenAI
# or a local OpenAI-compatible server, e.g. Ollama:
export EXTRACTOR_AI_BASE_URL=http://localhost:11434/v1 EXTRACTOR_AI_MODEL=llama3.1
# or Anthropic:
export EXTRACTOR_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=...
```

The model, endpoint and key can also be entered on the *AI assistant* page. MCP clients need no model
setting — they bring their own (see [MCP server and AI integration](#mcp-server-and-ai-integration)).

### Option C — Production build without Docker

```bash
npm ci
npm run setup
npm run build          # server -> dist/, dashboard -> web/out (static export)
npm run start:prod     # node dist/server/main.js
```

Only `dist/`, `web/out/`, `node_modules/` (production dependencies) and `package.json` are needed at
runtime. Run it under a process manager (systemd, pm2 …) and keep it on `127.0.0.1` behind a reverse
proxy. The proxy must forward WebSocket upgrades on `/ws/live` and Server-Sent Events on `/api/events`
(disable response buffering), and the public host name must be listed in `EXTRACTOR_ALLOWED_HOSTS`.

### Check the installation

```bash
curl http://localhost:4000/api/meta              # version, collectors, presets
curl http://localhost:4000/api/graph/status      # "connected": true when Neo4j is set up
curl http://localhost:4000/api/storage/status    # PostgreSQL and SeaweedFS status
curl http://localhost:4000/v1/tools | head -c 300   # AI tool definitions
```

---

## User guide

### Live session

![Start screen](docs/screenshots/live-start.png)

1. Enter a URL and press **Start extraction**.
   - *Headless* (default in Docker): no window; the page is streamed into the dashboard.
   - *Headed*: a Chromium window opens on your desktop; work in it normally.
2. Use the page in the dashboard: **click, scroll and type on the live view** (focus it to send keys),
   use the back / forward / reload buttons or type a new address.
3. Every click on the page triggers a full **snapshot**; press **Snapshot** for a manual one.
4. Press **Finish & save** (or close the browser window). Results appear under **Saved results**, and
   are archived and synced to the graph automatically when those services are connected.

![Running session](docs/screenshots/live-session.png)

The counters at the top update live. The timeline on the right lists every snapshot with its trigger
(click / manual / final), duration and errors — open its screenshot or JSON directly. **HAR** downloads
a HAR of the running session at any time.

Click a row of the network table to inspect the request: headers, post data, response headers, TLS
details, remote address and the response body (large bodies are saved to disk and open in a new tab).

![Request inspector](docs/screenshots/live-request.png)

The **Console** tab shows console messages, uncaught errors and dialogs with their source location
(filter by level or text); **Server log** shows what the extractor is doing.

![Console](docs/screenshots/live-console.png)

**Advanced options** (under the URL field, remembered for the next session):

| Option | Values |
|--------|--------|
| Device | Desktop, iPhone 15, iPhone 15 Pro Max, iPhone SE, Pixel 7, Galaxy S9+, iPad (gen 7), iPad Pro 11, Galaxy Tab S4 — viewport, touch, pixel ratio and User-Agent |
| Network | No throttling, Fast 4G, Slow 4G, Slow 3G, Offline (the same values as Chrome DevTools) |
| User-Agent | any string; overrides the device's |
| Extra headers | one `Name: value` per line, e.g. `Authorization: Bearer …` — sent with every request |
| Block URLs | one pattern per line: plain text = "URL contains"; with `*` = whole-URL pattern (`*.png`, `https://*/ads/*`). Blocked requests are recorded as failed (`ERR_BLOCKED_BY_CLIENT`) |

### Interactive scraper

Open a site, click the parts you want on the live picture of the page and get their data as a table —
no code and no selectors to write.

1. **Interactive scraper** → enter a URL → **Open site**. The page is streamed live over WebSocket.
   *Browse* mode works like a normal browser (click, scroll, type).
2. Switch to **Select** mode: the element under the cursor is outlined with its selector. Click it.
3. If the element repeats on the page (products, articles, table rows, cards …) you are asked whether
   to extract **every item of the list** — the list is detected automatically — or only this element.

   ![Picking an element](docs/screenshots/scraper-pick.png)

4. Click other parts of one item (price, category, image …) to add more columns. Selectors are made
   relative to the list item, so every row lines up even when an item lacks a field. Links also get a
   URL column automatically. Every column shows a sample value and is highlighted on the page in its
   colour.

   ![Columns and highlights](docs/screenshots/scraper.png)

5. Optional: **Pagination → Pick on page**, click the "next page" button and set the maximum number of
   pages.
6. **Extract all pages & save** — the table shows every row, and three files are saved in the session
   folder: `scrapes/<name>-<time>.csv` (UTF-8 with BOM, opens correctly in Excel), `.json` and `.md`
   (a Markdown table with the source URL, row and page count — ready for GitHub, notes or an LLM).

   ![Results](docs/screenshots/scraper-results.png)

Each column can be edited: its name, what to take (text, link, image / source, attribute, HTML, form
value) and its CSS selector. **Preview** extracts only the current page. Save the set of columns as a
**recipe** to run it again later — from this page, or from an AI model through MCP
(`extractor_run_recipe`; `extractor_scrape` does an ad-hoc extraction; pass `"output": "markdown"` to get
the rows back as a Markdown table). Recipes are stored in `output/recipes/`.

### Collectors and presets

![Collectors](docs/screenshots/collectors.png)

Switch collectors on or off, or apply a preset: **Minimal**, **Performance Analysis**, **Security
Analysis**, **DOM Analysis**, **Full Analysis**.

| Collector | Kind | Collects |
|-----------|------|----------|
| `network` | stream | Every request / response of every tab: headers, post data, body (large bodies saved to disk), status, size, duration, remote address, TLS details |
| `console` | stream | Console messages, uncaught errors, dialogs (dialogs are dismissed automatically) |
| `elements` | snapshot | Page overview (title, node counts, forms, headings, meta, iframes) and, for clicks: outerHTML, computed style, matched CSS rules, box model and the real event listeners of the element and its ancestors |
| `scripts` | snapshot | Downloads every external script once, saves inline scripts, detects `sourceMappingURL` |
| `css` | snapshot | Downloads stylesheets, saves inline styles, stylesheet summary, CSS custom properties |
| `application` | snapshot | Cookies (including HttpOnly), localStorage, sessionStorage, IndexedDB databases and stores, Cache Storage |
| `security` | snapshot | Secure context, TLS certificate, present / missing security headers, mixed content, cookies with weak flags |
| `performance` | snapshot | CDP metrics, navigation timing, FCP, LCP, CLS, long tasks, resource summary; a DevTools trace on manual / final snapshots |
| `accessibility` | snapshot | Full accessibility tree (saved to disk), role counts, elements without an accessible name |
| `media` | snapshot | Audio / video playback state and quality |
| `webgl` | snapshot | Context type of every canvas (tracked without touching the page), extensions, GPU info |
| `memory` | snapshot | Heap usage and DOM counters; a full `.heapsnapshot` on manual / final snapshots |
| `serviceWorker` | snapshot | Registrations, controller, running workers |

*Stream* collectors record for the whole session; *snapshot* collectors run on every snapshot. The
trace (`performance/trace-N.json`) and the heap snapshot (`memory/heap-N.heapsnapshot`) open in Chrome
DevTools (Performance → *Load profile*, Memory → *Load*).

### Saved results

![Saved sessions](docs/screenshots/sessions.png)

Every finished session, with its counters, emulation and status. Filter by URL, download
`analysis.json`, delete, or open a session:

![Session overview](docs/screenshots/session-overview.png)

The header has the exports — **HTML report** (open or download), **HAR**, **JSON** — and the actions
**Analyse with AI** (opens the assistant with a prepared question), **Archive** (PostgreSQL +
SeaweedFS) and **Send to graph** (Neo4j). The tabs:

| Tab | Content |
|-----|---------|
| Overview | Counters, enabled collectors and insight cards: page, security (missing headers, weak cookies), performance (TTFB, DCL, load, FCP, LCP, CLS, heap), accessibility, sources, storage, DevTools files |
| Snapshots | Screenshot gallery; each snapshot's JSON and saved HTML (shown sandboxed) |
| Network | Every request with filters; click for full details |
| Console | Every console message, uncaught error and dialog |
| Search | Full-text search (plain text or regex) |
| Module data | A collapsible JSON tree (or raw JSON) of every collector, with download |
| Files | Every file of the session folder |

![Snapshots](docs/screenshots/session-snapshots.png)

![Network details](docs/screenshots/session-network.png)

**Search** looks through request URLs, request and response headers, post data, response bodies,
console messages, cookies, local / session storage and the downloaded JS / CSS sources — useful for
finding API keys, tokens or where a value comes from.

![Search](docs/screenshots/session-search.png)

![Module data](docs/screenshots/session-modules.png)

**Exports**, written when a session finishes:

- `report.html` — a single self-contained report (summary, findings, embedded screenshots, console
  errors, failed requests, request list) to share or print. The dashboard renders it on demand in
  English or Persian.
- `network/network.har` — HAR 1.2 with full response bodies; import it in Chrome DevTools
  (Network → *Import HAR*), Firefox, Charles, Fiddler, Insomnia …
- `analysis.json` — everything combined.

![HTML report](docs/screenshots/report.png)

### Knowledge graph (Neo4j)

Every session is written into [Neo4j](https://neo4j.com) (official image, official `neo4j-driver`), so
you — and the AI assistant — can ask questions that span requests, domains, pages, scripts, cookies,
console messages, clicks and scraped records, across one session or all of them.

![Knowledge graph](docs/screenshots/graph.png)

- **Setup**: run Neo4j (see [installation](#installation-and-setup)), then connect it under
  **Connection** on this page or with `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` / `NEO4J_DATABASE`.
- **Sync**: with auto-sync on (default), a session is synced when it finishes and after every saved
  scrape; **Sync all sessions** imports older ones; session pages have **Send to graph**. Syncing is
  idempotent — a session's previous data is replaced.
- **Node counts** at the top are clickable and show that label's neighbourhood.
- **Cypher console**: read-only queries with example chips; results as a table or an interactive graph
  (drag nodes, hover for properties). **Analyse with AI** and **Ask AI about this query** hand the result
  or the query to the assistant.
- **Ready-made insights**: sessions overview, third-party domains, domains shared across sessions,
  failing requests, slowest requests, console error hotspots, cookies and their flags, missing security
  headers, scripts by serving domain, scraped records, click paths.

![Insight](docs/screenshots/graph-insight.png)

Graph model:

```
(Session)-[:STARTED_AT|VISITED]->(Page)-[:ON_DOMAIN]->(Domain {name, site})
(Session)-[:CONTACTED {requests, bytes, failed, thirdParty}]->(Domain)
(Session)-[:MADE]->(Request)-[:TO]->(Domain)            (Request)-[:FROM_PAGE]->(Page)
(Page)-[:LOADS]->(Script|Stylesheet)-[:SERVED_FROM]->(Domain)
(Session)-[:SAW_COOKIE {secure, httpOnly, ...}]->(Cookie)-[:FOR_DOMAIN]->(Domain)
(Session)-[:LOGGED]->(ConsoleMessage)-[:FROM_SCRIPT]->(Script)
(Page)-[:HAS_HEADER|MISSING_HEADER]->(SecurityHeader)
(Session)-[:CLICKED {seq}]->(Element)-[:ON_PAGE]->(Page)
(Session)-[:SCRAPED]->(Scrape)-[:HAS_RECORD]->(Record {one property per column})-[:LINKS_TO]->(Page)
```

Queries run in read transactions, so the database rejects writes; `LOAD CSV` and `dbms.*` / `apoc.*` /
`gds.*` procedures are refused as well.

```bash
curl -X POST localhost:4000/api/graph/query -H 'Content-Type: application/json' \
  -d '{"cypher":"MATCH (s:Session)-[c:CONTACTED]->(d:Domain) WHERE c.thirdParty RETURN d.name, sum(c.requests) AS n ORDER BY n DESC"}'
curl -X POST localhost:4000/api/graph/insights -H 'Content-Type: application/json' -d '{"id":"shared-domains"}'
```

### Long-term storage (PostgreSQL + SeaweedFS)

Finished sessions are archived so the data is kept independently of the local output folder:

- **SeaweedFS** (official `chrislusf/seaweedfs` image, through its S3 gateway with the official AWS SDK)
  stores every file of a session — screenshots, response bodies, sources, HAR, report, scrapes — as
  `<bucket>/sessions/<sessionId>/<path>`. Unchanged files are not uploaded again.
- **PostgreSQL** (official `postgres` image and the `pg` client) stores the structured data in the
  `extractor` schema: `sessions`, `requests` (with headers), `console_messages`, `cookies`,
  `security_headers`, `scrapes`, `scrape_records` (one `jsonb` row per scraped item) and `files`.

Either one can be used alone.

![Data storage](docs/screenshots/storage.png)

- **Setup**: run the services (see [installation](#installation-and-setup)), then connect them under
  **Connection** or with `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET` (default `extractor`).
- **Archive**: automatic when a session finishes (switch it off on this page or with
  `STORAGE_AUTO_ARCHIVE=0`); **Archive all sessions** stores older ones; session pages have **Archive**.
- **Archived sessions**: where each one is stored (local / SeaweedFS / PostgreSQL), **Open**,
  **Restore** (download back into the output folder), **Remove local copy** (only after every file is
  verified in SeaweedFS — the dashboard then serves its files from SeaweedFS) and removal from the
  archive (×).
- **SQL console**: one read-only `SELECT` / `WITH` / `EXPLAIN` statement, with examples and the table
  list. Scraped data is easy to query: `SELECT data->>'price' FROM scrape_records`.

![SQL console](docs/screenshots/storage-sql.png)

SQL runs in a read-only transaction under a role that can only read the `extractor` schema; functions
that read server files, run dynamic SQL or change settings are refused.

```bash
curl -X POST localhost:4000/api/storage/sql -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT host, count(*) FROM requests GROUP BY host ORDER BY 2 DESC"}'
curl -X POST localhost:4000/api/storage/archive -H 'Content-Type: application/json' -d '{"all":true}'
```

### AI assistant

Chat with a model that uses the extractor's tools: it can open sites, click, read the recorded data,
scrape, and query the knowledge graph and the SQL archive. Tool calls are shown as they happen (expand
one to see its arguments and result).

![AI assistant](docs/screenshots/assistant.png)

**Model settings** (right column): provider — **OpenAI-compatible** (default: OpenAI, Azure OpenAI,
OpenRouter, Groq, DeepSeek, Together, Ollama, vLLM, LM Studio, llama.cpp …) or **Anthropic**; model name;
API base URL; API key (kept only in this browser if you tick *Remember*); effort (Anthropic); whether
screenshots are sent to the model. Empty fields use the server's defaults (environment variables or
`config.json`), shown under the form.

The other pages hand questions to the assistant: **Ask the assistant** on the graph and storage pages,
**Analyse with AI** on results and session pages.

The **MCP & API connection** tab lists the tools and ready-to-copy configurations for MCP clients:

![MCP connection](docs/screenshots/assistant-connect.png)

### Settings, themes, languages and mobile

![Settings](docs/screenshots/settings.png)

Default URL, headless mode, viewport, slow motion, performance-trace duration and a custom Chromium
path. The output folder is shown for reference.

The buttons at the bottom of the sidebar switch the **theme** (dark / light) and the **language**
(English / Persian, right-to-left). The layout adapts to phones.

| Light theme | Persian (RTL) | Phone |
|-------------|---------------|-------|
| ![Light theme](docs/screenshots/theme-light.png) | ![Persian](docs/screenshots/rtl-persian.png) | ![Phone](docs/screenshots/mobile.png) |

---

## MCP server and AI integration

The extractor is an **MCP server** (Model Context Protocol), so any MCP client or model can drive the
browser and read the results — the same idea as
[Playwright MCP](https://github.com/microsoft/playwright-mcp), with the full DevTools data on top. Apps
that call a model API directly can use the same tools through an **OpenAI-compatible** (default) or
**Anthropic** tool API, and the **built-in agent** connects any model for you.

```
MCP clients (Claude, Cursor, VS Code, Codex …)  ── stdio  or  http://localhost:4000/mcp ─┐
Apps using OpenAI-compatible APIs                ── /v1/tools  (+ /v1/tools/call)        ├─ 32 extractor_* tools ─ one shared session ─ Chromium
Apps using the Anthropic API                     ── /v1/tools?format=anthropic           │
Built-in agent (dashboard page / npm run agent)  ────────────────────────────────────────┘
```

### Connect an MCP client

**Streamable HTTP** — while the dashboard runs (`npm start` or Docker) the endpoint is
`http://localhost:4000/mcp`:

```json
{
  "mcpServers": {
    "devtools-extractor": { "url": "http://localhost:4000/mcp" }
  }
}
```

**stdio** — the client starts the server itself (run `npm run build` once):

```json
{
  "mcpServers": {
    "devtools-extractor": {
      "command": "node",
      "args": ["/path/to/extractor/dist/mcp/main.js"]
    }
  }
}
```

| Client | How |
|--------|-----|
| Claude Code | `claude mcp add --transport http devtools-extractor http://localhost:4000/mcp` |
| Claude Desktop, Cursor, Windsurf, Cline, LM Studio | the configuration above (HTTP or stdio) |
| VS Code (`.vscode/mcp.json`) | `{"servers": {"devtools-extractor": {"type": "http", "url": "http://localhost:4000/mcp"}}}` |
| Codex (`~/.codex/config.toml`) | `[mcp_servers.devtools-extractor]` + `url = "http://localhost:4000/mcp"` (or `command` / `args` for stdio) |
| Docker (stdio) | `"command": "docker", "args": ["run", "-i", "--rm", "--init", "--shm-size=1g", "-v", "extractor-data:/data", "devtools-extractor", "node", "dist/mcp/main.js"]` |

A standalone MCP server without the dashboard: `npm run mcp` (stdio) or `npm run mcp -- --port 8931`
(HTTP at `http://127.0.0.1:8931/mcp`). The server also offers an `audit-website` prompt.

Hosted model APIs can use the MCP endpoint directly when it is reachable from the internet (behind
HTTPS, with `EXTRACTOR_API_TOKEN` set): the OpenAI Responses API through a
`{"type": "mcp", "server_url": …}` tool, and the Claude API through its MCP connector.

### Tools

| Tool | Title | Parameters | Read-only |
|------|-------|------------|:---------:|
| `extractor_start_session` | Start extraction session | `url`, `device`, `network`, `preset`, `collectors`, `userAgent`, `extraHeaders`, `blockPatterns`, `headless` |  |
| `extractor_stop_session` | Stop and save session | — |  |
| `extractor_session_status` | Session status | `sessionId` | ✓ |
| `extractor_take_snapshot` | Take snapshot | — |  |
| `extractor_navigate` | Navigate | `url`, `action` |  |
| `extractor_page_snapshot` | Page snapshot (accessibility tree) | `maxChars` | ✓ |
| `extractor_click` | Click | `ref`, `selector`, `role`, `name`, `text`, `element`, `doubleClick` |  |
| `extractor_type` | Type text | `ref`, `selector`, `role`, `name`, `text`, `element`, `value`, `submit`, `slowly` |  |
| `extractor_press_key` | Press key | `key` |  |
| `extractor_scroll` | Scroll | `deltaY` |  |
| `extractor_screenshot` | Screenshot | `fullPage` | ✓ |
| `extractor_evaluate` | Run JavaScript in the page | `function` |  |
| `extractor_list_sessions` | List saved sessions | `limit` | ✓ |
| `extractor_get_overview` | Findings overview | `sessionId` | ✓ |
| `extractor_list_requests` | List network requests | `sessionId`, `urlContains`, `resourceType`, `method`, `status`, `limit`, `offset` | ✓ |
| `extractor_get_request` | Request details | `sessionId`, `requestId`, `includeBody`, `maxBodyChars` | ✓ |
| `extractor_console_messages` | Console messages | `sessionId`, `level`, `contains`, `limit` | ✓ |
| `extractor_get_collector_data` | Collector data | `sessionId`, `collector`, `path`, `maxChars` | ✓ |
| `extractor_search` | Search session | `sessionId`, `query`, `regex`, `caseSensitive`, `limit` | ✓ |
| `extractor_scrape` | Scrape data | `itemSelector`, `fields`, `nextSelector`, `maxPages`, `name`, `maxRows`, `output` |  |
| `extractor_list_recipes` | List scraping recipes | — | ✓ |
| `extractor_run_recipe` | Run scraping recipe | `name`, `url`, `maxPages`, `maxRows`, `output` |  |
| `extractor_export` | Export | `sessionId`, `format`, `language` |  |
| `extractor_graph_schema` | Graph schema | — | ✓ |
| `extractor_graph_query` | Query the graph (Cypher) | `cypher`, `params`, `limit` | ✓ |
| `extractor_graph_insight` | Graph insight | `id`, `sessionId`, `limit` | ✓ |
| `extractor_graph_sync` | Sync sessions to the graph | `sessionId`, `all` |  |
| `extractor_storage_status` | Storage status and SQL schema | — | ✓ |
| `extractor_sql_query` | Query archived data (SQL) | `sql`, `params`, `limit` | ✓ |
| `extractor_archive_session` | Archive session | `sessionId`, `all`, `removeLocal` |  |
| `extractor_list_archived` | List archived sessions | `limit` | ✓ |
| `extractor_restore_session` | Restore archived session | `sessionId`, `overwrite` |  |

Like Playwright MCP, the page is read through an accessibility snapshot with element refs
(`extractor_page_snapshot` → `button "Buy now" [ref=e5]` → `extractor_click {"ref": "e5"}`), which works
without a vision model. Every click is recorded with a full DevTools snapshot. Data tools work on the
running session or on any saved session (`sessionId`). Arguments are validated; mistakes come back as
tool errors the model can read and fix.

### Tool API for OpenAI-compatible and Anthropic apps

For code that calls a model directly instead of through MCP:

```bash
# 1) tool definitions in OpenAI function-calling format (default) …
curl http://localhost:4000/v1/tools
# … or in Anthropic format
curl "http://localhost:4000/v1/tools?format=anthropic"

# 2) give them to the model; when it answers with tool calls, post them back unchanged:
#    OpenAI:    {"tool_calls": [...]}       (or the whole assistant message / one tool call)
#    Anthropic: {"content": [... tool_use blocks ...]}  (or one tool_use block)
curl -X POST http://localhost:4000/v1/tools/call -H 'Content-Type: application/json' \
  -d '{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"extractor_list_sessions","arguments":"{}"}}]}'
# -> OpenAI:    {"messages": [{"role": "tool", "tool_call_id": "call_1", "content": "…"}]}   (append them)
# -> Anthropic: {"message": {"role": "user", "content": [{"type": "tool_result", …}]}}  (append it)

# one tool with plain JSON arguments
curl -X POST http://localhost:4000/v1/tools/extractor_get_overview -H 'Content-Type: application/json' -d '{}'
```

Screenshots: Anthropic tool results carry the image; for OpenAI (whose tool messages are text-only) an
extra user message with the image follows the tool messages.

### Built-in agent

The dashboard's **AI assistant** page and `npm run agent` let a model drive the extractor directly.

```bash
# OpenAI
OPENAI_API_KEY=sk-… npm run agent -- --model <model> "Audit https://example.com"
# Ollama / LM Studio / vLLM (no key needed)
npm run agent -- --base-url http://localhost:11434/v1 --model <model> "Check https://example.com for console errors"
# Anthropic (default model claude-opus-5-5)
ANTHROPIC_API_KEY=… npm run agent -- --provider anthropic "Which third-party domains do my sessions share?"
# interactive chat
npm run agent -- --model <model>
```

| Setting | CLI | Environment | `config.json` → `ai` |
|---------|-----|-------------|----------------------|
| Provider | `--provider openai\|anthropic` | `EXTRACTOR_AI_PROVIDER` | `provider` |
| Model | `--model` | `EXTRACTOR_AI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL` | `model` |
| Endpoint | `--base-url` | `EXTRACTOR_AI_BASE_URL`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` | `baseURL` |
| API key | — | `EXTRACTOR_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | — (never stored) |
| Steps per message | `--max-steps` (30) | `EXTRACTOR_AI_MAX_STEPS` | `maxSteps` |
| Effort (Anthropic) | `--effort` | `EXTRACTOR_AI_EFFORT` | `effort` |
| Screenshots to the model | `--no-vision` | `EXTRACTOR_AI_VISION=0` | `vision` |
| Keep the session open | `--keep-session` | — | — |

With Anthropic on the Claude API, Claude 5-family models run with `effort: high` (tool-heavy work) and
the server-side refusal fallback is enabled; turn it off with `--no-fallbacks`.

---

## Command line

```bash
# extract without the dashboard (keys while running: s = snapshot, q = finish)
npm run extract -- --url https://example.com
npm run extract -- --url https://example.com --headless --duration 30
npm run extract -- --url https://example.com --device iphone-15 --network slow-3g \
  --header "Authorization: Bearer TOKEN" --block google-analytics --block "*.mp4"
npm run extract -- --list-devices                # device and network preset names

# collectors
npm run collectors list
npm run collectors enable network
npm run collectors disable memory
npm run collectors toggle performance
npm run collectors enable-all
npm run collectors presets
npm run collectors preset security               # minimal | performance | security | dom | full

# MCP and AI
npm run mcp                                      # MCP server on stdio
npm run mcp -- --port 8931                       # MCP over HTTP: http://127.0.0.1:8931/mcp
npm run agent -- --help
```

| `npm run extract` option | Meaning |
|--------------------------|---------|
| `--url`, `-u` | page to open (default: `targetUrl` from `config.json` or `TARGET_URL`) |
| `--headless` / `--headed` | run without / with a window |
| `--duration`, `-d` | stop automatically after N seconds |
| `--device`, `--network` | emulation presets (`--list-devices` prints the names) |
| `--user-agent` | custom User-Agent |
| `--header "Name: value"` | extra header (repeatable) |
| `--block <pattern>` | block matching URLs (repeatable) |

See [COMMANDS.md](COMMANDS.md) for a compact reference.

---

## Configuration

Settings come from `config.json` (editable from the dashboard), overridden by environment variables.

```json
{
  "targetUrl": "https://example.com",
  "headless": false,
  "slowMo": 0,
  "viewport": { "width": 1280, "height": 800 },
  "performanceTraceMs": 3000,
  "port": 4000,
  "executablePath": "/optional/path/to/chromium",
  "emulation": { "device": "desktop", "network": "none", "userAgent": "", "extraHeaders": {}, "blockPatterns": [] },
  "neo4j": { "enabled": true, "uri": "bolt://localhost:7687", "user": "neo4j", "password": "…", "autoSync": true },
  "storage": {
    "postgres": { "enabled": true, "url": "postgres://extractor:…@localhost:5432/extractor" },
    "s3": { "enabled": true, "endpoint": "http://localhost:8333", "accessKeyId": "extractor", "secretAccessKey": "…", "bucket": "extractor" },
    "autoArchive": true
  },
  "ai": { "provider": "openai", "model": "…", "baseURL": "…", "maxSteps": 30 },
  "collectors": { "network": { "enabled": true, "description": "…" } }
}
```

Passwords, secret keys and the PostgreSQL URL are never returned by the API — the dashboard only sees
whether they are set. Prefer environment variables for secrets.

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | server address (default `127.0.0.1:4000`) |
| `TARGET_URL` | default URL for `npm run extract` |
| `CHROMIUM_PATH` | use a specific Chromium binary |
| `EXTRACTOR_CONFIG` | path of the config file (default `config.json`) |
| `EXTRACTOR_OUTPUT` | output folder (default `output`) |
| `EXTRACTOR_HEADLESS=1` | force headless mode (set in the Docker image) |
| `DEBUG=1` | print debug logs |
| `EXTRACTOR_API_TOKEN` | bearer token required on `/mcp` and `/v1/*` |
| `EXTRACTOR_ALLOWED_HOSTS` | extra host names the server answers for (DNS-rebinding protection; `*` disables the check) |
| `EXTRACTOR_ALLOWED_ORIGINS` | extra browser origins allowed to call the API (`npm run dev` sets the Next.js dev server's) |
| `EXTRACTOR_AI_*`, `OPENAI_*`, `ANTHROPIC_*` | agent settings, see [Built-in agent](#built-in-agent) |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | knowledge graph connection |
| `NEO4J_AUTO_SYNC=0` | do not sync sessions automatically |
| `DATABASE_URL` | PostgreSQL archive, e.g. `postgres://extractor:pw@localhost:5432/extractor` |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION` | SeaweedFS (or any S3 store) for session files |
| `STORAGE_AUTO_ARCHIVE=0` | do not archive sessions automatically |

---

## Output folder

Each session gets its own folder:

```
output/<date>-<time>-<host>-<id>/
├── session.json            # manifest: status, counts, snapshots
├── analysis.json           # everything combined
├── report.html             # standalone HTML report
├── network/
│   ├── network.json
│   └── network.har         # HAR 1.2 export
├── console/console.json    # one folder per enabled collector
├── elements/elements.json
├── ...
├── snapshots/
│   ├── 001-click/          # snapshot.json, screenshot.png, page.html
│   ├── 002-manual/
│   └── 003-final/
├── scrapes/                # <name>-<time>.json / .csv / .md
├── responses/              # large response bodies
├── sources/                # downloaded JS / CSS and inline code
├── performance/trace-3.json
├── accessibility/ax-tree-3.json
└── memory/heap-3.heapsnapshot
output/recipes/             # saved scraping recipes
```

Page-state collectors in `analysis.json` / `<collector>/<collector>.json` contain the data of the latest
snapshot; every individual snapshot is kept in `snapshots/`.

---

## HTTP API reference

All endpoints are served by the dashboard server. JSON in, JSON out; errors are
`{"error": "message"}` with a matching status code. State-changing requests must send
`Content-Type: application/json`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/meta` | collectors, presets, devices, networks, version |
| `GET /api/config` · `PUT /api/config` | settings (without secrets) |
| `POST /api/presets/{key}` | apply a collector preset |
| `GET /api/events` | Server-Sent Events: status, requests, responses, console, clicks, snapshots, counters, logs |
| `GET /api/session` · `GET /api/session/live` | running session summary / live state |
| `POST /api/session/start` · `/snapshot` · `/stop` | control the session (`start`: `{url, headless, collectors, emulation}`) |
| `POST /api/session/input` | `{action: click\|scroll\|type\|press\|navigate\|back\|forward\|reload, …}` |
| `GET /api/session/screenshot` · `/har` · `/request/{id}` | JPEG, HAR, one request |
| `GET /api/sessions` · `GET\|DELETE /api/sessions/{id}` | saved sessions |
| `GET /api/sessions/{id}/files` · `/file?path=` · `/report?lang=` · `/search?q=` | files, report, search |
| `POST /api/scraper/count` · `/preview` · `/run` | scraper (`{recipe}`) |
| `GET\|POST /api/scraper/recipes` · `DELETE /api/scraper/recipes/{name}` | recipes |
| `GET /api/graph/status` · `PUT /api/graph/config` | Neo4j status / connection |
| `POST /api/graph/sync` · `/query` · `/insights` · `GET /api/graph/insights` · `/schema` | knowledge graph |
| `GET /api/storage/status` · `PUT /api/storage/config` | storage status / connection |
| `POST /api/storage/archive` · `/restore` · `/sql` · `GET /api/storage/sessions` · `/schema` · `DELETE /api/storage/sessions/{id}` | archive |
| `GET /api/agent/config` · `POST /api/agent/chat` (NDJSON stream) · `POST /api/agent/reset` | built-in agent |
| `POST /mcp` | MCP (Streamable HTTP) |
| `GET /v1/tools` · `POST /v1/tools/call` · `POST /v1/tools/{name}` | tool gateway |
| `WS /ws/live` | live view: JPEG frames (`[uint32 header length][JSON header][JPEG]`) and JSON input messages |

---

## Architecture

```
            Browser (dashboard: Next.js static export)          MCP clients / model apps
                 │  HTTP · SSE /api/events · WS /ws/live              │  /mcp · /v1
                 ▼                                                    ▼
   ┌───────────────────────────── NestJS server (src/server) ─────────────────────────────┐
   │ security middleware (Host / Origin / JSON) · token guard · error filter             │
   │ dashboard · events · live gateway · scraper · graph · storage · AI (MCP, gateway,   │
   │ agent) modules                                                                      │
   └───────────────┬───────────────────────────────┬──────────────────┬──────────────────┘
                   ▼                               ▼                  ▼
     session controller (src/core)        Neo4j (src/graph)   PostgreSQL + SeaweedFS
     Playwright + CDP → Chromium           knowledge graph     (src/storage) archive
     13 collectors → output/<session>/
```

- The dashboard (`web/`, Next.js App Router, client components) is built as a static export
  (`web/out`) and served by the NestJS server on the same origin as the API — one process, one port,
  no CORS.
- One shared session controller is used by the dashboard, MCP, the tool gateway and the agent, so a
  session started by a model is visible live in the dashboard.
- The live view is a CDP screencast: frames are sent only when the page repaints; slow clients skip
  frames instead of falling behind.

Project layout:

```
src/
├── core/                   # session lifecycle, controller, emulation, HAR, report, search, saved sessions
├── collectors/             # one module per collector + registry
├── server/                 # NestJS: main.ts, app.ts, app.module.ts, common/ (security, errors, files),
│                           # dashboard/, events/, live/, scraper/, graph/, storage/, ai/
├── scraper/                # in-page picker, list detection, extraction, recipes, CSV / Markdown
├── graph/                  # Neo4j client, session sync, insights
├── storage/                # PostgreSQL schema + read-only SQL, SeaweedFS (S3) client, archive / restore
├── mcp/                    # MCP server (stdio + Streamable HTTP)
├── ai/                     # tools (zod schemas), OpenAI / Anthropic gateway, agent, CLI
├── utils/                  # config, presets, CDP helpers, files, logger
├── bin/collector-cli.ts    # collectors CLI
└── main.ts                 # command-line extraction
web/                        # Next.js dashboard
├── app/                    # pages: /, /scraper, /collectors, /sessions, /graph, /storage, /assistant, /settings
├── views/                  # one component per page
├── components/             # shell, icons, JSON tree, live canvas, query results, request details
└── lib/                    # API client, live store (SSE), i18n, live view (WebSocket), force graph
test/                       # end-to-end tests and fixture site
docs/screenshots/           # images used in this README
Dockerfile, docker-compose.yml
```

---

## Development

```bash
npm start            # build the dashboard, start the server on http://localhost:4000
npm run dev          # server with reload on change (tsx watch)
npm run dev:web      # Next.js dev server on http://localhost:3000 (API proxied to :4000) — run next to npm run dev
npm run typecheck    # TypeScript check (server + dashboard)
npm run build        # server -> dist/, dashboard -> web/out
npm test             # end-to-end tests (headless Chromium against a local fixture site)
npm run clean        # remove dist/, output/ and the dashboard build
```

- **Server** (`src/`, NestJS 12 on Express): runs with `tsx` in development and is compiled by `tsc`
  for production. NestJS 12 is ESM-only; Node.js loads it through `require(esm)`, hence Node 20.19+.
- **Dashboard** (`web/`, Next.js 16 + React 19): `next build web` writes the static export to `web/out`.

The Neo4j and storage test suites run when the services are given and are skipped otherwise:

```bash
NEO4J_TEST_URI=bolt://127.0.0.1:7687 NEO4J_TEST_PASSWORD=… \
STORAGE_TEST_DATABASE_URL=postgres://extractor:…@127.0.0.1:5432/extractor \
STORAGE_TEST_S3_ENDPOINT=http://127.0.0.1:8333 STORAGE_TEST_S3_KEY=… STORAGE_TEST_S3_SECRET=… \
npm test
```

---

## Security

The extractor drives a real browser and reads everything it records, so treat access to it as access
to that data:

- The server answers only for `localhost` host names (DNS-rebinding protection). Allow other names with
  `EXTRACTOR_ALLOWED_HOSTS=host1,host2`.
- Cross-origin browser requests are rejected; state-changing requests must be JSON. JSON bodies are
  limited to 1 MB.
- `EXTRACTOR_API_TOKEN=<secret>` requires `Authorization: Bearer <secret>` on `/mcp` and `/v1/*`.
- Captured scripts, styles and SVGs are served as plain text and saved HTML pages are sandboxed, so
  nothing captured runs on the dashboard's origin.
- Cypher and SQL consoles are read-only (see their sections). Secrets are never returned by the API.
- `extractor_evaluate` runs JavaScript in the inspected page (marked destructive for MCP clients).
- Docker publishes every port on `127.0.0.1` only. Change the default service passwords with `.env`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Executable doesn't exist …chromium…` | Run `npm run setup`, or set `CHROMIUM_PATH` / *Settings → Chromium path* to an installed Chromium. |
| `no display found - enable headless mode` | On a server without a display, switch on *Headless mode* (or set `EXTRACTOR_HEADLESS=1`). |
| Port 4000 is in use | `PORT=5000 npm start`, or change the published port in `docker-compose.yml`. |
| The dashboard shows "The dashboard is not built yet" | Run `npm run build:web` (or use `npm start`, which does it). |
| Chromium crashes on heavy pages in Docker | Keep `shm_size: "1gb"` / `--shm-size=1g`. |
| `Host "…" is not allowed` | Add the host name to `EXTRACTOR_ALLOWED_HOSTS`. |
| Live view stays empty behind a reverse proxy | Forward WebSocket upgrades on `/ws/live` and disable buffering for `/api/events`. |
| Neo4j: "rejected the user name or password" | The password must match `NEO4J_AUTH` of the container (only applied when its volume is first created). |
| SeaweedFS: "internal error" / "no writable volumes" | Start SeaweedFS with `-volume.max=0` (as in the Compose file) so it can create volumes for each bucket. |
| `require() of ES Module` / syntax errors on start | Use Node.js 20.19 or newer. |
| The assistant answers "No model configured" | Set a model on the *AI assistant* page or with `EXTRACTOR_AI_MODEL` / `OPENAI_MODEL`. |

---

## License

MIT
