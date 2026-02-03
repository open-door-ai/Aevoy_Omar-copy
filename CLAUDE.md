# CLAUDE.md — Instructions for Claude Code

## What You Are Building

**Aevoy** — Your AI Employee That Never Fails.

Users interact via email, chat, phone calls, or text. The AI fully controls a computer and does any task a human can do. Two deployment modes: Cloud (Browserbase + Stagehand v3) and Local (Electron + nut.js).

See `docs/SPEC-V2.md` for the full v2 specification.

## Core Architecture

```
User (Email / SMS / Voice / Chat / Desktop App)
       ↓
Cloudflare Email Worker / Twilio Voice+SMS / Desktop Client
       ↓
Agent Server (packages/agent):
  1. Intent locking (security scope)
  2. Loads user's memory (4 types)
  3. AI model routing (DeepSeek → Kimi K2 → Gemini → Claude)
  4. Executes actions (Browserbase+Stagehand / local Playwright / nut.js)
  5. 3-step verification (self-check → evidence → smart review)
  6. Updates memory
  7. Sends response via Resend / Twilio
       ↓
User receives email / SMS / voice call with results
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14 (App Router), Tailwind, shadcn/ui |
| Backend | Node.js + TypeScript + Express |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Email In | Cloudflare Email Workers |
| Email Out | Resend API |
| AI (Primary) | DeepSeek V3.2 ($0.25/$0.38 per 1M tokens) |
| AI (Agentic) | Kimi K2 ($0.60/$2.50 per 1M, 75% cache savings) |
| AI (Free) | Gemini 2.0 Flash (free tier) |
| AI (Complex) | Claude Sonnet 4 ($3/$15 per 1M) |
| AI (Local) | Ollama (Llama3, Mistral) — free, offline |
| Browser (Cloud) | Browserbase + Stagehand v3 |
| Browser (Local) | Playwright |
| Desktop | Electron + nut.js |
| Voice/SMS | Twilio |
| Web Host | Vercel |
| Agent Host | Hetzner VPS (prod) / Local (dev) |

## AI Model Routing

| Task Type | Primary | Fallback Chain |
|-----------|---------|----------------|
| understand | DeepSeek V3.2 | Kimi K2 → Gemini Flash → Claude Haiku |
| plan | DeepSeek V3.2 | Kimi K2 → Claude Haiku |
| reason | Claude Sonnet | Kimi K2 → DeepSeek V3.2 |
| vision | Claude Sonnet | Gemini Flash |
| validate | Gemini Flash | DeepSeek V3.2 |
| respond | DeepSeek V3.2 | Claude Haiku |
| local | Ollama/Llama3 | Ollama/Mistral → DeepSeek V3.2 |

Target: <$0.10 average cost per task. Monthly budget per user: $15.

## Project Structure

```
aevoy/
├── CLAUDE.md                 # This file
├── .env.example              # Environment template
├── package.json              # Root package.json (pnpm workspace)
├── pnpm-workspace.yaml
│
├── docs/                     # Documentation
│   ├── SPEC-V2.md           # Full v2 specification
│   ├── PROGRESS.md          # Implementation progress tracker
│   ├── PRD.md               # Product requirements
│   ├── ARCHITECTURE.md      # System design
│   ├── DATABASE.md          # Database schema
│   ├── API.md               # API specs
│   └── PRIVACY.md           # Privacy implementation
│
├── apps/
│   ├── web/                 # Next.js app (Vercel)
│   │   ├── app/
│   │   │   ├── page.tsx           # Landing page
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   └── signup/page.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx       # Main dashboard
│   │   │   │   ├── activity/page.tsx
│   │   │   │   └── settings/page.tsx
│   │   │   └── api/
│   │   │       ├── tasks/route.ts
│   │   │       ├── memory/route.ts
│   │   │       ├── usage/route.ts
│   │   │       └── webhooks/
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   └── utils.ts
│   │   ├── supabase/
│   │   │   ├── migration.sql
│   │   │   ├── migration_v2.sql
│   │   │   └── migration_v3.sql
│   │   └── package.json
│   │
│   └── desktop/             # Electron app (Local mode)
│       ├── main/
│       │   ├── index.ts           # Main Electron process
│       │   ├── tray.ts            # System tray
│       │   ├── screen-control.ts  # nut.js wrapper
│       │   ├── local-browser.ts   # Local Playwright
│       │   ├── safety.ts          # Panic button, undo, recording
│       │   └── db.ts              # SQLite + encryption
│       ├── renderer/
│       │   ├── index.html
│       │   └── app.tsx
│       └── package.json
│
├── packages/
│   └── agent/               # Agent server
│       ├── src/
│       │   ├── index.ts           # Express entry
│       │   ├── types/
│       │   │   └── index.ts
│       │   ├── services/
│       │   │   ├── ai.ts          # AI model routing
│       │   │   ├── browser.ts     # Playwright (local fallback)
│       │   │   ├── stagehand.ts   # Browserbase + Stagehand v3
│       │   │   ├── memory.ts      # 4-type memory system
│       │   │   ├── email.ts       # Resend
│       │   │   ├── twilio.ts      # Voice + SMS
│       │   │   ├── processor.ts   # Task orchestration
│       │   │   ├── task-verifier.ts # 3-step verification
│       │   │   ├── proactive.ts   # Proactive engine
│       │   │   ├── scheduler.ts   # Cron scheduler
│       │   │   ├── clarifier.ts   # Task clarification
│       │   │   ├── verification.ts # 2FA detection
│       │   │   └── privacy-card.ts # Card management
│       │   ├── execution/
│       │   │   ├── engine.ts      # Execution orchestrator
│       │   │   └── actions/
│       │   │       ├── click.ts   # 15 click methods
│       │   │       ├── fill.ts    # 12 fill methods
│       │   │       ├── login.ts   # 10 login methods
│       │   │       └── navigate.ts # 8 navigation methods
│       │   ├── memory/
│       │   │   └── failure-db.ts  # Global failure memory
│       │   ├── security/
│       │   │   ├── encryption.ts
│       │   │   ├── intent-lock.ts
│       │   │   └── validator.ts
│       │   └── utils/
│       │       └── error.ts
│       ├── workspaces/            # User data (gitignored)
│       └── package.json
│
└── workers/
    └── email-router/        # Cloudflare Worker
        ├── src/
        │   └── index.ts
        ├── wrangler.toml
        └── package.json
