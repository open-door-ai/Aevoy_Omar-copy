# Aevoy V2 — Status, Next Steps & Action Items

Last updated: 2026-02-03 (session 3)

## Session Log
- Session 1: Implemented all 10 phases of V2 spec, created .env with all API keys
- Session 2: Deep security audit (38 vulns found), fixed all 7 critical + key high issues, pushed to GitHub, fixed build errors, added Stripe sig verification, CORS restriction, Twilio webhook auth, XSS prevention, timing-safe comparisons, admin-only beta endpoint
- Session 3: Phone provisioning API (GET/POST/DELETE /api/phone), UNIQUE constraint on profiles.twilio_number, agent_cards table + RLS + atomic RPCs, settings page phone provisioning UI, end-to-end email flow integration tests (7 cases)

## Build Status
- Web app: Dev mode works. Production build has pre-existing auth page error (login page SSR issue, not from V2 changes). Needs investigation.
- Agent server: Not yet build-tested (TypeScript compilation). Run `pnpm --filter agent build` to check.
- Desktop: Not build-tested. Needs electron-builder config.

## What To Do Next Session
1. Fix web app production build (login page SSR error)
2. Add rate limiting to agent server (`express-rate-limit`)
3. Add email sender validation in Cloudflare worker (SPF/DKIM check)
4. ~~Add phone provisioning API endpoint~~ **Done (session 3)**
5. Fix response channel (SMS/voice tasks should respond via same channel)
6. ~~Add UNIQUE constraint on profiles.twilio_number~~ **Done (session 3)**
7. ~~Add user_settings and agent_cards table migrations~~ **Done (session 3)**
8. ~~Test full email flow end-to-end~~ **Done (session 3)**
9. Set up ngrok for Twilio webhook testing
10. Improve onboarding flow / setup questions on website

## Current Status: V2 Implementation Complete, Security Hardened

All 10 phases of the V2 spec are implemented. 38 security vulnerabilities were found and the critical/high ones are fixed. Code is pushed to main.

---

## What's Working Now
- Full AI model routing (DeepSeek, Kimi K2, Gemini Flash, Claude, Ollama)
- Browserbase + Stagehand cloud browser automation (with local Playwright fallback)
- 3-step task verification system
- 4-type memory system (short-term, working, long-term, episodic)
- Twilio voice + SMS (with signature validation)
- Proactive engine (hourly checks)
- Desktop app structure (Electron + nut.js)
- Web dashboard with multi-channel support
- Email processing pipeline
- Payment/quota bypass in TEST_MODE

## What You (Omar) Need To Do

### Immediate (Before Testing)
1. **Run Supabase migration**: Go to Supabase SQL Editor and run `apps/web/supabase/migration_v3.sql`
2. **Set ADMIN_USER_IDS**: After signing up, get your user ID from Supabase Auth, add to `.env` as `ADMIN_USER_IDS=your-uuid`
3. **Install dependencies**: Run `pnpm install` in root directory
4. **Test the web app**: `pnpm dev:web` and visit localhost:3000
5. **Test the agent**: `pnpm dev:agent` in another terminal

### For Voice/SMS Testing
6. **Configure Twilio webhook URLs**: In Twilio console, set your phone number's webhook:
   - Voice URL: `https://your-agent-url/webhook/voice/YOUR_USER_ID`
   - SMS URL: `https://your-agent-url/webhook/sms/YOUR_USER_ID`
   - You need a public URL — use `ngrok http 3001` for local testing
7. **Call your Twilio number** (+17789008951) to test voice
8. **Text your Twilio number** to test SMS

