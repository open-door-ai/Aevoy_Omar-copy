# Anticipy Demo Guide

> How to demonstrate Anticipy's always-listening AI wearable experience.

---

## Quick Start

1. Navigate to `https://www.aevoy.com/anticipy` (or `localhost:3000/anticipy` in dev)
2. Sign in (or use test user: `test-e2e@aevoy.com` / `VisualTest2026`)
3. Tap the purple mic button
4. Talk naturally — don't give commands, just speak

---

## Test User: Jordan Chen

If running the demo with the seeded test user, Anticipy already knows:

| Category | Details |
|----------|---------|
| **Name** | Jordan Chen, 34, lives in Vancouver BC |
| **Job** | Product Manager at a SaaS company |
| **Boss** | Sarah (VP of Product) |
| **Partner** | Alex (they/them), architect |
| **Mom** | Linda, lives in Toronto, birthday April 12th |
| **Diet** | Vegetarian, oat milk latte from JJ Bean |
| **Gym** | Equinox, Monday/Wednesday/Friday mornings |
| **Car** | 2022 Tesla Model 3 |
| **Meetings** | Monday 9am standup, Thursday 2pm product review, biweekly Tuesday 1:1 with Sarah |
| **Plans** | Trip to Japan in June |
| **Active issue** | Insurance company hasn't responded to a claim (3 weeks) |
| **Restaurant** | Wants to try Autostrada (Italian, downtown) |

To seed this data, run: `packages/agent/scripts/seed-anticipy-test-user.sql` against Supabase.

---

## Recommended Demo Scenarios

### Scenario 1: "The Insurance Follow-Up" (Shows: ambient intent detection + action)
Say naturally: *"Honestly I keep forgetting to follow up with that insurance company, it's been like three weeks now"*

**What Anticipy should do:**
- Detect the intent via regex ("I keep forgetting to...")
- Show "Heard you mention: follow up with that insurance company — on it." in the feed
- Look up the insurance context from Jordan's profile (knows it's been 3 weeks)
- Draft a follow-up message or offer to call the insurance company

### Scenario 2: "The Meeting Reschedule" (Shows: LLM intent extraction)
Say naturally: *"Sarah just pinged me, she wants to move the product review to 3pm instead of 2"*

**What Anticipy should do:**
- No regex match, but LLM detects the implied task
- Recognize Sarah = boss, product review = Thursday recurring meeting
- Offer to reschedule the calendar event

### Scenario 3: "The Sarcasm Test" (Shows: Anticipy knows when NOT to act)
Say naturally: *"Oh wonderful, another all-hands meeting, can't wait"*

**What Anticipy should do:**
- Detect sarcasm, track negative sentiment about meetings
- NOT schedule a meeting or respond enthusiastically
- Silently note that Jordan dislikes all-hands meetings

### Scenario 4: "The Dinner Decision" (Shows: context-aware suggestion)
Say naturally: *"Alex asked if we should do Thai or Italian tonight, honestly I'm craving pasta"*

**What Anticipy should do:**
- Recognize Alex = partner, this is a joint decision
- Know from context that Jordan wants to try Autostrada (Italian, downtown)
- Suggest Autostrada without booking (this is a joint decision with Alex)

### Scenario 5: "The Birthday Reminder" (Shows: proactive intelligence)
Say naturally: *"I was telling my mom about the Japan trip and she got so excited, she wants to come too now"*

**What Anticipy should do:**
- Update trip context (Mom might join the Japan trip)
- NOT book anything — this is conversational, not an instruction
- Know that Mom = Linda, birthday = April 12th

---

## What the Demo Shows

1. **Mic button** → tap to start listening (simulates always-on wearable)
2. **Live transcript** → text appears above the mic as you speak
3. **Intent detection** → feed card appears instantly when Anticipy detects something actionable
4. **Contextual awareness** → Anticipy uses stored knowledge about the user
5. **Appropriate non-action** → Anticipy doesn't act on sarcasm, joint decisions, or vague mentions
6. **Real-time feed** → results appear via Supabase realtime subscriptions
7. **Settings** → 7 configurable options (morning check-in, autonomous mode, quiet hours, etc.)

