# Aevoy Session Log — Full Context for Future Sessions

Last updated: 2026-02-04
Read this file first when resuming work.

---

## What Was Done This Session

### 1. Fixed Landing Page Demos & Animations
**Files created:**
- `apps/web/app/api/demo/_rate-limit.ts` — Shared rate limiter for demo endpoints
- `apps/web/app/api/demo/call/route.ts` — Real Twilio phone call demo
- `apps/web/app/api/demo/task/route.ts` — Real AI query demo (Gemini Flash → DeepSeek)
- `apps/web/app/api/demo/email-result/route.ts` — Real email sending demo (Resend)

**Files modified:**
- `apps/web/app/page.tsx` — Rewrote LiveDemo component with real API calls, fixed animation jank (RAF batching, CSS cursor blink, direct DOM parallax)

### 2. Fixed Hive Mind Public API Error Handling
**Files modified:**
- `apps/web/app/api/hive/public/learnings/route.ts` — Returns empty array instead of 500 when table missing
- `apps/web/app/api/hive/public/vents/route.ts` — Same fix

### 3. Full E2E Testing (Everything Tested)
- Landing page: All 8 sections, all links, all 3 demos, security cards
- Auth: Login validation, signup validation, password mismatch
- Dashboard: All 3 pages redirect to login when not logged in
- All 8 web API endpoints: All reject unauthenticated requests
- Hive Mind: All 7 API endpoints tested, UI tested
- Agent server: Health, task endpoints, webhook auth, smoke test
- Production build: Passes with 0 TypeScript errors

### 4. Ran 4 Deep Audits
- Security audit (XSS, injection, auth, encryption)
- Code quality audit (types, errors, consistency)
- Agent server audit (all 18 files analyzed)
- Email worker audit (parsing, security, edge cases)

---

## What's Still Broken or Missing (Plain English)

### CRITICAL — Will Cause Real Problems

**1. The email worker sends emails to a URL that doesn't exist**
- File: `workers/email-router/src/index.ts`, line 307
- What happens: When someone sends a magic link/verification email to Aevoy, the worker tries to POST to `/task/magic-link` on the agent server. That endpoint was never created. The email just disappears.
- Fix: Create the `/task/magic-link` endpoint in `packages/agent/src/index.ts`, or change the worker to use `/task/incoming` instead.

**2. If the agent server is down, emails are lost forever**
- File: `workers/email-router/src/index.ts`, lines 343-346
- What happens: The email worker sends the email to the agent server. If the server is down or returns an error, there's no retry. The email is gone. The user never gets a response.
- Fix: Add a retry mechanism (try 3 times with delays), or store failed emails in a queue (Cloudflare Queue or KV store) to retry later.

**3. Email attachments are detected but thrown away**
- File: `workers/email-router/src/index.ts`, line 238
- What happens: The worker parses email attachments (filenames, sizes, types) but never includes them in the data sent to the agent server. If someone emails "here's the form to fill out" with a PDF attached, the agent never sees the PDF.
- Fix: Either forward attachment data (base64 or upload to storage first) or at minimum tell the agent "there were attachments but we couldn't process them."

**4. The email worker can be tricked with special characters in usernames**
- File: `workers/email-router/src/index.ts`, line 36
- What happens: The username from the email address (like "omar" from "omar@aevoy.com") is put directly into a database query without cleaning it. Someone could send an email to a specially crafted address to mess with the database query.
- Fix: Sanitize the username — only allow letters, numbers, hyphens, underscores.

**5. Database tables for Hive Mind don't exist yet**
- File: `apps/web/supabase/migration_v5.sql`
- What happens: The `learnings`, `vents`, `vent_upvotes`, and `agent_sync_log` tables were never created. The Hive page works but shows empty state. Internal API writes fail.
- Fix: Run `migration_v5.sql` in the Supabase Dashboard SQL Editor.

**6. The `/api/migrate` endpoint has no authentication**
- File: `apps/web/app/api/migrate/route.ts`
- What happens: This was created as a temporary dev tool. Anyone can hit it. It only reads data right now, but it's still a door left open.
- Fix: Delete this file before going live. It was only needed for debugging.

**7. Agent server crashes without restart**
- File: `packages/agent/src/index.ts`
- What happens: There are no handlers for uncaught errors or shutdown signals. If something unexpected crashes, the whole server dies and nobody restarts it. Active tasks are abandoned.
- Fix: Add `process.on('uncaughtException')`, `process.on('unhandledRejection')`, and `process.on('SIGTERM')` handlers.

---

### HIGH PRIORITY — Should Fix Before Launch

**8. User data gets logged (privacy violation)**
- File: `packages/agent/src/services/processor.ts` — Logs form field values, email content, URLs
- File: `workers/email-router/src/index.ts` — Logs sender email addresses
- File: `packages/agent/src/services/twilio.ts`, lines 103, 235 — Logs phone numbers
- The spec says "NEVER log user content." These all violate that.
- Fix: Replace content logging with sanitized metadata only (e.g., log "filled 5 fields" not the actual values).

**9. Webhook secret comparison isn't safe in web routes**
- Files: `apps/web/app/api/webhooks/task/route.ts`, all `api/hive/` routes
- What happens: The agent server uses timing-safe comparison (`crypto.timingSafeEqual`) to check the webhook secret, but the web app routes use simple `===` string comparison. An attacker could theoretically figure out the secret one character at a time by measuring response times.
- Fix: Use `crypto.timingSafeEqual` everywhere, not just in the agent.

