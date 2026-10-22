# Ultimate DevTools Extractor

Extract everything Chrome DevTools can see about a web page — network traffic, console, DOM,
scripts, styles, storage, security, performance, accessibility, media, WebGL, memory and
service workers — and browse the results in a web dashboard.

Built with TypeScript, Playwright and the Chrome DevTools Protocol (CDP).

> **راهنمای سریع (فارسی)**
>
> ```bash
> npm install
> npm run setup      # نصب Chromium برای Playwright (فقط یک بار)
> npm start          # اجرای داشبورد روی http://localhost:4000
> ```
>
> یا با داکر: `docker compose up -d --build` و سپس باز کردن `http://localhost:4000`
>
> برای استخراج داده بدون کدنویسی: در صفحه «اسکرپر تعاملی» سایت را باز کنید، روی تصویر زنده (WebSocket) بخش‌های
> دلخواه را انتخاب کنید (لیست‌های تکراری خودکار تشخیص داده می‌شوند) و خروجی CSV، JSON یا Markdown (md) بگیرید.
>
> برای اتصال مدل‌های هوش مصنوعی: آدرس MCP یعنی `http://localhost:4000/mcp` را در هر کلاینت MCP (Claude، Cursor،
> VS Code، Codex …) وارد کنید، یا از صفحه «دستیار هوش مصنوعی» با هر مدل سازگار با OpenAI (پیش‌فرض) یا Anthropic گفتگو کنید.
>
> در داشبورد آدرس سایت را وارد کنید و «شروع استخراج» را بزنید. با هر کلیک روی صفحه یک اسنپ‌شات کامل
> گرفته می‌شود. در پایان «پایان و ذخیره» را بزنید؛ همه نتایج در پوشه `output/` ذخیره می‌شوند و از بخش
> «نتایج ذخیره‌شده» قابل مشاهده‌اند. رابط کاربری فارسی/انگلیسی و تم تیره/روشن دارد.

## Quick start

```bash
npm install
npm run setup        # downloads Chromium for Playwright (once)
npm start            # dashboard on http://localhost:4000
```

1. Open <http://localhost:4000>.
2. Enter a URL and press **Start extraction**.
   - *Headed* (default): a Chromium window opens; interact with it normally.
   - *Headless*: no window; the page is shown live in the dashboard — click, scroll and type
     on the preview to control it.
3. Every click on the page triggers a full snapshot. Press **Snapshot** for a manual one.
4. Press **Finish & save** (or close the browser window). Results appear under **Saved results**.

## Docker

The image is based on the official Playwright image (Node.js + Chromium + system libraries),
runs as a non-root user and forces headless mode (a container has no display).

```bash
docker compose up -d --build        # dashboard on http://localhost:4000 + Neo4j, PostgreSQL, SeaweedFS
docker compose logs -f
docker compose down                  # keep data;  add -v to delete the data volume
```

Without compose:

```bash
docker build -t devtools-extractor .
docker run -d --name extractor --init --shm-size=1g \
  -p 127.0.0.1:4000:4000 -v extractor-data:/data devtools-extractor
```

Command line inside the container:

```bash
docker compose run --rm extractor node dist/main.js --url https://example.com --duration 30
docker compose run --rm extractor node dist/bin/collector-cli.js preset security
```

Config and results live in the `/data` volume (`/data/config.json`, `/data/output/`). Download
results from the dashboard, or copy them out:

```bash
docker cp devtools-extractor:/data/output ./output
```

Notes:
- `--shm-size=1g` (or `shm_size` in compose) prevents Chromium crashes on heavy pages.
- The port is published on `127.0.0.1` only; put an authenticating reverse proxy in front if
  you need remote access.
- When you upgrade `playwright` in `package.json`, change `PLAYWRIGHT_VERSION` in the
  `Dockerfile` to the same version.
- Compose also starts the official `neo4j:2026.10.0-community` (see *Knowledge graph*), `postgres:18.6` and
  `chrislusf/seaweedfs:4.48` images (see *Long-term storage*). Replace the default passwords with a `.env` file:
  `NEO4J_PASSWORD`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

## Emulation, exports and search

**Device & network emulation** — under *Advanced* on the start screen (or `--device`, `--network`
on the command line):

