# Aurora Audit Findings

> Living document. Updated as issues are found and fixed.
> Last updated: 2026-03-25

---

## 1. SYSTEM MAP

### What Aurora IS
Aurora is a simulated wearable AI experience. User taps a mic button (simulating an always-on pendant), speaks naturally, and Aurora listens, extracts context/intent, and acts autonomously. The user never gives commands — Aurora figures out what to do from ambient speech.

### Architecture Flow (Current)
```
Browser mic → getUserMedia (16kHz mono PCM)
  → WebSocket to /aurora/listen/ws
    → JWT auth via Supabase token
    → Proxy to Deepgram (wss://api.deepgram.com, nova-2 model)
      → Real-time transcripts back to server
        → Batched (wait for 20+ words)
          → extractContext() — Groq LLM extraction (async, fire-and-forget)
            → Stores: user_context, conversation_context, commitments, proactive_queue
              → proactive_queue processed HOURLY by scheduler
                → Action executed (eventually)
                  → User notified via sendAuroraMessage()
```

### Key Files
| File | Lines | Purpose |
|------|-------|---------|
| `apps/web/app/aurora/page.tsx` | 469 | Main feed page, realtime subscriptions, message sending |
| `apps/web/components/aurora/MicButton.tsx` | 640 | Mic capture, WebSocket audio streaming, visualizer |
| `apps/web/components/aurora/FeedCard.tsx` | 197 | Feed card UI component |
| `apps/web/components/aurora/StatusBanner.tsx` | 79 | Agent health check |
| `apps/web/app/aurora/layout.tsx` | 212 | App shell, auth guard, theme toggle |
| `apps/web/app/aurora/settings/page.tsx` | 551 | 7 configurable settings |
| `apps/web/app/aurora/onboarding/page.tsx` | 229 | First-run onboarding chat |
| `apps/web/app/api/aurora/send/route.ts` | 62 | Message proxy to agent |
| `apps/web/lib/feed-formatter.ts` | 209 | Response cleaning for display |
| `packages/agent/src/routes/aurora-listen.ts` | 497 | WebSocket proxy to Deepgram |
| `packages/agent/src/services/context-engine.ts` | 895 | LLM context extraction |
| `packages/agent/src/services/aurora-messenger.ts` | 666 | Outbound communication hub |
| `packages/agent/src/services/proactive-queue.ts` | 687 | Action generation from commitments/patterns |
| `packages/agent/src/services/proactive.ts` | 767 | Hourly proactive trigger checks |
| `packages/agent/src/services/proactive-engagement.ts` | 941 | Habit learning, daily digests |
| `packages/agent/src/services/context-carryover.ts` | 225 | Cross-task context memory |
| `packages/agent/src/services/channel-learner.ts` | 231 | Channel preference learning |
| `packages/agent/src/services/pattern-engine.ts` | 400+ | Behavioral pattern detection |
| `packages/agent/src/v3/processor-v3.ts` | 1308 | V3 tiered task processor |
| `packages/agent/src/v3/context-builder.ts` | 311 | Prompt context builder |

### Database Tables (Aurora-specific)
- `user_context` — Extracted facts (routines, preferences, relationships)
- `conversation_context` — Raw conversation logs + extracted entities
- `detected_patterns` — Behavioral patterns (daily routines, triggers)
- `commitments` — User promises tracked with due dates
- `proactive_queue` — Pending actions Aurora wants to take
- `channel_preferences` — Learned channel routing
- `daily_spend_tracking` — Cost circuit breaker
- `browser_sessions` — Steel.dev session tracking

---

## 2. CRITICAL FINDINGS

### BUG #1: Aurora processes speech ONLY AFTER recording stops (CRITICAL)

**Root cause: There are actually TWO separate problems creating this behavior.**

