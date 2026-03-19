# Aevoy Agent Server — Railway Deployment
FROM node:20-slim

# System deps for Playwright chromium + Windows font fingerprint bypass
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    wget ca-certificates \
    fonts-liberation fonts-liberation2 fonts-noto-core \
    fontconfig \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install MS Core Fonts (Arial, Times New Roman, Verdana, Courier New, etc.)
# Pre-accept EULA to avoid interactive prompt
RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula boolean true" | debconf-set-selections \
    && apt-get update && apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/* \
    || (echo "MS fonts failed - using Liberation fonts only" && fc-cache -fv)

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

# Install REAL Google Chrome — its TLS fingerprint (JA3/JA4) matches real users.
# Chromium's TLS fingerprint is different and gets flagged by Cloudflare/DataDome.
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/* \
    || echo "Chrome install failed — will use Chromium"

# Also install patchright Chromium as fallback
RUN npx patchright install chromium 2>/dev/null || npx playwright install chromium 2>/dev/null || true

# Create workspaces dir
RUN mkdir -p workspaces && chmod 777 workspaces

ENV NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

# Xvfb virtual display — Chrome runs headful (anti-bot detects headless mode)
ENV DISPLAY=:99
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & sleep 1 && AGENT_PORT=${PORT:-3001} node --max-old-space-size=4096 dist/index.js"]
