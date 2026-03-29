# AUDIT-DISCOVERY.md — Phase 1 Complete
**Date**: 2026-03-29
**Commit**: 959ec1e (HEAD of main)

---

## 1. Project Structure

**Monorepo** (pnpm workspaces):
- `apps/web/` — Next.js 16.1.6 frontend (Vercel)
- `packages/agent/` — Express 4.21 backend (Railway)
- `workers/email-router/` — Cloudflare Worker (email ingress)

### Agent Source (`packages/agent/src/`)
- `index.ts` — 4000+ lines, 68 Express routes
- `v3/` — V3 tiered processor (ACTIVE), 17 tools, model router
- `services/` — 50+ service files (AI, Twilio, email, memory, personality, etc.)
- `execution/` — Document creation (Excel, PDF, Word, PowerPoint)
- `middleware/` — Rate limiting, budget checks
- `routes/` — Aurora listen WebSocket, skills
- `security/` — Encryption, intent lock, validator
- `utils/` — Cost calculator, PIN auth, error tracker, logger

### Web App (`apps/web/app/`)
- 30+ pages (dashboard, aurora, billing, settings, admin, store, developer)
- 90+ API routes
- Admin panel at `/x7k9f` (obscured path)

---

## 2. Every Express Route (Agent — 68 routes)

### Health & Status (5)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Minimal health check for load balancers |
| GET | `/aurora/status` | Service status with AI backoff info |
| GET | `/health/detailed` | Detailed health (requires webhook secret) |
| GET | `/admin/health` | Comprehensive admin health (requires Bearer auth) |
| GET | `/health/memory` | Memory subsystem health |

### Task Processing (6)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/task` | Legacy V1 task processor |
| POST | `/task/v2` | V2 task processor with planning |
| POST | `/task/incoming` | Full processor for incoming tasks (30x iterations) |
| POST | `/task/confirm` | Plan confirmation (YES/NO/MODIFY) |
| POST | `/task/verification` | Verification code reply handler |
| GET | `/task/:taskId/status` | Task status with vision agent steps |

### Voice Webhooks (17)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook/voice/incoming` | Incoming voice calls with caller ID |
| POST | `/webhook/voice/demo-outbound` | Demo number outbound call TwiML |
| POST | `/webhook/voice/outbound-twiml` | Outbound scheduled callback TwiML |
| POST | `/webhook/voice/external-call-twiml` | External call TwiML (calling businesses) |
| POST | `/webhook/voice/:userId` | Generic user voice webhook |
| POST | `/webhook/voice/process/:userId` | Voice command processor |
| POST | `/webhook/voice/email-decision/:userId/:queueId` | Email voice decision |
| POST | `/webhook/voice/message/:userId` | Message-taking (receptionist mode) |
| POST | `/webhook/voice/pin-verify` | PIN verification for unknown callers |
| POST | `/webhook/voice/premium/:userId` | Premium number voice webhook |
| POST | `/webhook/voice/call-end` | Call cost tracking (StatusCallback) |
| POST | `/webhook/voice/amd-status` | Answering Machine Detection |
| POST | `/webhook/voice/onboarding-verify` | Phone verification for onboarding |
| POST | `/webhook/voice/onboarding-gather/:userId` | Verification call TwiML |
| POST | `/webhook/voice/onboarding-confirm/:userId` | Handle verification key press |
| POST | `/webhook/checkin/:userId` | Daily check-in call TwiML |
| POST | `/webhook/checkin/response/:userId` | Check-in response handler |

### SMS Webhooks (3)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook/sms/:userId` | SMS to specific user |
| POST | `/webhook/sms/incoming` | Incoming SMS with caller identification |
| POST | `/webhook/sms/premium/:userId` | Premium number SMS |

### Chat Platform Webhooks (2)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook/telegram` | Telegram bot messaging |
| POST | `/webhook/whatsapp` | WhatsApp messaging |

