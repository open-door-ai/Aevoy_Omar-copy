# Aevoy Agent Server — Railway Deployment
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

# Copy full monorepo structure needed for pnpm workspace install
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY packages/agent/package.json packages/agent/package.json

# Install deps - try frozen first, fall back to no-frozen
RUN pnpm install --filter agent... --frozen-lockfile 2>/dev/null || pnpm install --filter agent...

# Copy agent source + config
COPY packages/agent/ packages/agent/

# Build TypeScript
WORKDIR /app/packages/agent
RUN pnpm build

# Create workspaces dir
RUN mkdir -p workspaces && chmod 777 workspaces

ENV NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

CMD ["sh", "-c", "AGENT_PORT=${PORT:-3001} node dist/index.js"]
