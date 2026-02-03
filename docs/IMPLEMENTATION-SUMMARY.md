# Aevoy V2 — Implementation Summary

Reference document for context across sessions. All phases are implemented.

## What Was Built (All 10 Phases Complete)

### Phase 0: Documentation
- `docs/SPEC-V2.md` — Full v2 spec (17 parts)
- `docs/PROGRESS.md` — Implementation checklist
- Updated: CLAUDE.md, ARCHITECTURE.md, DATABASE.md, API.md, PRD.md

### Phase 1: Database (migration_v3.sql)
- New tables: `action_history`, `transactions`, `prepaid_cards` (stub)
- Updated: `profiles` (twilio_number, proactive_enabled), `user_memory` (embedding)
- RLS policies on all new tables
- Indexes on failure_memory + usage

### Phase 2: AI Model Routing
- File: `packages/agent/src/services/ai.ts` — full rewrite
- Added: Kimi K2 client, Ollama client, 10-type routing table
- Fallback chains: DeepSeek -> Kimi K2 -> Gemini -> Claude
- Per-call cost tracking to Supabase usage table
- Types: TaskType, ModelProvider in `types/index.ts`

### Phase 3: Browserbase + Stagehand
- `packages/agent/src/services/stagehand.ts` — Cloud browser service
- `packages/agent/src/execution/actions/login.ts` — 10 login methods
- `packages/agent/src/execution/actions/navigate.ts` — 8 nav methods
- `execution/engine.ts` — Auto-detects Browserbase keys, falls back to local Playwright

### Phase 4: 3-Step Verification
- `packages/agent/src/services/task-verifier.ts`
- Step 1: Self-Check (text indicators, Gemini Flash)
- Step 2: Evidence Check (regex patterns, URL checks)
- Step 3: Smart Review (Claude Sonnet vision)
- Integrated into `processor.ts` — runs after every task execution
- 8 task-type criteria: booking, email, form, login, purchase, download, calendar, research

### Phase 5: Memory System
- `packages/agent/src/services/memory.ts` — full rewrite
- 4 types: short-term (Map), working (Supabase 7d), long-term (encrypted file), episodic (Supabase)
- Cost-optimized loading: keyword matching, token estimation, truncation
- Memory compression: 7d working -> long-term summarization

### Phase 6: Voice & SMS (Twilio)
- `packages/agent/src/services/twilio.ts` — full rewrite
- Outbound/inbound calls, TwiML generation, speech-to-text
- SMS two-way: send tasks via text, receive updates
- Voice webhooks in `index.ts`: /webhook/voice/:userId, /webhook/voice/process/:userId, /webhook/sms/:userId

### Phase 7: Proactive Engine
- `packages/agent/src/services/proactive.ts`
- Triggers: recurring tasks, unanswered tasks, upcoming scheduled
- Priority routing: high -> call, medium -> SMS, low -> email
- Hourly cron in `scheduler.ts`

### Phase 8: Desktop App
- `apps/desktop/` — Full Electron app structure
- `main/index.ts` — Main process with panic hotkey (Cmd+Shift+X)
- `main/tray.ts` — System tray
- `main/screen-control.ts` — nut.js wrapper
- `main/local-browser.ts` — Local Playwright
- `main/safety.ts` — Panic, undo, recording
- `main/db.ts` — SQLite + AES-256-GCM
- `renderer/index.html` — UI shell

### Phase 9: Web API
- `apps/web/app/api/memory/route.ts` — GET/POST memory
- `apps/web/app/api/usage/route.ts` — GET usage stats
- `apps/web/app/dashboard/page.tsx` — Voice/SMS channels, cost tracking, Twilio number display
- `apps/web/components/recent-activity.tsx` — Channel badges, verification status

### Phase 10: Config
- `.env` created with all provided keys + generated JWT_SECRET
- Root `package.json` with dev/build/test scripts per workspace
- `TEST_MODE=true` and `SKIP_PAYMENT_CHECKS=true` for development

## Security Fixes Applied
- Webhook auth: Always require secret (no bypass if env empty)
- Webhook task updates: Validate status against allowed values
- Task API: Pagination bounds (max 100), status validation
- Memory API: Type validation on GET + POST
- Usage API: Month format validation (YYYY-MM regex)
- Path traversal: Strict UUID v4 regex + resolved path check in memory.ts
- Logging: Removed user content from all console.log statements
- Sanitization: Input length limits on webhook data

## Test Mode Flags
Set in `.env`:
```
TEST_MODE=true
SKIP_PAYMENT_CHECKS=true
```
These skip:
- Message quota checks in processor.ts
- Usage increment billing

## API Keys Still Needed

| Key | Purpose | Where to Get |
|-----|---------|-------------|
| GOOGLE_API_KEY | Gemini Flash (free tier) | Google AI Studio |
| KIMI_API_KEY | Kimi K2 (agentic tasks) | kimi.ai / Moonshot AI |
| BROWSERBASE_API_KEY | Cloud browser automation | browserbase.com ($99/mo) |
| BROWSERBASE_PROJECT_ID | Cloud browser project | browserbase.com |
| TWILIO_ACCOUNT_SID | Voice/SMS | twilio.com (~$20 initial) |
| TWILIO_AUTH_TOKEN | Voice/SMS | twilio.com |
| TWILIO_PHONE_NUMBER | Your AI phone number | Purchase on Twilio ($1/mo) |

## Keys Already Configured
- Supabase (URL, Anon, Service Role)
- DeepSeek API
- Anthropic API (Claude)
- Resend API (email)
- Encryption Key (AES-256)
- JWT Secret (generated)
- Agent Webhook Secret

## Key File Paths
```
.env                                          — All secrets (gitignored)
packages/agent/src/services/ai.ts             — AI routing + all model clients
packages/agent/src/services/processor.ts      — Task orchestration + verification
packages/agent/src/services/stagehand.ts      — Browserbase/Stagehand
packages/agent/src/services/task-verifier.ts  — 3-step verification
packages/agent/src/services/memory.ts         — 4-type memory system
packages/agent/src/services/twilio.ts         — Voice + SMS
packages/agent/src/services/proactive.ts      — Proactive engine
packages/agent/src/execution/engine.ts        — Browser execution
packages/agent/src/index.ts                   — Express server + all webhooks
apps/web/app/dashboard/page.tsx               — Dashboard UI
apps/desktop/main/index.ts                    — Desktop app entry
```
