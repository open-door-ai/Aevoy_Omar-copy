# Aevoy AGI Platform — System Architecture

> Production reference. Updated to reflect the live system as of 2026-03-06.

---

## Table of Contents

1. [Stack Overview](#1-stack-overview)
2. [Request Flow](#2-request-flow)
3. [Fast Paths](#3-fast-paths)
4. [AI Model Selection](#4-ai-model-selection)
5. [Browser Automation Stack](#5-browser-automation-stack)
6. [Voice Pipeline](#6-voice-pipeline)
7. [Memory System](#7-memory-system)
8. [Cost Tracking Flow](#8-cost-tracking-flow)
9. [Security Layers](#9-security-layers)

---

## 1. Stack Overview

### Monorepo Layout

```
/
├── apps/
│   └── web/                  Next.js 14 frontend (Vercel)
│       ├── app/              App Router pages
│       ├── components/       React components
│       └── supabase/         DB migrations v1–v40
├── packages/
│   └── agent/                Express AGI backend (Railway)
│       └── src/
│           ├── index.ts          70+ Express routes
│           ├── services/         Core business logic
│           ├── execution/        Browser + action execution
│           ├── security/         Validators, intent-lock
│           ├── memory/           Failure DB, learnings
│           ├── middleware/       Rate limiting
│           ├── routes/           Skill routes
│           └── utils/            Supabase, hashing, logging
└── workers/
    └── email-router/         Cloudflare Worker (email ingress)
```

### Service Map

| Service | Stack | Host | URL |
|---------|-------|------|-----|
| Frontend | Next.js 14, Tailwind, Supabase Auth | Vercel | https://www.aevoy.com |
| Agent API | Express, TypeScript, patchright | Railway | https://agent-production-1339.up.railway.app |
| Database | Supabase (PostgreSQL + pgvector) | Supabase | `eawoquqgfndmphogwjeu` |
| Email ingress | Cloudflare Worker | Cloudflare | Custom domain |
| Email outbound | Resend API | External | — |
| Voice | Twilio ConversationRelay + ElevenLabs TTS | External | — |
| Browser | patchright (local) / Bright Data (remote) | Railway / External | — |

---

## 2. Request Flow

### Full Pipeline (ASCII)

```
INBOUND CHANNELS
  Email ─────────────┐
  SMS ───────────────┤
  Voice (Twilio) ────┤
  Web dashboard ─────┤──► POST /task or /task/v2  (Railway)
  Telegram ──────────┤         │
  WhatsApp ──────────┘         │
                               ▼
                    ┌─────────────────────┐
                    │  SECURITY GATE      │
                    │  - webhook secret   │
                    │  - rate limits      │
                    │  - prompt injection │
                    │  - concurrency (10) │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  FAST PATHS         │  < 500ms, no full AI loop
                    │  weather / email    │
                    │  schedule / SMS     │
                    │  call / greeting    │
                    └─────────┬───────────┘
                              │  (not matched)
                              ▼
                    ┌─────────────────────┐
                    │  LOAD MEMORY        │
                    │  profile + settings │
                    │  long-term facts    │
                    │  recent context     │
                    │  hive mind learnings│
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  AGENT TEAM CHECK   │
                    │  isComplexTask?     │
                    │  → decompose        │
                    │  → parallel specs   │
                    │  → synthesize       │
                    └─────────┬───────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  AI EXECUTION LOOP            │
              │  max 15 iter, 40-min, $5 cap  │
              │                               │
              │  1. Classify task type        │
              │  2. Generate action(s)        │
              │     (Haiku → Groq → DeepSeek) │
              │  3. Execute actions           │
              │     ├─ browser (vision agent) │
              │     ├─ email / SMS / voice    │
              │     ├─ file creation          │
              │     └─ API calls              │
              │  4. Verify outcome            │
              │     (screenshot-based, 3 strike)│
              │  5. Progress ledger (every 5) │
              └───────────────┬───────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  PASSIVE GUARD      │  rejects "want me to?" → forces action
                    │  QUALITY GATE (90%) │  rejects page-state responses
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  PROACTIVE FOLLOW-UP│
                    │  detect next step   │
                    │  append 1 question  │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  RESPOND            │
                    │  same channel as    │
                    │  input (email/SMS/  │
                    │  voice/Telegram/WA) │
                    └─────────────────────┘
```

### Concurrency Controls

| Limit | Value | Scope |
|-------|-------|-------|
| Global tasks | 10 | Per Railway instance |
| Browser tasks | 6 | Per Railway instance |
| AI concurrency | 4 slots | Across all tasks |
| Daily calls per user | 50 | DB-backed counter |
| Task queue | Unlimited | In-memory, FIFO |

Counter self-healing runs every 2 minutes, reconciling in-memory state against the `tasks` table.

### Mid-Task Update Injection

If a user sends a new message while a task is already running, the system classifies the new message:

- `obvious_update` — inject silently into the running task context
- `likely_update` — inject and acknowledge to user
- `new_task` — spawn a parallel task

---

## 3. Fast Paths

Fast paths bypass the full AI loop. They are matched by keyword regex in `processor.ts` before any model is invoked.

| Fast Path | Trigger Keywords | Backend | Latency |
|-----------|-----------------|---------|---------|
| Weather | "weather", "temperature", "forecast" | wttr.in REST API | ~200ms |
| Email send | "send email", "email to" + direct compose intent | Resend API | ~300ms |
| Schedule | "remind me", "set a reminder", "schedule" | Direct DB insert | ~100ms |
| Greeting | "hello", "hi", "hey" alone | Quick AI (Groq Scout) | ~400ms |
| SMS send | "text me", "send sms to" | Twilio API | ~300ms |
| Outbound call | "call me", "call [number]" | Twilio API | ~300ms |

All fast paths return before the AI execution loop starts. The response is still delivered through the user's input channel (email/SMS/voice/web).

---

## 4. AI Model Selection

### Routing Strategy

The model routing table (`ROUTING_TABLE` in `ai.ts`) maps task types to ordered chains of models. The system tries each model in order, skipping models that are in rate-limit backoff. Claude Haiku 4.5 is primary for all reasoning/vision tasks; free models handle classification and validation.

### Task Types and Model Chains

| Task Type | Primary | Fallbacks | Notes |
|-----------|---------|-----------|-------|
| `understand` | Claude Haiku 4.5 | Groq Scout → Kimi K2 → Llama-3.3 → DeepSeek | NLU, intent detection |
| `plan` | Claude Haiku 4.5 | Kimi K2 → Groq Scout → Qwen3-32B → DeepSeek | Multi-step planning |
| `reason` | Claude Haiku 4.5 | Llama-3.3 → Groq Scout → Kimi K2 → DeepSeek | Complex logic |
| `vision` | Claude Haiku 4.5 | Groq Scout (vision) → Gemini 2.5 Flash | Screenshot analysis |
| `validate` | Groq Llama-8B | Qwen3-32B → Mistral Small → Cerebras → Gemini | Outcome checks (free) |
| `respond` | Groq Scout | Kimi K2 → Gemma-3-27B → Cerebras Qwen → Llama-3.3 | Final response gen |
| `generate` | OpenRouter Qwen3-Coder | Mistral Small → Cerebras Qwen → Kimi K2 → Gemini | Code/doc generation |
| `classify` | Groq Llama-8B | Qwen3-32B → Mistral Small → Cerebras → Gemini | Fast classification |
| `complex` | Groq Scout | Kimi K2 → OpenRouter Llama-3.3 → Cerebras → DeepSeek | Agent team tasks |
| `local` | Ollama Llama3 | Ollama Mistral → Gemini | Privacy/offline mode |

### Model Costs

| Provider | Model | Input ($/M) | Output ($/M) | Typical Use |
|----------|-------|-------------|--------------|-------------|
| Anthropic | Claude Haiku 4.5 | $0.80 | $4.00 | Browser + vision tasks |
| DeepSeek | deepseek-chat | $0.27 | $1.10 | Text fallback, writing |
| Gemini | gemini-2.5-flash | $0.15 | $0.60 | Vision fallback |
| Groq | Scout / Kimi / Llama | $0 | $0 | Free tier, classification |
| OpenRouter | Various free models | $0 | $0 | Fallback pool |
| Cerebras | llama-3.1-8b | $0 | $0 | Ultra-fast, free |
| Ollama | Local models | $0 | $0 | Privacy mode |

**Billing markup**: 20% added to all AI costs (`BILLING_MARKUP = 1.20`).

### Rate Limit Handling

- Per-model backoff tracked in `rateLimitBackoff` Map
- 429/402 → skip model for 60–120 seconds
- Per-model circuit breakers (not per-provider — Groq Scout and Groq Llama have independent breakers)
- Global AI concurrency semaphore: 4 slots across all tasks, priority queue

### Per-User OpenRouter Keys

Users can supply their own OpenRouter API key via Settings. The key is stored AES-256-GCM encrypted in `user_settings.openrouter_api_key` and decrypted at request time. Model routing respects the user's `openrouter_model_preset` ("free" / "quality" / "balanced" / "auto").

---

## 5. Browser Automation Stack

### Priority Order

```
1. Bright Data Scraping Browser (remote, $0.02/session)
   wss://brd-customer-*.brd.superproxy.io:9222
   └─ Best for: anti-bot sites (Amazon, LinkedIn, travel)
   └─ Configured via: BRIGHT_DATA_BROWSER_WS env var

2. Remote Chrome CDP (VPS or Railway sidecar)
   REMOTE_BROWSER_CDP env var → ws://host:9222
   └─ Best for: general browsing without Bright Data quota

3. Local patchright (Chromium in Railway container)
   └─ Best for: development, fallback when remote unavailable
   └─ Stealth: patches Runtime.enable CDP leak
```

**CRITICAL**: `FORCE_LOCAL_BROWSER=true` env var blocks Bright Data — never set it on Railway.

### Vision Agent (Observe → Reason → Act)

Source: `packages/agent/src/execution/vision-agent.ts`

```
For each step (max 40 steps, 8-min total timeout):
  1. OBSERVE   — take screenshot, extract accessibility tree
  2. REASON    — ask Claude Haiku 4.5 (vision): "what do I see? what's next?"
  3. ACT       — execute one of:
                   CLICK [n] — by element ref number
                   CLICK_AT x,y — by pixel coordinate
                   TYPE "text" — keyboard input
                   FILL #selector "value" — form fill (React-native setter)
                   NAVIGATE url — browser navigation
                   SCROLL direction — page scroll
                   WAIT n — explicit wait
                   DONE — task complete
                   FAIL reason — unrecoverable failure

Stuck detection:
  - Same URL 3+ times → force vision mode, take fresh screenshot
  - Vision used → reset sameUrlCount to 0
  - Error pages → auto-recover (chrome-error://)
  - Repeat guard: same action twice → bail

CAPTCHA handling:
  - CapSolver API (CAP-025A0A...) — reCAPTCHA v2/v3, Cloudflare Turnstile
  - 2captcha fallback

Cookie consent:
  - Auto-dismissed on first navigation
```

### Click Cascade (4 strategies)

1. Playwright native `getByRole()` / `getByText()`
2. Coordinate click from `getBoundingClientRect()` (cx, cy)
3. CDP `Runtime.evaluate` click injection
4. JavaScript `element.click()` direct call

### Stealth Layers

| Layer | What It Does |
|-------|-------------|
| patchright | Patches `Runtime.enable` CDP leak that fingerprints headless Chrome |
| `stealth.ts` | JS patches: `navigator.webdriver`, `chrome.runtime`, canvas noise |
| Ghost cursor | Bezier-curve mouse movements (not straight lines) |
| Chrome 134 UA | Current user-agent string |
| CDP screenX/Y | Fixes reported screen coordinates |

### Verification

After each action sequence, the agent takes a screenshot and asks the vision model: "did this succeed?" Three consecutive failures (strikes) trigger task failure or user takeover request.

---

## 6. Voice Pipeline

### Architecture

```
User phone call
      │
      ▼
  Twilio (PSTN)
      │ HTTP POST (webhook)
      ▼
  /webhook/voice/incoming  (index.ts)
      │ validates caller, checks PIN, routes
      ▼
  TwiML Response: <ConversationRelay>
      │ WebSocket upgrade
      ▼
  /ws/voice  (WebSocket server in index.ts)
      │
      ▼
  voice-conversation.ts (handleVoiceWebSocket)
      │
      ├─ ElevenLabs TTS (via Twilio ConversationRelay — no API key needed)
      │   Default voice: Sarah EXAVITQu4vr4xnSDxMaL
      │   Health voice:  Daniel onwK4e9ZLuTAKqWW03F9
      │
      ├─ Deepgram STT (via Twilio ConversationRelay)
      │
      └─ processTask() (full AI loop) for each user utterance
```

### Call Paths (4 TwiML endpoints)

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `POST /webhook/voice/incoming` | Inbound calls to user's dedicated number | PIN (DTMF) |
| `POST /webhook/voice/demo-outbound` | "Call Me Now" demo from website | None (demo) |
| `POST /webhook/voice/outbound-twiml` | Agent calls user back (scheduled) | userId in query |
| `POST /webhook/voice/external-call-twiml` | Agent calls business/restaurant | userId in query |

All four paths use `ttsProvider="ElevenLabs"` and `interruptible="false"` (prevents echo loop).

### Voice Safety Features

| Feature | Detail |
|---------|--------|
| Silence watchdog | 25s silence → "Still there?" → 15s → hang up |
| Goodbye detection | Detects "bye", "goodbye" → 3s then hang up |
| AMD (voicemail detection) | `DetectMessageEnd` → auto-leave voicemail → hang up |
| Per-call budget cap | $5 per call |
| Daily call limit | 50 calls/day per user (DB-backed) |
| Echo detection | 2s window — stops TTS→mic→STT→interrupt loop |
| Demo minute cap | 60 min/day in-memory counter (~$3.15 max) |

### StatusCallback (Call Cost Tracking)

`POST /webhook/voice/call-end` receives Twilio StatusCallback at call end:
- Records actual duration × $0.0525/min to `ai_cost_log`
- Replaces hardcoded $0.16 estimate (root cause of $400 Twilio charge incident)

### AMD Webhook

`POST /webhook/voice/amd-status` receives AMD result:
- If `AnsweredBy=machine_start` → trigger `triggerAmdHangup()` → leave voicemail message

---

## 7. Memory System

### 4 Layers

```
┌────────────────────────────────────────────────┐
│ Layer 1: Profile Memory                        │
│ Table: profiles                                │
│ Fields: display_name, timezone, phone_number,  │
│         preferred_name, main_uses, autonomy    │
│ Scope: Permanent, structured                   │
└────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────┐
│ Layer 2: Long-Term Facts (Episodic)            │
│ Table: user_memory                             │
│ Written via: [REMEMBER: fact]  AI tags         │
│ Read via: get_long_term_facts RPC              │
│ Semantic search: pgvector embeddings (optional)│
│ Scope: Permanent, user-controlled              │
└────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────┐
│ Layer 3: Working Memory (Task Context)         │
│ Source: recent tasks, context-carryover.ts     │
│ TTL: last 5 tasks within 2 hours               │
│ Scope: Session-level, cross-task context       │
└────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────┐
│ Layer 4: Daily Logs                            │
│ Table: daily_summaries (appended daily)        │
│ Function: appendDailyLog()                     │
│ Scope: Day-level activity summary              │
└────────────────────────────────────────────────┘
```

### Hive Mind (Cross-User Learning)

```
Table: global_learnings
- Fully anonymized (no user_id column)
- domain + task_type + approach → outcome
- success_rate updated via EMA on each use
- RLS: anyone reads, only service_role writes

Table: failure_fixes (per-user)
- Records failure_approach → successful_fix pairs
- fix_category: 'oauth_fallback', 'coordinate_click', etc.

Table: model_performance
- Per user × model × task_type × domain
- Tracks successes, failures, tokens, cost, latency
- Used by model-intelligence.ts for adaptive routing
```

Memory is loaded at the start of every task via `loadMemory()` and injected into the system prompt. The AI writes new facts back using `[REMEMBER: fact]` tags which `processor.ts` parses and persists.

---

## 8. Cost Tracking Flow

```
Task executes AI call
      │
      ▼
trackServiceCost(userId, provider, model, inputTokens, outputTokens)
      │
      ├─ api_cost = (inputTokens/1M × costPerMInput) + (outputTokens/1M × costPerMOutput)
      ├─ billed_cost = api_cost × 1.20  (BILLING_MARKUP)
      │
      ▼
ai_cost_log INSERT:
  user_id, provider, model, task_type, purpose
  input_tokens, output_tokens, api_cost_usd, billed_cost_usd
  created_at

      │
      ▼
tasks UPDATE:
  cost_usd += billed_cost  (running total)

      │
      ▼
credit_wallets DEDUCT (via deduct_credits() RPC):
  balance -= billed_cost
  If balance < 0 → sendOverQuotaEmail() → task blocked
```

### Cost Protection Limits

| Limit | Value | Configurable |
|-------|-------|-------------|
| Per-task AI budget | $5.00 | `task_budget_cents` in user_settings |
| Per-call voice budget | $5.00 | Hardcoded |
| Daily SMS limit | 15 proactive SMS/day | `daily_sms_limit` in user_settings |
| Max monitoring jobs | 3 concurrent | `max_monitor_jobs` in user_settings |
| Demo daily minutes | 60 min/day | `DEMO_DAILY_MINUTE_CAP` constant |

### Daily Twilio Reconciliation

`twilio-reconciliation.ts` fires at startup and every 24 hours:
- Queries Twilio API for actual call costs
- Compares against `ai_cost_log`
- Alerts if discrepancy > 20%

---

## 9. Security Layers

### Transport

| Layer | Mechanism |
|-------|-----------|
| HTTPS everywhere | Enforced by Vercel + Railway |
| HSTS | 1-year max-age, includeSubDomains, preload |
| CORS | Strict whitelist: aevoy.com, www.aevoy.com (prod) |
| CSP | Restrictive: no wildcards, frame-ancestors: none |
| X-Frame-Options | DENY |
| Permissions-Policy | Blocks camera, mic, geolocation, payment |

### Authentication

| Layer | Mechanism |
|-------|-----------|
| Web users | Supabase Auth (email/password + OAuth) |
| Agent webhooks | `AGENT_WEBHOOK_SECRET` header, `timingSafeEqual` comparison |
| Twilio webhooks | `X-Twilio-Signature` HMAC validation |
| Voice callers | Unified PIN (bcrypt, 5 attempts → 1-hour lockout) |
| SMS senders | PIN in message body (unknown numbers) |
| Email senders | PIN in subject/body (inbox-poller) |
| Telegram/WhatsApp | No PIN (identity verified at link time) |
| Demo calls | No PIN (sales demo, no user data access) |

### Data Encryption

| Data | Algorithm | Key |
|------|-----------|-----|
| Agent passwords | AES-256-GCM | `ENCRYPTION_KEY` (64-char hex) |
| User API keys (OpenRouter, etc.) | AES-256-GCM | `ENCRYPTION_KEY` |
| PINs | bcrypt (rounds=10) | N/A (one-way) |
| Voice PINs (legacy) | bcrypt (auto-migrated) | N/A |

### Database

- Row Level Security (RLS) on all 43+ tables
- `user_id` filter on every policy
- Service role key only on agent (never in browser)
- Supabase anon key only for auth flows in frontend
- `global_learnings` — no user_id column (fully anonymized)

### Input Validation

- `sanitizeTaskInput()` — prompt injection detection before any AI call
- `PAGE_INJECTION_PATTERNS` — detects injected AI instructions in scraped page content
- `[UNTRUSTED PAGE CONTENT]` wrapper — all scraped HTML wrapped before sending to AI
- `sanitizeElementName()` — cleans DOM element names without truncation
- Emergency number blocking (911, 112) on all outbound call paths
- Call rate limits: 3 call_user + 3 call_external per task
- Request body limit: 1MB

### Encryption Key Validation at Startup

The agent validates `ENCRYPTION_KEY` at startup and exits if:
- Not 64 hex characters
- All same character (e.g., all zeros, all Fs)
- Repeating pattern
- Fewer than 10 unique characters

Generate a valid key with: `openssl rand -hex 32`