### Email (2)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/email/test` | Test IMAP connection |
| POST | `/email/send` | Send email via Resend |

### Aurora (5)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/aurora/settings` | Update user communication settings |
| GET | `/aurora/feed/:userId` | Get user activity feed |
| POST | `/aurora/onboard` | Trigger onboarding call |
| POST | `/aurora/onboard/amd` | AMD voicemail detection for onboarding |
| POST | `/aurora/error` | Frontend error reporting |

### Debug (5)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/debug/proactive` | Trigger proactive checks on demand |
| GET | `/debug/test-apis` | Test all AI APIs |
| GET | `/debug/test-image-gen` | Test image generation |
| GET | `/debug/voice-twiml` | Debug TwiML generation |
| POST | `/debug/email-test` | Test email config |

### Other (8)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/files/:type/:filename` | Serve generated documents |
| GET | `/tasks/active` | List currently processing tasks |
| POST | `/api/verify-pin` | Unified PIN verification |
| POST | `/takeover/validate-token` | Takeover token validation |
| GET | `/engines` | Engine registry status |
| POST | `/admin/clear-active-tasks` | Clear stale tasks |
| POST | `/test/smoke` | Dev-only smoke test |
| * | `/skills/*` | Mounted skill routes |

### WebSocket (3)
| Path | Purpose |
|------|---------|
| `/ws/voice` | ConversationRelay voice calls |
| `/ws/browser/:taskId` | Browser takeover (disabled for Aurora) |
| `/aurora/listen/ws` | Aurora listening (Deepgram proxy) |

---

## 3. Database — 78 Tables

### Core Tables
| Table | Rows | RLS | Purpose |
|-------|------|-----|---------|
| profiles | 13 | Yes | User accounts |
| tasks | 11,880 | Yes | Task records |
| user_settings | 13 | Yes | User preferences |
| user_twilio_numbers | 2 | Yes | Dedicated phone numbers |
| credit_wallets | 13 | Yes | Prepaid credits |
| credit_transactions | 6,100 | Yes | Wallet audit trail |
| ai_cost_log | 29,924 | Yes | Per-API-call cost tracking |
| user_memory | 7,690 | Yes | 4-tier memory (encrypted) |
| scheduled_tasks | 158 | Yes | Cron jobs |
| action_history | 15,009 | Yes | Action audit log |

### Aurora-Specific Tables
| Table | Rows | Purpose |
|-------|------|---------|
| user_context | 424 | Extracted entities with confidence |
| detected_patterns | 76 | Learned behavioral patterns |
| commitments | 92 | User commitments with due dates |
| proactive_queue | 63 | Pending autonomous actions |
| conversation_context | 352 | Message history + extracted intents |
| channel_preferences | 187 | Learned channel preferences |

### Communication Tables
| Table | Rows | Purpose |
|-------|------|---------|
| call_history | 173 | Call analytics |
| inbox_settings | 20 | Email autonomy config |
| inbox_queue | 0 | Email ingestion queue |
| inbox_processing_log | 2,060 | Email processing audit |
| telegram_link_codes | 5 | Telegram account linking |

### Deprecated/Unused (marked for removal)
- `_deprecated_failure_memory`, `_deprecated_learnings`
- `_deprecated_marketplace_apps/installs/reviews`
- `marketplace_categories` (RLS disabled!)
- `vps_instances`, `user_vps_assignments`
- `browser_sessions` (0 rows)

### ISSUE: `processor_version` column missing from `tasks` table
The CLAUDE.md references this but the column doesn't exist. Migration may have been missed.

---

## 4. External Service Integrations

### AI Models
| Provider | Status | Models | Cost |
|----------|--------|--------|------|
| Groq | Configured | llama-3.1-8b, Scout, Kimi K2 | FREE |
| DeepSeek | Configured | deepseek-chat | $0.27/$1.10 per M |
| Anthropic | Configured | claude-haiku-4.5 | $1/$5 per M |
| Google (Gemini) | Configured | gemini-2.5-flash | $0.15/$0.60 per M |
| Kimi | Configured | moonshot models | Variable |

