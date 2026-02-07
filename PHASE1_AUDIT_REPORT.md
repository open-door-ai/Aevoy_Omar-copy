# PHASE 1: FULL CODEBASE AUDIT REPORT -- AEVOY

**Date:** 2026-02-07
**Auditor:** Claude Opus 4.6 (4-agent parallel audit)
**Scope:** 12 systems, 39 database tables, ~150 source files

---

## SECTION A: SYSTEM-BY-SYSTEM REPORT

---

### 1. BROWSER AUTOMATION & TASK EXECUTION ENGINE

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/services/stagehand.ts` (693 lines) -- Browserbase + Stagehand v3 with local Playwright fallback
- `packages/agent/src/services/browser.ts` (449 lines) -- Standalone local Playwright browser with CAPTCHA solving
- `packages/agent/src/execution/engine.ts` (772 lines) -- Core execution engine with fallback chains
- `packages/agent/src/execution/api-executor.ts` (498 lines) -- Direct API execution (Google/Microsoft)
- `packages/agent/src/services/skill-registry.ts` (171 lines) -- 8 default API skills seeded on startup
- `packages/agent/src/execution/actions/click.ts` (244 lines) -- 15 click fallback methods
- `packages/agent/src/execution/actions/fill.ts` (327 lines) -- 17 fill fallback methods
- `packages/agent/src/execution/actions/login.ts` (685 lines) -- 11 login fallback methods
- `packages/agent/src/execution/actions/navigate.ts` (370 lines) -- 8 navigation fallback methods
- `packages/agent/src/execution/failure-handlers.ts` (209 lines) -- 6 failure handler types
- `packages/agent/src/execution/captcha.ts` (398 lines) -- CAPTCHA detection + solving (reCAPTCHA, hCaptcha, Turnstile)
- `packages/agent/src/execution/stealth.ts` (132 lines) -- Anti-detection patches
- `packages/agent/src/execution/antibot.ts` (207 lines) -- Anti-bot detection/handling
- `packages/agent/src/execution/session-manager.ts` (222 lines) -- LRU session cache + encrypted persistence
- `packages/agent/src/execution/retry.ts` -- Exponential backoff + circuit breaker
- `packages/agent/src/execution/popup-handler.ts` -- Popup dismissal before each step
- `packages/agent/src/execution/dynamic-content.ts` -- SPA-ready wait logic
- `packages/agent/src/execution/page-hash.ts` -- Page hash for layout change detection
- `packages/agent/src/memory/failure-db.ts` (310 lines) -- Failure memory with EMA success rates
- `packages/agent/src/services/tasks/api-fallback.ts` (178 lines) -- API fallback (DuckDuckGo, GitHub, Yelp)
- `packages/agent/src/services/tasks/email-fallback.ts` -- Email-based fallback
- `packages/agent/src/services/tasks/manual-fallback.ts` -- Manual instruction fallback

**Database tables:** failure_memory, user_sessions, learnings, skills, execution_plans, action_history, tasks, oauth_connections, credential_vault

**What works:**
- Browserbase + Stagehand v3 cloud integration with persistent contexts per user (profiles.browserbase_context_id). Falls back to local Playwright.
- 15 click methods, 17 fill methods (with verification), 11 login methods, 8 navigation methods -- all as ordered fallback chains.
- Fill verification: checks DOM input value matches target after fill (fill.ts:288-308).
- Session management: encrypted cookie+localStorage persistence in DB (7-day TTL), LRU in-memory cache (max 10).
- CAPTCHA solving: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, image CAPTCHAs via 2captcha API + Claude Vision fallback.
- Anti-bot: Cloudflare challenge wait (30s), AWS WAF rotation, rate limit backoff (5s/15s/45s).
- Stealth: navigator.webdriver override, plugins, languages, chrome object, permissions, UA rotation (12 agents).
- Failure memory with EMA (weight 0.3), cross-user global learning (3+ uses promoted), 90-day expiration.
- Screenshot after every step (engine.ts:286-293).
- Step-level retry: exponential backoff (1s/2s/4s), max 2 retries per step.
- Task timeout: 3 min/task, 30s/step.
- Page crash recovery via `ensurePageAlive()`.
- Live View URL from Browserbase passed back to user.
- 8 API skills bypass browser: Google Calendar, Gmail, Drive, Sheets, Microsoft Calendar, Outlook.

**What's broken:**
- **Proxy config exists but never wired**: `getProxyConfig()` in antibot.ts:185-195 is never called by ExecutionEngine during browser launch.
- **browser.ts singleton concurrency hazard**: shared `let browser: Browser | null = null` -- but likely legacy/unused in main flow.
- **browser.ts uses `--no-sandbox` unconditionally** (even in production) vs stagehand.ts which only does so in dev.
- **`humanizeInteraction()` defined but never called** -- mouse/keyboard humanization is not active.
- **Login methods not wired into execution engine**: engine.ts has no "login" action type. Login fallbacks exist but aren't reachable from the standard execution path.
- **`handleSelect()` has no fallback chain** -- raw `page.selectOption()` with immediate throw on failure.

**What's missing:**
- No "dry run" / plan preview shown to user before execution. Plans are auto-approved.
- No browser session isolation in local Playwright mode (cloud mode uses per-user Browserbase contexts).
- No fingerprint spoofing beyond UA rotation (no canvas/WebGL/AudioContext).
- No file download action type.
- No tab management (single-page only, can't handle popup-based OAuth).
- `handleSubmit()` uses hardcoded selector fallback instead of a robust chain.

**UI exists:** YES_PARTIAL
**UI details:** Skills marketplace page, task queue page, activity page showing task history. NO live browser view in dashboard -- Live View URL only sent via email/SMS.
**Connected to backend:** YES
**Priority:** HIGH

---

### 2. TASK PLANNING & DECISION RESOLUTION

**Status:** EXISTS_BUT_INCOMPLETE

**Files found:**
- `packages/agent/src/services/processor.ts` (1677 lines) -- Main task orchestrator
- `packages/agent/src/execution/engine.ts` (772 lines) -- Step execution
- `packages/agent/src/services/clarifier.ts` (348 lines) -- Task clarification + confirmation
- `packages/agent/src/services/task-verifier.ts` (641 lines) -- 3-step verification + strike system
- `packages/agent/src/services/planner.ts` (148 lines) -- Execution method routing
- `packages/agent/src/services/task-decomposition.ts` -- Sub-task decomposition
- `packages/agent/src/services/parallel-execution.ts` -- Parallel execution logic
- `packages/agent/src/services/iterative-deepening.ts` -- Iterative deepening
- `packages/agent/src/services/context-carryover.ts` -- Context between tasks (24hr window)
- `packages/agent/src/services/difficulty-predictor.ts` -- Pre-execution difficulty prediction
- `packages/agent/src/services/pattern-detector.ts` -- Cross-domain pattern warnings
- `packages/agent/src/services/verification-learner.ts` -- Learn from verification corrections
- `packages/agent/src/security/intent-lock.ts` -- Immutable task scope
- `packages/agent/src/security/validator.ts` -- Action validation

**Database tables:** tasks, execution_plans, user_settings, scheduled_tasks, workflows

**What works:**
- Plan generation from natural language via DeepSeek with structured intent extraction, confidence scoring, per-task-type caps for missing fields.
- User confirmation: 4 modes (always/unclear/risky/never) with email reply flow (YES/NO/changes).
- Intent locking: immutable scope per task with allowed actions, domains, budget. Object.freeze'd.
- Planner checks 4 paths: API skills -> cached browser steps -> browser_new -> direct.
- 3-step verification: quality tiers (financial=99%, browser=95%, communication=90%, research=80%), strike system (max 3), composite scoring, Claude Sonnet escalation on strike 3.
- Checkpoint saving after each successful action for resumability.
- Progress updates every 3 successful actions.

**What's broken:**
- **Task decomposition is logged but NOT executed** (processor.ts:706-707 comment: "For now, just log the plan"). Subtasks are decomposed then the monolithic original task runs.
- **Parallel execution imported but never called** -- `shouldUseParallelExecution` and `executeInParallel` are unused.
- **Iterative deepening imported but never called** -- `executeWithDeepening` is unused.
- **Plans auto-approved** (processor.ts:726: `approved: true`). User never sees execution steps before they run.
- **Missing auth detection logs but doesn't act** (processor.ts:737: "Could generate connect links here in future").
- **Cron parser is oversimplified** -- only handles weekly Monday 8am and hourly; complex expressions default to "1 day from now".

**What's missing:**
- No dependency detection between sub-tasks.
- No user-facing plan approval step (user approves intent, not execution steps).
- No cost estimation shown before execution.
- No rollback mechanism (action_history stores undo_data but no undo function exists).
- No alternative plan generation.

**UI exists:** YES_PARTIAL
**UI details:** Confirmation works via email replies. Dashboard shows task status. No plan viewer, no step-by-step progress, no execution plan visualization.
**Connected to backend:** YES
**Priority:** HIGH

---

### 3. MULTI-CHANNEL COMMUNICATION (SMS / Call / Email)

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/services/twilio.ts` (637 lines) -- Twilio SMS + Voice
- `packages/agent/src/services/email.ts` (361 lines) -- Resend email with HTML templates
- `packages/agent/src/services/inbox-poller.ts` (508 lines) -- IMAP poller (DISABLED in production)
- `packages/agent/src/services/identity/normalizer.ts` (61 lines) -- Gmail dot/plus, E.164 normalization
- `packages/agent/src/services/identity/resolver.ts` (87 lines) -- Cross-channel user identity resolution
- `workers/email-router/src/index.ts` (745 lines) -- Cloudflare email worker
- `packages/agent/src/index.ts` (1304 lines) -- All webhook routes
- `packages/agent/src/services/tfa.ts` (181 lines) -- 2FA code capture
- `packages/agent/src/services/progress.ts` (61 lines) -- Per-channel progress updates
- `packages/agent/src/services/checkin.ts` (117 lines) -- Daily check-in calls