**Problem A: Transcript batching delays processing**
- `aurora-listen.ts:254` — Context extraction only fires after `transcriptBuffer` accumulates 20+ words
- Short utterances (< 3 words) get batched and held until the next final transcript
- If user says "I need to book that restaurant" (7 words), it sits in the buffer waiting for 13 more words
- When the user STOPS recording, the `close` handler (line 470-476) flushes the remaining buffer
- **This is why it appears to only process after stop** — the 20-word threshold is rarely hit during natural pauses

**Problem B: No immediate action execution**
- Even when context extraction fires, `detectAndQueueActions()` only puts items in `proactive_queue`
- The proactive queue is processed by the scheduler on a 15-minute to 1-hour cycle
- There is NO mechanism to immediately execute a detected action
- The `processTaskV3()` function (line 69-79) explicitly returns empty for `microphone` channel:
  ```typescript
  if (task.inputChannel === 'microphone') {
    return { taskId: '', success: true, response: '', actions: [] };
  }
  ```
- This means microphone input NEVER gets processed as a task

**Impact: Aurora is deaf.** It hears, it stores, but it doesn't act in real-time. Actions are delayed by minutes to hours.

**Fix needed:**
1. Lower transcript buffer threshold to 5 words (or use utterance-end VAD events)
2. When `detectAndQueueActions()` finds an actionable intent, immediately create a task and process it through V3
3. Show detected intents in the feed UI in real-time (not just transcripts)

### BUG #2: User context NOT injected into AI prompts (HIGH)

**Root cause:** `context-builder.ts` loads profile, memory, and personality — but NEVER loads `user_context` table data.

- `buildTaskContext()` calls `loadUserProfile()` and `BudgetManager` — no context
- `loadTaskMemory()` loads from the old `user_memory` table — not `user_context`
- `loadPersonality()` compiles the personality prompt — no context injection
- The `recall` tool CAN access `user_context`, but the AI must explicitly call it
- For instant and single_tool tiers, the AI never sees user context at all

**Impact:** Aurora knows nothing about the user during task processing unless the AI happens to call `recall`. The entire context engine is collecting data that's never used.

**Fix needed:** Inject top user_context entries (high confidence) into the system prompt for all task tiers.

### BUG #3: No real-time feed updates from microphone (MEDIUM)

**Root cause:** The microphone pipeline stores context but never creates tasks or feed items.

- When Aurora detects an intent from speech, it queues to `proactive_queue`
- The feed UI subscribes to `tasks` table changes (not `proactive_queue`)
- Items in `proactive_queue` never appear in the feed until they're processed and delivered
- The transcript echo (line 247-251 in aurora-listen.ts) shows transcripts briefly (5s) then clears

**Impact:** User sees transcripts flash by briefly, but no indication that Aurora understood or is acting. Feels broken.

**Fix needed:** When an actionable intent is detected from mic input, immediately create a visible feed item showing what Aurora detected and what it plans to do.

### BUG #4: Proactive queue items with action_type="do" are never executed (HIGH)

**Root cause:** `detectAndQueueActions()` sets `action_type: "do"` but the proactive queue processor in `proactive-queue.ts` only handles `remind`, `suggest`, `check_in`, and `follow_up` types. Items with `action_type: "do"` sit in the queue forever.

**Impact:** The most important Aurora capability — doing things the user mentioned — never actually happens.

**Fix needed:** Add "do" action processing that creates real V3 tasks from proactive queue items.

---

## 3. HARDCODING AUDIT

### Hardcoded Elements Found

| Location | What | Concern Level |
|----------|------|--------------|
| `context-engine.ts:185-208` | 9 ACTION_INTENT_PATTERNS regexes | MEDIUM — useful bootstrapping but should be AI-augmented |
| `context-engine.ts:93-100` | 37 SKIP_MESSAGES | LOW — reasonable trivial-message filter |
| `aurora-messenger.ts` | 23 FRUSTRATION_PATTERNS | MEDIUM — could miss nuanced frustration |
| `proactive.ts` | 7 fixed proactive trigger types | HIGH — not learned, static |
| `aurora-listen.ts:36` | 120-minute daily budget (in-memory) | LOW — resets on restart but acceptable MVP |
| `aurora-messenger.ts` | 10PM-7AM quiet hours | LOW — configurable per user via settings |
| `proactive-queue.ts:63` | 0.85 confidence threshold | LOW — reasonable default |

