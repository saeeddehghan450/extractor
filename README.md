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
├── server/server.ts        # dashboard HTTP API + live events (SSE), no extra dependencies
├── utils/                  # config, presets, CDP helpers, files, logger
├── bin/collector-cli.ts    # collectors CLI
└── main.ts                 # command-line extraction
web/
├── src/                    # dashboard source (TypeScript, no framework)
│   ├── app.ts, store.ts, api.ts, types.ts, i18n.ts, ...
│   └── views/              # live, collectors, sessions, settings
└── tsconfig.json           # browser build -> public/js
public/                     # index.html, CSS and the compiled dashboard (public/js is generated)
test/                       # end-to-end tests and fixture site
Dockerfile, docker-compose.yml
```

## License

MIT — Saeed Dehghan
