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
docker compose up -d --build        # dashboard on http://localhost:4000
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

The dashboard listens on `127.0.0.1` only; it can drive a browser and read the output folder,
so do not expose it on a public interface.

## Development

Requires Node.js 20+. Development runs TypeScript directly with `tsx`; `npm run build` compiles
with TypeScript 7.

```bash
npm run typecheck    # TypeScript check
npm test             # end-to-end tests (real headless Chromium against a local fixture site)
npm run build        # compile to dist/ ; then: npm run start:prod
```

Project layout:

```
src/
├── core/
│   ├── session.ts          # session lifecycle, snapshots, output, remote control
│   ├── sessionStore.ts     # reading saved sessions
│   └── pageScript.ts       # injected script: click tracking, canvas context tracking
├── collectors/             # one module per collector + registry.ts
├── server/server.ts        # dashboard HTTP API + live events (SSE), no extra dependencies
├── utils/                  # config, presets, CDP helpers, files, logger
├── bin/collector-cli.ts    # collectors CLI
└── main.ts                 # command-line extraction
public/                     # dashboard (vanilla JS modules + CSS, no build step)
test/                       # end-to-end tests and fixture site
Dockerfile, docker-compose.yml
```

## License

MIT — Saeed Dehghan
