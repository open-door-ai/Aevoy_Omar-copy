# Aevoy V2 — Production Deployment Guide

Last updated: 2026-02-04

## Architecture Overview

```
Users (Email / SMS / Voice / Web)
         |
    +---------+-----------+-----------+
    |         |           |           |
Cloudflare  Twilio    Vercel      Browser
Email       Voice     Next.js     (Browserbase)
Worker      + SMS     Web App
    |         |           |
    +---------+-----------+
              |
    Hetzner VPS (agent.aevoy.com)
    Express + Playwright + AI
              |
    +---------+---------+
    |                   |
 Supabase           AI APIs
 (PostgreSQL)    (DeepSeek, Claude,
                  Gemini, Kimi K2)
```

## Prerequisites

- Domain: `aevoy.com` on Cloudflare
- Supabase project (PostgreSQL + Auth)
- Twilio account with phone number
- Resend account (email sending)
- Browserbase account (cloud browser)
- AI API keys: DeepSeek, Anthropic, Google, Kimi
- Hetzner VPS (Ubuntu 22.04, 4GB+ RAM, ~7 EUR/mo)
- Vercel account (free tier works)

---

## Step 1: Run Database Migrations

Go to **Supabase Dashboard > SQL Editor** and run these in order:

```sql
-- Run each file's contents in sequence:
-- 1. apps/web/supabase/migration.sql       (base schema)
-- 2. apps/web/supabase/migration_v2.sql     (V2 updates)
-- 3. apps/web/supabase/migration_v3.sql     (action_history, transactions, prepaid_cards)
-- 4. apps/web/supabase/migration_v4.sql     (user_sessions, checkpoint_data, RLS fixes)
-- 5. apps/web/supabase/migration_v5.sql     (hive mind tables)
-- 6. apps/web/supabase/migration_v6.sql     (onboarding, user_settings, agent_cards)
```

Verify tables exist:
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- Should include: profiles, tasks, user_memory, user_credentials,
-- failure_memory, usage, scheduled_tasks, action_history,
-- transactions, prepaid_cards, user_sessions, user_settings, agent_cards
```

---

## Step 2: Deploy Agent Server (Hetzner VPS)

### 2a. Provision Server

```bash
# Hetzner Cloud: Create CX21 (2 vCPU, 4GB RAM, 40GB SSD)
# OS: Ubuntu 22.04
# Location: Nuremberg or similar
# SSH key: Add your public key
```

### 2b. Server Setup

```bash
# SSH into server
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2

# Install Playwright dependencies
npx playwright install-deps
npx playwright install chromium

# Install nginx
apt install -y nginx certbot python3-certbot-nginx

# Create app directory
mkdir -p /opt/aevoy
cd /opt/aevoy
```

### 2c. Deploy Code

```bash
cd /opt/aevoy
git clone https://github.com/YOUR_REPO/Aevoy.git .
pnpm install

# Create .env with production values
cp .env.example .env
nano .env  # Edit with production values (see Environment section below)

# Build agent
pnpm --filter agent build

