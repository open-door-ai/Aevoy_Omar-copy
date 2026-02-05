# Aevoy Agent Server — Railway Deployment
# Build from repo root to get monorepo lockfile
FROM node:20-slim

# System deps for Playwright chromium (optional, falls back to Browserbase)
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

# Copy lockfile + workspace config first for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/agent/package.json packages/agent/package.json

# Install only agent dependencies
RUN pnpm install --filter agent... --frozen-lockfile || pnpm install --filter agent... --no-frozen-lockfile

# Copy agent source
COPY packages/agent/ packages/agent/

# Build TypeScript
RUN pnpm --filter agent build

# Create workspaces dir
RUN mkdir -p packages/agent/workspaces && chmod 777 packages/agent/workspaces

WORKDIR /app/packages/agent

# Railway sets PORT env var; agent reads AGENT_PORT
ENV NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${AGENT_PORT:-3001}/health || exit 1

# Start script maps Railway's PORT to AGENT_PORT
CMD ["sh", "-c", "AGENT_PORT=${PORT:-3001} node dist/index.js"]