**Database tables:** profiles, tasks, user_twilio_numbers, tfa_codes, email_pin_sessions, processed_emails, usage, call_history

**What works:**
- SMS sending via Twilio with usage tracking. SMS receiving via 3 webhook routes (user-specific, shared, premium).
- Voice outbound (Polly.Amy TTS), voice inbound with caller identification and PIN verification.
- Phone provisioning: area code search, purchase, webhook config, DB storage.
- Cloudflare Email Worker: MIME parsing, type detection, sender validation, agent forwarding.
- Email PIN security: 6-digit PIN, 10-min TTL, 3-attempt lockout, registered email notification.
- IMAP fallback (fully implemented but disabled in favor of Cloudflare).
- Resend email with full HTML templates, attachments support.
- Channel detection via input_channel field, responses routed back via same channel.
- Identity resolution: email/phone normalization, cross-channel user matching.
- Rate limiting: 100/min global, 10/min per user tasks, 30/min per Twilio caller, 50 calls/day.
- Message formatting: SMS truncated to 1500 chars, voice gets SMS+email, email gets full HTML.
- Daily check-in calls with timezone-aware scheduling and transcription to episodic memory.
- Twilio signature validation middleware.

**What's broken:**
- **Receptionist SMS routing bug**: index.ts:638 sends SMS to `profile.email` instead of phone number.
- **Voice PIN plaintext comparison**: index.ts:940 fetches ALL profiles and compares PINs in plaintext. Comment: "plaintext for now, will encrypt later".
- **Timezone handling in check-ins**: hardcoded 12-timezone offset map with NO DST handling -- calls arrive at wrong time ~6 months/year.
- **IMAP poller disabled but code maintained** -- no automatic fallback if Cloudflare has issues.

**What's missing:**
- No MMS support, no SMS delivery receipts, no call recording storage, no WhatsApp.
- No Cloudflare worker email origin verification.
- Hardcoded Twilio number `+17789008951` in index.ts:972 and checkin.ts:22.

**UI exists:** YES_PARTIAL
**UI details:** Channel badges in activity. Phone provisioning + email PIN in settings. No calls/SMS history page. No voice PIN setup UI.
**Connected to backend:** YES
**Priority:** MEDIUM

---

### 4. AI MODEL ROUTING & TOKEN OPTIMIZATION

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/services/ai.ts` (1012 lines) -- Core AI routing, 7 providers, caching, cost tracking
- `packages/agent/src/services/processor.ts` (1677 lines) -- Budget checks, AI usage
- `packages/agent/src/services/model-intelligence.ts` -- Adaptive model chain
- `packages/agent/src/services/difficulty-predictor.ts` -- Task difficulty for routing

**Database tables:** ai_cost_log, usage, tasks, profiles

**What works:**
- 10 task types with ordered fallback chains across 7 providers: Groq, DeepSeek, Kimi, Gemini, Claude Sonnet, Claude Haiku, Ollama.
- Provider availability checks (skip if API key missing).
- Per-model timeouts: DeepSeek/Kimi 30s, Gemini/Groq 15s, Sonnet 45s, Haiku 20s, Ollama 60s.
- Circuit breakers: 5 failures / 600s window / 60s cooldown per provider.
- Response cache: LRU 100 entries, 5-min TTL, SHA-256 key. Skips vision/complex.
- Cost tracking: per-call to ai_cost_log + monthly usage upsert. Actual per-model pricing.
- Monthly budget: $15/user hard cap. Per-task cap: $2. Budget alert email at <$3 remaining.
- Adaptive routing via historical success rates (model-intelligence.ts).
- 429 rate limit handling: Retry-After wait <= 10s, then fallback.
- Task classification: keyword heuristics first (fast), then AI fallback.
- Personality system: SOUL.md, IDENTITY.md, USER_TEMPLATE.md with built-in fallback.

**What's broken:**
- **Latency tracking always equals timeout**: ai.ts:578 `latencyMs: Date.now() - (Date.now() - timeout)` -- makes adaptive routing latency data meaningless.
- **Silent false positive on model failure**: quickValidate falls through to `{ result: "true", cost: 0 }` when all models fail.
- **Cache key too short**: only first 200 chars of prompt used -- different prompts with same prefix return wrong cached response.
- **Potential double-counting**: calls both upsert and track_usage RPC for ai_cost_cents.

**What's missing:**
- No context window pre-check (prompt may exceed model limit).
- No pre-flight token estimation.
- No streaming support.
- No daily cost caps (only monthly).
- No per-model usage quotas (e.g., Groq free tier limits).

**UI exists:** YES_PARTIAL
**UI details:** Usage stats in settings. /api/usage and /api/stats endpoints. No per-task cost breakdown, no per-model usage view, no routing decision visibility. Budget alerts email-only.
**Connected to backend:** YES
**Priority:** MEDIUM

---

### 5. AUTHENTICATION & CREDENTIAL MANAGEMENT

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/security/encryption.ts` (165 lines) -- AES-256-GCM with user/server keys
- `packages/agent/src/services/oauth-manager.ts` (201 lines) -- Token retrieval, refresh, expiry check
- `apps/web/app/api/integrations/gmail/route.ts` (139 lines)
- `apps/web/app/api/integrations/gmail/callback/route.ts` (156 lines)
- `apps/web/app/api/integrations/microsoft/route.ts` (127 lines)
- `apps/web/app/api/integrations/microsoft/callback/route.ts` (140 lines)
- `apps/web/lib/encryption.ts` (69 lines) -- Web-side AES-256-GCM with scrypt
- `packages/agent/src/services/verification.ts` (340 lines) -- 2FA detection + code entry
- `packages/agent/src/services/tfa.ts` (181 lines) -- TFA storage, Gmail extraction, TOTP