### NOT Hardcoded (Good)
- Feed responses — all from backend, no demo data
- Task results — real AI processing
- User context — extracted dynamically
- Personality — compiled from SOUL.md + IDENTITY.md
- Model selection — dynamic fallback chain

### Verdict
The hardcoding is mostly in the right places (bootstrapping/safety). The ACTION_INTENT_PATTERNS are the main concern — they determine what Aurora acts on from speech. Missing patterns = missed intents. But this is augmented by the LLM extraction which also extracts `tasks_implied`.

---

## 4. REAL-TIME PROCESSING ANALYSIS

### What Works
- Audio capture: getUserMedia at 16kHz mono with echo cancellation + noise suppression
- Audio streaming: WebSocket binary chunks, 256ms intervals (4096 samples at 16kHz)
- Deepgram proxy: Real-time connection to nova-2 model with VAD events
- Transcript batching: Short fragments (<3 words) concatenated (reduces noise)
- JWT authentication: 10-second timeout, Supabase token validation
- Session management: Max 1 per user, 4-hour max, 120min daily budget
- Deepgram reconnection: 3 retries at 2s intervals with 30s audio buffer
- Cost tracking: $0.0077/min to daily_spend_tracking

### What's Broken
1. **20-word buffer** before context extraction fires — too high, causes batch-processing feel
2. **No immediate task creation** from detected intents — only queues for later
3. **No real-time feed updates** from mic input — user sees nothing happening
4. **interim_results=false** in Deepgram config (aurora-listen.ts:111) — no interim transcripts shown
5. **Microphone channel explicitly silenced** in V3 processor — returns empty immediately

