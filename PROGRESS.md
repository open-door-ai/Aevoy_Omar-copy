# Session 29 — Progress Log
**Date:** 2026-02-22
**Focus:** AGI intro fix, cost billing, voice calls, onboarding, wiring audit, above & beyond

---

## Task Breakdown

### 1. [DONE] AGI Intro — First Visit Only
- **Status:** Complete
- **Changes:** `apps/web/app/page.tsx`
  - Changed from 48-hour reset to permanent once-ever (localStorage boolean check)
  - Sped up animation from ~8s to ~4s (reduced all phase delays by 40-50%)
  - Added "Intern" to SCRAMBLE_WORDS rotation
  - SSR-safe: returns `false` on server to avoid hydration mismatch
- **Tested:** 3/3 Playwright tests passed (first visit shows, second visit skips, mobile works)

### 2. [DONE] Cost Billing — All APIs at Cost + 20%
- **Status:** Complete
- **Changes:**
  - `packages/agent/src/utils/cost-calculator.ts`: Added `BILLING_MARKUP = 1.20`, `IMAGE_GENERATION_COSTS`, `calculateImageCost()`
  - `packages/agent/src/services/ai.ts`: Applied 20% markup in `trackApiCall()`, added `trackServiceCost()` for non-AI costs, added tracking to `generateForcedDirectAnswer()` (Haiku, Groq, DeepSeek fallbacks)
  - `packages/agent/src/services/processor.ts`: Added DALL-E 3 cost tracking to `generate_image` handler
  - `packages/agent/src/services/voice-conversation.ts`: Added voice call cost tracking at call end
  - `packages/agent/src/services/twilio.ts`: Added SMS dollar cost tracking

### 3. [DONE] Voice/Phone Call Quality
- **Status:** Complete
- **Changes:**
  - `packages/agent/src/index.ts`:
    - Eliminated double `resolveUser()` call (was calling it twice in parallel — 2 wasted DB queries)
    - Moved profile fetch + call limit check into single parallel Promise.all
    - Made call_history insert fire-and-forget (don't block TwiML response)
    - Replaced AI greeting generation with fast template greeting (was blocking TwiML on Groq API call)
    - User's ElevenLabs voice ID now read from `user_settings.elevenlabs_voice_id`
  - `packages/agent/src/services/voice-prompts.ts`:
    - Reduced Groq response timeout from 8s to 4s
    - Reduced DeepSeek response timeout from 10s to 5s
    - Reduced greeting generation timeout from 5s to 2s

### 4. [DONE] Onboarding — "Treat Your Agent Like an Intern"
- **Status:** Already wired (step 3 in unified-flow.tsx)
- `step-meet-intern.tsx` component exists with 3 tips: "Talk like a person", "Give it real tasks", "Be specific"

### 5. [DONE] Wiring Audit — Production Connectivity
- **Status:** Complete
- **Changes:**
  - `packages/agent/src/index.ts`: Added `AGENT_URL` to required env vars validation
  - `packages/agent/.env.example`: Fixed Twitter env var names (`CLIENT_ID` instead of `CONSUMER_KEY`), added `ELEVENLABS_*` and `AGENT_URL` vars

### 6. [DONE] Research — Cheaper Voice Alternatives
- **Status:** Report complete
- **Finding:** Cartesia Sonic-3 ($0.03/min, 40ms TTFB) and Deepgram Aura-2 ($0.027/min, 90ms TTFB) are 4-8x cheaper than ElevenLabs
- **Decision:** Keep ElevenLabs for now (native ConversationRelay support), fix bugs first

### 7. [DONE] Default Agent Name
- **Status:** Complete
- **Changes:**
  - `apps/web/components/onboarding/step-bot-email.tsx`: "Dave" first in QUICK_PICKS and CURATED_NAMES
  - All agent fallbacks changed from "Nova" to "Dave"

### 8. [IN PROGRESS] Above & Beyond — Quick Wins
- Agent scanning codebase for 30-50 improvements

---

## Decisions Log
| Decision | Outcome | Notes |
|----------|---------|-------|
| Markup timing | At logging time | Users see final cost (incl. 20%) on dashboard |
| Voice provider | Keep ElevenLabs | Fix bugs first, evaluate Cartesia later |
| Agent tiers | Onboarding text only | Intern concept introduced, full tiers deferred |
| Default name | Dave | First quick pick, all fallbacks updated |

## Questions for Omar
| # | Question | Status |
|---|----------|--------|
| 1 | Switch to Cartesia for voice? (4-8x cheaper) | Deferred — fixing ElevenLabs bugs first |
| 2 | Build full agent tier system (Intern → Employee → Senior → Boss)? | Deferred — concept planted in onboarding |
| 3 | Force "Dave" name or allow custom? | Default to Dave, custom allowed |

## Test Results
| Test | Result | Notes |
|------|--------|-------|
| AGI intro — first visit | PASS | Dark overlay, typing animation, curtain reveal |
| AGI intro — second visit | PASS | Goes straight to landing page, no overlay |
| AGI intro — mobile 390px | PASS | Responsive text, skip button visible |
| Agent build | PASS | Clean compile |
| Web build | PASS | Clean compile |

## Files Changed This Session
| File | Changes |
|------|---------|
| `apps/web/app/page.tsx` | AGI intro localStorage fix, speed up, "Intern" in scramble |
| `packages/agent/src/utils/cost-calculator.ts` | BILLING_MARKUP, IMAGE_GENERATION_COSTS |
| `packages/agent/src/services/ai.ts` | 20% markup in trackApiCall, trackServiceCost(), fallback tracking |
| `packages/agent/src/services/processor.ts` | DALL-E cost tracking |
| `packages/agent/src/services/voice-conversation.ts` | Voice call cost tracking, "Dave" default |
| `packages/agent/src/services/twilio.ts` | SMS cost tracking |
| `packages/agent/src/index.ts` | Voice latency fixes, AGENT_URL validation, "Dave" default |
| `packages/agent/src/services/voice-prompts.ts` | Reduced timeouts (8s→4s, 10s→5s, 5s→2s) |
| `packages/agent/.env.example` | Fixed Twitter vars, added ELEVENLABS/AGENT_URL |
| `apps/web/components/onboarding/step-bot-email.tsx` | "Dave" first in quick picks |
| `apps/web/components/onboarding/unified-flow.tsx` | "Dave" default fallback |
