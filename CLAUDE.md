# Aurora — Claude Code Context

> Comprehensive codebase reference. Read this before diving into any task.
> **Transitioning from Aevoy** — see `AEVOY-CLAUDE.md` for legacy reference.

## What is Aurora?

Aurora is a proactive AI assistant that learns from user interactions and acts autonomously. Unlike traditional chatbots that wait for commands, Aurora observes patterns in user behavior, anticipates needs, and takes initiative — sending reminders before you ask, routing information to the right channel at the right time, and building a rich understanding of each user over time. Aurora communicates via SMS, phone calls, email, Telegram, and WhatsApp.

## Stack
- **Monorepo**: pnpm workspaces
- **Frontend**: `apps/web/` — Next.js 16.1.6, Supabase Auth, Tailwind 4, React 19
- **Agent**: `packages/agent/` — Express 4.21, TypeScript 5.6, ESM
- **Email Worker**: `workers/email-router/` — Cloudflare Worker
- **Database**: Supabase (PostgreSQL), 58 tables, RLS on all

## Deployment
| Service | URL | Check |
|---------|-----|-------|
| Vercel (web) | https://www.aevoy.com | Vercel dashboard |
| Railway (agent) | https://agent-production-1339.up.railway.app | `/health` endpoint |
| Supabase | `eawoquqgfndmphogwjeu` | MCP tools |

## Build Commands
```bash
pnpm --filter web build       # Build frontend
pnpm --filter agent build     # Build agent (TypeScript)
pnpm --filter web dev         # Dev server (port 3000)
pnpm --filter agent dev       # Agent dev (port 3001)
```

## Key File Paths

### Agent Core
- `packages/agent/src/index.ts` — Express routes (70+ endpoints, 4000+ lines)
- `packages/agent/src/v3/processor-v3.ts` — V3 tiered processor (ACTIVE)
- `packages/agent/src/v3/model-router.ts` — Model selection with session-aware fallback
- `packages/agent/src/v3/tools/` — 17 registered tools (email, SMS, calendar, etc.)
- `packages/agent/src/services/ai.ts` — AI model routing, system prompt, cost tracking
- `packages/agent/src/services/processor.ts` — V1 legacy processor (12,766 lines — TO BE REMOVED)

### Personality Engine (PRESERVE — this is excellent)
- `packages/agent/config/personality/SOUL.md` — Voice traits: direct, dry humor, contractions, fragments
- `packages/agent/config/personality/IDENTITY.md` — Channel-specific communication standards
- `packages/agent/src/services/personality.ts` — Personality compiler
- System prompt: `packages/agent/src/services/ai.ts:881-1026` — 14 behavioral rules

### Communication Channels
- `packages/agent/src/services/twilio.ts` — SMS + voice (Twilio 5.0)
- `packages/agent/src/services/voice-conversation.ts` — ConversationRelay + ElevenLabs TTS
- `packages/agent/src/services/email.ts` — Resend outbound email
- `packages/agent/src/services/inbox-poller.ts` — IMAP Gmail polling
- `packages/agent/src/services/telegram.ts` — Telegram bot
- `packages/agent/src/services/whatsapp.ts` — WhatsApp via Twilio
- `workers/email-router/src/index.ts` — Cloudflare email ingress

### Services
- `packages/agent/src/services/memory.ts` — Profile + working + episodic memory
- `packages/agent/src/services/scheduler.ts` — Cron scheduling + distributed locks
- `packages/agent/src/services/proactive.ts` — Hourly proactive checks
- `packages/agent/src/services/proactive-engagement.ts` — Daily digests, weekly reports
- `packages/agent/src/utils/pin-auth.ts` — Unified PIN verification (bcrypt, 5/1hr lockout)
- `packages/agent/src/utils/cost-calculator.ts` — Cost tracking (29.6% markup)

### Frontend
- `apps/web/app/page.tsx` — Landing page (~3000 lines)
- `apps/web/app/dashboard/page.tsx` — Dashboard
- `apps/web/components/onboarding/unified-flow.tsx` — 6-step onboarding
- `apps/web/supabase/migrations/` — 45+ migrations

### Browser Automation (TO BE REMOVED for Aurora)
- `packages/agent/src/execution/vision-agent.ts` — Browser automation loop
- `packages/agent/src/execution/stealth.ts` — Anti-detection fingerprinting
- `packages/agent/src/execution/captcha.ts` — CAPTCHA solving pipeline
- `packages/agent/src/execution/engine.ts` — Browser engine (Patchright/Playwright)

