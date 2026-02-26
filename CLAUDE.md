# Aevoy — Claude Code Context

> Comprehensive codebase reference. Read this before diving into any task.

## Stack
- **Monorepo**: pnpm workspaces
- **Frontend**: `apps/web/` — Next.js 14, Supabase Auth, Tailwind
- **Agent**: `packages/agent/` — Express, TypeScript, patchright
- **Email Worker**: `workers/email-router/` — Cloudflare Worker
- **Database**: Supabase (`eawoquqgfndmphogwjeu`), 43+ tables, RLS on all

## Deployment
| Service | URL | Check |
|---------|-----|-------|
| Vercel (web) | https://www.aevoy.com | Vercel dashboard |
| Railway (agent) | https://agent-production-1339.up.railway.app | `/health` endpoint |
| Supabase | eawoquqgfndmphogwjeu | MCP tools |

## Build Commands
```bash
pnpm --filter web build       # Build frontend
pnpm --filter agent build     # Build agent (TypeScript)
pnpm --filter web dev         # Dev server (port 3000)
pnpm --filter agent dev       # Agent dev (port 3001)
```

## Key File Paths

### Agent Core Pipeline
- `packages/agent/src/services/processor.ts` — Main task orchestrator (7000+ lines)
- `packages/agent/src/services/processor-v2.ts` — V2 for /task/v2 endpoint
- `packages/agent/src/services/ai.ts` — AI model selection, cost tracking, main system prompt
- `packages/agent/src/execution/vision-agent.ts` — Browser automation (Observe→Reason→Act)
- `packages/agent/src/index.ts` — Express routes (70+)

### Frontend
- `apps/web/app/page.tsx` — Landing page (~2000 lines, single file)
- `apps/web/app/dashboard/page.tsx` — Dashboard
- `apps/web/components/onboarding/unified-flow.tsx` — Onboarding (6 steps) — THIS is what /dashboard renders
- `apps/web/supabase/` — DB migrations v1–v35

### Services
- `packages/agent/src/services/email.ts` — Resend email sending
- `packages/agent/src/services/twilio.ts` — SMS, voice, ConversationRelay
- `packages/agent/src/services/memory.ts` — Profile + working + episodic + daily logs
- `packages/agent/src/services/inbox-poller.ts` — IMAP polling, Resend forwarding
- `packages/agent/src/services/scheduler.ts` — Cron scheduling
- `packages/agent/src/services/proactive.ts` — Hourly proactive checks
- `packages/agent/src/services/proactive-engagement.ts` — Daily digests, weekly reports
- `packages/agent/src/services/autonomous-integration.ts` — AGI executor
- `packages/agent/src/utils/pin-auth.ts` — Unified PIN verification

## Agent Pipeline Flow

```
HTTP POST /task or /task/v2
  ↓
FAST PATHS (pre-AI bypasses, < 500ms)
  ├─ Weather: wttr.in API
  ├─ Email send: direct Resend
  ├─ Schedule: direct DB insert
  ├─ Greeting: quick AI response
  ├─ SMS: direct Twilio
  └─ Call: direct Twilio
  ↓
AI EXECUTION LOOP (max 15 iterations, 40-min timeout, $5 budget)
  ├─ Classify → decompose → plan
  ├─ Generate actions (Claude/Groq/DeepSeek/Gemini)
  ├─ Execute actions (browser/API/email/SMS/voice)
  ├─ Vision agent for browser tasks (40 steps, 8 min)
  ├─ Progress ledger every 5 iterations (Magentic-One pattern)
  └─ Verification: screenshot-based, 3 strikes
  ↓
PROACTIVE FOLLOW-UP
  ├─ Detect natural next step (restaurant → offer to book)
  └─ Append 1-sentence follow-up question to response
  ↓
RESPONSE via user's channel (email/SMS/voice/web)
```

## Action Types (complete list)
`browse`, `search`, `screenshot`, `fill_form`, `send_email`, `read_email`, `remember`, `schedule`, `click`, `fill`, `select`, `submit`, `login`, `scroll`, `wait`, `extract`, `create_excel`, `create_powerpoint`, `create_word`, `create_pdf`, `screenshot_ocr`, `generate_image`, `post_tweet`, `create_campaign`, `generate_video_call`, `analyze_health_data`, `check_calendar`, `create_event`, `send_sms`, `send_whatsapp`, `send_telegram`, `call_user`, `call_external`

## Input Channels
`email | sms | voice | chat | web | desktop | proactive | workflow | telegram | whatsapp`