| Option | Values |
|--------|--------|
| Device | Desktop, iPhone 15, iPhone 15 Pro Max, iPhone SE, Pixel 7, Galaxy S9+, iPad (gen 7), iPad Pro 11, Galaxy Tab S4 (viewport, touch, pixel ratio and User-Agent) |
| Network | No throttling, Fast 4G, Slow 4G, Slow 3G, Offline (same values as Chrome DevTools) |
| User-Agent | any string, overrides the device's |
| Extra headers | e.g. `Authorization: Bearer …` — sent with every request |
| Block URLs | one pattern per line: plain text = "URL contains", with `*` = whole-URL pattern (`*.png`, `https://*/ads/*`). Blocked requests are recorded as failed (`ERR_BLOCKED_BY_CLIENT`) |

The options are remembered in `config.json` (`emulation`) for the next session.

**Exports** — written when a session finishes:

- `network/network.har` — HAR 1.2 with full response bodies; import it in Chrome DevTools
  (Network → *Import HAR*), Firefox, Charles, Fiddler, Insomnia… A live HAR of a running session
  can be downloaded from the dashboard at any time.
- `report.html` — a single self-contained report (summary, findings, embedded screenshots,
  console errors, failed requests, request list) to share or print. The dashboard generates it
  on demand in Persian or English.

**Search** — the *Search* tab of a saved session searches request URLs, request/response
headers, post data, response bodies, console messages, cookies, local/session storage and the
downloaded JS/CSS sources. Plain text or regex, optionally case-sensitive; useful for finding
API keys, tokens or where a value comes from.

## Interactive scraper

Open a site, pick the parts you want on a live picture of the page and get their data as a table —
no code and no selectors to write.

1. **Interactive scraper** page → enter a URL → *Open site*. The page is streamed live over a
   **WebSocket** (`/ws/live`, Chrome screencast: frames are sent only when the page repaints) and you can
   use it like a browser (*Browse* mode: click, scroll, type).
2. Switch to **Select** mode: the element under the cursor is outlined. Click it to add it as a column.
3. If it repeats on the page (products, articles, table rows, cards…) you are asked whether to extract
   **every item of the list** — the list is detected automatically. Then click other parts of one item
   (price, image, link…) to add more columns; selectors are made relative to the item, so every row lines
   up even when some items lack a field.
4. Optional: *Pick on page* the "next page" button and set the number of pages.
5. **Extract all pages & save** → table preview and three files in the session folder, downloadable from
   the page: `scrapes/<name>-<time>.csv` (UTF-8 with BOM, opens in Excel), `.json` and `.md` (a Markdown
   table with the source URL, row and page count — ready for GitHub, notes or an LLM prompt).

Every column can be edited: name, what to take (text, link, image/source, attribute, HTML, form value) and
its CSS selector. Matches are highlighted on the live view in the column's colour. Save the set of columns
as a **recipe** to run it again later — from the page, or from an AI model through MCP
(`extractor_run_recipe`, also `extractor_scrape` for ad-hoc extraction; pass `"output": "markdown"` to get the
rows back as a Markdown table, which is shorter than JSON). Recipes live in `output/recipes/`.

HTTP API: `POST /api/scraper/preview`, `POST /api/scraper/run`, `POST /api/scraper/count`,
`GET|POST /api/scraper/recipes`, `DELETE /api/scraper/recipes/{name}`.

The *Live session* page uses the same WebSocket view.

## Knowledge graph (Neo4j)

Every session can be written into [Neo4j](https://neo4j.com) (official Docker image and the official
`neo4j-driver`), so you — and the AI agent — can ask questions that span requests, domains, pages, scripts,
cookies, console messages, clicks and scraped records, across one session or all of them.

```bash
docker compose up -d                 # starts neo4j:2026.10.0-community next to the dashboard
# or on its own:
docker run -d --name neo4j -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
  -e NEO4J_AUTH=neo4j/change-me -v neo4j-data:/data neo4j:2026.10.0-community
```

Connect it on the dashboard's **Knowledge graph** page (URI, user, password — stored in `config.json`,
never sent back to the browser) or with `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` / `NEO4J_DATABASE`.
With auto-sync on (default) a session is synced when it finishes and after every saved scrape; *Sync all
sessions* imports older ones. Syncing is idempotent: a session's previous data is replaced.

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

The page has a read-only Cypher console (table view and an interactive graph view), eleven ready-made
insights (third-party and shared domains, failing and slow requests, error hotspots, cookie flags, missing
security headers, scripts by domain, scraped records, click paths) and an *Ask the assistant* box. Session
pages have *Analyse with AI* and *Send to graph* buttons.

