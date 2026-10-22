## COMMANDS REFERENCE

### Dashboard
```bash
npm start                         # http://localhost:4000
PORT=5000 npm start               # another port
npm run build && npm run start:prod
```

### Extraction without the dashboard
```bash
npm run extract                                  # uses targetUrl from config.json
npm run extract -- --url https://example.com
npm run extract -- --url https://example.com --headless --duration 30
```
While running: `s` = manual snapshot, `q` / Ctrl+C = finish & save. Closing the browser also finishes.

### Collectors
```bash
npm run collectors list              # status of all collectors
npm run collectors status <name>     # one collector
npm run collectors enable <name>
npm run collectors disable <name>
npm run collectors toggle <name>
npm run collectors enable-all
npm run collectors disable-all
npm run collectors presets           # list presets
npm run collectors preset <name>     # minimal | performance | security | dom | full
```

### Collector names
```
network          console          elements         scripts
css              application      security         performance
accessibility    media            webgl            memory
serviceWorker
```

### Docker
```bash
docker compose up -d --build
docker compose logs -f
docker compose run --rm extractor node dist/main.js --url https://example.com --duration 30
docker compose run --rm extractor node dist/bin/collector-cli.js list
docker cp devtools-extractor:/data/output ./output
docker compose down            # add -v to delete the data volume
```

### Development
```bash
npm run setup       # install Chromium for Playwright
npm run typecheck
npm run build:web   # compile the dashboard (web/src -> public/js)
npm run dev:web     # recompile the dashboard on every change
npm test
npm run clean       # remove dist/ and output/
```