## Database Tables (key ones)
- `profiles` — User account, display_name, phone_number, timezone
- `user_settings` — confirmation_mode, proactive_enabled, proactive_channel, greeting_style
- `tasks` — Task records with status, cost, input_channel, response_text
- `scheduled_tasks` — Cron jobs (cron_expression = 'once' for one-time)
- `user_twilio_numbers` — Dedicated phone numbers per user
- `credit_wallets` — Prepaid credits balance
- `ai_cost_log` — AI cost tracking (billed_cost = api_cost × 1.2)
- `distributed_locks` — DB-level locks for scheduler/inbox
- `processed_emails` — Deduplication for email processing
- `credential_vault` — Encrypted API credentials
- `oauth_connections` — OAuth tokens (Google, Microsoft, Twitter, Fitbit)

## Environment Variables (Required)
```
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
AGENT_WEBHOOK_SECRET
ENCRYPTION_KEY (64-char hex)
GROQ_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
RESEND_API_KEY
AGENT_URL=https://agent-production-1339.up.railway.app
TWILIO_CALLBACK_URL=https://agent-production-1339.up.railway.app
```

## Voice Configuration
- **Provider**: ElevenLabs (native to Twilio ConversationRelay — no API key needed)
- **Default voice**: Sarah `EXAVITQu4vr4xnSDxMaL`
- **Health doctor**: Daniel `onwK4e9ZLuTAKqWW03F9`
- **DO NOT add** `ttsLanguage` or `-flash_v2_5` model specs — both broke testing
- All 4 call paths in `index.ts` use `ttsProvider="ElevenLabs"` hardcoded

## Demo System (Website "Call Me Now")
- **Number**: +17789008951 (`DEMO_PHONE_NUMBER` env var)
- Unknown callers → Sarah voice, sales pitch
- Registered users → personalized greeting
- Onboarding users → 6-question interview → saves [SAVE:field=value] to profile
- No PIN required for demo calls

## Unified PIN System
- **Storage**: `unified_pin_hash` (bcrypt) in `profiles`
- **Utility**: `packages/agent/src/utils/pin-auth.ts`
- **Lockout**: 5 wrong attempts = 1 hour
- **Channels**: Voice (DTMF), Email (subject/body), SMS (message body)
- **Exempt**: Demo, WhatsApp, Telegram

## Email Routing
- **Ingress**: Cloudflare Worker → `inbox_queue` Supabase table
- **Poller**: IMAP (Gmail app password) in `inbox-poller.ts`
- **Outbound**: Resend API
- **Admin bypass**: omar@, hello@, welcome@, info@, contact@, etc. → forward to admin
- **Omar's account**: username `Tess`, ID `dd7d0b19-b275-4caa-86ca-1027ba37a1fd`

## Browser Automation
- **Primary**: patchright (CDP stealth, patches Runtime.enable leak)
- **Stealth layers**: `stealth.ts` (JS patches) + `captcha.ts` (CapSolver/2captcha)
- **Vision agent**: 40 steps max, 8-min timeout, Gemini Flash vision AI
- **CAPTCHA**: CapSolver API key: `CAP-025A0A30DAFBB09042E5D95A24B8917931ED20B18DE9933C128E8EBB4A5BC4D4`

## Cost & Billing
- `BILLING_MARKUP = 1.20` in `cost-calculator.ts`
- `ai_cost_log` stores billed cost (with markup already applied)
- Billing bypass when no Stripe key (dev/beta mode)

## Test User
- Email: `test-e2e@aevoy.com`
- ID: `11684ec6-80cd-4bb6-9aed-8f0947afd06a`
- Password: `VisualTest2026`

## Security Rules
- Never expose internal errors to users
- RLS on all DB tables (user_id filtering)
- AES-256-GCM for credential encryption
- bcrypt for PIN hashing
- TimingSafeEqual for webhook verification

## Proactive Intent Completion (Core AGI Principle)
The agent DRIVES the conversation — it prompts the user, not the other way around.
After every completed task, the agent analyzes if there's a natural next step:
- Restaurant found → offer to call and make reservation
- Product price found → offer to order
- Content written → offer to post
- Research done → offer to act on findings

This is enforced in:
1. `ai.ts` system prompt: PROACTIVE INTENT COMPLETION section
2. `processor.ts`: post-completion quickValidate check appends follow-up question

## Common Pitfalls
- **AGENT_URL on Vercel**: Must be Railway URL, not old dead VPS IP
- **Twilio webhooks**: Must point to Railway (not localhost/VPS)
- **`sendViaChannel` before Supabase update**: Causes "processing" hang — always DB first
- **Onboarding**: `unified-flow.tsx` (NOT `onboarding-flow.tsx`) is what renders
- **Verification email auto-fill**: vision-agent.ts WAIT handler fetches inbox + auto-fills OTP
- **processor-v2 delegation**: passes `subject=task, body=''` to main processTask
