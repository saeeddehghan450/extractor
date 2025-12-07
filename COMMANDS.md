## COLLECTOR COMMANDS REFERENCE

### View Status
```bash
npm run collectors list              # See all collectors and their status
npm run collectors status <name>     # Check single collector
```

### Enable/Disable
```bash
npm run collectors enable <name>     # Turn on a collector
npm run collectors disable <name>    # Turn off a collector
npm run collectors toggle <name>     # Switch on/off
npm run collectors enable-all        # Turn on all collectors
npm run collectors disable-all       # Turn off all collectors
```

### Collector Names
```
network          console          elements         scripts
css              application      security         performance
accessibility   media            webgl            memory
serviceWorker
```

### Example Commands
```bash
# Enable just network and console
npm run collectors disable-all
npm run collectors enable network
npm run collectors enable console

# Enable performance analysis
npm run collectors disable-all
npm run collectors enable performance
npm run collectors enable memory
npm run collectors enable media

# Toggle one collector
npm run collectors toggle network

# Check specific collector
npm run collectors status security

# Enable everything
npm run collectors enable-all
```

### Start Extraction
```bash
npm start                           # Start with configured collectors
TARGET_URL=https://example.com npm start  # Override target URL
```

### Output Location
```
output/
├── network/              # HTTP requests/responses
├── console/              # Logs and errors
├── elements/             # DOM elements
├── scripts/              # JavaScript files
├── css/                  # Stylesheets
├── application/          # Storage data
├── security/             # Security info
├── performance/          # Metrics
├── accessibility/        # A11y tree
├── media/                # Audio/video
├── webgl/                # Canvas
├── memory/               # Heap
├── serviceWorker/        # Service workers
└── analysis-*.json       # Combined analysis
```

### Configuration File
Edit `config.json` to change:
- `targetUrl`: Website to analyze
- `headless`: Run in headless mode
- `slowMo`: Delay between actions (ms)
- `collectors`: Enable/disable each module

### Quick Presets
```bash
# Minimal
npm run collectors disable-all
npm run collectors enable network
npm run collectors enable console

# Performance focused
npm run collectors disable-all
npm run collectors enable performance
npm run collectors enable media
npm run collectors enable memory
npm run collectors enable network

# Security focused
npm run collectors disable-all
npm run collectors enable security
npm run collectors enable application
npm run collectors enable network

# DOM focused
npm run collectors disable-all
npm run collectors enable elements
npm run collectors enable css
npm run collectors enable scripts
npm run collectors enable accessibility

# Everything
npm run collectors enable-all
```

---
For more info: `node QUICK_START.js`