The agent and every MCP client get four tools: `extractor_graph_schema`, `extractor_graph_query` (read-only
Cypher), `extractor_graph_insight` and `extractor_graph_sync`. Queries run in read transactions, so the
database rejects writes; `LOAD CSV` and `dbms.*` / `apoc.*` / `gds.*` procedures are refused as well.

```bash
curl localhost:4000/api/graph/status
curl -X POST localhost:4000/api/graph/query -H 'Content-Type: application/json' \
  -d '{"cypher":"MATCH (s:Session)-[c:CONTACTED]->(d:Domain) WHERE c.thirdParty RETURN d.name, sum(c.requests) AS n ORDER BY n DESC"}'
curl -X POST localhost:4000/api/graph/insights -H 'Content-Type: application/json' -d '{"id":"shared-domains"}'
```

## Long-term storage (PostgreSQL + SeaweedFS)

Finished sessions are archived so the data is kept independently of the local output folder:

- **SeaweedFS** (official `chrislusf/seaweedfs` image, through its S3 gateway with the official AWS SDK) stores
  every file of a session — screenshots, response bodies, sources, HAR, report, scrapes — as
  `<bucket>/sessions/<sessionId>/<path>`. Unchanged files are not uploaded again.
- **PostgreSQL** (official `postgres` image and the `pg` client) stores the structured data in the `extractor`
  schema: `sessions`, `requests` (with headers), `console_messages`, `cookies`, `security_headers`, `scrapes`,
  `scrape_records` (one `jsonb` row per scraped item) and `files` (the index of the stored files).

```bash
docker compose up -d                 # starts postgres:18.6 and chrislusf/seaweedfs:4.48 next to the dashboard
# or on their own:
docker run -d --name postgres -p 127.0.0.1:5432:5432 -e POSTGRES_USER=extractor -e POSTGRES_PASSWORD=change-me \
  -v pg-data:/var/lib/postgresql postgres:18.6
docker run -d --name seaweedfs -p 127.0.0.1:8333:8333 -e AWS_ACCESS_KEY_ID=extractor -e AWS_SECRET_ACCESS_KEY=change-me \
  -v sw-data:/data chrislusf/seaweedfs:4.48 server -dir=/data -s3 -volume.max=0
```

Connect them on the dashboard's **Data storage** page or with `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (default `extractor`). Either one can be used alone. With auto-archive on
(default) a session is archived when it finishes; *Archive all sessions* stores older ones.

The page lists archived sessions with *Restore* (download back into the output folder), *Remove local copy*
(only after every file is verified in SeaweedFS; files are then served from SeaweedFS) and removal from the
archive, plus a read-only SQL console with examples and an *Ask the assistant* box. Session pages get an
*Archive* button.

AI / MCP tools: `extractor_storage_status` (status + SQL schema), `extractor_sql_query`, `extractor_archive_session`,
`extractor_list_archived`, `extractor_restore_session`. SQL is limited to one `SELECT` / `WITH` / `EXPLAIN` statement
in a read-only transaction under a role that can only read the `extractor` schema; functions that read server
files, run dynamic SQL or change settings are refused.

```bash
curl -X POST localhost:4000/api/storage/sql -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT host, count(*) FROM requests GROUP BY host ORDER BY 2 DESC"}'
curl -X POST localhost:4000/api/storage/archive -H 'Content-Type: application/json' -d '{"all":true}'
```

## MCP server & AI models

