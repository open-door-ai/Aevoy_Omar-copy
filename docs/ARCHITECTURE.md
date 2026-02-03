# System Architecture

## Overview

```
┌────────────────────────────────────────────────────────────┐
│                         USER                                │
│       Email / SMS / Voice Call / Chat / Desktop App         │
└────────────┬─────────────┬──────────────┬─────────────────┘
             │             │              │
             ▼             ▼              ▼
┌────────────────┐ ┌─────────────┐ ┌──────────────────────┐
│  CLOUDFLARE    │ │   TWILIO    │ │   DESKTOP APP        │
│  Email Worker  │ │  Voice+SMS  │ │   (Electron+nut.js)  │
│  *@aevoy.com   │ │  Webhooks   │ │   Local execution    │
└───────┬────────┘ └──────┬──────┘ └──────────┬───────────┘
        │                 │                    │
        └────────────────┬┘                    │
                         ▼                     │
┌────────────────────────────────────────────────────────────┐
│                     AGENT SERVER                            │
│                   (packages/agent)                          │
│                                                            │
│  1. Intent Locking (security scope)                        │
│  2. AI Model Routing (DeepSeek/Kimi/Gemini/Claude/Ollama)  │
│  3. Task Processing & Orchestration                        │
│  4. Browser Automation (Browserbase+Stagehand / Playwright)│
│  5. 3-Step Verification                                    │
│  6. Memory System (4 types)                                │
│  7. Proactive Engine                                       │
│  8. Response via Resend / Twilio                           │
└───────────────────────┬────────────────────────────────────┘
                        │
       ┌────────────────┼───────────────────┐
       ▼                ▼                   ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────────┐
│  SUPABASE   │ │ BROWSERBASE  │ │    AI MODELS     │
│  PostgreSQL │ │ + Stagehand  │ │ DeepSeek, Kimi,  │
│  Auth + RLS │ │ Cloud browser│ │ Gemini, Claude,  │
│  Storage    │ │ CAPTCHA solve│ │ Ollama (local)   │
└─────────────┘ └──────────────┘ └──────────────────┘
```

## System Layers

| Layer | Components | Purpose |
|-------|-----------|---------|
| User Interaction | Email, SMS, Voice, Chat, Desktop | How users communicate with Aevoy |
| Aevoy Brain | Lead Agent + Sub-Agents | Understands tasks, picks AI model, orchestrates |
| Execution Layer | Cloud: Browserbase+Stagehand v3 / Local: Playwright+nut.js | Performs actions |
| Verification Layer | 3-step: Self-check → Evidence → Smart Review | Ensures task completed correctly |
| Data Layer | Supabase (RLS), encrypted memory files | Secure storage |

## Components

### 1. Cloudflare Email Worker

Receives all emails to `*@aevoy.com`.

```
Email arrives → Parse (from, to, subject, body) →
  Extract username from "to" →
    Validate user exists →
      POST to agent server
```

### 2. Web App (Vercel)

Next.js application.

**Pages:**
- `/` — Landing page
- `/login` — Login
- `/signup` — Sign up
- `/dashboard` — Main dashboard (AI email, activity, stats)
- `/dashboard/activity` — Full activity log
- `/dashboard/settings` — User settings

### 3. Agent Server

Node.js + Express server. Core task processing pipeline.

**Flow:**
```
1. Receive task (email/SMS/voice/API)
2. Create locked intent (security scope)
3. Load user's memory (4 types, cost-optimized)
4. Route to AI model based on task type
5. Parse AI response for actions
6. Execute actions via Browserbase+Stagehand (cloud) or Playwright (local)
7. 3-step verification after each action
8. Update memory (short-term, working, long-term, episodic)
9. Send response via Resend / Twilio
10. Track cost in usage table
```

### 4. Browser Automation (Browserbase + Stagehand v3)