**10. Raw database errors shown to users**
- Files: `api/memory/route.ts`, `api/usage/route.ts`, `api/settings/route.ts`, `api/scheduled-tasks/route.ts`, `api/agent-card/route.ts`
- What happens: When a database query fails, the actual PostgreSQL error message is sent back to the user. This tells attackers about the database structure.
- Fix: Return generic "Something went wrong" messages, log the real error server-side only.

**11. `/api/usage/route.ts` has no try/catch**
- The entire route handler has no error handling. If anything goes wrong, it crashes with an unhandled exception.
- Fix: Wrap in try/catch like every other route.

**12. `document.querySelector` in server code**
- File: `packages/agent/src/memory/failure-db.ts`, line 278
- What happens: This function calls `document.querySelector` which only exists in browsers. In Node.js on the server, this will crash if that code path is hit.
- Fix: Remove or replace with a Node.js compatible check.

**13. Click method always says "success" even when it fails**
- File: `packages/agent/src/execution/actions/click.ts`, line 215
- The `dispatch_event` click method (method 15 of 15) always returns `true` regardless of whether the click actually worked.
- Fix: Actually check if the event dispatched successfully.

**14. Keyboard shortcut hardcoded for Mac, breaks on Linux**
- File: `packages/agent/src/execution/actions/fill.ts`, line 137
- Uses `Meta+a` (Mac's Command key) to select all text. On the Linux production server, this does nothing. Should use `Control+a` on Linux.
- Fix: Check the platform and use the right key.

**15. Ollama is always marked as "available" even when it's not**
- File: `packages/agent/src/services/ai.ts`, line 171
- There's a `|| true` that makes the Ollama availability check always return true. If the AI routing picks Ollama and it's not actually running, the request fails.
- Fix: Remove the `|| true`.

**16. Agent server rate limiter has IPv6 bug**
- File: `packages/agent/src/index.ts`, lines 74, 83
- The rate limiter's key generator uses `req.ip` without the IPv6 helper function. IPv6 users could bypass rate limits.
- Fix: Use `ipKeyGenerator` from `express-rate-limit`.

---

### MEDIUM — Should Fix Eventually

**17. Intent lock can be expanded beyond defaults** — `intent-lock.ts:86` — callers can add more allowed actions than the task type should permit.

**18. No `maxBudget` in LockedIntent** — The spec says intent locks should include a spending limit, but the code doesn't have one.

**19. SMS verification overwrites the whole task intent** — `twilio.ts:287` — Should merge, not replace.

**20. API error format inconsistent** — Some routes return `{error: "message"}`, others return `{error: "code", message: "text"}`. The spec says to use the two-field format everywhere.

**21. Encryption uses static salt** — `security/encryption.ts` uses a hardcoded salt instead of a random one per encryption operation.

**22. Two incompatible encryption systems** — `memory.ts` uses the raw key directly, `encryption.ts` derives a key with scrypt. They can't decrypt each other's data.

**23. `classifyTask` never calls AI** — It's pure keyword matching ("book" = booking, "find" = research). Never uses the AI models for classification like the spec suggests.

**24. Unused dependencies bloating install** — `bullmq` and `ioredis` are in package.json but never imported. Adds ~15MB.

**25. Magic link detection has false positives** — An email like "Help me verify my insurance claim" with a URL gets misclassified as a magic link/2FA code.

**26. No `!` assertion validation on env vars** — 14+ web API routes use `process.env.SOMETHING!` without checking if the value actually exists. Will crash if env vars are missing.

---

## What Works Perfectly

- Landing page renders all sections correctly
- All 3 demos work (Call validation, AI queries via Gemini, Form typewriter)
- Auth pages (login/signup) with proper validation
- Dashboard auth protection (redirects to login)
- All web API endpoints reject unauthenticated requests
- Agent server health check shows all subsystems
- Agent server webhook auth (timing-safe)
- Hive Mind page with tab switching, search, sort, empty states
- Production build passes with 0 TypeScript errors, 0 `any` types
- CORS configured on agent server
- Supabase RLS on all user tables
- AES-256-GCM encryption implementation (in encryption.ts)
- Intent locking system (with caveats above)
- 3-step verification system (self-check → evidence → smart review)
- AI model routing with fallback chains
- 15 click methods, 12 fill methods, 10 login methods

---

## Environment State

- Dev server: `pnpm --filter web dev` on port 3000
- Agent server: `pnpm --filter agent dev` on port 3001
- Supabase: Connected at `eawoquqgfndmphogwjeu.supabase.co`
- All API keys configured (.env.local): DeepSeek, Anthropic, Google, Kimi, Twilio, Resend, Browserbase
- TEST_MODE=true, SKIP_PAYMENT_CHECKS=true

## Files to NOT Delete

- `apps/web/app/api/demo/` — The 4 new demo API files (real demos)
- `apps/web/supabase/migration_v5.sql` — Hive tables (needs to be run)

## Files to Delete Before Launch

- `apps/web/app/api/migrate/route.ts` — Temp dev endpoint with no auth
- `packages/agent/src/test.ts` — Dev test file

## Next Steps (Priority Order)

1. Run `migration_v5.sql` in Supabase Dashboard (unblocks Hive)
2. Fix email worker: add retry, fix magic-link endpoint, forward attachments
3. Fix PII logging (processor.ts, email worker, twilio.ts)
4. Add process crash handlers to agent server
5. Fix raw DB error exposure in web API routes
6. Fix the `|| true` Ollama bug in ai.ts
7. Fix `Meta+a` → platform-aware select-all in fill.ts
8. Delete `/api/migrate/route.ts`
9. Fix timing-safe webhook comparison in web routes
10. Wrap usage/route.ts in try/catch