The extractor is also an **MCP server** (Model Context Protocol), so any MCP client or model can drive the
browser and read the results — the same idea as [Playwright MCP](https://github.com/microsoft/playwright-mcp),
with the full DevTools data on top. Apps that call a model API directly can use the same tools through an
**OpenAI-compatible** (default) or **Anthropic** tool API, and a **built-in agent** connects any model for you.

```
MCP clients (Claude, Cursor, VS Code, Codex…)  ── stdio  or  http://localhost:4000/mcp ─┐
Apps using OpenAI-compatible APIs               ── /v1/tools  (+ /v1/tools/call)         ├─ 23 extractor_* tools ─ one shared session ─ Chromium
Apps using the Anthropic API                    ── /v1/tools?format=anthropic            │
Built-in agent (dashboard page / npm run agent) ─────────────────────────────────────────┘
```

### Connect an MCP client

**Streamable HTTP** — while the dashboard runs (`npm start` or Docker), the MCP endpoint is
`http://localhost:4000/mcp`. Standard config:

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
| Claude Desktop, Cursor, Windsurf, Cline, LM Studio | standard config above (HTTP or stdio) |
| VS Code (`.vscode/mcp.json`) | `{"servers": {"devtools-extractor": {"type": "http", "url": "http://localhost:4000/mcp"}}}` |
| Codex (`~/.codex/config.toml`) | `[mcp_servers.devtools-extractor]` + `url = "http://localhost:4000/mcp"` (or `command`/`args` for stdio) |
| Docker (stdio) | `"command": "docker", "args": ["run", "-i", "--rm", "--init", "--shm-size=1g", "-v", "extractor-data:/data", "devtools-extractor", "node", "dist/mcp/main.js"]` |

A standalone MCP server without the dashboard: `npm run mcp` (stdio) or `npm run mcp -- --port 8931`
(HTTP at `http://127.0.0.1:8931/mcp`). The dashboard's *AI assistant → MCP & API connection* page shows
ready-to-copy configs for your address. The server also offers an `audit-website` prompt.

Hosted model APIs can use the MCP endpoint directly when it is reachable from the internet (put it behind
HTTPS and set `EXTRACTOR_API_TOKEN`): the OpenAI Responses API through a `{"type": "mcp", "server_url": …}`
tool, and the Claude API through its MCP connector (`mcp_servers` + an `mcp_toolset` tool, beta
`mcp-client-2025-11-20`).

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
| `extractor_scrape` | Scrape data | `itemSelector`, `fields`, `nextSelector`, `maxPages`, `name`, `maxRows` |  |
| `extractor_list_recipes` | List scraping recipes | — | ✓ |
| `extractor_run_recipe` | Run scraping recipe | `name`, `url`, `maxPages`, `maxRows` |  |
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
without a vision model. Every click is recorded with a full DevTools snapshot. Data tools work on the running
session or on any saved session (`sessionId`). Arguments are validated; mistakes come back as tool errors
the model can read and fix.

### Tool API for OpenAI-compatible and Anthropic apps

For code that calls a model directly instead of through MCP (served by the dashboard server):

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

Screenshots: Anthropic tool results carry the image; for OpenAI (whose tool messages are text-only) an extra
user message with the image follows the tool messages.

### Built-in agent (any model)

The dashboard's **AI assistant** page and `npm run agent` let a model drive the extractor directly. The
default provider is **OpenAI-compatible** — OpenAI, Azure OpenAI, OpenRouter, Groq, DeepSeek, Together, or
local servers such as Ollama, vLLM, LM Studio and llama.cpp; `--provider anthropic` uses the Claude API.

```bash
# OpenAI
OPENAI_API_KEY=sk-… npm run agent -- --model <model> "Audit https://example.com"
# Ollama / LM Studio / vLLM (no key needed)
npm run agent -- --base-url http://localhost:11434/v1 --model <model> "Check https://example.com for console errors"
# Anthropic (default model claude-opus-5-5)
ANTHROPIC_API_KEY=… npm run agent -- --provider anthropic "Find API keys in the last session"
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

With Anthropic on the Claude API, Claude 5-family models run with `effort: high` (tool-heavy work) and the
server-side refusal fallback (`fallbacks: "default"`) is enabled; turn it off with `--no-fallbacks`. In the
dashboard the API key can also be entered on the page (kept in the browser only if you choose to).

### Security

The extractor drives a real browser and reads everything it records, so treat access to it as access to
that data:

- The server answers only for `localhost` host names (DNS-rebinding protection). Allow other names with
  `EXTRACTOR_ALLOWED_HOSTS=host1,host2` (`*` disables the check).
- `EXTRACTOR_API_TOKEN=<secret>` requires `Authorization: Bearer <secret>` on `/mcp` and `/v1/*`.
- Cross-origin browser requests are rejected; the Docker port is published on `127.0.0.1` only.
- `extractor_evaluate` runs JavaScript in the inspected page (it is marked destructive for MCP clients).

## Dashboard

| Page | What it does |
|------|--------------|
| **Live session** | Start a session, live browser preview with remote control, live network table and request inspector, console, server log, clicks/snapshots timeline, live counters |
| **Collectors** | Enable/disable each of the 13 collectors or apply a preset |
| **Saved results** | All past sessions: overview with insights (security headers, Web Vitals, a11y issues, storage…), snapshot gallery with screenshots, network & console explorer, JSON tree viewer for every module, file browser and downloads |
| **Settings** | Default URL, headless, viewport, slow-mo, trace duration, custom Chromium path |

The UI is available in Persian (RTL) and English, with dark and light themes.

## Collectors

| Collector | Kind | Collects |
|-----------|------|----------|
| `network` | stream | Every request/response of every tab: headers, post data, body (large bodies saved to disk), status, size, duration, remote address, TLS details |
| `console` | stream | Console messages, uncaught errors, dialogs (dialogs are dismissed automatically) |
| `elements` | snapshot | Page overview (title, node counts, forms, headings, meta, iframes) and, for clicks: outerHTML, computed style, matched CSS rules, box model and real event listeners of the element and its ancestors |
| `scripts` | snapshot | Downloads every external script once, saves inline scripts, detects `sourceMappingURL` |
| `css` | snapshot | Downloads stylesheets, saves inline styles, stylesheet summary, CSS custom properties |
| `application` | snapshot | Cookies (incl. HttpOnly), localStorage, sessionStorage, IndexedDB databases & stores, Cache Storage |
| `security` | snapshot | Secure context, TLS certificate, present/missing security headers, mixed content, cookies with weak flags |
| `performance` | snapshot | CDP metrics, navigation timing, FCP, LCP, CLS, long tasks, resource summary; a DevTools trace on manual/final snapshots |
| `accessibility` | snapshot | Full AX tree (saved to disk), role counts, elements without an accessible name |
| `media` | snapshot | Audio/video playback state and quality |
| `webgl` | snapshot | Context type of every canvas (tracked without touching the page), extensions, GPU info |
| `memory` | snapshot | Heap usage and DOM counters; a full `.heapsnapshot` on manual/final snapshots |
| `serviceWorker` | snapshot | Registrations, controller, running workers |

*Stream* collectors record for the whole session; *snapshot* collectors run on every snapshot.
The trace (`performance/trace-N.json`) and heap snapshot (`memory/heap-N.heapsnapshot`) can be
loaded in Chrome DevTools (Performance → *Load profile*, Memory → *Load*).

## Output

Each session gets its own folder:

```
output/<date>-<time>-<host>-<id>/
├── session.json            # manifest: status, counts, snapshots
├── analysis.json           # everything combined
├── network/network.json    # one folder per enabled collector
├── console/console.json
├── elements/elements.json
├── ...
├── report.html             # standalone HTML report
├── network/network.har     # HAR export
├── snapshots/
│   ├── 001-click/          # snapshot.json, screenshot.png, page.html
│   ├── 002-manual/
│   └── 003-final/
├── responses/              # large response bodies
├── sources/                # downloaded JS/CSS and inline code
├── performance/trace-3.json
├── accessibility/ax-tree-3.json
└── memory/heap-3.heapsnapshot
```

Page-state collectors in `analysis.json` / `<collector>/<collector>.json` contain the data of
the latest snapshot; every individual snapshot is kept in `snapshots/`.

## Command line

```bash
# extract without the dashboard (keys: s = snapshot, q = finish)
npm run extract -- --url https://example.com
npm run extract -- --url https://example.com --headless --duration 30
npm run extract -- --url https://example.com --device iphone-15 --network slow-3g \
  --header "Authorization: Bearer TOKEN" --block google-analytics --block "*.mp4"
npm run extract -- --list-devices                # device and network preset names

# manage collectors
npm run collectors list
npm run collectors enable network
npm run collectors disable memory
npm run collectors toggle performance
npm run collectors enable-all
npm run collectors presets
npm run collectors preset security      # minimal | performance | security | dom | full
```

See [COMMANDS.md](COMMANDS.md) for the full reference.

## Configuration

`config.json` (editable from the dashboard too):

```json
{
  "targetUrl": "https://example.com",
  "headless": false,
  "slowMo": 0,
  "viewport": { "width": 1280, "height": 800 },
  "performanceTraceMs": 3000,
  "port": 4000,
  "executablePath": "/optional/path/to/chromium",
  "collectors": { "network": { "enabled": true, "description": "..." } }
}
```

Environment variables:

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | Dashboard address (default `127.0.0.1:4000`) |
| `TARGET_URL` | Default URL for `npm run extract` |
| `CHROMIUM_PATH` | Use a specific Chromium binary |
| `EXTRACTOR_CONFIG` | Path of the config file (default `config.json`) |
| `EXTRACTOR_OUTPUT` | Output folder (default `output`) |
| `EXTRACTOR_HEADLESS=1` | Force headless mode (set in the Docker image) |
| `DEBUG=1` | Print debug logs |
| `EXTRACTOR_API_TOKEN` | Bearer token required on `/mcp` and `/v1/*` |
| `EXTRACTOR_ALLOWED_HOSTS` | Extra host names the server answers for (DNS-rebinding protection) |
| `EXTRACTOR_AI_*`, `OPENAI_*`, `ANTHROPIC_*` | Agent settings, see *Built-in agent* |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | Knowledge graph connection (overrides the dashboard settings) |
| `NEO4J_AUTO_SYNC=0` | Do not sync sessions automatically |
| `DATABASE_URL` | PostgreSQL archive, e.g. `postgres://extractor:pw@localhost:5432/extractor` |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION` | SeaweedFS (or any S3 store) for session files |
| `STORAGE_AUTO_ARCHIVE=0` | Do not archive sessions automatically |

The dashboard listens on `127.0.0.1` only; it can drive a browser and read the output folder,
so do not expose it on a public interface.

## Development

Requires Node.js 20+. The whole project is TypeScript: the server runs directly with `tsx` in
development, and the dashboard (`web/src`) is compiled by `tsc` to `public/js` — `npm start` does
that automatically. Use `npm run dev:web` to recompile the dashboard on every change.

```bash
npm run typecheck    # TypeScript check (server + dashboard)
npm run dev:web      # recompile the dashboard on change (run next to npm start)
npm test             # end-to-end tests (real headless Chromium against a local fixture site)
# Neo4j tests run when a server is given:
NEO4J_TEST_URI=bolt://127.0.0.1:7687 NEO4J_TEST_PASSWORD=… npm test
# storage tests run when PostgreSQL and SeaweedFS are given:
STORAGE_TEST_DATABASE_URL=postgres://… STORAGE_TEST_S3_ENDPOINT=http://127.0.0.1:8333 \
  STORAGE_TEST_S3_KEY=… STORAGE_TEST_S3_SECRET=… npm test
npm run build        # server -> dist/, dashboard -> public/js ; then: npm run start:prod
```

Project layout:

```
src/
├── core/
│   ├── session.ts          # session lifecycle, snapshots, output, remote control
│   ├── sessionStore.ts     # reading saved sessions
│   ├── emulation.ts        # devices, throttling, UA / headers, URL blocking
│   ├── har.ts              # HAR 1.2 export
│   ├── report.ts           # standalone HTML report
│   ├── search.ts           # full-text search inside a session
│   └── pageScript.ts       # injected script: click tracking, canvas context tracking
├── collectors/             # one module per collector + registry.ts
├── server/
│   ├── server.ts           # dashboard HTTP API + live events (SSE)
│   ├── aiRoutes.ts         # /mcp, /v1/tools gateway, /api/agent
│   ├── liveSocket.ts       # /ws/live: screencast frames + input over WebSocket
│   ├── scraperRoutes.ts    # /api/scraper/*
│   ├── graphRoutes.ts      # /api/graph/*
│   └── storageRoutes.ts    # /api/storage/*
├── graph/                  # Neo4j: connection + read-only queries, session sync, insights
├── storage/                # PostgreSQL + SeaweedFS (S3): settings, schema, read-only SQL, archive / restore
├── mcp/                    # MCP server (stdio + Streamable HTTP)
├── scraper/                # interactive scraper: in-page picker, lists, extraction, recipes
├── ai/
│   ├── tools.ts            # the 32 tools (zod schemas), shared by MCP, gateway and agent
│   ├── gateway.ts          # OpenAI / Anthropic tool formats
│   ├── agent.ts            # agent loop: OpenAI-compatible + Anthropic
│   └── cli.ts              # npm run agent
├── utils/                  # config, presets, CDP helpers, files, logger
├── bin/collector-cli.ts    # collectors CLI
└── main.ts                 # command-line extraction
web/
├── src/                    # dashboard source (TypeScript, no framework)
│   ├── app.ts, store.ts, api.ts, types.ts, i18n.ts, ...
│   └── views/              # live, scraper, collectors, sessions, graph, storage, assistant, settings
└── tsconfig.json           # browser build -> public/js
public/                     # index.html, CSS and the compiled dashboard (public/js is generated)
test/                       # end-to-end tests and fixture site
Dockerfile, docker-compose.yml
```

## License

MIT — Saeed Dehghan
