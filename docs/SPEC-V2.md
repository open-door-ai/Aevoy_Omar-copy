# AEVOY - Complete Technical Specification v2

**Your AI Employee That Never Fails**

Document Version: 2.0 FINAL
Date: February 2, 2026

---

## Executive Summary

Aevoy is an AI assistant that can fully control a computer and do any task a human can do. Users interact via email, chat, phone calls, or text. The AI never gives up, never fails, and always delivers results.

### Core Philosophy

- "If a human can do it on a computer, Aevoy can do it."
- "It must JUST WORK. No excuses. No failures."
- "Security is invisible - users never see it, but it's impenetrable."

### Two Deployment Modes

| Mode | How It Works | Cost |
|------|-------------|------|
| Cloud Mode | User emails aevoy.com, servers run browser via Browserbase + Stagehand v3, result emailed back | Higher ($0.10-0.12/min browser) |
| Local Mode | User installs Electron app, AI controls their computer directly via nut.js | Lower (user's computer) |

---

## Part 1: High-Level Architecture

### System Layers

| Layer | Components | Purpose |
|-------|-----------|---------|
| User Interaction | Email (aevoy.com), Chat App, Phone/SMS (Twilio), Voice | How users communicate with Aevoy |
| Aevoy Brain | Lead Agent + Sub-Agents (Browser, Email, Calendar, File, Communication, Purchase) | Understands tasks, picks AI model, breaks into sub-tasks, verifies work |
| Execution Layer | Cloud: Browserbase + Stagehand v3, Local: Electron + nut.js | Actually performs the actions |
| Verification Layer | Screenshot after EVERY action, Claude Vision verification, 100+ fallback methods | Ensures task completed correctly |
| Data Layer | Supabase with user-derived encryption, RLS policies | Secure storage of all data |

---

## Part 2: Security Architecture

### Threat Model & Solutions

| Threat | Solution | Result |
|--------|---------|--------|
| Data Breach | User-derived encryption (PBKDF2 + AES-256-GCM) | Hacker gets useless encrypted blobs |
| Prompt Injection | Intent Locking - task scope locked BEFORE execution | AI physically cannot exceed task scope |
| AI Mistakes | Verification layer + Undo system | Every action verified before continuing |
| Rogue AI | Task-type permissions (allowedActions, blockedActions per task) | Capabilities limited per task type |
| Computer Takeover (Local) | Screen recording + Panic button (Cmd+Shift+X) | User can stop and review anytime |
| Cross-User Leak | Row-Level Security in Supabase | Database enforces complete isolation |

### Intent Locking

Before browsing any website, the task scope is locked immutably:
- **goal**: The specific task
- **allowedActions**: Only navigate, click, fill_form, read_text
- **blockedActions**: send_email, make_purchase, download_file
- **allowedDomains**: Only relevant domains
- **maxBudget**: 0 (no purchases allowed unless specified)
- **locked**: true, lockedAt: timestamp - IMMUTABLE

---

## Part 3: The Never-Fail System

### Fallback Chains

| Action Type | Fallbacks | Key Methods |
|------------|----------|-------------|
| Click | 15 methods | CSS selector, XPath, text content, role-based, force click, JS click, coordinates, scroll+click, keyboard nav, wait+retry, Claude Vision, viewport changes, hover+click, double-click |
| Form Fill | 12 methods | Standard fill, by label, by placeholder, clear+type, char-by-char, JS value set, React input hack, focus+type, paste, by name, by ID, Claude Vision |
| Login | 10 methods | Standard form, two-step, Google OAuth, magic link, mobile site, API login, cookie injection, Enter key, tab navigation, Claude Vision guided |
| Navigation | 8 methods | Direct URL, search+click, menu navigation, sitemap, mobile version, cached route, fallback URLs, Claude Vision |

### Browserbase + Stagehand v3 Advantages

- 95% baseline success rate with managed browser infrastructure
- 44% faster than v2 - uses Chrome DevTools Protocol (CDP) directly
- Self-healing execution layer adapts to DOM changes in real-time
- Auto-caching of discovered elements - no LLM inference cost for repeats
- Built-in CAPTCHA solving, residential proxies, fingerprint generation
- Hybrid mode: DOM-based + Vision-based (CUA) for maximum reliability

---

## Part 4: AI Model Routing

### Model Hierarchy

| Model | Cost (per 1M tokens) | Use For | Priority |
|-------|---------------------|---------|----------|
| DeepSeek V3.2 | $0.25 input / $0.38 output | Primary: understanding, planning, simple tasks, responses | 1 (default) |
| Kimi K2 | $0.60 input / $2.50 output (75% savings with cache) | Tool use, coding, agentic tasks with caching | 2 (alternative) |
| Gemini 2.0 Flash | FREE tier | Fallback, simple validation | 3 (free fallback) |
| Claude Sonnet 4 | $3 input / $15 output | Complex reasoning, vision, screenshot verification | 4 (when needed) |
| Local (Ollama) | FREE | Privacy mode, offline, simple tasks | Optional |

### Routing Logic

| Task Type | Primary Model | Fallback Chain |
|-----------|--------------|----------------|
| understand | DeepSeek V3.2 | Kimi K2 -> Gemini Flash -> Claude Haiku |
| plan | DeepSeek V3.2 | Kimi K2 -> Claude Haiku |
| reason | Claude Sonnet | Kimi K2 -> DeepSeek V3.2 |
| vision | Claude Sonnet | Gemini Flash (free vision) |
| validate | Gemini Flash | DeepSeek V3.2 |
| respond | DeepSeek V3.2 | Claude Haiku |
| local | Ollama/Llama3 | Ollama/Mistral -> DeepSeek V3.2 |

### Cost Tracking & Limits

- Track every API call with model, tokens, and cost
- Monthly budget per user: $15 (triggers aggressive optimization if exceeded)
- Target: <$0.10 average cost per task

---

## Part 5: Verification System

### 3-Step Verification Flow

| Step | Name | What It Does | Model Used |
|------|------|-------------|-----------|
| 1 | Self-Check | Same AI looks at screenshot and checks if task succeeded | Gemini Flash (free) |
| 2 | Evidence Check | Look for proof: confirmation numbers, success messages, emails | Code (no AI) |
| 3 | Smart Review | If confidence < 90%, smarter AI reviews the work | Claude Sonnet |

### Task-Specific Verification

| Task Type | Verification Method | Pass Criteria |
|-----------|-------------------|---------------|
| Book reservation | Screenshot + email check | Confirmation number found OR email received |
| Send email | Check sent folder | Email appears in sent folder |
| Fill form | Screenshot analysis | Success message visible OR redirect to thank you page |
| Login | Screenshot analysis | Dashboard/home page loads, no error messages |
| Purchase | Screenshot + email check | Order confirmation visible AND receipt email |
| File download | File system check | File exists, correct size, not corrupted |
| Calendar event | Calendar API check | Event appears in calendar at correct time |

---

## Part 6: Voice Communication (Twilio)

### Capabilities

| Feature | Description | Use Case |
|---------|-----------|----------|
| AI calls user | Proactive updates, questions, alerts | Domain expiring, meeting reminder |
| User calls AI | Give tasks by voice | "Book me a dinner reservation" |
| AI calls others | Book appointments, make inquiries | Call restaurant, dentist |
| AI receives calls | Act as receptionist | Answer business line, take messages |
| SMS two-way | Text-based task management | Send task via text, receive updates |
| 2FA codes | AI phone receives verification codes | Login to sites requiring SMS verification |

### Twilio Pricing

| Service | Cost | Notes |
|---------|------|-------|
| Local phone number | $1.00/month | 604 area code for Vancouver |
| Inbound calls (local) | $0.0085/minute | When user calls AI |
| Outbound calls (local) | $0.014/minute | When AI calls user or others |
| SMS (send) | $0.0079/message | Notifications, updates |
| SMS (receive) | $0.0079/message | Receiving tasks, 2FA codes |
| Speech-to-text | $0.035/minute | Transcribing voice commands |

---

## Part 7: Virtual Card System (Deferred)

Uses Stripe Issuing ($0.10/virtual card, no monthly fee).
- Create virtual card instantly via API
- Set per-transaction limit (default $50)
- Set monthly limit (default $200)
- Real-time authorization webhooks
- Instant freeze/unfreeze
- Full transaction log with merchant details

**Note:** Virtual card implementation is deferred post-launch.

---

## Part 8: Proactive Features

### Proactive Behaviors

| Trigger | AI Action | Channel | Priority |
|---------|----------|---------|----------|
| Domain expiring in 7 days | Alert user, offer to renew | Call + SMS | High |
| Meeting in 1 hour | Prepare agenda, send summary | Email + SMS | Medium |
| Unanswered email > 24 hours | Remind user, offer to draft reply | SMS | Medium |
| Bill due soon | Alert user, offer to pay | Call + SMS | High |
| Flight booked | Check in automatically at 24 hours | Automated | Medium |
| Package shipped | Track and notify on delivery day | SMS | Low |
| Recurring task detected (3+) | Offer to automate | Email | Low |
| Better deal found | Alert price drop | Email | Low |

### Implementation

- Cron job runs hourly for all users with proactive_enabled=true
- ProactiveEngine class with check methods for each trigger
- Findings have priority: high (immediate call), medium (SMS), low (queue)
- Pattern detection uses last 30 days of task history

---

## Part 9: Memory System

### Memory Types

| Type | What It Stores | Retention | Example |
|------|---------------|-----------|---------|
| Short-term | Current task context | Until task complete | Current booking details |
| Working | Recent conversations, tasks | 7 days, then summarized | Last week's tasks |
| Long-term | User preferences, facts | Forever | Prefers window seats, allergic to peanuts |
| Episodic | Specific memories | Forever, compressed | Last time we booked Miku, they loved the sashimi |

### Cost-Optimized Context Loading

- Always load long-term preferences (5 most relevant)
- Load task-relevant memories via embedding similarity (10 most relevant)
- Load recent interactions from last 24 hours (5 most recent)
- Estimate tokens before sending to AI - stay under budget

### Memory Compression

Working memories older than 7 days are automatically summarized into long-term facts. This keeps context costs low while preserving important information.

---

## Part 10: Local Mode (Desktop App)

### Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Desktop App | Electron | Cross-platform desktop application |
| Screen Control | nut.js | Mouse, keyboard, screen capture |
| Browser Automation | Playwright (local) | Control user's browser directly |
| Local Storage | SQLite + better-sqlite3 | Fast local database |
| Encrypted Credentials | AES-256-GCM | Store logins securely on device |

### Safety Features

- **Panic Hotkey**: Cmd+Shift+X - Stops all actions, undoes last 5 actions
- Screen recording of all sessions for review
- System tray icon showing current status
- All actions are reversible via undo system

---

## Part 11: Browser Automation (Browserbase + Stagehand v3)

### Browserbase Pricing

| Plan | Cost | Includes |
|------|------|---------|
| Free | $0/month | 1 browser hour, 1 concurrent |
| Hobby | $39/month | 200 hours, 3 concurrent |
| Startup | $99/month | 500 hours, 50 concurrent |
| Overage | $0.10-0.12/hour | Beyond plan limits |

### Stagehand v3 Features

- `act()` - Execute individual actions with natural language
- `agent()` - Multi-step tasks with reasoning
- `extract()` - Get structured data from pages (Zod schemas)
- `observe()` - Find interactive elements
- Hybrid mode - DOM + Vision for maximum reliability

---

## Part 12: Database Schema

See `docs/DATABASE.md` for full schema. 10 core tables:
users, tasks, user_memory, user_credentials, failure_memory, prepaid_cards, transactions, usage, scheduled_tasks, action_history

All tables with user data have RLS enabled.

---

## Part 13: API Endpoints

See `docs/API.md` for full API spec. 20+ endpoints covering:
- Auth (register, login, refresh)
- Tasks (CRUD, webhooks)
- Voice/SMS webhooks
- Card management (deferred)
- Memory management
- Settings and usage

---

## Part 14: Environment Variables

See `.env.example` for all required variables.

---

## Part 15: File Structure

See `CLAUDE.md` for current project structure.

---

## Part 16: Build Plan

1. Core email flow + AI integration
2. Browser automation (Browserbase + Stagehand v3)
3. Verification + Fallbacks
4. Voice + SMS + Dashboard
5. Testing + Deploy

---

## Part 17: Sample Tasks to Test

- "Book me a dinner reservation at Miku for Saturday 7pm, party of 2"
- "Find the cheapest flight to Toronto next Friday"
- "Research the best CRM for small law firms"
- "Reply to John's email saying I'll be 10 minutes late"
- "Call the dentist and book a cleaning for next week"