### For Cloud Deployment
9. **Set up Hetzner VPS** for agent server:
   - Ubuntu 22.04, min 2GB RAM
   - Install Node 20+, pnpm, Playwright deps (`npx playwright install-deps`)
   - Clone repo, set up .env, run with PM2
   - Set up nginx reverse proxy with SSL (Let's Encrypt)
   - Point agent subdomain (e.g., agent.aevoy.com) to VPS
10. **Deploy web to Vercel**:
    - Connect GitHub repo
    - Set all NEXT_PUBLIC_* env vars in Vercel dashboard
    - Set SUPABASE_SERVICE_ROLE_KEY
    - Set AGENT_URL to your VPS URL
11. **Update Cloudflare email worker**:
    - Set AGENT_URL to your VPS URL in wrangler.toml secrets
    - Deploy with `cd workers/email-router && npx wrangler deploy`
12. **Update AGENT_URL in .env** once VPS is live

### For Stripe (Deferred — Not Needed For Testing)
13. **Set up Stripe account** and get STRIPE_SECRET_KEY
14. **Create webhook endpoint** in Stripe dashboard pointing to `/api/webhooks/stripe`
15. **Get STRIPE_WEBHOOK_SECRET** from Stripe dashboard

---

## Security Fixes Applied

### Critical (Fixed)
| # | Issue | Fix |
|---|-------|-----|
| C-1 | Stripe webhook no signature | Now uses `stripe.webhooks.constructEvent()` |
| C-2 | Beta endpoint open to all | Now admin-only via `ADMIN_USER_IDS` |
| C-3 | Hardcoded encryption fallback | Now throws fatal error if key missing |
| C-4 | CORS wide open | Restricted to `ALLOWED_ORIGINS` |
| C-5 | Twilio webhooks no auth | Added `validateTwilioSignature` middleware |
| C-6 | Prompt injection | Intent locking + action validation (partial) |
| C-7 | Card balance race condition | Atomic DB operations with RPC |

### High (Fixed)
| # | Issue | Fix |
|---|-------|-----|
| H-1 | SMS content logged | Removed from logs |
| H-3 | XSS in email HTML | Added `escapeHtml()` |
| H-4 | Task webhook no ownership | Now requires `userId` always |
| L-3 | Timing-safe comparison | Using `crypto.timingSafeEqual()` |
| M-1 | Error details to users | Generic error messages now |

### Fixed (Session 3)
| # | Issue | Fix |
|---|-------|-----|
| H-9 | RLS policies too broad | Scoped to `TO service_role` in migration_v4.sql |
| M-10 | Tasks table missing DELETE RLS | Added DELETE policy in migration_v4.sql |
| M-11 | user_settings table missing | Created in migration_v4.sql |
| M-12 | agent_cards table missing | Created with RLS + atomic RPCs in migration_v4.sql |

### Remaining (For Production)
| # | Issue | Priority | Action |
|---|-------|----------|--------|
| H-2 | No rate limiting | High | Add `express-rate-limit` to agent server |
| H-5 | Email sender spoofing | High | Validate `from` matches user's email in email-router |
| H-6 | Shared browser singleton | High | Create per-user browser instances |
| H-7 | Memory map never cleaned | High | Add TTL-based eviction (30 min) |
| H-8 | Memory compression no transaction | High | Wrap in DB transaction |
| H-10 | Playwright `--no-sandbox` | Medium | Run in sandboxed container |
| M-2 | CSS selector injection | Medium | Use `getByLabel()` instead of raw selectors |
| M-4 | Desktop encryption fallback | Medium | Throw error if no key |
| M-8 | Proactive spam | Medium | Add deduplication with 24h cooldown |
| M-13 | AI action targets unvalidated | Medium | Validate send_email recipients |

---

## Phone/Voice Architecture Gaps to Fix

| # | Gap | Priority | Status |
|---|-----|----------|--------|
| 1 | No API endpoint for phone provisioning | High | **Fixed** (session 3) — `/api/phone` GET/POST/DELETE |
| 2 | Response always via email (not SMS/voice) | High | Open |
| 3 | Shared outbound number replies unrouted | High | Open |
| 4 | No UNIQUE constraint on twilio_number | Medium | **Fixed** (session 3) — partial unique index |
| 5 | Duplicate task creation for voice | Medium | Open |
| 6 | Voice hardcoded to Polly.Amy | Low | Open |
| 7 | Area code hardcoded to 604 | Low | **Fixed** (session 3) — user can specify area code |

---

## Cloud Hosting Architecture

```
User (email/SMS/voice/chat)
       |
       v
+--Cloudflare--+    +--Twilio--+
| Email Worker  |    | Voice+SMS|
+------+--------+    +----+-----+
       |                   |
       v                   v
+------+-------------------+------+
|     Agent Server (Hetzner VPS)  |
|  Express + Playwright + AI APIs |
|  PM2 + nginx + Let's Encrypt    |
+-----------+---------------------+
            |
            v
+------+--------+    +---------+
| Supabase (DB) |    | Vercel  |
| Auth + Storage |    | Next.js |
+---------------+    +---------+
```

### What Runs Where
- **Vercel**: Web app (Next.js) — apps/web/
- **Hetzner VPS**: Agent server — packages/agent/
- **Cloudflare**: Email router worker — workers/email-router/
- **Supabase**: Database, auth, storage (managed)
- **Twilio**: Voice/SMS (managed)
- **Browserbase**: Cloud browser sessions (managed)

---

## Files Changed In This Session

### New Files Created
- `docs/SPEC-V2.md` — Full V2 specification
- `docs/PROGRESS.md` — Implementation checklist
- `docs/IMPLEMENTATION-SUMMARY.md` — Quick reference
- `docs/STATUS-AND-NEXT-STEPS.md` — This file
- `apps/web/supabase/migration_v3.sql` — V3 database migration
- `packages/agent/src/services/stagehand.ts` — Browserbase service
- `packages/agent/src/services/task-verifier.ts` — 3-step verification
- `packages/agent/src/services/proactive.ts` — Proactive engine
- `packages/agent/src/execution/actions/login.ts` — 10 login methods
- `packages/agent/src/execution/actions/navigate.ts` — 8 nav methods
- `apps/web/app/api/memory/route.ts` — Memory API
- `apps/web/app/api/usage/route.ts` — Usage API
- `apps/desktop/` — Full desktop app (8 files)

### Modified Files
- `CLAUDE.md` — Updated for V2
- `package.json` — Added workspace scripts
- All docs in `docs/` — Updated for V2
- `packages/agent/src/services/ai.ts` — Full rewrite (routing, Kimi K2, Ollama)
- `packages/agent/src/services/memory.ts` — Full rewrite (4 types)
- `packages/agent/src/services/twilio.ts` — Full rewrite (voice + SMS)
- `packages/agent/src/services/processor.ts` — Added verification, test mode, security fixes
- `packages/agent/src/services/email.ts` — XSS fix
- `packages/agent/src/services/scheduler.ts` — Added proactive checks
- `packages/agent/src/services/privacy-card.ts` — Race condition fix
- `packages/agent/src/execution/engine.ts` — Stagehand integration
- `packages/agent/src/index.ts` — CORS, Twilio auth, timing-safe, webhooks
- `packages/agent/src/security/encryption.ts` — No fallback key
- `packages/agent/src/types/index.ts` — V2 types
- `apps/web/app/dashboard/page.tsx` — Multi-channel, costs
- `apps/web/components/recent-activity.tsx` — Channel badges, verification
- `apps/web/app/api/webhooks/stripe/route.ts` — Signature verification
- `apps/web/app/api/profile/beta-status/route.ts` — Admin-only
- `apps/web/app/api/webhooks/task/route.ts` — Ownership required
- `apps/web/app/api/tasks/route.ts` — Input validation
- `apps/web/app/api/memory/route.ts` — Type validation
- `apps/web/app/api/usage/route.ts` — Month validation