### Communication
| Provider | Purpose | Status |
|----------|---------|--------|
| Twilio | SMS + Voice + WhatsApp | Configured |
| Resend | Outbound email | Configured |
| IMAP (Gmail) | Inbound email polling | Configured |
| Telegram | Bot messaging | Configured |
| Deepgram | Real-time transcription (Aurora) | Configured |
| ElevenLabs | TTS for voice calls | Configured (native to Twilio) |

### Browser Automation
| Provider | Purpose | Status |
|----------|---------|--------|
| Playwright | Browser automation | Installed (v1.58.1) |
| Patchright | Stealth browser | Installed (v1.58.2) |
| Stagehand | Browser automation lib | Installed (v2.0.0) |
| CapSolver | CAPTCHA solving (primary) | Configured |
| 2Captcha | CAPTCHA solving (fallback) | Configured |
| Steel.dev | Cloud browser | Configured |
| Browserbase | Cloud browser | Configured |

### Payments & Security
| Provider | Purpose | Status |
|----------|---------|--------|
| Stripe | Billing/payments | Configured |
| bcrypt | PIN hashing | Installed |
| AES-256-GCM | Credential encryption | Configured |

---

## 5. Environment Variables

### Required (22)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY` (primary free model)
- `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`
- `RESEND_API_KEY`
- `AGENT_WEBHOOK_SECRET`, `AGENT_PORT`, `AGENT_URL`
- `ENCRYPTION_KEY`, `JWT_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL`, `ALLOWED_ORIGINS`