**Database tables:** oauth_connections, credential_vault, user_credentials, tfa_codes

**What works:**
- OAuth 2.0 for Google and Microsoft with state parameter (base64url JSON + userId + timestamp), 10-min state expiry.
- All tokens encrypted with AES-256-GCM (scrypt-derived keys). Both access + refresh tokens.
- Token refresh for Google and Microsoft with 5-min buffer, auto-marks "expired" on failure.
- Hourly scheduled refresh of expiring tokens with 15-min lookahead.
- User-derived keys (`deriveUserKey`) use userId + server secret -- per-user key derivation.
- 2FA detection: 25 indicator patterns, 12 code input selectors.
- Auto-extraction of 2FA codes from Gmail API before asking user.
- Full TOTP generation (RFC 6238, base32 decode, HMAC-SHA1).
- TFA codes auto-expire after 10 minutes.

**What's broken:**
- **TFA RPC parameter mismatch**: tfa.ts:39-48 passes `p_task_id` but the RPC expects `p_user_id` + `p_site_domain`. Task-based lookup will fail at runtime.
- **Dual-write crypto inconsistency**: Gmail callback writes to both oauth_connections (scrypt encryption) and user_credentials (raw hex key). Cross-service decryption may fail.
- **Web API memory encryption differs from agent**: memory/route.ts uses raw hex key, agent uses scrypt. Data encrypted by web API can't be decrypted by agent.