# Start with PM2
pm2 start packages/agent/dist/index.js --name aevoy-agent
pm2 save
pm2 startup  # Auto-restart on reboot
```

### 2d. Nginx + SSL

```nginx
# /etc/nginx/sites-available/aevoy-agent
server {
    listen 80;
    server_name agent.aevoy.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/aevoy-agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# SSL certificate
certbot --nginx -d agent.aevoy.com
```

### 2e. DNS

Add A record: `agent.aevoy.com` → VPS IP address

### 2f. Verify

```bash
curl https://agent.aevoy.com/health
# Should return: {"status":"ok","uptime":...}
```

---

## Step 3: Deploy Web App (Vercel)

### 3a. Connect Repository

1. Go to vercel.com → New Project
2. Import your GitHub repo
3. Set root directory: `apps/web`
4. Framework: Next.js (auto-detected)

### 3b. Environment Variables (Vercel Dashboard)

Set these in Vercel > Project > Settings > Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
AGENT_URL=https://agent.aevoy.com
AGENT_WEBHOOK_SECRET=xxx
DEEPSEEK_API_KEY=xxx
GOOGLE_API_KEY=xxx
RESEND_API_KEY=xxx
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+17789008951
ENCRYPTION_KEY=xxx
ADMIN_USER_IDS=xxx
```

### 3c. Deploy

```bash
# Or push to main branch — Vercel auto-deploys
cd apps/web && vercel --prod
```

### 3d. Custom Domain

In Vercel > Project > Domains: Add `aevoy.com` and `www.aevoy.com`

---

## Step 4: Deploy Email Worker (Cloudflare)

### 4a. Deploy Worker

```bash
cd workers/email-router

# Set secrets (these are NOT in wrangler.toml)
wrangler secret put AGENT_WEBHOOK_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY

# Deploy
npx wrangler deploy
```

### 4b. Enable Email Routing

1. Cloudflare Dashboard → aevoy.com → Email → Email Routing
2. Enable Email Routing
3. Add catch-all rule: `*@aevoy.com` → Route to Worker → `aevoy-email-router`

### 4c. Verify

Send a test email to `test@aevoy.com` — check Cloudflare Worker logs for activity.

---

## Step 5: Configure Twilio Webhooks

### 5a. Phone Number Configuration

1. Go to Twilio Console → Phone Numbers → +17789008951
2. Set webhook URLs:
   - **Voice & Fax > A CALL COMES IN**: `https://agent.aevoy.com/webhook/voice/DEFAULT`
   - **Messaging > A MESSAGE COMES IN**: `https://agent.aevoy.com/webhook/sms/DEFAULT`
3. Method: HTTP POST for both

Note: For per-user webhooks, the phone provisioning API sets specific URLs:
- Voice: `https://agent.aevoy.com/webhook/voice/{userId}`
- SMS: `https://agent.aevoy.com/webhook/sms/{userId}`

### 5b. Test

```bash
# Send SMS to +17789008951
# Call +17789008951
# Check agent server logs: pm2 logs aevoy-agent
```

---

## Step 6: Post-Deployment Verification

### Checklist

```
[ ] Agent health: curl https://agent.aevoy.com/health
[ ] Web app loads: https://aevoy.com
[ ] Sign up works: https://aevoy.com/signup
[ ] Login works: https://aevoy.com/login
[ ] Dashboard loads (after login)
[ ] Onboarding flow (5 steps)
[ ] Send test email to username@aevoy.com
[ ] Agent processes task and responds
[ ] SMS test: text +17789008951
[ ] Voice test: call +17789008951
[ ] Demo: /api/demo/task returns AI response
[ ] Settings page loads with phone/card options
[ ] Hive mind page loads: /hive
```

### Set ADMIN_USER_IDS

After your first signup:
1. Go to Supabase Dashboard → Authentication → Users
2. Copy your user UUID
3. Add to `.env`: `ADMIN_USER_IDS=your-uuid-here`
4. Restart agent: `pm2 restart aevoy-agent`

---

## Environment Variables Reference

### Agent Server (.env on VPS)

```bash
# Required
ENCRYPTION_KEY=xxx                    # 32-byte hex
AGENT_WEBHOOK_SECRET=xxx              # Random secret
NEXT_PUBLIC_SUPABASE_URL=xxx          # Supabase URL
SUPABASE_SERVICE_ROLE_KEY=xxx         # Supabase admin key
DEEPSEEK_API_KEY=xxx                  # Primary AI
ANTHROPIC_API_KEY=xxx                 # Complex reasoning
GOOGLE_API_KEY=xxx                    # Vision/validation
RESEND_API_KEY=xxx                    # Email sending
TWILIO_ACCOUNT_SID=xxx               # Voice/SMS
TWILIO_AUTH_TOKEN=xxx                 # Voice/SMS
TWILIO_PHONE_NUMBER=+17789008951     # From number

# Production values
AGENT_PORT=3001
AGENT_URL=https://agent.aevoy.com
NODE_ENV=production
TEST_MODE=false
SKIP_PAYMENT_CHECKS=false
ALLOWED_ORIGINS=https://aevoy.com,https://www.aevoy.com

# Optional
KIMI_API_KEY=xxx                      # Agentic tasks
BROWSERBASE_API_KEY=xxx               # Cloud browser
BROWSERBASE_PROJECT_ID=xxx            # Cloud browser
OLLAMA_HOST=http://localhost:11434    # Local AI fallback
```

---

## Monitoring & Logs

```bash
# Agent server logs
pm2 logs aevoy-agent

# Real-time monitoring
pm2 monit

# Cloudflare Worker logs
wrangler tail --name aevoy-email-router

# Vercel logs
vercel logs --follow
```

---

## Updating

```bash
# On VPS
cd /opt/aevoy
git pull
pnpm install
pnpm --filter agent build
pm2 restart aevoy-agent

# On Vercel — auto-deploys on push to main

# Cloudflare Worker
cd workers/email-router
npx wrangler deploy
```

---

## Cost Estimates (Monthly)

| Service | Cost | Notes |
|---------|------|-------|
| Hetzner VPS (CX21) | ~7 EUR | 2 vCPU, 4GB RAM |
| Vercel | $0 | Free tier (hobby) |
| Supabase | $0 | Free tier (500MB) |
| Cloudflare | $0 | Free tier (email routing + workers) |
| Resend | $0 | Free tier (100 emails/day) |
| Twilio Phone | ~$1/mo | Per phone number |
| Twilio Voice | ~$0.013/min | Outbound calls |
| Twilio SMS | ~$0.0079/msg | Outbound SMS |
| DeepSeek API | ~$0.25/1M tokens | Primary AI |
| Browserbase | TBD | Per browser session |
| **Total (low usage)** | **~$10/mo** | Before user scaling |