### Optional (20+)
- `KIMI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `DEEPGRAM_API_KEY`, `CAPSOLVER_API_KEY`, `TWOCAPTCHA_API_KEY`
- `STEEL_API_KEY`, `BROWSERBASE_API_KEY/PROJECT_ID`
- `CLOUDFLARE_*` (5 vars for email worker)
- `BILLING_ENABLED`, `AI_MOCK_MODE`, `TEST_MODE`
- `DEMO_PHONE_NUMBER`, `HETZNER_API_TOKEN`

---

## 6. Deployment Configuration

### Railway (Agent)
- Dockerfile: Node 20-slim + Playwright deps + real Chrome + Xvfb
- Health check: `GET /health` every 30s
- Port: 3001 (via $PORT)
- Memory: 4GB max heap (`--max-old-space-size=4096`)
- Auto-deploy on push to main

### Vercel (Web)
- Next.js 16.1.6
- Auto-deploy on push to main

### Cloudflare (Email Worker)
- Manual deploy via `wrangler deploy`

---

## 7. Production State — Key Metrics

### Users: 13 profiles
- Omar (dd7d0b19): beta tier, 5,984 messages used, no Twilio number assigned
- Test user (11684ec6): has Twilio number +17789249312, $4,940.29 credits
- altafebrahim (42276366): pro tier, 144 messages, $9,998.80 credits
- courtlinelaw (9feaea38): has Twilio number +17789079355, $1.22 credits

### Tasks: 11,880 total
- Completed: 7,254 (61.1%)
- Needs Review: 2,816 (23.7%)
- Failed: 1,784 (15.0%)
- Other: 26 (0.2%)

### Channels Used
- Proactive: 7,768 (65.4%) — most tasks are proactive suggestions
- Email: 2,188 (18.4%)
- Web: 1,698 (14.3%)
- SMS: 53 (0.4%)
- Voice: 35 (0.3%)
- Microphone (Aurora): 5

### Recent (last 9 days): 291 tasks
- 0 failures (100% success rate recently)
- SMS flow works (977ms response time on last test)
- Email flow works ($0.11 cost, 210s execution for complex task)
- Voice works (10 completed)
- Aurora microphone: 5 completed

### Verification Quality
- Verified: 6,596 (83.2%)
- Unverified: 1,277 (16.1%)
- Failed/Hallucination/Delegation/Other: 68 (0.9%)

---

## 8. CRITICAL FINDINGS

### CRITICAL Issues
1. **Omar has no Twilio number assigned** — He can't receive SMS responses to his own account
2. **`processor_version` column missing** from tasks table — V3/V1 tracking broken
3. **`marketplace_categories` has RLS disabled** — potential data leak (low risk, deprecated table)
4. **`takeover_tokens` has RLS disabled** — 13,367 rows, potential security issue

### HIGH Issues
5. **15% overall task failure rate** (1,784 failed) — mostly historical, recent rate is 0%
6. **SMS only 53 tasks ever** — very low usage despite being the primary demo channel
7. **No `processor_version` tracking** — can't distinguish V1 vs V3 task outcomes
8. **23.7% needs_review** — 2,816 tasks flagged but no evidence of human review workflow

### MEDIUM Issues
9. **5 tasks stuck in `awaiting_user_input`** — 3 are "Login test" from March 5
10. **Empty `error_logs` table** — structured error logging exists but has 0 rows
11. **Empty `inbox_queue`** — email ingestion may not be running
12. **0 rows in `credential_vault`** — no stored credentials for autonomous tasks
13. **Multiple deprecated tables** still present — cleanup needed

---

## 9. V3 Processor Architecture (ACTIVE)

### Tier Classification
- **Instant** (<1s): Greetings, knowledge questions
- **Single Tool** (1-6s): Weather, email, SMS, calendar, documents
- **Multi-Step** (up to 40min): Browser automation, research, complex tasks
- **Autonomous** (deferred): Multi-day campaigns (not implemented)

### Model Routing (cheapest first)
1. Groq 8B (FREE) → classify, instant
2. DeepSeek ($0.27/$1.10) → single_tool, multi_step
3. Gemini Flash ($0.15/$0.60) → fallback
4. Haiku ($1/$5) → last resort for multi_step

### 17 Registered Tools
Communication: send_email, send_sms, make_call, read_inbox, ask_user, send_telegram, send_whatsapp
Data: weather, web_search, remember, recall
Files: create_document, generate_image
System: schedule_task, check_calendar, create_event
Browser: browser_go, browser_click, browser_fill, browser_snapshot, browser_screenshot, browser_close

### Quality Gate
Cross-references AI claims against actual tool execution. Catches: hallucinations, credential leaks, vague responses, delegation, no-action browser tasks.

---

## 10. Aurora System (Ambient Detection)

### Pipeline
```
Mic → 16kHz PCM → WebSocket → Deepgram Nova-2 → Transcription
  → 5-word buffer OR UtteranceEnd → extractContext()
    → Regex: 10 ACTION_INTENT_PATTERNS (instant, free)
    → LLM: Groq Llama-8B (entities, commitments, emotions)
    → IF action → intent_detected → processTaskV3() immediately
```

### Cost: $0.0077/min (~$0.46/hour), 120-min daily budget per user

---

## 11. Personality Engine (Excellent)

### SOUL.md — Voice traits
- Direct, dry humor, contractions, fragments
- Never says "Certainly!", "Absolutely!", "Great question!"
- Banned words: delve, embark, foster, harness, illuminate, etc.
- Dry humor: "Insurance is technically optional in the same way that air is."

### IDENTITY.md — Channel standards
- SMS: Short, to the point
- Email: No greetings, no sign-offs
- Voice: One idea per sentence, natural rhythm
- Task reports: Report what happened, not what you did

---

## 12. CLAUDE.md Status

The existing CLAUDE.md is **current and comprehensive**. It accurately reflects:
- Project structure and file paths
- V3 processor architecture
- Aurora speech pipeline
- Deployment configuration
- Environment variables
- Security rules
- Known issues

No updates needed to CLAUDE.md.