## Architecture

### V3 Processor (Active via PROCESSOR_VERSION=v3)
```
HTTP POST /task or /task/v2
  |
  v
CLASSIFY TIER
  |- instant (<1s): greetings, weather, memory recall
  |- single_tool (1-6s): email, SMS, calendar, documents
  |- multi_step (up to 40min): research, complex tasks
  |
  v
MODEL ROUTING (free first, paid fallback)
  |- Groq (free): Llama 8B, Scout, Kimi K2, Qwen3
  |- DeepSeek ($0.27/$1.10): deepseek-chat
  |- Gemini Flash ($0.15/$0.60): gemini-2.5-flash
  |- Haiku ($1/$5): claude-haiku-4.5 (LAST RESORT)
  |
  v
TOOL EXECUTION (17 tools)
  |- send_email, send_sms, make_call, weather, web_search
  |- create_document, generate_image, schedule_task
  |- check_calendar, create_event, remember, recall
  |- ask_user, read_inbox, send_telegram, send_whatsapp
  |
  v
RESPONSE via user's channel (email/SMS/voice/web/telegram/whatsapp)
```

### Communication Channels
| Channel | Inbound | Outbound | Provider |
|---------|---------|----------|----------|
| Email | IMAP + Cloudflare Worker | Resend API | Resend |
| SMS | Twilio webhook | Twilio REST | Twilio |
| Voice | Twilio webhook | ConversationRelay | Twilio + ElevenLabs |
| WhatsApp | Twilio webhook | Twilio REST | Twilio |
| Telegram | Bot webhook | Bot API | Telegram |
| Dashboard | WebSocket | WebSocket/REST | Supabase |

## Database (58 Tables — Key Ones)
- `profiles` — User account, display_name, phone, timezone, PIN hash
- `user_settings` — confirmation_mode, proactive_enabled, greeting_style, voice_preference
- `tasks` — Task records: status, cost, input_channel, response_text, processor_version
- `scheduled_tasks` — Cron jobs (cron_expression, timezone, run_count)
- `user_twilio_numbers` — Dedicated phone numbers per user
- `credit_wallets` — Prepaid credits (balance_cents, auto_reload)
- `credit_transactions` — Audit trail of wallet movements
- `ai_cost_log` — Per-API-call cost tracking (billed_cost = api_cost x 1.2)
- `user_memory` — 4-tier memory: short-term, working, episodic, long-term (AES encrypted)
- `credential_vault` — Encrypted site credentials (AES-256-GCM)
- `oauth_connections` — OAuth tokens (Google, Microsoft, Twitter, Fitbit)
- `inbox_queue` — Email ingestion queue
- `inbox_settings` — Email autonomy configuration
- `distributed_locks` — DB-level locks for scheduler/poller
- `processed_emails` — Email deduplication

## Environment Variables (Required)
```
# Database
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

# AI Models (at least one required)
GROQ_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY / DEEPSEEK_API_KEY

# Communication
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
RESEND_API_KEY
AGENT_INBOX_EMAIL / AGENT_INBOX_PASSWORD

# Security
ENCRYPTION_KEY (64-char hex, AES-256-GCM)
AGENT_WEBHOOK_SECRET

# URLs
AGENT_URL=https://agent-production-1339.up.railway.app
NEXT_PUBLIC_APP_URL=https://www.aevoy.com

# Billing
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET

# Feature Flags
PROCESSOR_VERSION=v3
BILLING_ENABLED=true/false
```

### Optional Environment Variables
```
# Additional AI
KIMI_API_KEY / OPENROUTER_API_KEY / SAMBANOVA_API_KEY / CEREBRAS_API_KEY / OPENAI_API_KEY

# OAuth
GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET

# Social
TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET
TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET

# Voice
ELEVENLABS_API_KEY / ELEVENLABS_DEFAULT_VOICE_ID

# Browser (TO BE REMOVED)
VPS_BROWSER_HOST / CAPSOLVER_API_KEY / TWOCAPTCHA_API_KEY
BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID

# Dev/Test
AI_MOCK_MODE / TEST_MODE / SKIP_PAYMENT_CHECKS / FORCE_LOCAL_BROWSER
```