### What's Missing
1. No real-time intent display in the feed as user speaks
2. No "Aurora is thinking about..." indicator for detected intents
3. No mechanism to cancel/modify detected intents before Aurora acts
4. No ambient vs. directed speech detection (Aurora should know when it's being spoken TO vs. overhearing)

---

## 5. CONTEXTUAL AWARENESS ANALYSIS

### Context Extraction Pipeline
The context engine (`context-engine.ts`) is well-designed:
1. **Instant action detection** (regex, zero cost) — catches explicit intents
2. **Communication style** (regex, zero cost) — learns formality, verbosity
3. **Trivial skip** (set lookup) — avoids wasting LLM on "ok", "thanks"
4. **Rate limiting** (5/user/min) — prevents cost runaway
5. **LLM extraction** (Groq, free tier) — structured extraction of people, commitments, tasks, dates, preferences, emotions, locations, topics, sentiment
6. **Context merging** — upsert with confidence decay (converges, doesn't inflate)
7. **Commitment storage** — deduplicated, confidence-gated

### Context Retrieval Gap
The extracted context is NEVER automatically used in task processing:
- `getUserContext()` exists but is only called by the `recall` tool
- `buildTaskContext()` doesn't query `user_context`
- Instant/single_tool prompts have zero user context
- Multi-step prompts get personality + memory but not context engine data

### Sarcasm/Non-literal Speech
- The extraction prompt says "Include subtext, humor, stress signals"
- But there's no explicit sarcasm detection
- The LLM may or may not catch "Oh great, another meeting" as sarcasm
- Action detection regex would NOT be triggered by sarcasm (good — it only matches explicit intents)

### Ambient vs. Directed Speech
- No detection whatsoever
- The V3 processor silences ALL microphone input (treats it all as ambient)
- Text sent via the input box goes through normal task processing (treated as directed)
- There's no "hey Aurora" wake word or equivalent

---

## 6. SECURITY AUDIT

### Strong
- JWT validation on WebSocket (Supabase token verified server-side)
- Session deduplication (max 1 per user)
- Auth timeout (10 seconds)
- Message size limit (64KB)
- Cost circuit breaker (daily spend tracking)
- RLS on all Aurora tables
- Credential stripping in responses

### Gaps
- Transcripts stored in `conversation_context` without encryption (user_memory uses AES-256-GCM but conversation_context does not)
- No per-session rate limit on WebSocket messages (could flood audio)
- Listening budget is in-memory only (resets on deploy)
- No audio data retention policy documented

---

## 7. UX AUDIT

### What's Good
- Clean, modern design with dark/light themes
- Radial waveform visualizer during recording
- Floating "Aurora is listening..." pill when mic scrolls out of view
- Haptic feedback on tap
- Silence detection with state transition
- Browser-specific permission help text
- Responsive layout, mobile-friendly
- Real-time feed updates via Supabase realtime

### What's Broken/Missing
- **No indication Aurora understood anything** — transcripts flash for 5s then vanish
- **No "Aurora is working on..."** indicator for detected intents
- **Toast says "Processing what it heard..."** on stop but nothing visibly happens after
- **Feed only shows task results** — no visibility into context extraction or intent detection
- **Settings page has 7 options** but no "what Aurora knows about me" view

---

## 8. FIX PLAN (Priority Order)

### Fix 1: Real-time processing — Lower buffer threshold + immediate action execution
- Lower transcript buffer from 20 words to 5 words
- Enable `interim_results=true` in Deepgram for live transcript display
- When `detectAndQueueActions()` finds an intent, immediately create a V3 task (not just queue)
- Create feed item showing detected intent in real-time

### Fix 2: Inject user context into AI prompts
- Modify `buildTaskContext()` to load high-confidence user_context entries
- Include in system prompt for all tiers
- Cap at ~500 tokens to avoid prompt bloat

### Fix 3: Process "do" actions from proactive queue
- Add handler for `action_type: "do"` that creates real V3 tasks
- Connect to existing task processing pipeline

### Fix 4: Real-time feed for mic intents
- When intent detected, insert into conversation_context with Aurora's action plan
- Subscribe to conversation_context changes in the feed (not just tasks)

### Fix 5: Security — Encrypt conversation_context
- Apply same AES-256-GCM encryption used for user_memory

### Fix 6: UX — Show "Aurora knows" context view
- Add section to settings showing extracted context with confidence levels

---

## 9. TEST RESULTS

### Component Testing (Phase 1)
| Component | Test | Expected | Actual | Status |
|-----------|------|----------|--------|--------|
| Mic capture | getUserMedia in browser | Audio stream created | CANNOT TEST — no browser runtime | BLOCKED |
| WebSocket auth | Send auth message | Authenticated response | CANNOT TEST — needs running agent + Deepgram key | BLOCKED |
| Deepgram transcription | Send audio, get transcript | Real-time transcripts | CANNOT TEST — needs Deepgram API key | BLOCKED |
| Context extraction | extractContext("I need to book dentist", userId, "microphone") | Action queued + context stored | Code review PASS — logic correct, but 20-word buffer delays it | PARTIAL |
| Action detection | "I keep forgetting to follow up with insurance" | Regex match → proactive_queue insert | Code review PASS — pattern matches | PARTIAL |
| Feed realtime | Task status change | Feed card updates | Code review PASS — Supabase realtime subscription correct | PARTIAL |
| V3 processing of mic | inputChannel='microphone' | Should process intent | FAILS — returns empty immediately (line 69-79) | BROKEN |
| Proactive queue "do" | action_type="do" items | Should execute task | FAILS — "do" type not handled | BROKEN |
| User context in prompts | Context available to AI | Should be in system prompt | FAILS — not loaded by context-builder | BROKEN |

### Notes on Testing
Live testing is blocked without a running agent server with valid API keys (Deepgram, Groq, Supabase). All testing is code-path analysis with high confidence in findings. The architectural issues (#1-#4) are definitively confirmed from code reading — these are not "might be broken" situations.

---

## 10. CHANGES LOG

_Updated as fixes are applied._

| Date | Fix | Commit | Status |
|------|-----|--------|--------|
| | | | |
