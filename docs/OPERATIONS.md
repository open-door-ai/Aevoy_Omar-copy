# Aevoy AGI Platform — Operations Guide

> Production operations reference for the Railway agent and Vercel frontend.

---

## Table of Contents

1. [Environment Variables](#1-environment-variables)
2. [Railway Deployment](#2-railway-deployment)
3. [Vercel Deployment](#3-vercel-deployment)
4. [Supabase Migrations](#4-supabase-migrations)
5. [Cost Monitoring](#5-cost-monitoring)
6. [Emergency Procedures](#6-emergency-procedures)
7. [Twilio Webhook Configuration](#7-twilio-webhook-configuration)
8. [Known Issues and Workarounds](#8-known-issues-and-workarounds)

---

## 1. Environment Variables

### Required on Railway (Agent)

| Variable | What It Does | Notes |
|----------|-------------|-------|
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption of stored credentials and agent passwords | Generate: `openssl rand -hex 32`. Agent exits if weak/invalid. |
| `AGENT_WEBHOOK_SECRET` | Shared secret for internal API calls from Vercel to Railway | Must match `AGENT_WEBHOOK_SECRET` on Vercel |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://eawoquqgfndmphogwjeu.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) | Never expose to browser |
| `AGENT_URL` | Public Railway URL — used in Twilio webhooks and self-references | `https://agent-production-1339.up.railway.app` — NEVER set to localhost or VPS IP |
| `TWILIO_CALLBACK_URL` | Base URL for Twilio StatusCallback, AMD callback | Same as `AGENT_URL` |

At least one AI provider key is required (agent exits on startup otherwise):

| Variable | Provider | Notes |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | Claude Haiku 4.5 | Primary for browser + vision. ~$0.80/$4 per M. |
| `DEEPSEEK_API_KEY` | DeepSeek chat | Paid fallback for text tasks. $0.27/$1.10 per M. |
| `GOOGLE_API_KEY` | Gemini 2.5 Flash | Vision fallback, image generation. |
| `GROQ_API_KEY` | Groq (Llama, Kimi, Scout) | Free tier, classification/validation. 30 RPM. |

### Optional on Railway (Agent)

| Variable | What It Does | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Outbound email via Resend | Email features disabled without it |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier | SMS + voice disabled without it |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Must be current — rotates in Twilio console |
| `TWILIO_PHONE_NUMBER` | Shared Twilio number (fallback for outbound) | E.164 format e.g. `+17789001234` |
| `DEMO_PHONE_NUMBER` | "Call Me Now" website demo number | `+17789008951` |
| `DEMO_USER_ID` | Supabase user ID to tie demo sessions to | Optional |
| `ELEVENLABS_DEFAULT_VOICE_ID` | ElevenLabs voice for calls | `EXAVITQu4vr4xnSDxMaL` (Sarah) |
| `BRIGHT_DATA_BROWSER_WS` | Bright Data Scraping Browser WebSocket URL | `wss://brd-customer-hl_...@brd.superproxy.io:9222` |
| `REMOTE_BROWSER_CDP` | Remote Chrome CDP endpoint | `ws://host:9222` |
| `CAPSOLVER_API_KEY` | CapSolver CAPTCHA solving API | Required for CAPTCHA bypass |
| `OPENROUTER_API_KEY` | Platform-level OpenRouter key | Fallback model routing |
| `CEREBRAS_API_KEY` | Cerebras ultra-fast inference | Free tier, separate rate limit pool |
| `SAMBANOVA_API_KEY` | SambaNova inference | Free tier fallback |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare AI embeddings for semantic search | Optional |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Optional |
| `KIMI_API_KEY` | Kimi (Moonshot) API | Optional provider |
| `ALLOWED_ORIGINS` | Comma-separated CORS whitelist | `https://aevoy.com,https://www.aevoy.com` |
| `AGENT_PORT` | HTTP listen port | `3001` |
| `USE_CONVERSATION_RELAY` | Enable Twilio ConversationRelay | `true` |
| `AI_MOCK_MODE` | Bypass real AI calls (testing only) | `false` |
| `MONITORING_INTERVAL_MS` | Monitoring heartbeat interval | `900000` (15 min) |

**NEVER set `FORCE_LOCAL_BROWSER=true` on Railway** — it blocks Bright Data and remote CDP.

### Required on Vercel (Frontend)

| Variable | What It Does |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, browser-safe) |
| `AGENT_URL` | Railway agent URL — must be `https://agent-production-1339.up.railway.app` |
| `AGENT_WEBHOOK_SECRET` | Must match the Railway value |

---

## 2. Railway Deployment

### Health Check

```bash
curl https://agent-production-1339.up.railway.app/health
```

Expected response (HTTP 200):

```json
{
  "status": "healthy",
  "version": "2.0.0-agi-v23",
  "gitSha": "abc1234",
  "activeTasks": 0,
  "activeBrowserTasks": 0,
  "activeVoiceSessions": 0,
  "queuedTasks": 0,
  "conversationRelay": true,
  "database": "ok",
  "groqApi": true,
  "anthropicApi": true,
  "agentUrl": "set",
  "brightData": "configured"
}
```

Degraded (HTTP 503) if `database` is not `"ok"`.

### API Validation

```bash
curl https://agent-production-1339.up.railway.app/debug/test-apis
```

Returns live test results for each configured AI provider.

### Deploying

Railway auto-deploys on push to `main`. To force a deploy:

1. Go to Railway dashboard → Aevoy Agent → Deployments → "Deploy Now"
2. Or push an empty commit: `git commit --allow-empty -m "chore: trigger deploy"`

### Checking Deployment Status

Railway shows build logs in real time. Wait for "Deploy succeeded" before running tests. Typical build time: 60–90 seconds.

### Rollback

In Railway dashboard: Deployments → select a previous deployment → "Redeploy".

### Viewing Logs

Railway dashboard → Aevoy Agent → Logs. Filter by:
- `[STARTUP]` — initialization checks
- `[TASK]` — task processing events
- `[VOICE]` — voice call events
- `[SECURITY]` — security events (rate limits, blocked calls)
- `[COUNTER-HEAL]` — task counter self-healing
- `[BACKOFF]` — model rate limit backoffs

---

## 3. Vercel Deployment

Vercel auto-deploys on push to `main`. Build command: `pnpm --filter web build`.

### Build Failures

The most common cause is an imported file that was not committed. Always verify all imports are committed before pushing.

Check build status via Vercel dashboard or:

```bash
gh deployment list --repo aevoy/aevoy
```

### Setting Environment Variables

Variables must be set in Vercel dashboard under Project → Settings → Environment Variables. The `AGENT_URL` variable is critical — it must point to Railway, never to a VPS IP or localhost.

---

## 4. Supabase Migrations

### Naming Convention

```
migration.sql                         # v1 (original)
migration_v2.sql ... migration_v18.sql
migration_v20.sql ... migration_v37.sql
20260305000001_v38_hive_mind_global.sql
20260305000002_v39_workspace.sql
20260305000003_v40_cost_protection.sql
```

Newer migrations use the `YYYYMMDD######_description.sql` format.

### Running a Migration

Apply via Supabase MCP or the dashboard SQL editor:

```bash
# Via MCP tool
mcp__supabase__execute_sql --query "$(cat apps/web/supabase/migration_vXX.sql)"
```

Or paste into Supabase dashboard → SQL Editor → Run.

### Migration Index

| Version | Description |
|---------|-------------|
| v1–v16 | Core tables: profiles, tasks, user_memory, learnings, oauth_connections, credential_vault |
| v17–v19 | Security: PIN system, webhook validation, RLS hardening |
| v20 | Inbox management |
| v21 | Inbox management — email settings |
| v23 | Hive mind learnings with privacy controls |
| v24 | Miscellaneous table fixes |
| v25 | Campaign scheduler |
| v26 | RLS fix for scheduled_tasks |
| v27 | Learnings columns + distributed_locks |
| v28 | Voicemail settings |
| v29 | OpenRouter per-user settings |
| v30 | Messaging channels (credit_wallets, credit_transactions) |
| v31 | Proactive channel setting |
| v32 | Health data tables |
| v33 | Telegram RLS fix |
| v34 | Marketplace tables |
| v35 | Auto-init user_settings + inbox_settings on signup |
| v36 (unified_pin) | unified_pin_hash, pin_attempts, pin_locked_until, agent_passwords_encrypted |
| v36 (dynamic_timeouts) | clarification_timeout_ms, monitoring_interval_ms, max_task_iterations, task_budget_cents, response_channel |
| v37 | Full send mode flag |
| v38 | Semantic search (pgvector) |
| v38 (hive_mind_global) | global_learnings, failure_fixes, model_performance tables |
| v39 | user_workspace_files, contribute_to_hive_mind flag |
| v40 | daily_sms_limit, max_monitor_jobs in user_settings (cost protection) |

---

## 5. Cost Monitoring

### Key Metrics to Watch

| Metric | Query | Alert Threshold |
|--------|-------|----------------|
| Daily AI spend | `SELECT SUM(billed_cost_usd) FROM ai_cost_log WHERE created_at > NOW() - INTERVAL '1 day'` | > $10 |
| Tasks stuck in processing | `SELECT COUNT(*) FROM tasks WHERE status='processing' AND created_at < NOW() - INTERVAL '1 hour'` | > 5 |
| Daily SMS per user | `SELECT user_id, COUNT(*) FROM ai_cost_log WHERE purpose='sms' AND created_at > NOW() - INTERVAL '1 day' GROUP BY user_id` | > 15 per user |
| Active monitoring jobs | `SELECT COUNT(*) FROM user_memory WHERE key LIKE 'MONITOR:%'` | > 3 per user |
| Twilio call cost | `SELECT SUM(billed_cost_usd) FROM ai_cost_log WHERE provider='twilio' AND created_at > NOW() - INTERVAL '1 day'` | > $5 |

### Cost Breakdown (Typical Task)

| Task Type | Typical Cost | Primary Driver |
|-----------|-------------|----------------|
| Simple text query | < $0.001 | Groq free tier |
| Weather lookup | $0 | wttr.in (no AI) |
| Email send | < $0.002 | Resend + Groq classification |
| Web research | $0.02–$0.10 | Claude Haiku for analysis |
| Browser booking (40 steps) | ~$0.06 | Claude Haiku 4.5 vision |
| Outbound voice call (5 min) | ~$0.26 | Twilio ($0.0525/min) + AI |
| Document generation | $0.01–$0.05 | DeepSeek or Gemini |

### Daily Twilio Reconciliation

Fires automatically at startup and every 24 hours. Check logs for `[RECONCILE]` tags. If a >20% discrepancy is detected, an alert is logged and the ops team should investigate.

---

## 6. Emergency Procedures

### Kill All Running Tasks

Set tasks stuck in "processing" to failed:

```sql
UPDATE tasks
SET
  status = 'needs_review',
  response_text = 'Task stopped by operator.',
  error_message = 'Emergency stop',
  completed_at = NOW()
WHERE status = 'processing';
```

### Disable Proactive Monitoring (Runaway Prevention)

The 2026-03-05 incident saw 3,821 tasks/day from runaway proactive monitoring. To prevent recurrence:

1. Set `max_monitor_jobs = 0` for affected users:
   ```sql
   UPDATE user_settings SET max_monitor_jobs = 0 WHERE user_id = 'USER_ID';
   ```

2. To disable all proactive monitoring system-wide, set `MONITORING_INTERVAL_MS=999999999` on Railway (effectively infinite interval) and redeploy.

3. Clear monitoring jobs from user_memory:
   ```sql
   DELETE FROM user_memory WHERE key LIKE 'MONITOR:%' AND user_id = 'USER_ID';
   ```

### Disable Proactive SMS

Cap SMS per user to 0:

```sql
UPDATE user_settings SET daily_sms_limit = 0;
```

### Reset Task Counter Drift

If `activeTasks` counter drifts (tasks stuck in "processing" state but no real work happening), restart the Railway service. The counter self-healing loop reconciles every 2 minutes and will correct on next cycle.

### Block a Phone Number

If a phone number is abusing the voice/SMS system:

```sql
-- There is no dedicated blocklist table — log and update rate limit approach:
-- Option 1: Remove their user_twilio_numbers entry
DELETE FROM user_twilio_numbers WHERE phone_number = '+1XXXXXXXXXX';

-- Option 2: Disable their account
UPDATE profiles SET is_active = false WHERE phone_number = '+1XXXXXXXXXX';
```

Emergency numbers (911, 112) are blocked at the code level in all outbound call paths.

### Rotate Twilio Auth Token

The Twilio auth token can become stale. Signs of staleness: Twilio webhook calls return 401.

1. Go to console.twilio.com → Account → Auth Tokens
2. Generate a new primary token
3. Update `TWILIO_AUTH_TOKEN` on Railway
4. Redeploy

### Rotate ENCRYPTION_KEY

**This is destructive** — all AES-256-GCM encrypted data (agent passwords, user API keys) will be unreadable.

1. Generate new key: `openssl rand -hex 32`
2. Decrypt all encrypted values with old key first (manual process — no migration exists)
3. Update `ENCRYPTION_KEY` on Railway
4. Re-encrypt all values with new key
5. Redeploy

No automated rotation procedure exists. Avoid this unless the key is compromised.

### Fix Stuck Voice Calls

If a Twilio call gets stuck and never hangs up (running up minutes):

1. Go to Twilio console → Monitor → Calls
2. Find the call SID
3. Cancel via Twilio API or dashboard
4. Check `call_history` table for the CallSid and log the real duration

---

## 7. Twilio Webhook Configuration

All Twilio webhooks must point to Railway (`https://agent-production-1339.up.railway.app`). Never point to localhost, a VPS IP, or Vercel.

### Inbound Call Webhook

In Twilio console → Phone Numbers → select number → Voice & Fax:

| Setting | Value |
|---------|-------|
| A Call Comes In | Webhook |
| URL | `https://agent-production-1339.up.railway.app/webhook/voice/incoming` |
| HTTP Method | HTTP POST |

### SMS Webhook

| Setting | Value |
|---------|-------|
| A Message Comes In | Webhook |
| URL | `https://agent-production-1339.up.railway.app/webhook/sms/incoming` |
| HTTP Method | HTTP POST |

### StatusCallback (Call Cost Tracking)

Set on all outbound call API calls (already wired in `twilio.ts`):

| Setting | Value |
|---------|-------|
| StatusCallback | `https://agent-production-1339.up.railway.app/webhook/voice/call-end` |
| StatusCallbackMethod | POST |

### AMD Webhook (Voicemail Detection)

| Setting | Value |
|---------|-------|
| MachineDetection | Enable |
| AsyncAmdStatusCallback | `https://agent-production-1339.up.railway.app/webhook/voice/amd-status` |

### WebSocket (ConversationRelay)

ConversationRelay connects via WebSocket. The URL is assembled in code:

```
ws://agent-production-1339.up.railway.app/ws/voice
```

(Replace `https` with `ws` from `AGENT_URL`.)

### Webhook Auto-Repair

The agent auto-verifies and repairs Twilio webhooks at startup and every 30 minutes. Check logs for `[WEBHOOK-REPAIR]` tags.

---

## 8. Known Issues and Workarounds

### AGENT_URL Must Be Railway URL

**Issue**: `AGENT_URL` set to a dead VPS IP causes all Twilio webhooks to fail silently.

**Fix**: Ensure `AGENT_URL=https://agent-production-1339.up.railway.app` on both Railway and Vercel.

### Twilio Auth Token Staleness

**Issue**: Twilio auth tokens expire or are rotated in the Twilio console without updating the Railway env var. All Twilio webhook signature validations return 401.

**Fix**: Refresh `TWILIO_AUTH_TOKEN` from console.twilio.com and update on Railway.

### DeepSeek Non-Streaming Timeout

**Issue**: DeepSeek with streaming disabled times out on outputs > ~500 tokens due to Railway's idle connection timeout.

**Fix**: DeepSeek always uses `stream: true` in `callProvider()`. Never disable streaming for DeepSeek.

### Groq Rate Limits (30 RPM Shared)

**Issue**: Multiple concurrent tasks exhaust Groq's free 30 RPM limit, causing cascading 429s.

**Fix**: Per-model circuit breakers and the global AI concurrency limiter (4 slots) prevent this. If still hitting limits, add Cerebras or SambaNova API keys for additional rate limit pools.

### Bright Data FORCE_LOCAL_BROWSER Conflict

**Issue**: If `FORCE_LOCAL_BROWSER=true` is set on Railway, Bright Data and remote CDP are bypassed entirely, falling back to slow local patchright.

**Fix**: Delete `FORCE_LOCAL_BROWSER` env var from Railway. Never set it in production.

### sendViaChannel Before DB Update

**Issue**: Calling `sendViaChannel()` before updating the task in Supabase can leave the task in "processing" state indefinitely.

**Fix**: Always update `tasks.status` in Supabase before calling `sendViaChannel()`.

### Onboarding File Reference

**Issue**: `onboarding-flow.tsx` exists but is not used. The live onboarding is `unified-flow.tsx`.

**Fix**: Never edit `onboarding-flow.tsx`. All onboarding changes go in `apps/web/components/onboarding/unified-flow.tsx`.

### processor-v2 Delegation

**Issue**: `processor-v2.ts` was previously returning raw AI strings like `[THINKING][ACTION:search()]` instead of executing them.

**Fix**: processor-v2 now delegates to main `processTask(suppressEmail=true)` and returns `cleanResponse` not `aiResponse.content`.

### Voice Echo Loop

**Issue**: `interruptible="true"` in ConversationRelay TwiML causes TTS audio to feed back into STT, creating an infinite loop of silence/interruptions.

**Fix**: All 4 ConversationRelay paths use `interruptible="false"`. Never change this.

### Missing Imported Files Cause Vercel Build Failure

**Issue**: If a TypeScript file imports another file that was not committed to git, Vercel build fails. Railway builds from the git repo so it fails too.

**Fix**: Always verify all imported files are committed. Check `git status` before pushing.