**Cloud Mode (Production):**
- Browserbase provides managed browser infrastructure
- Stagehand v3 provides AI-driven browser control
- 95% baseline success rate
- Built-in CAPTCHA solving, residential proxies
- Hybrid mode: DOM-based + Vision-based

**Local Mode (Development/Desktop):**
- Playwright for direct browser control
- nut.js for screen-level control (desktop app)
- Same fallback chains as cloud mode

**Never-Fail Fallback Chains:**
| Action | Methods |
|--------|---------|
| Click | 15 methods (CSS, XPath, text, role, force, JS, coords, scroll+click, keyboard, wait+retry, Vision, viewport, hover+click, double-click, frame) |
| Form Fill | 12 methods (standard, label, placeholder, clear+type, char-by-char, JS value, React hack, focus+type, paste, name, ID, Vision) |
| Login | 10 methods (standard, two-step, OAuth, magic link, mobile, API, cookie, Enter, Tab, Vision) |
| Navigation | 8 methods (direct URL, search+click, menu, sitemap, mobile, cached, fallback URLs, Vision) |

### 5. Verification System (3-Step)

| Step | Name | Model | Cost |
|------|------|-------|------|
| 1 | Self-Check | Gemini Flash | Free |
| 2 | Evidence Check | Code (no AI) | Free |
| 3 | Smart Review | Claude Sonnet | $$ (only if confidence < 90%) |

### 6. Memory System (4 Types)

| Type | Storage | Retention | Purpose |
|------|---------|-----------|---------|
| Short-term | In-memory Map | Until task complete | Current task context |
| Working | Supabase user_memory | 7 days | Recent conversations |
| Long-term | Encrypted MEMORY.md | Forever | User preferences, facts |
| Episodic | Supabase user_memory | Forever (compressed) | Specific event memories |

**Cost Optimization:**
- Load only 5 most relevant long-term preferences
- 10 task-relevant memories (keyword match)
- 5 most recent interactions (24h)
- Token estimation before AI calls

### 7. AI Model Routing

| Task Type | Primary | Fallback Chain |
|-----------|---------|----------------|
| understand | DeepSeek V3.2 | Kimi K2 → Gemini Flash → Claude Haiku |
| plan | DeepSeek V3.2 | Kimi K2 → Claude Haiku |
| reason | Claude Sonnet | Kimi K2 → DeepSeek V3.2 |
| vision | Claude Sonnet | Gemini Flash |
| validate | Gemini Flash | DeepSeek V3.2 |
| respond | DeepSeek V3.2 | Claude Haiku |
| local | Ollama/Llama3 | Ollama/Mistral → DeepSeek V3.2 |

### 8. Voice & SMS (Twilio)

- Inbound/outbound voice calls with TwiML
- SMS two-way task management
- 2FA code reception via virtual phone numbers
- Speech-to-text transcription
- Polly.Amy voice for natural-sounding responses

### 9. Proactive Engine

Hourly cron checks for users with proactive_enabled:
- Domain expiring alerts (high priority → call)
- Meeting preparation (medium → SMS)
- Unanswered email reminders (medium → SMS)
- Bill due alerts (high → call)
- Auto check-in for flights (automated)
- Package tracking (low → SMS)
- Recurring task automation offers (low → email)

### 10. Desktop App (Electron + nut.js)

- Screen-level control via nut.js (mouse, keyboard, capture)
- Local Playwright for browser automation
- SQLite for offline storage
- Panic hotkey: Cmd+Shift+X
- All sessions recorded for review
- System tray with status indicator

## Deployment

### Development
- Web: `localhost:3000`
- Agent: `localhost:3001`
- Desktop: Electron local
- Database: Supabase cloud (free tier)

### Production
- Web: Vercel (auto-deploy from GitHub)
- Agent: Hetzner VPS
- Browser: Browserbase (Startup plan, $99/mo)
- Database: Supabase (free tier)
- Email: Cloudflare (free) + Resend (free tier)
- Voice/SMS: Twilio (~$10/mo per user)
