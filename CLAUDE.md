# CLAUDE.md — Complete Aevoy Codebase Context

## Autonomy Instructions

Work fully autonomously. Do not ask "Can I proceed?" or "Should I continue?" — just do the work. Make decisions, write code, run commands, and deploy. Only ask the user when there is a genuine ambiguity about requirements (not implementation). You have full access to Supabase, GitHub, Playwright, and all tools.

## What Is Aevoy

**Aevoy** — Your AI Employee That Never Fails. Users send tasks via email, SMS, voice, or chat. The AI controls a browser (or desktop) and executes any task a human can do. Two modes: Cloud (Browserbase + Stagehand v3) and Local (Electron + nut.js).

## Architecture

```
User (Email / SMS / Voice / Chat / Desktop)
  → Cloudflare Email Worker / Twilio / Desktop Client
    → Agent Server (packages/agent, Express, port 3001):
        1. Intent locking (scope security)
        2. Load user memory (4 types)
        3. Query Hive learnings for known approaches
        4. AI model routing (Groq → DeepSeek → Kimi K2 → Gemini → Claude)
        5. Plan-then-execute (API skills → cached browser → new browser → fallback)
        6. 3-step verification (self-check → evidence → smart review)
        7. Update memory + log cost
        8. Respond via Resend / Twilio / same channel
    → User gets results
```

## Tech Stack

