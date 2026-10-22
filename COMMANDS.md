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
Emulation flags:
```bash
--device <name>            # desktop, iphone-15, iphone-15-pro-max, iphone-se, pixel-7, galaxy-s9, ipad, ipad-pro-11, galaxy-tab-s4
--network <preset>         # none, fast-4g, slow-4g, slow-3g, offline
--user-agent "<ua>"
--header "Name: value"     # repeatable
--block <pattern>          # repeatable; plain text = URL contains, * = whole-URL wildcard
--list-devices
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

### Interactive scraper
Dashboard → *Interactive scraper*: open a URL, switch to *Select*, click the data you want, *Extract all pages & save*.
```bash
curl -X POST localhost:4000/api/scraper/run -H 'Content-Type: application/json' \
  -d '{"recipe":{"itemSelector":"li.product","fields":[{"name":"title","selector":"a.title","extract":"text"}],"nextSelector":"a.next","maxPages":5}}'
```

### Knowledge graph (Neo4j)
```bash
docker compose up -d neo4j                      # official neo4j:2026.10.0-community (Browser: http://localhost:7474)
NEO4J_URI=bolt://localhost:7687 NEO4J_PASSWORD=extractor-graph npm start
curl -X POST localhost:4000/api/graph/sync -H 'Content-Type: application/json' -d '{"all":true}'
curl -X POST localhost:4000/api/graph/query -H 'Content-Type: application/json' -d '{"cypher":"MATCH (d:Domain) RETURN d.name LIMIT 10"}'
```

### MCP & AI
```bash
npm run mcp                          # MCP server on stdio
npm run mcp -- --port 8931           # MCP server over HTTP: http://127.0.0.1:8931/mcp
# (the dashboard also serves MCP at http://localhost:4000/mcp)
claude mcp add --transport http devtools-extractor http://localhost:4000/mcp

npm run agent -- --model <model> "Audit https://example.com"                       # OpenAI-compatible
npm run agent -- --base-url http://localhost:11434/v1 --model <model> "…"           # Ollama / local
npm run agent -- --provider anthropic "…"                                          # Claude
curl http://localhost:4000/v1/tools                       # tools, OpenAI format
curl "http://localhost:4000/v1/tools?format=anthropic"    # tools, Anthropic format
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