## How to Run Locally
```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Fill in required values (Supabase, at least one AI key, Twilio, Resend)

# 3. Run dev servers
pnpm --filter web dev     # Frontend: http://localhost:3000
pnpm --filter agent dev   # Agent: http://localhost:3001
```

## How to Deploy

### Railway (Agent)
- Auto-deploys on push to main
- Uses `Dockerfile` at root (Node 20, Playwright deps, Chrome)
- Health check: GET `/health` every 30s
- Config: `railway.toml` + `packages/agent/railway.toml`

### Vercel (Web)
- Auto-deploys on push to main
- Project ID: `prj_TxoXhFdmsWKm8yvGYbDXBE720ZEN`
- Config: `apps/web/vercel.json`

### Cloudflare (Email Worker)
- Manual deploy: `cd workers/email-router && npx wrangler deploy`
- Config: `workers/email-router/wrangler.toml`

## Voice Configuration
- **TTS Provider**: ElevenLabs (native to Twilio ConversationRelay — no API key needed)
- **Default voice**: Sarah `EXAVITQu4vr4xnSDxMaL`
- **Greeting styles**: casual (default), jarvis, ironman, australian, professional
- **DO NOT add** `ttsLanguage` or `-flash_v2_5` model specs — both broke testing

## Security Rules
- Never expose internal errors to users
- RLS on all DB tables (user_id filtering)
- AES-256-GCM for credential encryption
- bcrypt for PIN hashing (5 wrong = 1hr lockout)
- TimingSafeEqual for webhook verification
- HTML sanitization: 5-step strip/unescape/re-strip/re-escape/control-char removal
- URL validation: block private IPs, javascript: protocol, non-standard ports
- Prompt injection defense: `<untrusted-data>` tags, pattern detection

## Cost & Billing
- `BILLING_MARKUP = 1.20` in `cost-calculator.ts`
- `COST_SAFETY_MARGIN = 1.08` — total margin 29.6%
- `ai_cost_log` stores billed cost (with markup applied)
- SMS markup: 2.0x on top of base markup (2.592x total)
- Credit wallet: auto-reload at $2 threshold, $10 reload amount

## Transition Status (Aevoy → Aurora)

### Working (Keep)
- Personality engine (SOUL.md + IDENTITY.md + system prompt)
- Twilio SMS/voice integration (production-grade)
- Email pipeline (send/receive/route)
- Telegram + WhatsApp channels
- V3 tiered processor + model routing
- Supabase schema (core tables)
- Credit wallet + Stripe billing
- PIN auth system
- Proactive engagement (basic)

### To Remove
- Browser automation (vision-agent, stealth, captcha, engine)
- V1 processor (12,766-line monolith)
- Desktop app (`apps/desktop/`)
- Legacy project (`omars-ai/`)
- Marketplace tables
- Hive Mind / vents system

### To Build (Aurora-specific)
- Proactive intelligence engine (pattern detection + anticipation)
- User context accumulation (extract intents/entities from every conversation)
- Pattern learning system (detect routines, preferences, habits)
- Proactive action queue (things Aurora wants to tell/do)
- Channel preference learning (which channel for which info type)
- Calendar deep integration (context source)
- Aurora dashboard (proactive feed, not task list)

## Common Pitfalls
- **AGENT_URL on Vercel**: Must be Railway URL, not old dead VPS IP
- **Twilio webhooks**: Must point to Railway (not localhost/VPS)
- **`sendViaChannel` before Supabase update**: Causes "processing" hang — always DB first
- **Onboarding**: `unified-flow.tsx` (NOT `onboarding-flow.tsx`) is what renders
- **DeepSeek balance $0**: Every call returns 402 — backoff handles it
- **Groq rate limits**: Scout/Kimi K2 hit TPD limits during heavy testing
- **Monitoring service**: DISABLED in scheduler.ts (burned $26 on voice)
- **No global unhandledRejection handler**: Uncaught promises crash the process (fix needed)

## Test User
- Email: `test-e2e@aevoy.com`
- ID: `11684ec6-80cd-4bb6-9aed-8f0947afd06a`
- Password: `VisualTest2026`

## Omar's Account
- Username: `Tess`
- ID: `dd7d0b19-b275-4caa-86ca-1027ba37a1fd`