- **Frontend**: Next.js 14 App Router, Tailwind CSS v4, shadcn/ui, Framer Motion
- **Backend**: Express + TypeScript (packages/agent)
- **Database**: Supabase PostgreSQL, RLS on all tables, 26 tables
- **Auth**: Supabase Auth
- **AI**: Groq (fastest, cheapest) → DeepSeek V3.2 → Kimi K2 → Gemini Flash (free) → Claude Sonnet 4 (complex)
- **Browser**: Browserbase + Stagehand v3 (cloud) / Playwright (local)
- **Desktop**: Electron + nut.js
- **Voice/SMS**: Twilio (trial, +17789008951)
- **Email In**: ImprovMX → Gmail IMAP (30s poll) + Cloudflare Worker
- **Email Out**: Resend (noreply@aevoy.com, DKIM+SPF verified)
- **Web Host**: Vercel (https://www.aevoy.com)
- **Agent Host**: Koyeb (https://hissing-verile-aevoy-e721b4a6.koyeb.app)
- **Monorepo**: pnpm workspaces

## Complete File Map

### Root
| File | Purpose |
|------|---------|
| `package.json` | pnpm workspace root, scripts: dev, build, lint, typecheck |
| `pnpm-workspace.yaml` | Workspaces: apps/*, packages/*, workers/* |
| `docker-compose.yml` | Agent container, port 3001, healthcheck /health |
| `Dockerfile` | Node 20-slim + Playwright deps for agent |
| `deploy.sh` | Deploy script (agent→Docker/VPS, worker→Cloudflare, web→Vercel) |
| `.mcp.json` | MCP servers: github, playwright, supabase (project: eawoquqgfndmphogwjeu) |
| `.env.example` | Template for all env vars |

### apps/web/ (Next.js on Vercel)

#### Pages
| File | Purpose |
|------|---------|
| `app/page.tsx` | Landing page (~2000 lines, all sections inline) |
| `app/(auth)/login/page.tsx` | Login with email/password, Supabase Auth |
| `app/(auth)/signup/page.tsx` | Signup with password strength, auto-generates AI email |
| `app/dashboard/page.tsx` | Main dashboard: recent activity, quick actions, stats |
| `app/dashboard/activity/page.tsx` | Full task history with status filters, pagination |
| `app/dashboard/settings/page.tsx` | Profile, preferences, agent card, phone, Hive opt-in |
| `app/how-it-works/page.tsx` | Educational page showing AI capabilities |
| `app/hive/page.tsx` | Public Hive Mind: browse learnings + agent vents |
| `app/connect/[token]/page.tsx` | OAuth callback landing (Gmail, Microsoft) |
| `middleware.ts` | Auth middleware: redirect unauthed from /dashboard, authed from /login |

#### API Routes (37 endpoints)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/tasks` | GET, POST | List tasks (paginated, filtered) / Create task (forwards to agent) |
| `/api/user` | GET, PATCH | Get/update profile (displayName, timezone) |
| `/api/user/export` | GET | GDPR data export (JSON download) |
| `/api/user/delete` | DELETE | GDPR deletion (19 tables in FK order) |
| `/api/usage` | GET | Monthly usage stats (browser_tasks, sms, voice, ai_cost) |
| `/api/stats` | GET | Overall stats (messages, tasks, costs) |
| `/api/memory` | GET, POST | List/save encrypted user memory |
| `/api/settings` | GET, PUT | User settings (confirmation_mode, verification_method) |
| `/api/onboarding/complete` | POST | Complete 5-step onboarding |
| `/api/onboarding/check-username` | POST | Username availability (15 reserved words) |
| `/api/integrations/gmail` | GET, POST | Gmail OAuth status/initiate |
| `/api/integrations/gmail/callback` | GET | Gmail OAuth callback, store encrypted tokens |
| `/api/integrations/microsoft` | POST | Microsoft OAuth initiate |
| `/api/integrations/microsoft/callback` | GET | Microsoft OAuth callback |
| `/api/integrations/email` | POST | IMAP email setup |
| `/api/hive/learnings` | GET, POST | Search/post learnings (internal, webhook-authed) |
| `/api/hive/vents` | POST | Post agent vent (rate limit 5/day) |
| `/api/hive/public/vents` | GET | Browse public vents |
| `/api/hive/public/learnings` | GET | Browse public learnings |
| `/api/hive/public/stats` | GET | Hive statistics |
| `/api/hive/sync` | POST | Daily learnings sync |
| `/api/demo/task` | POST | Demo query (Gemini→DeepSeek, 10/day/IP, 15s timeout) |
| `/api/demo/call` | POST | Demo phone call |
| `/api/phone` | POST | Provision AI phone number |
| `/api/agent-card` | GET | Get agent card |
| `/api/scheduled-tasks` | POST | Create scheduled task |
| `/api/workflows` | POST | Create workflow |
| `/api/webhooks/stripe` | POST | Stripe webhook handler |
| `/api/webhooks/task` | POST | Task completion webhook |
| `/api/profile/beta-status` | POST | Beta status check |

#### Lib
| File | Purpose |
|------|---------|
| `lib/supabase/client.ts` | Browser Supabase client (createBrowserClient) |
| `lib/supabase/server.ts` | Server Supabase client (createServerClient, cookie handling) |
| `lib/supabase/middleware.ts` | Session refresh middleware, auth redirects |
| `lib/types/database.ts` | TypeScript interfaces: Profile, Task, ScheduledTask, UserResponse, etc. |
| `lib/encryption.ts` | AES-256-GCM encrypt/decrypt (salt:iv:authTag:data format) |
| `lib/verify-webhook.ts` | Timing-safe webhook secret verification |
| `lib/theme.tsx` | Dark/light mode (ThemeProvider, useTheme hook, localStorage) |
| `lib/utils.ts` | cn() helper (clsx + tailwind-merge) |
| `lib/hive/learning-generator.ts` | Generate structured learnings from task data |
| `lib/hive/learning-merger.ts` | Merge learnings with EMA calculations |
| `lib/hive/pii-scrubber.ts` | Remove PII from learning content |
| `lib/hive/vent-generator.ts` | Generate AI agent vents |

#### Components (21 files)
| File | Purpose |
|------|---------|
| `components/dashboard-with-onboarding.tsx` | Wrapper: shows onboarding if not completed |
| `components/onboarding-flow.tsx` | 5-step orchestrator with progress indicator |
| `components/onboarding-wizard.tsx` | Wizard coordinator |
| `components/onboarding/step-*.tsx` | 5 steps: welcome, email, phone, interview, tour |
| `components/recent-activity.tsx` | Task cards with real-time polling (3s/10s) |
| `components/scheduled-tasks.tsx` | Cron task list |
| `components/beta-payment-modal.tsx` | Stripe payment modal |
| `components/ui/button.tsx` | shadcn button (variants: default, outline, ghost, link) |
| `components/ui/card.tsx` | Card, CardHeader, CardTitle, CardContent, CardFooter |
| `components/ui/dialog.tsx` | Modal dialog |
| `components/ui/input.tsx` | Text input |
| `components/ui/label.tsx` | Form label |
| `components/ui/tabs.tsx` | Tabbed interface |
| `components/ui/toast.tsx` | Toast notifications |
| `components/ui/skeleton.tsx` | Loading skeletons |
| `components/ui/empty-state.tsx` | No data state |
| `components/ui/motion.tsx` | FadeIn, StaggerContainer, GlassCard, spring presets |

### packages/agent/ (Express server on Koyeb)

#### Core
| File | Purpose |
|------|---------|
| `src/index.ts` | Express entry: routes, middleware, CORS, startup (seed skills, start scheduler/IMAP/proactive) |
| `src/types/index.ts` | All types: Task, UserMemory, IntentLock, CascadeLevel, CascadeResult, CompiledPersonality, ResolvedUser, TaskKnowledge, etc. |

#### Services
| File | Purpose |
|------|---------|
| `src/services/ai.ts` | AI routing: Groq→DeepSeek→Kimi→Gemini→Claude chains. LRU response cache (100 entries, 5-min TTL). Per-call cost logging to ai_cost_log. |
| `src/services/processor.ts` | Task orchestrator: receives task → loads memory → queries learnings → calls AI → executes → verifies → responds |
| `src/services/memory.ts` | 4-type memory (working, long_term, episodic + short-term in-memory). Decay: -0.1 importance for >30 days. Ranked retrieval: score = importance*0.6 + keywordOverlap*0.4 |
| `src/services/browser.ts` | Local Playwright fallback browser |
| `src/services/stagehand.ts` | Browserbase + Stagehand v3 (CDP direct, 44% faster) |
| `src/services/email.ts` | Resend email sending |
| `src/services/twilio.ts` | Twilio voice + SMS (signature validation, TwiML) |
| `src/services/task-verifier.ts` | 3-step verification: self-check (Gemini) → evidence (code) → smart review (Claude if <90%) |
| `src/services/proactive.ts` | Proactive engine: quiet hours (10PM-7AM), daily counter (max 2, DB-backed), 8 trigger types |
| `src/services/scheduler.ts` | Cron scheduler with distributed locks (scheduler_tasks, scheduler_proactive) |
| `src/services/clarifier.ts` | Task clarification (ask user for missing info) |
| `src/services/verification.ts` | 2FA detection and handling |
| `src/services/privacy-card.ts` | Virtual card management |
| `src/services/inbox-poller.ts` | IMAP Gmail poller (30s interval), email idempotency via processed_emails table, distributed lock |
| `src/services/personality.ts` | External .md personality loader (config/personality/), hot-reload, falls back to built-in SYSTEM_PROMPT |
| `src/services/supabase.ts` | Supabase service-role client, distributed locking (acquireDistributedLock/releaseDistributedLock) |
| `src/services/identity/normalizer.ts` | Gmail dots/plus normalization, E.164 phone normalization |
| `src/services/identity/resolver.ts` | email/phone → user resolution |
| `src/services/oauth-manager.ts` | OAuth token refresh, encrypted storage, auto-refresh in scheduler |

#### Execution Engine
| File | Purpose |
|------|---------|
| `src/execution/engine.ts` | Plan-then-execute: API skills → cached browser → browser_new → direct fallback |
| `src/execution/api-executor.ts` | Google Calendar/Gmail/Drive + Microsoft equivalents via OAuth |
| `src/execution/skill-registry.ts` | 8 default API skills, seeded on startup |
| `src/execution/actions/click.ts` | 15 click methods (CSS, XPath, text, role, force, JS, coordinates, vision, etc.) |
| `src/execution/actions/fill.ts` | 12 fill methods (standard, label, placeholder, JS, React hack, vision, etc.) |
| `src/execution/actions/login.ts` | 10 login methods (standard, OAuth, magic link, cookie injection, etc.) |
| `src/execution/actions/navigate.ts` | 8 navigation methods (URL, search, menu, sitemap, cached, vision, etc.) |

#### Cascade & Fallbacks
| File | Purpose |
|------|---------|
| `src/services/api-fallback.ts` | API fallback (triggers when browser success <70%) |
| `src/services/email-fallback.ts` | Email fallback |
| `src/services/manual-fallback.ts` | Manual fallback (human handoff) |
| `src/services/failure-handlers.ts` | OAuth/password/layout/crash/bot/ratelimit recovery |

#### Security
| File | Purpose |
|------|---------|
| `src/security/encryption.ts` | AES-256-GCM encryption for credentials and memory |
| `src/security/intent-lock.ts` | Immutable task scope (allowedActions, allowedDomains, maxBudget) |
| `src/security/validator.ts` | Input validation and sanitization |

#### Config
| File | Purpose |
|------|---------|
| `config/personality/SOUL.md` | Aevoy personality: direct, casual, action-oriented, no corporate speak |
| `config/personality/IDENTITY.md` | Capabilities (8) and refusals (6) |
| `config/personality/USER_TEMPLATE.md` | Per-user context template ({{username}}, {{timezone}}, etc.) |

#### Agent Routes (from index.ts)
| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check (all subsystems) |
| `/task` | POST | Process task (webhook-authed) |
| `/task/incoming` | POST | Incoming task from email/IMAP |
| `/task/confirm` | POST | User confirmation response |
| `/webhook/voice/:userId` | POST | Twilio voice webhook |
| `/webhook/sms/:userId` | POST | Twilio SMS webhook |
| `/email/test` | POST | IMAP connection test |

### workers/email-router/ (Cloudflare Worker)
| File | Purpose |
|------|---------|
| `src/index.ts` | Email routing: parse MIME → detect type (new_task, confirmation, verification, magic_link) → resolve user → forward to agent |
| `wrangler.toml` | Config: secrets (AGENT_URL, AGENT_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY) |

### apps/desktop/ (Electron + nut.js, scaffolded)
| File | Purpose |
|------|---------|
| `main/index.ts` | Electron main: tray, panic hotkey (Cmd/Ctrl+Shift+X), IPC handlers |
| `main/safety.ts` | SafetyManager: recordAction, undoLastActions, recording |
| `main/screen-control.ts` | nut.js wrapper (mouse, keyboard, capture) |
| `main/local-browser.ts` | Playwright wrapper for local browser |
| `main/db.ts` | SQLite + better-sqlite3 local storage |
| `main/tray.ts` | System tray integration |

## Database Schema (27 tables, Supabase PostgreSQL, RLS on all)

### Core
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `profiles` | id (→auth.users), username, email, timezone, subscription_tier, messages_used, messages_limit, onboarding_completed, twilio_number, proactive_enabled, allow_agent_venting, email_pin, email_pin_attempts, email_pin_locked_until | User profiles |
| `tasks` | id, user_id, status, type, email_subject, cost_usd, tokens_used, input_channel, cascade_level, checkpoint_data, verification_status | Task records |
| `task_logs` | task_id, level, message | Task execution logs |
| `task_queue` | task_id, user_id, priority, status | Priority queue |
| `scheduled_tasks` | id, user_id, description, cron_expression, next_run_at, last_run_at, is_active, run_count | Cron tasks |
| `execution_plans` | id, task_id, plan_data | Task execution plans |

### Memory & Knowledge
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `user_memory` | id, user_id, memory_type (working/long_term/episodic), encrypted_data, importance (0-1), last_accessed_at, embedding (pgvector 1536) | Encrypted user memories |
| `failure_memory` | id, site_domain, action_type, original_selector, error_type, solution_method, success_rate, times_used, last_seen_at | Global cross-user failure patterns |
| `learnings` | id, service, task_type, title, steps, gotchas, success_rate, difficulty, is_warning, tags | Hive Mind collective knowledge |
| `vents` | id, agent_display_name, service, mood (frustrated/amused/shocked/defeated/victorious), content, upvotes | AI agent vents |
| `vent_upvotes` | vent_id, agent_hash | Vent voting (UNIQUE dedup) |
| `agent_sync_log` | id, user_id, sync_type, learnings_absorbed | Daily sync tracking |

### Credentials & Auth
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `user_credentials` | id, user_id, site_domain, encrypted_data | Encrypted site credentials |
| `credential_vault` | id, user_id, site_domain, username, encrypted_password | Encrypted passwords (AES-256-GCM) |
| `oauth_connections` | id, user_id, service, access_token_encrypted, refresh_token_encrypted, expires_at | OAuth tokens (encrypted) |
| `tfa_codes` | id, user_id, service, code, expires_at | 2FA codes (auto-extracted from Gmail) |
| `email_pin_sessions` | id, user_id, sender_email, pin_code, email_subject, email_body, email_body_html, attachments, expires_at (10 min), verified | Temporary PIN verification sessions for unregistered sender emails |
| `user_sessions` | id, user_id, domain, session_data, expires_at (7 days) | Persistent login sessions |

### User Preferences
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `user_settings` | user_id, confirmation_mode (always/unclear/risky/never), verification_method (forward/virtual_number), agent_card_enabled, limits | Preferences |
| `agent_cards` | id, user_id, card_id, last_four, balance_cents, per_tx_limit, monthly_limit, is_frozen | Virtual cards |
| `user_twilio_numbers` | id, user_id, phone_number, provider | Provisioned phone numbers |
| `skills` | id, name, description, api_endpoint, auth_type | Agent API skill registry (8 default) |

### Usage & Tracking
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `usage` | id, user_id, month (YYYY-MM), browser_tasks, simple_tasks, sms_count, voice_minutes, ai_cost_cents, proactive_daily_count, proactive_daily_date | Monthly usage |
| `ai_cost_log` | id, user_id, model, tokens_used, cost_usd, task_type | Per-call AI cost tracking |
| `action_history` | id, task_id, user_id, action_type, action_data, undo_data, screenshot_url | Undo system |

### Workflows
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `workflows` | id, user_id, name, trigger_type, steps, is_active | Multi-step automation |
| `workflow_steps` | id, workflow_id, step_order, action_type, config | Workflow step definitions |

### Infrastructure
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `distributed_locks` | lock_name (PK), acquired_at, expires_at | Multi-instance coordination |
| `processed_emails` | message_id (PK), processed_at, from_addr, to_addr, subject | Email idempotency (cleaned after 7 days) |

### Database Functions (RPCs)
- `handle_new_user()` — Trigger on auth.users insert
- `increment_usage(user_id)` — Increment messages_used
- `check_quota(user_id)` — Check if user over limit
- `track_usage(user_id, task_type, ai_cost_cents)` — Upsert monthly usage
- `record_action(task_id, user_id, action_type, action_data, undo_data, screenshot_url)` — Log action
- `track_voice_sms_usage(user_id, sms_count, voice_minutes)` — Track voice/SMS
- `cleanup_expired_tfa_codes()` — Delete expired 2FA codes
- `get_latest_tfa_code(user_id, service)` — Fetch current 2FA code
- `atomic_record_failure(...)` — Atomic upsert with EMA success rate
- `cleanup_expired_sessions()` — Delete expired sessions

## AI Model Routing

| Task Type | Chain (position 0 = primary) |
|-----------|------------------------------|
| understand | Groq → DeepSeek V3.2 → Kimi K2 → Gemini Flash → Claude Haiku |
| plan | Groq → DeepSeek V3.2 → Kimi K2 → Claude Haiku |
| classify | Groq → DeepSeek V3.2 → Gemini Flash |
| reason | Claude Sonnet → Kimi K2 → DeepSeek V3.2 |
| vision | Claude Sonnet → Gemini Flash |
| validate | Groq → Gemini Flash → DeepSeek V3.2 |
| respond | Groq → DeepSeek V3.2 → Claude Haiku |
| local | Ollama/Llama3 → Ollama/Mistral → DeepSeek V3.2 |

Target: <$0.10 avg cost per task. Budget: $15/user/month.

## Email PIN Security System

**Purpose**: Allow users to securely receive emails from alternate addresses (not their registered email) after PIN verification.

### Flow:
1. Email arrives from unregistered sender → email worker detects mismatch
2. If no `email_pin` set → reject + send setup instructions to registered email
3. If `email_pin` set → generate 6-digit PIN
4. Store session in `email_pin_sessions` table (10-min TTL)
5. Send PIN to registered email
6. Send auto-reply to sender confirming receipt
7. User replies with PIN (or submits via dashboard at `/api/settings/email-pin`)
8. Worker verifies PIN → processes original task
9. If 3 failed attempts → 15-minute lockout

### Security:
- PIN encrypted in database (AES-256-GCM via `encryptPin()`)
- 10-minute expiration per session
- 3 attempts before 15-minute lockout (`email_pin_locked_until`)
- Sessions auto-cleanup hourly via scheduler
- Separate from voice PIN system
- Mirrors phone PIN architecture from Session 15

### Database Tables:
- **profiles**: Added `email_pin` (encrypted), `email_pin_attempts`, `email_pin_locked_until`
- **email_pin_sessions**: Temporary storage for pending emails (user_id, sender_email, pin_code, email_subject, email_body, email_body_html, attachments, expires_at, verified, created_at)

### Endpoints:
- **POST /task/email-pin** (agent): Direct PIN verification from web dashboard
- **POST /email/send** (agent): Send emails via Resend (used by worker for notifications)
- **POST /api/settings/email-pin** (web): Set/update email PIN in settings

### Files Modified:
- `workers/email-router/src/index.ts`: Lines 245-400 replaced rejection logic with full PIN flow
- `packages/agent/src/index.ts`: Added `/task/email-pin` and `/email/send` endpoints
- `packages/agent/src/services/scheduler.ts`: Added hourly cleanup via `cleanup_expired_email_pin_sessions()` RPC
- `apps/web/app/dashboard/settings/page.tsx`: Added Email PIN section to Phone & Voice card
- `apps/web/app/api/settings/email-pin/route.ts`: New API route for PIN setup

## Migrations (11 files, cumulative)

| Migration | Key Changes |
|-----------|-------------|
| `migration.sql` (v1) | profiles, tasks, scheduled_tasks, failure_memory, handle_new_user trigger |
| `migration_v2.sql` | user_credentials, user_memory, usage, track_usage RPC |
| `migration_v3.sql` | action_history, transactions, prepaid_cards, memory_type/importance/embedding on user_memory |
| `migration_v4.sql` | user_sessions, checkpoint_data on tasks, atomic_record_failure RPC |
| `migration_v5.sql` | learnings, vents, vent_upvotes, agent_sync_log, allow_agent_venting on profiles |
| `migration_v6.sql` | user_settings, agent_cards, onboarding fields on profiles |
| `migration_v7.sql` | last_accessed_at on user_memory, cascade_level on tasks, decay/retention indexes |
| `migration_v8.sql` | oauth_connections, credential_vault, tfa_codes, skills, execution_plans, task_queue, ai_cost_log, user_twilio_numbers, 2 RPCs |
| `migration_v9.sql` | Security: fixed mutable search_path on 5 functions, tightened learnings RLS |
| `migration_v10.sql` | distributed_locks, processed_emails, proactive_daily_count/date on usage |
| `migration_v15.sql` | email_pin/email_pin_attempts/email_pin_locked_until on profiles, email_pin_sessions table, 3 RPCs (increment/reset attempts, cleanup sessions) |

All migrations in: `apps/web/supabase/`

## Commands

```bash
pnpm install                    # Install all deps
pnpm --filter web dev           # Web app dev server (port 3000)
pnpm --filter agent dev         # Agent server dev (port 3001)
pnpm --filter web build         # Production build web
pnpm --filter agent build       # Production build agent
pnpm dev                        # Run all
docker-compose up --build       # Agent in Docker
```

## Deployment Status

| Component | Location | Status |
|-----------|----------|--------|
| Website | Vercel → https://www.aevoy.com | Live, SSL valid |
| Agent | Koyeb → https://hissing-verile-aevoy-e721b4a6.koyeb.app | Live, healthy |
| Email Worker | Cloudflare → https://aevoy-email-router.omarkebrahim.workers.dev | Deployed, secrets configured |
| Email Out | Resend (noreply@aevoy.com) | DKIM+SPF verified |
| Email In | ImprovMX → Gmail IMAP (30s poll) | Working (primary) |
| Email Routing | Cloudflare Email Routing → Worker | Ready (needs MX records update) |
| DNS | Porkbun (A, CNAME, 3xTXT, MX) | Configured |
| SPF | `v=spf1 include:spf.improvmx.com include:amazonses.com ~all` | Combined |
| Auth | Supabase, site URL = https://www.aevoy.com | Working |
| Twilio | Trial, +17789008951 | Webhooks pointed to Koyeb |
| DB | Supabase (eawoquqgfndmphogwjeu), 27 tables, RLS on all | All migrations applied (v1-v15) |

## Environment Variables (all in apps/web/.env.local)

Supabase, Groq, DeepSeek, Anthropic, Google (Gemini), Kimi, Browserbase, Twilio, Resend, IMAP (inbox email + Gmail app password), Google OAuth, Microsoft OAuth, ENCRYPTION_KEY (32-byte hex), AGENT_WEBHOOK_SECRET, AGENT_PORT=3001, AGENT_URL, NEXT_PUBLIC_APP_URL.

## Coding Standards

1. **TypeScript everywhere** — No `any` types
2. **Async/await** — No callbacks
3. **Error handling** — Always try/catch, never crash
4. **Logging** — Log events, NEVER log user content or email bodies
5. **Security** — Validate all inputs, parameterized queries, encrypt sensitive data
6. **NEVER** store API keys in code, NEVER share data between users
7. **ALWAYS** encrypt user memory, credentials, and OAuth tokens (AES-256-GCM)

## Key Patterns

- **Encryption**: AES-256-GCM, format `salt:iv:authTag:encrypted` (base64), scrypt key derivation
- **Webhook auth**: timing-safe comparison via `crypto.timingSafeEqual`
- **Memory decay**: -0.1 importance for memories >30 days old
- **Memory retrieval**: score = importance*0.6 + keywordOverlap*0.4
- **Response cache**: LRU 100 entries, 5-min TTL, SHA-256 key, skips vision/complex
- **Distributed locks**: acquireDistributedLock/releaseDistributedLock in supabase.ts
- **Email idempotency**: processed_emails table, cleaned after 7 days
- **Proactive guards**: quiet hours (10PM-7AM by timezone), max 2/day/user (DB-backed)
- **Budget alerts**: Email when remaining < $3, tracked via budget_alert task type
- **Identity**: Gmail dots/plus normalization, E.164 phone normalization
- **Cascade**: API skills → cached browser → new browser → email fallback → manual fallback
- **Never-fail**: 15 click methods, 12 fill methods, 10 login methods, 8 nav methods

## Session History (12 sessions)

1. Hive Mind social network (13 files)
2. V2 spec alignment (15 gaps closed)
3. Demo fixes + full system audit + DB gaps
4. System activation: docker fix, crash fix, workflow engine, Gmail OAuth, receptionist mode
5. IMAP email (replaces OAuth), circular dep fix, full 31-route audit
6. OpenClaw features: personality, cache, cascade, decay, identity, GDPR, retention
7. Integration engine: Groq, OAuth vault, plan-then-execute, API skills, TFA, overnight, failure handlers
8. Deployment: Security fixes, Koyeb deploy, Twilio webhooks, end-to-end verified
9. DNS restoration, Supabase Auth fix, full E2E verification
10. Security audit, repo cleanup, scale-readiness (distributed locks, email idempotency, DB counters)
11. Comprehensive UI overhaul (Phases 1-3)
12. Email PIN security system: Migration v15, PIN verification flow, Cloudflare Worker deployment, settings UI