```

## Security Architecture

1. **Intent Locking** — Task scope locked immutably before execution (allowedActions, allowedDomains, maxBudget)
2. **User-derived Encryption** — AES-256-GCM for all user data at rest
3. **Row-Level Security** — Supabase RLS on all user tables
4. **Verification Layer** — 3-step verification on every task
5. **Undo System** — All actions logged in action_history, reversible
6. **Panic Button** — Cmd+Shift+X stops all actions (desktop)

## Key Commands

```bash
# Install all dependencies
pnpm install

# Run web app (development)
pnpm --filter web dev

# Run agent server (development)
pnpm --filter agent dev

# Run desktop app (development)
pnpm --filter desktop dev

# Run all
pnpm dev

# Build for production
pnpm build

# Build desktop app
pnpm --filter desktop build

# Deploy web to Vercel
cd apps/web && vercel

# Run database migration
pnpm db:migrate

# Type check
pnpm typecheck

# Lint
pnpm lint

# Run end-to-end test flow
pnpm --filter agent test:flow
```

## Environment Variables

Required in `.env`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# AI Services
DEEPSEEK_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
GOOGLE_API_KEY=xxx
KIMI_API_KEY=xxx

# Browser Automation
BROWSERBASE_API_KEY=xxx
BROWSERBASE_PROJECT_ID=xxx

# Voice/SMS
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=xxx

# Email
RESEND_API_KEY=xxx

# Agent Server
AGENT_WEBHOOK_SECRET=xxx
AGENT_PORT=3001

# Security
ENCRYPTION_KEY=xxx        # 32 byte hex string for AES-256
JWT_SECRET=xxx            # 32 byte hex string

# Local AI (optional)
OLLAMA_HOST=http://localhost:11434
```

## Coding Standards

1. **TypeScript everywhere** — No `any` types
2. **Async/await** — No callbacks
3. **Error handling** — Always try/catch, never crash
4. **Logging** — Log events, NEVER log user content
5. **Security** — Validate all inputs, parameterized queries
6. **Testing** — Test critical paths

## Security Rules (IMPORTANT)

1. **NEVER** log email content or user messages
2. **NEVER** store API keys in code
3. **ALWAYS** validate user owns the resource
4. **ALWAYS** sanitize inputs before using in prompts
5. **ALWAYS** encrypt user memory files
6. **NEVER** share data between users

## File Reading Order

When starting work, read these files first:
1. `docs/SPEC-V2.md` — Full v2 specification
2. `docs/ARCHITECTURE.md` — How it works
3. `docs/DATABASE.md` — Database schema
4. `docs/PRIVACY.md` — Privacy requirements
5. `docs/PROGRESS.md` — Current implementation status

## Current Status

Implementing V2 specification. See `docs/PROGRESS.md` for detailed status.