**What's missing:**
- No credential rotation mechanism.
- No Just-In-Time connection flow (logs "Missing auth" but doesn't prompt user).
- No OAuth token revocation on disconnect (only marks "revoked" in DB, doesn't call provider).
- No PKCE for OAuth flows.
- **credential_vault table has ZERO application code using it** -- entirely unused.
- TFA codes stored in plaintext (short-lived, but notable).

**UI exists:** YES_PARTIAL
**UI details:** Gmail/Microsoft connect buttons in settings. No credential_vault management. No TFA secret storage UI. No stored credentials viewer.
**Connected to backend:** YES
**Priority:** HIGH

---

### 6. MEMORY & LEARNING SYSTEM

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/services/memory.ts` (663 lines) -- 4-type memory, encryption, decay, compression
- `packages/agent/src/services/processor.ts` (1677 lines) -- Memory loading, injection
- `apps/web/app/api/memory/route.ts` (128 lines)
- `apps/web/app/api/hive/learnings/route.ts` (184 lines)
- `apps/web/lib/hive/learning-generator.ts` (218 lines)
- `apps/web/lib/hive/learning-merger.ts` (96 lines)
- `apps/web/lib/hive/pii-scrubber.ts` (128 lines)
- `packages/agent/src/memory/failure-db.ts` (310 lines)
- `packages/agent/src/services/context-carryover.ts`
- `packages/agent/src/services/verification-learner.ts`
- `packages/agent/src/services/pattern-detector.ts`
- `packages/agent/src/services/difficulty-predictor.ts`
- `packages/agent/src/services/method-tracker.ts`

**Database tables:** user_memory, failure_memory, learnings, vents, vent_upvotes, agent_sync_log

**What works:**
- 4-type memory: short-term (in-memory Map, 30-min TTL), working (DB, 7-day), long-term (encrypted file, permanent), episodic (DB, importance-weighted).
- All memory encrypted with AES-256-GCM + scrypt. Legacy format backward compatibility.
- Cost-optimized loading: 5 long-term + 10 working + 5 episodic. Token budgets: 500/300/200.
- Adaptive decay: variable rates by access recency (0.05 for 7-30d, 0.1 for 30-90d, 0.15 for never-accessed). Floor at 0.05.
- Memory compression: regex-based key fact extraction from old working memories into long-term.
- `boostMemoryOnAccess` prevents important memories from decaying.
- Memory injected into AI prompts with Hive learnings and context carryover.
- Hive Mind: shared knowledge base with AI-structured learning generation, EMA merger, PII scrubbing (2-pass: regex + AI).
- Failure memory: cross-user EMA learning, 90-day expiration, 3-use global promotion.
- Path traversal prevention with UUID v4 validation.

**What's broken:**
- **Cross-service encryption incompatibility**: web API memory/route.ts uses raw hex key, agent uses scrypt. Memories saved via web API can't be decrypted by agent.
- **Memory compression uses only regex** -- the AI summarization mentioned in comments was never implemented (memory.ts:489-490).
- **Vector embeddings column exists but unused**: migration_v3 adds `embedding vector(1536)` but NO code generates or queries embeddings. Semantic search doesn't exist.

**What's missing:**
- No semantic/vector search (keyword matching only).
- No conversation history storage (only compressed facts).
- Short-term memory lost on server restart (in-memory Map).
- No memory export/import in dashboard (API returns metadata only).
- `failure_memory` table has NO RLS enabled despite having a policy defined -- any authenticated user could read all failure data.

**UI exists:** YES_PARTIAL
**UI details:** Memory API exists (GET/POST). Dashboard shows metadata only, no content. Hive Mind page (/hive) shows public learnings/vents. No failure memory inspection.
**Connected to backend:** YES
**Priority:** MEDIUM

---

### 7. PROACTIVE SCHEDULING & HEARTBEAT

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/services/scheduler.ts` (630 lines) -- Main scheduler with all job types
- `packages/agent/src/services/proactive.ts` (562 lines) -- 5 trigger types, quiet hours, rate limiting
- `packages/agent/src/services/overnight.ts` (219 lines) -- Overnight queue + morning summaries
- `packages/agent/src/services/checkin.ts` (117 lines) -- Daily check-in calls

**Database tables:** scheduled_tasks, task_queue, usage, user_settings, profiles, distributed_locks, call_history

**What works:**
- Cron scheduler: every 60s, distributed lock, executes via processTask(), updates next_run_at.
- Cron keywords (hourly, daily, weekly, monthly) + standard 5-field expressions.
- Proactive engine (hourly): 5 triggers in parallel (recurring tasks, stuck tasks, upcoming scheduled, upcoming meetings, recurring bills).
- Quiet hours: 10PM-7AM per user timezone via Intl.DateTimeFormat.
- Rate limiting: DB-backed daily counter, configurable 0-20/day. High-priority bypasses limit.
- Channel routing by priority: High=Call+SMS, Medium=SMS, Low=email.
- Overnight queue: max 5 queued tasks/cycle in priority order. Morning summaries at 7AM per timezone.
- Memory compression + decay runs in scheduler. Data retention: 90-day cleanup.
- 3 distributed locks: scheduler_tasks (2min), scheduler_proactive (5min), scheduler_checkins (5min).
- Cleanup jobs: expired TFA codes, email PINs, old processed_emails (7d), stale learnings (14d layout).
- Daily check-in calls with 5-min tolerance window, dedup via call_history.
- Cross-task pattern detection (3 AM UTC), skill recommendations (4 AM UTC), OAuth refresh (hourly).

**What's broken:**
- **Same hardcoded timezone map for check-ins**: only 12 timezones, NO DST handling. Wrong check-in times ~6 months/year.
- **In-memory `lastRetentionDate`**: lost on restart (retention could re-run same day; idempotent but inconsistent).
- **Morning summary timezone conversion**: uses `toLocaleString` which may vary across Node.js versions.

**What's missing:**
- No UI for managing scheduled tasks from dashboard.
- 3 of 8 documented proactive triggers not implemented: domain_expiry, flight_checkin, better_deal.
- No wake-up call for urgent 2FA.
- Cron parser doesn't support ranges, lists, or step values (`*/5`, `1,15`, `1-5`).
- No recurring task auto-creation from detected patterns (suggests but doesn't create).

**UI exists:** YES_PARTIAL
**UI details:** `scheduled-tasks.tsx` component exists for viewing. Proactive channel badges on tasks. No creation/editing UI for scheduled tasks.
**Connected to backend:** YES
**Priority:** MEDIUM

---

### 8. SECURITY & SANDBOXING

**Status:** EXISTS_AND_WORKS

**Files found:**
- `packages/agent/src/security/intent-lock.ts` (188 lines)
- `packages/agent/src/security/validator.ts` (121 lines)
- `packages/agent/src/security/encryption.ts` (165 lines)
- `apps/web/lib/verify-webhook.ts` (13 lines)
- `apps/web/middleware.ts` (20 lines)
- `apps/web/lib/supabase/middleware.ts` (73 lines)
- All 15 migration files in `apps/web/supabase/`

**Database tables:** All 39 tables with RLS enabled

**What works:**
- Intent locking: Object.freeze'd scope per task. 8 task types with action allowlists/denylists. Domain allowlisting with subdomain matching.
- Action validation: time limit, action count, intent check, forbidden list, 13 prompt injection patterns.
- RLS on ALL 39 tables with user-scoped SELECT policies.
- Webhook verification: timing-safe `crypto.timingSafeEqual`.
- Twilio signature validation via official SDK.
- Auth middleware: session refresh, redirect protection.
- Browser session isolation: per-task StagehandService instances, per-user Browserbase contexts.
- Comprehensive AES-256-GCM encryption with scrypt, separate user/server key paths.
- No sensitive data logging found (explicitly avoids logging user content).
- CORS: restricted to aevoy.com, www.aevoy.com, localhost:3000.

**What's broken:**
- **CRITICAL: `failure_memory` table has RLS NOT actually enabled.** Policy defined but `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` never executed. Any authenticated user can read/write all failure_memory data.
- **CRITICAL: `tasks` INSERT/UPDATE policies use `USING (true)` / `WITH CHECK (true)` without role restriction.** Any authenticated user could insert/update any other user's tasks.
- **CRITICAL: migration_v9.sql (security fixes) is MISSING from filesystem.** The search_path fixes and learnings RLS tightening referenced in CLAUDE.md may never have been applied.
- **OAuth state not cryptographically signed** -- base64url JSON without HMAC. Callback does verify userId match, partially mitigating this.
- **Twilio validation silently passes in non-production** when import fails.

**What's missing:**
- No CSRF protection on API routes.
- No rate limiting on authenticated API routes (only public/demo).
- No XSS sanitization on stored content (relies on React auto-escape).
- No Content Security Policy (CSP) headers.
- Browser automation can access host filesystem in local mode (Docker provides some isolation).

**UI exists:** YES_PARTIAL
**UI details:** Auth pages, settings for integrations. No admin/security audit UI, no session management.
**Connected to backend:** YES
**Priority:** CRITICAL

---

### 9. AUDIT TRAIL & ACTIVITY LOG

**Status:** EXISTS_BUT_INCOMPLETE

**Files found:**
- `packages/agent/src/services/processor.ts` (records via `record_action` RPC)
- `apps/web/app/dashboard/activity/page.tsx` (89 lines)
- `apps/web/app/api/tasks/route.ts` (146 lines)
- `apps/web/components/recent-activity.tsx` (282 lines)

**Database tables:** tasks, action_history, ai_cost_log, execution_plans, call_history

**What works:**
- Per-action recording via `record_action` RPC: task_id, user_id, action_type, action_data (JSONB).
- Task-level tracking: full status lifecycle, timestamps, costs, verification data, checkpoints.
- 3-step verification stores detailed results: confidence, method, evidence, strike history.
- Execution plans logged with method, steps, estimated cost.
- Per-call AI costs in ai_cost_log.
- Call history with call_sid, direction, PIN auth status.
- Activity dashboard: real-time polling (3s pending, 10s otherwise), channel badges, status filters.
- Task API: pagination, status filtering, total count.
- Data retention: 90-day cleanup.

**What's broken:**
- **`task_logs` table documented in CLAUDE.md but DOES NOT EXIST.** No migration creates it, no code writes to it. The GDPR delete route tries to delete from it (will error).
- **screenshot_url mostly null**: only explicit "screenshot" actions capture screenshots. Navigate, click, fill do NOT auto-screenshot.
- **undo_data always null**: record_action passes `p_undo_data: null` -- undo system is theoretical only.

**What's missing:**
- No step-by-step structured log per task (only raw action_data JSONB).
- No auto-screenshot at each step.
- No task detail drill-down page.
- Logs not searchable (status filter only).
- No error categorization taxonomy.
- No log export (CSV/JSON).
- No real-time log streaming (no websocket feed).
- No target_url or method_used columns in action_history.

**UI exists:** YES_PARTIAL
**UI details:** Flat task list with status/channel/verification badges, cost/tokens. No drill-down, no action timeline, no screenshot viewer.
**Connected to backend:** YES
**Priority:** HIGH

---

### 10. USER DASHBOARD & WEB UI

**Status:** EXISTS_AND_WORKS

**Files found:**
- `apps/web/app/page.tsx` (~2000 lines) -- Full landing page
- `apps/web/app/(auth)/login/page.tsx` -- Login with email/password + demo mode
- `apps/web/app/(auth)/signup/page.tsx` -- Signup with strength indicator + beta modal
- `apps/web/app/dashboard/page.tsx` -- SSR dashboard with stats
- `apps/web/app/dashboard/activity/page.tsx` -- All tasks list
- `apps/web/app/dashboard/settings/page.tsx` (1409 lines) -- 8 settings cards
- `apps/web/app/dashboard/skills/page.tsx` -- Skills marketplace with search/filter/install
- `apps/web/app/dashboard/queue/page.tsx` -- Task queue (MOCK DATA, no API calls)
- `apps/web/components/onboarding/unified-flow.tsx` -- 11-step onboarding
- `apps/web/components/recent-activity.tsx` -- Real-time activity with polling
- `apps/web/components/scheduled-tasks.tsx` -- Scheduled task CRUD
- 42 API route files under `apps/web/app/api/`

**Database tables:** profiles, tasks, usage, user_settings, scheduled_tasks, skills, installed_skills

**What works:**
- Full auth flow: login, signup (password strength + AI email generation), demo mode.
- 11-step onboarding: welcome, bot email, email verification, how-it-works, use cases, AI behavior, timezone, verification, legal, interview, tour.
- Dashboard: SSR stats, recent activity with real-time polling, channel/status filters.
- Settings: 8 cards (profile, AI behavior, phone, email PIN, security, integrations, data export/delete, danger zone).
- Skills marketplace: search, category filter, install/uninstall.
- Activity page: paginated task list with status badges.
- Scheduled tasks: CRUD with cron display.
- GDPR: data export (JSON download) + account deletion (19-table FK-order cascade).
- 42 API routes, all with Supabase auth.
- Mobile-responsive sidebar with hamburger drawer.
- Loading states, empty states, error handling throughout.

**What's broken:**
- **Queue page uses MOCK data**: `dashboard/queue/page.tsx` has hardcoded `MOCK_TASKS` array, no API calls. Completely non-functional.
- **Beta payment modal disabled**: card fields are commented out, only "Skip" button works. Stripe integration exists in webhook but payment form is non-functional.

**What's missing:**
- No live browser view (can't watch agent work in real-time).
- No task detail page (no drill-down into individual tasks).
- No in-app chat channel (only email/SMS/voice).
- No admin panel.
- No real-time notifications (polling only, no websockets/SSE).

**UI exists:** YES_COMPLETE (for what's implemented)
**UI details:** Landing page, auth, 11-step onboarding, dashboard, activity, settings (8 cards), skills marketplace, scheduled tasks, Hive Mind, legal pages. All connected to real APIs except queue page.
**Connected to backend:** YES (except queue page)
**Priority:** MEDIUM

---

### 11. BILLING & SUBSCRIPTION

**Status:** EXISTS_BUT_INCOMPLETE

**Files found:**
- `apps/web/app/api/webhooks/stripe/route.ts` -- Stripe webhook handler (5 event types)
- `apps/web/components/beta-payment-modal.tsx` -- Payment modal (card fields DISABLED)
- `apps/web/app/(auth)/signup/page.tsx` -- Beta modal trigger

**Database tables:** profiles (stripe_customer_id, subscription_status, subscription_tier, subscription_ends_at, messages_used, messages_limit), usage

**What works:**
- Stripe webhook handler processes 5 events: checkout.session.completed, invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
- Webhook signature verification via `stripe-event` header comparison (NOT using Stripe SDK's constructEvent).
- Profiles have subscription fields: tier, status, customer_id, ends_at.
- Usage tracking: messages_used vs messages_limit with check_quota RPC.
- Monthly usage table tracks browser_tasks, simple_tasks, sms_count, voice_minutes, ai_cost_cents.

**What's broken:**
- **Payment modal card fields are DISABLED/commented out** -- only "Skip for Free Trial" button works. No actual payment collection.
- **Webhook signature verification is custom** (not using Stripe SDK's `constructEvent`), less secure.
- **No Stripe SDK imported anywhere** -- all Stripe interaction is via raw webhook parsing.
- **`SKIP_PAYMENT_CHECKS` env var** can bypass all payment validation (processor.ts).

**What's missing:**
- No Stripe Checkout session creation endpoint (can't actually start a subscription).
- No payment method management.
- No subscription status checks before task execution in the agent (only messages_used vs limit).
- No referral system (no referral codes, no tracking, no influencer attribution).
- No Stripe Customer Portal integration.
- No billing history view.
- `STRIPE_WEBHOOK_SECRET` not in .env.example.

**UI exists:** YES_PARTIAL
**UI details:** Beta payment modal exists but card inputs disabled. Usage stats in settings. No billing page, no subscription management, no payment history.
**Connected to backend:** PARTIALLY
**Priority:** HIGH (blocking monetization)

---

### 12. DEPLOYMENT & INFRASTRUCTURE

**Status:** EXISTS_AND_WORKS

**Files found:**
- `vercel.json` -- Vercel configuration
- `apps/web/next.config.ts` -- Next.js config with security headers
- `.env.example` -- 24 vars documented
- `packages/agent/.env.example` -- Agent env template
- `docker-compose.yml` -- Agent container config
- `Dockerfile` -- Node 20-slim + Playwright deps
- `deploy.sh` -- 3-component deploy script
- `railway.toml` -- Railway deployment config
- `.mcp.json` -- MCP servers config
- 16 migration files in `apps/web/supabase/`

**What works:**
- Vercel deployment: vercel.json with serverless function config, CSP + security headers in next.config.ts.
- Agent on Koyeb: Docker container with Node 20-slim, Playwright deps, health check at `/health`.
- Cloudflare Email Worker: deployed with wrangler, secrets configured.
- Deploy script handles all 3 components (web/agent/worker).
- Health check endpoint returns subsystem status.
- 16 migration files (v1 through v16) tracked in supabase/ directory.
- .env.example documents 24 core variables.
- Docker container runs as non-root with appropriate security.
- Railway.toml provides alternative deployment target.

**What's broken:**
- **No CI/CD pipeline**: no `.github/workflows/`, no automated tests on push/PR.
- **No error monitoring**: no Sentry, no error tracking service. Console.log only.
- **Migration v9 missing**: CLAUDE.md references security fixes that may not have been applied.
- **No staging/preview environment**: only production.

**What's missing:**
- No CI/CD (GitHub Actions or similar).
- No error monitoring (Sentry or equivalent).
- No log aggregation (centralized logging beyond console.log).
- No uptime monitoring / alerting.
- No infrastructure-as-code for agent server.
- No secrets rotation strategy.
- No database backup strategy (beyond Supabase defaults).
- No load testing configuration.
- 20 env vars used in code but NOT in .env.example (NEXT_PUBLIC_APP_URL, STRIPE_WEBHOOK_SECRET, PRIVACY_API_KEY, etc.).

**UI exists:** N/A
**Connected to backend:** YES
**Priority:** MEDIUM

---

## SECTION B: CRITICAL PATH ANALYSIS

Systems in launch-blocking priority order:

1. **SECURITY & SANDBOXING** -- CRITICAL -- `failure_memory` RLS not enabled, `tasks` table allows any user to insert/update any task, missing migration_v9 security fixes. Must fix before any real users.

2. **BILLING & SUBSCRIPTION** -- HIGH -- No actual payment collection. Card fields disabled, no Stripe Checkout session creation. Blocks monetization entirely. Must build Stripe integration for launch.

3. **BROWSER AUTOMATION & TASK EXECUTION** -- HIGH -- Core engine works but proxy not wired, login methods not reachable from engine, no plan preview before execution. Fix the wiring issues.

4. **TASK PLANNING & DECISION RESOLUTION** -- HIGH -- Task decomposition, parallel execution, and iterative deepening are imported but never called. Auto-approves all plans. No user-facing plan approval.

5. **AUTH & CREDENTIAL MANAGEMENT** -- HIGH -- TFA RPC parameter mismatch will fail at runtime. Cross-service encryption incompatibility. credential_vault table completely unused.

6. **AUDIT TRAIL & ACTIVITY LOG** -- HIGH -- Ghost `task_logs` table breaks GDPR delete. No per-step screenshots. No task drill-down page. Critical for user trust and debugging.

7. **MULTI-CHANNEL COMMUNICATION** -- MEDIUM -- Works end-to-end but receptionist SMS bug, plaintext PIN storage, DST timezone issues.

8. **AI MODEL ROUTING** -- MEDIUM -- Substantially complete. Fix latency tracking bug, cache key length, silent false positive on failure.

9. **PROACTIVE SCHEDULING** -- MEDIUM -- Works but timezone bugs in check-ins, 3 missing trigger types, no management UI.

10. **MEMORY & LEARNING** -- MEDIUM -- Works but vector search doesn't exist (column unused), cross-service encryption mismatch.

11. **USER DASHBOARD & WEB UI** -- MEDIUM -- Comprehensive but queue page is mock data, no task drill-down, no live view.

12. **DEPLOYMENT & INFRASTRUCTURE** -- MEDIUM -- Production works but no CI/CD, no error monitoring, no staging env.

---

## SECTION C: DEPENDENCY MAP

```
Browser Automation (1) --> depends on --> AI Routing (4) [for action decisions]
Browser Automation (1) --> depends on --> Auth/Credentials (5) [for site logins]
Browser Automation (1) --> depends on --> Memory/Learning (6) [for failure avoidance]
Task Planning (2) --> depends on --> AI Routing (4) [for plan generation]
Task Planning (2) --> depends on --> Browser Automation (1) [for execution]
Task Planning (2) --> depends on --> Auth/Credentials (5) [for credential checks]
Multi-Channel (3) --> depends on --> Task Planning (2) [for processing tasks]
Multi-Channel (3) --> depends on --> Security (8) [for webhook validation]
AI Routing (4) --> independent (core service)
Auth/Credentials (5) --> depends on --> Security (8) [for encryption]
Memory/Learning (6) --> depends on --> AI Routing (4) [for learning generation]
Memory/Learning (6) --> depends on --> Security (8) [for encryption]
Proactive Scheduling (7) --> depends on --> Task Planning (2) [for executing tasks]
Proactive Scheduling (7) --> depends on --> Multi-Channel (3) [for sending messages]
Security (8) --> independent (foundational)
Audit Trail (9) --> depends on --> Browser Automation (1) [for action recording]
Dashboard UI (10) --> depends on --> all backend systems (API consumer)
Billing (11) --> depends on --> Dashboard UI (10) [for payment flow]
Deployment (12) --> independent (infrastructure)
```

---

## SECTION D: ESTIMATED EFFORT

| # | System | Status | Hours to Fix/Complete | Hours from Scratch | Complexity |
|---|--------|--------|----------------------|--------------------|------------|
| 1 | Browser Automation | EXISTS_AND_WORKS | 12-20h (wire proxy, login, plan preview) | 200h+ | VERY_HIGH |
| 2 | Task Planning | EXISTS_BUT_INCOMPLETE | 20-30h (decomposition, parallel, approval) | 120h | HIGH |
| 3 | Multi-Channel | EXISTS_AND_WORKS | 8-12h (SMS bug, PIN encryption, DST) | 100h | HIGH |
| 4 | AI Routing | EXISTS_AND_WORKS | 4-8h (latency fix, cache key, context check) | 60h | MEDIUM |
| 5 | Auth/Credentials | EXISTS_AND_WORKS | 12-16h (TFA fix, crypto compat, JIT, vault) | 80h | HIGH |
| 6 | Memory/Learning | EXISTS_AND_WORKS | 8-12h (crypto compat, vector search, compression) | 80h | HIGH |
| 7 | Proactive Scheduling | EXISTS_AND_WORKS | 6-10h (timezone fix, missing triggers, UI) | 60h | MEDIUM |
| 8 | Security | EXISTS_AND_WORKS | 8-12h (RLS fixes, rate limiting, CSRF, migration_v9) | 40h | HIGH |
| 9 | Audit Trail | EXISTS_BUT_INCOMPLETE | 16-24h (task_logs, screenshots, drill-down, search) | 40h | MEDIUM |
| 10 | Dashboard UI | EXISTS_AND_WORKS | 12-16h (queue page, task detail, live view) | 120h | MEDIUM |
| 11 | Billing | EXISTS_BUT_INCOMPLETE | 20-30h (Stripe Checkout, portal, subscription checks) | 40h | MEDIUM |
| 12 | Deployment | EXISTS_AND_WORKS | 8-12h (CI/CD, Sentry, staging, env docs) | 20h | LOW |

**Total estimated fix hours: 134-202h**
**Total if building from scratch: ~960h**

---

## SECTION E: DATABASE REALITY CHECK

### Tables Found: 39

| Table | Row Count | RLS Enabled | Notes |
|-------|-----------|-------------|-------|
| action_history | 0 | YES | Service + user read own |
| agent_cards | 0 | YES | User manages own |
| ai_cost_log | 2 | YES | Service + user read own |
| autonomous_oauth_log | 0 | YES | Service + user read own |
| call_history | 0 | YES | Service + user read own |
| credential_vault | 0 | YES | **ZERO code uses this table** |
| cross_task_patterns | 0 | YES | **PUBLIC read/write (USING true)** |
| distributed_locks | 0 | YES | RLS ON but NO policies (default deny = good) |
| email_pin_sessions | 0 | YES | Service + user read own |
| error_logs | 0 | YES | Service only |
| execution_plans | 0 | YES | Service + user read own |
| failure_memory | 2 | YES | **Policy defined but RLS may not be properly enforced** |
| free_trial_signups | 0 | YES | Service + user read own |
| installed_skills | 0 | YES | Service + user read own |
| iteration_results | 0 | YES | Service + user read own |
| learnings | 0 | YES | Public read, service write |
| method_success_rates | 0 | YES | **PUBLIC read/write (USING true)** |
| model_performance | 0 | YES | **PUBLIC write (USING true)** |
| oauth_connections | 1 | YES | CRUD for own + service |
| processed_emails | 0 | YES | RLS ON but NO policies (default deny) |
| profiles | 4 | YES | View/update own, service insert |
| scheduled_tasks | 0 | YES | Users manage own |
| skills | 8 | YES | Authenticated read, service manage |
| task_difficulty_cache | 0 | YES | **PUBLIC write (USING true)** |
| task_logs | 0 | YES | Service only |
| task_queue | 0 | YES | Service + user read own |
| tasks | 0 | YES | **INSERT/UPDATE with USING(true) = any user can write** |
| tfa_codes | 0 | YES | Service only |
| twilio_number_products | 0 | YES | Available numbers public read |
| usage | 3 | YES | Service + user read own |
| user_credentials | 0 | YES | User + service manage |
| user_memory | 0 | YES | User + service manage |
| user_sessions | 0 | YES | User manages own |
| user_settings | 3 | YES | User manages own |
| user_twilio_numbers | 0 | YES | Service + user read own |
| users | 2 | YES | Service + user read own |
| verification_learnings | 0 | YES | **PUBLIC write (USING true)** |
| workflow_steps | 0 | YES | **PUBLIC write (USING true)** |
| workflows | 0 | YES | CRUD for own |

### Database Functions (RPCs): 18

| Function | Type | Return |
|----------|------|--------|
| check_quota | FUNCTION | boolean |
| cleanup_expired_email_pin_sessions | FUNCTION | integer |
| cleanup_expired_tfa_codes | FUNCTION | void |
| get_autonomous_settings | FUNCTION | record |
| get_latest_tfa_code | FUNCTION | text |
| handle_new_user | FUNCTION | trigger |
| increment_email_pin_attempts | FUNCTION | void |
| increment_usage | FUNCTION | void |
| is_skill_installed | FUNCTION | boolean |
| record_action | FUNCTION | uuid |
| reset_email_pin_attempts | FUNCTION | void |
| track_usage | FUNCTION | void |
| track_voice_sms_usage | FUNCTION | void |
| update_updated_at_column | FUNCTION | trigger |
| upsert_method_success | FUNCTION | void |
| upsert_model_performance | FUNCTION | void |
| upsert_task_difficulty | FUNCTION | void |
| upsert_verification_learning | FUNCTION | void |

### Edge Functions: 1

| Name | Status | JWT |
|------|--------|-----|
| send-email | ACTIVE | No (verify_jwt: false) |

### Triggers: 1

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| update_tasks_updated_at | tasks | UPDATE | update_updated_at_column() |

### Supabase Security Advisors: 12 findings

| Level | Finding | Detail |
|-------|---------|--------|
| INFO | RLS Enabled No Policy | `distributed_locks` -- RLS on, no policies (correct for service-only) |
| INFO | RLS Enabled No Policy | `processed_emails` -- RLS on, no policies (correct for service-only) |
| WARN | RLS Always True | `cross_task_patterns` -- ALL with USING(true) |
| WARN | RLS Always True | `method_success_rates` -- ALL with USING(true) |
| WARN | RLS Always True | `model_performance` -- ALL with USING(true) |
| WARN | RLS Always True | `profiles` INSERT -- WITH CHECK(true) |
| WARN | RLS Always True | `task_difficulty_cache` -- ALL with USING(true) |
| WARN | RLS Always True | `tasks` INSERT -- WITH CHECK(true) |
| WARN | RLS Always True | `tasks` UPDATE -- USING(true) |
| WARN | RLS Always True | `verification_learnings` -- ALL with USING(true) |
| WARN | RLS Always True | `workflow_steps` -- ALL with USING(true) |
| WARN | Leaked Password Protection | Supabase Auth HIBP check disabled |

### Supabase Performance Advisors: 251 findings

| Level | Finding | Count |
|-------|---------|-------|
| WARN | Multiple Permissive Policies | 148 occurrences |
| WARN | Auth RLS Initialization Plan (`auth.uid()` not wrapped in `(select ...)`) | 63 occurrences across nearly all tables |
| INFO | Unused Index | 37 occurrences |
| WARN | Duplicate Index | 2 occurrences |
| INFO | Unindexed Foreign Key | 1 occurrence (workflow_steps.task_id) |

### Undocumented Tables (exist in DB but NOT in CLAUDE.md)

These 12 tables exist in the database but are NOT documented in CLAUDE.md:
- `autonomous_oauth_log`
- `call_history`
- `cross_task_patterns`
- `error_logs`
- `free_trial_signups`
- `installed_skills`
- `iteration_results`
- `method_success_rates`
- `model_performance`
- `task_difficulty_cache`
- `twilio_number_products`
- `verification_learnings`

---

## SECTION F: FILE TREE SNAPSHOT

Legend: COMPLETE = real logic, STUB = scaffolded/placeholder, MOCK = uses fake data

```
/workspaces/Aevoy_Omar-copy/
  .claude/settings.local.json              COMPLETE (autonomy config)
  .env.example                             COMPLETE (24 vars)
  .mcp.json                                COMPLETE (github, playwright, supabase)
  CLAUDE.md                                COMPLETE (comprehensive docs)
  Dockerfile                               COMPLETE (Node 20-slim + Playwright)
  docker-compose.yml                       COMPLETE (agent container)
  deploy.sh                                COMPLETE (3-component deploy)
  railway.toml                             COMPLETE

  apps/desktop/                            --- SCAFFOLDED, NOT FUNCTIONAL ---
    main/db.ts                             STUB
    main/index.ts                          STUB (Electron main, IPC placeholders)
    main/local-browser.ts                  STUB
    main/safety.ts                         STUB
    main/screen-control.ts                 STUB
    main/tray.ts                           STUB

  apps/web/                                --- MAIN WEB APPLICATION ---
    middleware.ts                           COMPLETE
    next.config.ts                         COMPLETE (CSP + security headers)
    vercel.json                            COMPLETE

    app/
      page.tsx                             COMPLETE (~2000 lines, full landing)
      layout.tsx                           COMPLETE

      (auth)/
        login/page.tsx                     COMPLETE (email/password + demo)
        signup/page.tsx                    COMPLETE (strength + beta modal)

      dashboard/
        layout.tsx                         COMPLETE (sidebar + mobile drawer)
        page.tsx                           COMPLETE (SSR stats)
        activity/page.tsx                  COMPLETE (task list)
        settings/page.tsx                  COMPLETE (1409 lines, 8 cards)
        skills/page.tsx                    COMPLETE (marketplace)
        queue/page.tsx                     MOCK (hardcoded data, no API)

      connect/[token]/page.tsx             COMPLETE (OAuth callback)
      hive/page.tsx                        COMPLETE (Hive Mind browser)
      how-it-works/page.tsx                COMPLETE
      legal/privacy/page.tsx               COMPLETE
      legal/terms/page.tsx                 COMPLETE
      security/page.tsx                    COMPLETE

      api/ (42 route files)                ALL COMPLETE (see below)
        tasks/route.ts                     COMPLETE (GET+POST)
        user/route.ts                      COMPLETE (GET+PATCH)
        user/delete/route.ts              COMPLETE (GDPR, 19-table cascade)
        user/export/route.ts              COMPLETE (JSON download)
        usage/route.ts                     COMPLETE
        stats/route.ts                     COMPLETE
        memory/route.ts                    COMPLETE
        settings/route.ts                  COMPLETE
        settings/email-pin/route.ts        COMPLETE
        settings/pin/route.ts              COMPLETE
        onboarding/complete/route.ts       COMPLETE
        onboarding/check-username/route.ts COMPLETE
        onboarding/request-call/route.ts   COMPLETE
        onboarding/save-step/route.ts      COMPLETE
        onboarding/send-questionnaire/route.ts COMPLETE
        integrations/gmail/route.ts        COMPLETE
        integrations/gmail/callback/route.ts COMPLETE
        integrations/microsoft/route.ts    COMPLETE
        integrations/microsoft/callback/route.ts COMPLETE
        integrations/email/route.ts        COMPLETE
        hive/learnings/route.ts            COMPLETE
        hive/vents/route.ts                COMPLETE
        hive/sync/route.ts                 COMPLETE
        hive/public/{learnings,stats,vents}/route.ts COMPLETE
        demo/task/route.ts                 COMPLETE
        demo/call/route.ts                 COMPLETE
        demo/email-result/route.ts         COMPLETE
        phone/route.ts                     COMPLETE
        phone/purchase/route.ts            COMPLETE
        phone/search/route.ts              COMPLETE
        agent-card/route.ts                COMPLETE
        scheduled-tasks/route.ts           COMPLETE
        workflows/route.ts                 COMPLETE
        webhooks/stripe/route.ts           COMPLETE (5 events, no Stripe SDK)
        webhooks/task/route.ts             COMPLETE
        profile/beta-status/route.ts       COMPLETE
        skills/install/route.ts            COMPLETE
        connect/generate/route.ts          COMPLETE
        test-email/route.ts                COMPLETE

    components/
      beta-payment-modal.tsx               COMPLETE (card fields disabled)
      dashboard-with-onboarding.tsx         COMPLETE
      onboarding-wizard.tsx                COMPLETE
      recent-activity.tsx                  COMPLETE (polling, filters)
      scheduled-tasks.tsx                  COMPLETE (CRUD)
      onboarding/ (15 files)              ALL COMPLETE
      ui/ (17 primitives)                  ALL COMPLETE

    lib/
      encryption.ts                        COMPLETE (AES-256-GCM)
      theme.tsx                            COMPLETE
      types/database.ts                    COMPLETE
      utils.ts                             COMPLETE
      verify-webhook.ts                    COMPLETE
      supabase/{client,middleware,server}.ts COMPLETE
      hive/{learning-generator,learning-merger,moderator,pii-scrubber,vent-generator}.ts COMPLETE

    supabase/
      migration.sql (v1) through v16       COMPLETE (16 migration files)
      functions/send-email/                COMPLETE (edge function)

    e2e/ (8 test files)                    COMPLETE

  packages/agent/                          --- AGENT SERVER ---
    src/
      index.ts                             COMPLETE (1304 lines, Express server)
      types/index.ts                       COMPLETE

      execution/
        engine.ts                          COMPLETE (plan-then-execute)
        api-executor.ts                    COMPLETE (Google/Microsoft APIs)
        actions/click.ts                   COMPLETE (15 methods)
        actions/fill.ts                    COMPLETE (17 methods)
        actions/login.ts                   COMPLETE (11 methods)
        actions/navigate.ts                COMPLETE (8 methods)
        antibot.ts                         COMPLETE
        captcha.ts                         COMPLETE
        dynamic-content.ts                 COMPLETE
        failure-handlers.ts                COMPLETE
        page-hash.ts                       COMPLETE
        popup-handler.ts                   COMPLETE
        retry.ts                           COMPLETE
        session-manager.ts                 COMPLETE
        stealth.ts                         COMPLETE

      memory/failure-db.ts                 COMPLETE
      security/{encryption,intent-lock,validator}.ts COMPLETE

      services/
        ai.ts                              COMPLETE (1012 lines, multi-model)
        browser.ts                         COMPLETE
        checkin.ts                          COMPLETE
        clarifier.ts                       COMPLETE
        context-carryover.ts               COMPLETE
        credential-vault.ts                COMPLETE
        difficulty-predictor.ts            COMPLETE
        email.ts                           COMPLETE
        identity/{normalizer,resolver}.ts   COMPLETE
        inbox-poller.ts                    COMPLETE (disabled in prod)
        iterative-deepening.ts             COMPLETE
        memory.ts                          COMPLETE (663 lines)
        method-tracker.ts                  COMPLETE
        model-intelligence.ts              COMPLETE
        oauth-manager.ts                   COMPLETE
        overnight.ts                       COMPLETE
        parallel-execution.ts              COMPLETE
        pattern-detector.ts                COMPLETE
        personality.ts                     COMPLETE
        planner.ts                         COMPLETE
        privacy-card.ts                    COMPLETE
        proactive.ts                       COMPLETE (562 lines)
        processor.ts                       COMPLETE (1677 lines)
        progress.ts                        COMPLETE
        scheduler.ts                       COMPLETE (630 lines)
        skill-registry.ts                  COMPLETE
        stagehand.ts                       COMPLETE (693 lines)
        task-decomposition.ts              COMPLETE
        task-verifier.ts                   COMPLETE (641 lines)
        tasks/{api,email,manual}-fallback.ts COMPLETE
        tfa.ts                             COMPLETE
        twilio.ts                          COMPLETE (637 lines)
        verification.ts                    COMPLETE
        verification-learner.ts            COMPLETE
        workflow.ts                        COMPLETE

      skills/
        {auditor,discovery,downloader,executor,index,installer}.ts COMPLETE
        registry.json                      COMPLETE

    config/personality/{SOUL,IDENTITY,USER_TEMPLATE}.md COMPLETE
    __tests__/ (4 test files)              COMPLETE

  workers/email-router/
    src/index.ts                           COMPLETE (745 lines)
    wrangler.toml                          COMPLETE

  docs/ (11 documentation files)           COMPLETE
```

---

## SECTION G: ENVIRONMENT VARIABLES

44 distinct environment variables found across 60+ files.

### Documented in .env.example AND used in code (24):

| Variable | Primary Files |
|----------|---------------|
| NEXT_PUBLIC_SUPABASE_URL | supabase/client.ts, server.ts, middleware.ts, agent/utils/supabase.ts |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | supabase/client.ts, server.ts, middleware.ts |
| SUPABASE_SERVICE_ROLE_KEY | agent/utils/supabase.ts, webhooks/*.ts, hive/*.ts |
| GROQ_API_KEY | agent/services/ai.ts |
| DEEPSEEK_API_KEY | agent/services/ai.ts, hive/*.ts, clarifier.ts |
| ANTHROPIC_API_KEY | agent/services/ai.ts, browser.ts, verifier.ts, captcha.ts |
| GOOGLE_API_KEY | agent/services/ai.ts, stagehand.ts |
| KIMI_API_KEY | agent/services/ai.ts |
| BROWSERBASE_API_KEY | agent/services/stagehand.ts, engine.ts |
| BROWSERBASE_PROJECT_ID | agent/services/stagehand.ts, engine.ts |
| TWILIO_ACCOUNT_SID | agent/services/twilio.ts, phone/*.ts, checkin.ts |
| TWILIO_AUTH_TOKEN | agent/services/twilio.ts, phone/*.ts |
| TWILIO_PHONE_NUMBER | agent/services/twilio.ts, demo/call.ts, checkin.ts |
| TWILIO_API_KEY_SID | agent/services/twilio.ts, phone/*.ts |
| TWILIO_API_KEY_SECRET | agent/services/twilio.ts, phone/*.ts |
| RESEND_API_KEY | agent/services/email.ts, test-email.ts |
| AGENT_WEBHOOK_SECRET | agent/index.ts, verify-webhook.ts, tasks/route.ts |
| AGENT_PORT | agent/index.ts |
| AGENT_URL | agent/index.ts, tasks/route.ts, workflows/route.ts |
| AGENT_INBOX_EMAIL | agent/services/inbox-poller.ts (disabled) |
| AGENT_INBOX_PASSWORD | agent/services/inbox-poller.ts (disabled) |
| GOOGLE_OAUTH_CLIENT_ID | integrations/gmail/*.ts, oauth-manager.ts |
| GOOGLE_OAUTH_CLIENT_SECRET | integrations/gmail/*.ts, oauth-manager.ts |
| ENCRYPTION_KEY | security/encryption.ts, memory.ts, lib/encryption.ts |

### Used in code but NOT in .env.example (20):

| Variable | Files | Impact |
|----------|-------|--------|
| **NEXT_PUBLIC_APP_URL** | integrations/gmail/*.ts, microsoft/*.ts, connect/generate.ts | **HIGH -- OAuth redirect URIs will fail without it** |
| **STRIPE_WEBHOOK_SECRET** | webhooks/stripe/route.ts | **HIGH -- Stripe webhooks unverified without it** |
| NEXT_PUBLIC_AGENT_URL | dashboard/skills/page.tsx | Medium -- skills marketplace won't load |
| MICROSOFT_CLIENT_ID | integrations/microsoft/*.ts, oauth-manager.ts | Medium -- Microsoft OAuth |
| MICROSOFT_CLIENT_SECRET | integrations/microsoft/*.ts, oauth-manager.ts | Medium -- Microsoft OAuth |
| ALLOWED_ORIGINS | agent/index.ts | Low -- CORS |
| AGENT_WEBHOOK_BASE_URL | agent/services/twilio.ts | Low -- Twilio webhook base |
| PRIVACY_API_KEY | agent/services/privacy-card.ts | Low -- optional feature |
| YELP_API_KEY | tasks/api-fallback.ts | Low -- optional |
| TWOCAPTCHA_API_KEY | execution/captcha.ts | Low -- optional CAPTCHA solving |
| PROXY_LIST | execution/antibot.ts | Low -- optional proxy rotation |
| AI_MOCK_MODE | agent/services/ai.ts | Low -- testing only |
| OLLAMA_HOST | agent/services/ai.ts | Low -- optional local AI |
| TEST_MODE | agent/index.ts, processor.ts | Low -- testing |
| SKIP_PAYMENT_CHECKS | processor.ts, webhooks/stripe.ts | Low -- testing |
| STAGEHAND_MODEL | stagehand.ts | Low -- override |
| ADMIN_USER_IDS | profile/beta-status.ts | Low |
| NODE_ENV | multiple | Set by runtime |
| CI | playwright.config.ts | Set by CI |

### In .env.example but NOT used in code (1):

| Variable | Notes |
|----------|-------|
| JWT_SECRET | Dead variable -- referenced nowhere in code |

---

## TODO/FIXME/HACK Comments Found

| File | Line | Comment |
|------|------|---------|
| packages/agent/src/skills/discovery.ts | 157 | "TODO: Implement MCP registry search via puppeteer/cheerio" |
| packages/agent/src/skills/discovery.ts | 261 | "TODO: Implement MCP skill fetching" |
| packages/agent/src/skills/downloader.ts | 185 | "TODO: Implement MCP skill download" |
| packages/agent/src/services/checkin.ts | 97 | "TODO: Integrate AI-generated greetings properly with full Memory context" |
| packages/agent/src/services/memory.ts | 489 | "For now, extract key facts using simple heuristic" (AI summarization not implemented) |
| packages/agent/src/services/processor.ts | 706 | "Note: Full decomposition execution would require recursive processTask calls. For now, just log" |
| packages/agent/src/services/processor.ts | 737 | "Could generate connect links here in future -- for now just log" |
| packages/agent/src/index.ts | 940 | "plaintext for now, will encrypt later" (voice PIN) |

## Notable Hardcoded Values

| Value | Location | Purpose |
|-------|----------|---------|
| $15/user/month | ai.ts:408 | Monthly budget cap |
| $2/task | processor.ts:841, 1037 | Per-task cost cap |
| 100 entries, 5-min TTL | ai.ts:34-35 | Response cache |
| 3 min / 30s | engine.ts:26-27 | Task/step timeouts |
| 800ms | engine.ts:28 | Post-action wait |
| 90 days | failure-db.ts:14 | Failure memory expiration |
| 0.3 | failure-db.ts:17 | EMA weight |
| 3 uses | failure-db.ts:20 | Global promotion threshold |
| 5/600s/60s | ai.ts:213 | Circuit breaker |
| 14 days | planner.ts:98 | Cached browser step validity |
| $3 | processor.ts:523 | Budget alert threshold |
| +17789008951 | index.ts:972, checkin.ts:22 | Hardcoded Twilio number |

---

*End of Phase 1 Audit Report*
