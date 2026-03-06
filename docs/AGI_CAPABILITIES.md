# Aevoy AGI — Capabilities Reference

> What the agent can do, how it decides, and what it costs.

---

## Table of Contents

1. [Input Channels](#1-input-channels)
2. [Action Types](#2-action-types)
3. [AGI Intelligence Features](#3-agi-intelligence-features)
4. [Browser Automation](#4-browser-automation)
5. [Escalation vs Autonomous Action](#5-escalation-vs-autonomous-action)
6. [Pricing by Task Type](#6-pricing-by-task-type)

---

## 1. Input Channels

The agent accepts tasks from any of these channels. The response is delivered back through the same channel by default, unless the user specifies otherwise.

| Channel | Inbound Path | Auth | Notes |
|---------|-------------|------|-------|
| `email` | Cloudflare Worker → `inbox_queue` → IMAP poller | PIN in subject/body (unknown senders) | Supports full HTML replies |
| `sms` | `POST /webhook/sms/incoming` | PIN in body (unknown numbers) | Replies truncated at 1500 chars; long responses also emailed |
| `voice` | Twilio → `POST /webhook/voice/incoming` | DTMF PIN | Full conversational AI via ConversationRelay + ElevenLabs |
| `web` | Dashboard → `POST /task` | Supabase session JWT | Used by dashboard "Ask me anything" |
| `telegram` | Telegram Bot webhook | Linked at setup time (no PIN) | Full message support |
| `whatsapp` | Twilio WhatsApp webhook | Linked at setup time (no PIN) | Same as SMS but via WhatsApp |
| `proactive` | Internal — scheduler or monitoring job | N/A | Agent-initiated, no user input |
| `workflow` | Internal — workflow engine | N/A | Multi-step automated flows |

### Cross-Channel Response

The AI can respond on a different channel than it received the message. Examples:

- Email task → "text me when done" → AI sends SMS
- SMS task → task too long for SMS → AI also sends email
- Voice call → task too complex → AI sends email with full details

The `sendViaChannel()` function handles routing. SMS responses > 1500 characters automatically get a truncated SMS plus a full email.

---

## 2. Action Types

The AI generates one or more actions per iteration. These are parsed from the AI response as structured tags and executed by `processor.ts` or `vision-agent.ts`.

### Web & Research

| Action | What It Does | Example |
|--------|-------------|---------|
| `browse` | Navigate browser to URL and extract content | "Go to amazon.com and find MacBook prices" |
| `search` | Fetch-based search (DDG Lite → Brave → DDG Instant → browser) | "Find the best sushi restaurant downtown" |
| `screenshot` | Take and analyze browser screenshot | Used internally after every browser action |
| `screenshot_ocr` | Extract text from image using vision AI | "Read the text in this screenshot" |
| `extract` | Pull structured data from current page | "Get all product names and prices" |
| `scroll` | Scroll page up/down/to element | Used in vision agent for infinite-scroll pages |
| `wait` | Pause execution, then check inbox for verification codes | "Wait for email verification" → auto-reads OTP |
| `click` | Click a DOM element by selector or reference | Used in vision agent step execution |
| `fill` | Fill a form field (handles React-controlled inputs) | Used in vision agent form filling |
| `select` | Choose a dropdown option | Used in vision agent |
| `submit` | Submit a form | Used in vision agent |

### Communication

| Action | What It Does | Cost |
|--------|-------------|------|
| `send_email` | Send email via Resend | ~$0 (Resend free tier) |
| `read_email` | Read inbox via IMAP | ~$0 |
| `send_sms` | Send SMS via user's dedicated Twilio number | ~$0.0083/message |
| `send_whatsapp` | Send WhatsApp message via Twilio | ~$0.005/message |
| `send_telegram` | Send Telegram message via Bot API | $0 |
| `call_user` | Call user back via Twilio ConversationRelay | ~$0.0525/min |
| `call_external` | Call a business/restaurant on user's behalf | ~$0.0525/min (outbound) |

Per-task limits: 3 `call_user` + 3 `call_external` per task (prevents runaway call loops).

### Scheduling & Memory

| Action | What It Does | Example |
|--------|-------------|---------|
| `schedule` | Create a scheduled task (cron or one-time) | "Remind me tomorrow at 9am" |
| `remember` | Write a fact to long-term memory | "Remember my favorite restaurant is Nobu" |
| `check_calendar` | Read user's Google/Outlook calendar | "What do I have tomorrow?" |
| `create_event` | Add event to user's calendar | "Book a dentist appointment for Friday 2pm" |

Schedule expressions use standard cron syntax for recurring tasks, or `'once'` for one-time tasks. Relative times ("in 2 hours", "tomorrow at 9am") are converted to absolute timestamps using the user's timezone from `profiles.timezone`.

### Document Creation

All documents are generated in memory and stored in `/tmp/aevoy-files/`, then served at `https://agent-production-1339.up.railway.app/files/`.

| Action | Output | Format |
|--------|--------|--------|
| `create_excel` | Excel spreadsheet | `.xlsx` |
| `create_powerpoint` | PowerPoint presentation | `.pptx` |
| `create_word` | Word document | `.docx` |
| `create_pdf` | PDF document | `.pdf` |
| `generate_image` | PNG image via Gemini 2.0 Flash image generation | `.png` |

The agent emails the user a download link after generation.

### Social & Marketing

| Action | What It Does | Notes |
|--------|-------------|-------|
| `post_tweet` | Post to Twitter/X via OAuth | Requires Twitter OAuth connection |
| `create_campaign` | Create email marketing campaign | Requires connected email marketing integration |
| `generate_video_call` | Generate a video call link | Currently in development |

### Health & Fitness

| Action | What It Does | Notes |
|--------|-------------|-------|
| `analyze_health_data` | Analyze fitness/health data | Fitbit, Apple Health — Coming Soon |

### Browser Login

| Action | What It Does |
|--------|-------------|
| `login` | Log into a website using stored credentials or agent passwords |
| `fill_form` | Fill a multi-field web form |

Agent passwords (up to 3 slots: primary, secondary, tertiary) are stored AES-256-GCM encrypted in `profiles.agent_passwords_encrypted`. The AI uses `{primary_password}` template syntax in `fill` actions — resolved at execution time.

---

## 3. AGI Intelligence Features

These are the core intelligence systems built into the platform, beyond basic AI completion.

### 1. Hive Mind (Cross-User Learning)

The agent learns from outcomes across all users (anonymized). When a task starts, the agent queries `global_learnings` for the relevant domain and injects successful approaches into its context.

- **Inputs**: domain (e.g., `amazon.com`, `restaurant_booking`), task type, approach
- **Outcome tracking**: success/failure, EMA-updated success rate, confidence score
- **Privacy**: fully anonymized — no user_id in `global_learnings`
- **Opt-out**: `user_settings.contribute_to_hive_mind = false`
- **Effect**: The agent avoids known failure patterns and tries known-good approaches first

### 2. Failure Memory and Retry Intelligence

Per-user failure tracking in `failure_fixes` and `failure-db.ts`:

- Records what failed and what fixed it for each domain/task type combination
- On retry, injects "what failed last time" context to prevent dumb repetition
- `buildRetryEnforcementMessage()` injects prior failure context into each re-prompt
- Categories: `oauth_fallback`, `mobile_site`, `coordinate_click`, `search_alternative`

### 3. Adaptive Model Routing (Model Intelligence)

`model-intelligence.ts` tracks per-model success rates per user and task type:

- `model_performance` table: successes, failures, tokens, cost, latency per model
- `getAdaptiveChain()` reorders the ROUTING_TABLE based on historical performance
- Models with high failure rates are deprioritized for that user's task type
- Learns in real time — each completed task updates the performance record

### 4. Proactive Intent Completion

The agent drives the conversation forward, not the user.

After every completed task, `quickValidate()` checks for a natural next step:
- Restaurant found → "Want me to call and make a reservation?"
- Product price found → "Should I add it to your cart?"
- Content written → "Want me to post this to Twitter?"
- Research done → "Want me to email you a summary or act on this?"

The follow-up question is appended as a single sentence to the response. The next user message is then treated as confirmation/rejection.

### 5. Agent Team (Parallel Specialist Execution)

For complex multi-domain tasks, `agent-team.ts` decomposes and executes in parallel:

1. `isComplexTask()` — determines if a task spans multiple domains
2. Decomposes into specialist subtasks (research specialist, action specialist, communication specialist)
3. Executes subtasks in parallel
4. Synthesizes results into a unified response

Example: "Research flights, hotels, and activities for a Tokyo trip" → 3 parallel specialists.

### 6. Monitoring Service (Background Watchdogs)

The AI registers monitoring jobs via `[REMEMBER: MONITOR: description every Xmin]` tags in responses. The monitoring service:

- Parses interval from natural language: "every 15min", "every hour", "daily"
- Runs background AI checks at the interval using distributed locks (prevents duplicate execution on multi-instance deployments)
- If the check finds something actionable, notifies via user's preferred channel
- Max 3 concurrent monitoring jobs per user (`user_settings.max_monitor_jobs`)

Examples the AI might auto-register:
- "Monitor my inbox for a reply from John every 15 minutes"
- "Check Amazon price for MacBook Air every hour"
- "Watch for new job listings matching my criteria daily"

Monitoring jobs NEVER launch browser sessions — they use fetch-based checks only.

### 7. Self-Learning Difficulty Predictor

`difficulty-predictor.ts` predicts task complexity before execution:

- Historical completion rates per task type
- Used to set initial iteration budget and model selection
- Records actual vs. predicted difficulty to improve future estimates

---

## 4. Browser Automation

### What the Vision Agent Can Do

- Navigate to any public URL
- Log into websites using stored credentials
- Fill forms (including React-controlled inputs with native setter injection)
- Click buttons, links, and interactive elements
- Handle multi-step flows (sign up → verify email → complete profile)
- Auto-read verification codes from inbox during WAIT steps
- Scroll through infinite-scroll pages
- Handle cookie consent banners automatically
- Solve CAPTCHAs via CapSolver (reCAPTCHA v2/v3, Cloudflare Turnstile)
- Take and analyze screenshots with vision AI after every action
- Extract structured data from pages (prices, addresses, phone numbers, etc.)
- Handle JavaScript-heavy SPAs (waits for network idle after navigation)

### What the Vision Agent Cannot Do

| Limitation | Why | Workaround |
|-----------|-----|-----------|
| Sites that detect all headless browsers | Some use browser fingerprinting beyond what patchright patches | Bright Data Scraping Browser (more stealthy) or phone escalation |
| Requires payment to proceed | Agent has no real payment card | Agent Spending Card feature (planned) |
| MFA with TOTP authenticator apps | No access to authenticator app | User takeover request |
| Requires physical device (hardware 2FA) | No physical access | User takeover request |
| Sites blocking Railway IP ranges | IP blocklisting | Bright Data proxy rotation |
| Very long tasks > 40 vision steps | Hard step limit | Task decomposition into sub-tasks |
| Flash/Java content | Deprecated technologies | N/A |

### Browser Priority Chain

1. **Bright Data Scraping Browser** — anti-bot bypass, residential proxy rotation. Best for Amazon, LinkedIn, travel booking sites. Costs ~$0.02/session.
2. **Remote Chrome CDP** — VPS or Railway sidecar with headless Chrome. Good for general browsing.
3. **Local patchright** — Chromium in the Railway container. Fallback, may be blocked by aggressive bot detection.

### Takeover Flow

If the vision agent is stuck (CAPTCHA it cannot solve, bot block, verification it cannot complete), it:

1. Sets `tasks.needs_takeover = true` and `status = 'awaiting_user_input'`
2. Sends user a message via their channel with:
   - Live browser view URL (if available)
   - Dashboard takeover URL: `https://www.aevoy.com/dashboard/takeover/{taskId}`
3. Waits for user to resolve the blocker and click "I'm Done"
4. Resumes execution from where it stopped

---

## 5. Escalation vs Autonomous Action

### When the Agent Acts Autonomously

The agent acts without asking when:

- Task is unambiguous ("send an email to john@example.com saying...")
- Task type is low-risk (research, reading, writing, scheduling)
- `confirmation_mode` in user_settings is set to `off` (default for most actions)
- Fast paths apply (weather, SMS, email send, schedule)
- The action is clearly within the user's stated intent from prior context

### When the Agent Asks First

The agent asks before acting when:

- The task involves irreversible actions (sending to many people, account changes, large purchases)
- `confirmation_mode` in user_settings is set to `always`
- Required information is missing (e.g., "book a restaurant" with no time specified → asks for time via SMS/email/call)
- Task is ambiguous (classifier confidence below threshold)

Clarification is sent via the user's active channel. The `clarification_timeout_ms` in `user_settings` controls how long the agent waits for a reply before timing out.

### When the Agent Escalates

The agent escalates to the user when:

- Browser is stuck (bot detection, CAPTCHA, hardware 2FA)
- Task requires payment and no card is configured
- 3 consecutive failures at the same step (3-strike system)
- The task hits the $5 budget cap
- The task hits the 40-minute timeout

Escalation always includes a specific reason and the next step the user should take.

### The Passive Guard

The PASSIVE-GUARD system detects and rejects AI responses that ask "want me to?" instead of acting. Before returning a response, `processor.ts` checks:

- Does the response contain passive intent patterns ("should I", "want me to", "would you like me to")?
- If yes, and the task type requires action → rewrite the response to perform the action directly

The passive guard has an exception for credential-gated tasks (e.g., Netflix, Hulu) where the agent genuinely cannot proceed without stored credentials.

---

## 6. Pricing by Task Type

All costs include the 20% billing markup. Costs are estimates based on typical token usage and the model routing table.

### Fast Path Tasks (Pre-AI)

| Task | Cost | Why |
|------|------|-----|
| Weather lookup | $0.00 | wttr.in API, no AI |
| Schedule a reminder | $0.001 | DB insert only |
| Simple greeting | $0.001 | Single Groq call |

### Text Tasks (AI Only, No Browser)

| Task | Estimated Cost | Primary Model |
|------|---------------|---------------|
| Answer a question | $0.001–$0.005 | Groq Scout |
| Write an email | $0.003–$0.01 | Groq Kimi / Llama |
| Write a document (long) | $0.01–$0.05 | DeepSeek / Gemini |
| Analyze uploaded data | $0.005–$0.02 | Claude Haiku |
| Create Excel spreadsheet | $0.01–$0.04 | Groq + file gen |
| Create PowerPoint | $0.02–$0.08 | Groq + file gen |
| Generate image | $0.001–$0.01 | Gemini Flash |
| Research task (fetch-based) | $0.005–$0.03 | Groq + Brave Search |

### Browser Tasks

| Task | Estimated Cost | Time | Notes |
|------|---------------|------|-------|
| Look up product price | $0.02–$0.06 | 10–40s | Vision agent, ~10 steps |
| Book a restaurant reservation | $0.05–$0.15 | 2–8 min | Vision agent, 20–40 steps |
| Sign up for a service | $0.05–$0.20 | 3–10 min | Vision agent, 20–50 steps |
| Cancel a subscription | $0.04–$0.12 | 2–6 min | Vision agent, 15–35 steps |
| Book a flight | $0.08–$0.25 | 5–15 min | Vision agent, 30–60 steps |
| Full AGI task (multi-site) | $0.10–$0.50 | 10–40 min | Multiple browser sessions |

Bright Data adds ~$0.02/session to browser task cost.

### Communication Tasks

| Task | Cost | Notes |
|------|------|-------|
| Send SMS | $0.01 | Twilio $0.0083/message + markup |
| Send WhatsApp | $0.006 | Twilio $0.005/message + markup |
| Send Telegram | $0.001 | Telegram Bot API is free |
| Send email | $0.001 | Resend free tier |
| Outbound voice call (per minute) | $0.063 | Twilio $0.0525/min + markup |
| Inbound voice call (per minute) | $0.025 | Twilio $0.0085/min inbound + ConversationRelay |

### Per-Task Budget Cap

Each task has a configurable budget cap (default $5.00). When the cap is reached, the agent stops and reports what was accomplished. The budget can be adjusted per user in `user_settings.task_budget_cents`.

### Monitoring Jobs

Monitoring jobs run in the background on a schedule. Cost depends on the check type:

| Check Type | Cost Per Check | Notes |
|-----------|---------------|-------|
| Fetch-based (URL, API) | $0.001–$0.005 | No browser, Groq only |
| Browser-based | N/A | Monitoring jobs are NOT allowed to launch browser sessions |
| Email inbox check | $0.001–$0.003 | IMAP + Groq analysis |
