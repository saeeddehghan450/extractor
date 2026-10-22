# syntax=docker/dockerfile:1

# The Playwright image ships Node.js, Chromium and every system library it needs.
# Keep PLAYWRIGHT_VERSION equal to the "playwright" version in package-lock.json.
ARG PLAYWRIGHT_VERSION=1.64.1

# ---------------------------------------------------------------------------
# build: compile TypeScript, then drop dev dependencies
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    EXTRACTOR_HEADLESS=1 \
    EXTRACTOR_CONFIG=/data/config.json \
    EXTRACTOR_OUTPUT=/data/output

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public

# /data holds config.json and every session's output (mount a volume there)
RUN mkdir -p /data/output && chown -R pwuser:pwuser /data
VOLUME ["/data"]

USER pwuser
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/meta').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/server.js"]