---

## Live Test Results (2026-03-25)

**Final Score: 72/90 (80%)** across 10 test scenarios with Jordan Chen profile.

### Best Demos (scored 9/9 — lead with these)
1. **Sarcasm test:** "Oh wonderful, another all-hands meeting, can't wait" — Anticipy empathizes, doesn't schedule anything
2. **Italian dinner:** "Alex asked if we should do Thai or Italian, I'm craving pasta" — Anticipy suggests the Italian place downtown (from profile), asks what Alex wants
3. **Anniversary ramen:** "Alex would love that new ramen place for our anniversary" — Anticipy remembers the anniversary, doesn't book prematurely

### Good Demos (scored 7-8/9)
4. **Oat milk:** "Ugh, I'm completely out of oat milk" — Anticipy finds Vancouver-specific delivery options
5. **Japan trip:** "My mom got excited about the Japan trip" — Anticipy correctly doesn't book, notes context
6. **Headspace cancel:** "I need to cancel Headspace" — Anticipy researches real cancellation steps + phone number

### Avoid Demoing (scored 5-6/9)
7. **Insurance follow-up** — Anticipy asks for info it should already know from profile
8. **Competitor analysis for Sarah** — Anticipy asks for Sarah's email despite knowing she's the boss
9. **Gym bag reminder** — Anticipy suggests user set their own reminder instead of doing it

---

## Known Limitations

### Cannot Do Yet
- **Ambient vs. directed speech**: Anticipy can't distinguish "hey Anticipy, do X" from "I was telling John about X". All speech from the mic is treated as ambient
- **Calendar integration**: Requires Google OAuth setup per user — demo may show "schedule" intent but not actually modify Google Calendar without OAuth
- **Voice calls**: Making/receiving calls requires Twilio number provisioned for the user
- **Browser automation**: Complex multi-step tasks (booking restaurants, signing up for services) require Steel.dev browser sessions — may take 30-90 seconds
- **Pattern learning**: Detected patterns require multiple observations over days — not visible in a single demo session
- **Real-time cancellation**: No way to say "never mind" to cancel a detected intent mid-processing

### Technical Requirements
- **Deepgram API key**: Required for transcription. Without it, mic button connects but produces no transcripts
- **Groq API key**: Required for context extraction. Without it, context is stored raw but not analyzed
- **Supabase**: Must be running with Anticipy schema (migration 20260323_001)
- **Agent server**: Must be running on Railway or localhost:3001
- **HTTPS**: Microphone requires secure context (HTTPS or localhost)

### Accuracy Notes
- Regex intent detection covers ~10 common patterns. Unusual phrasings may need LLM fallback (adds 1-15s latency)
- LLM extraction uses Groq free tier (Llama 3.1 8B) — sophisticated phrasings may not be caught. Upgrading to a larger model would improve accuracy
- Confidence thresholds (0.7 for LLM tasks, 0.85 for proactive queue) are conservative — some valid intents may be dropped

---

## Architecture (Post-Audit)

```
Browser Mic → 16kHz PCM → WebSocket → Deepgram (nova-2, real-time)
  ├── Interim transcripts → live display in UI
  ├── Final transcripts → 5-word buffer → extractContext()
  └── UtteranceEnd (natural pause) → flush buffer → extractContext()
        ├── Regex: 10 ACTION_INTENT_PATTERNS (instant, free)
        ├── LLM: Groq extraction (people, commitments, tasks, emotions)
        └── IF action detected:
              ├── intent_detected → browser feed (instant)
              ├── processTaskV3() → AI with full user context
              └── Task result → Supabase realtime → feed update
```
