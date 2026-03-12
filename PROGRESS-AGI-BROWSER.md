# AGI Browser Automation Overhaul — Progress Log

## Objective
Make the browser agent work with true AGI intelligence — like how Claude Code uses Playwright (accessibility tree + deterministic actions), not dumb screenshot guessing with cheap models.

## Success Criteria
- Agent can book a restaurant reservation end-to-end (not just "here's the phone number")
- Agent falls back to calling the business when browser fails
- Agent verifies outcomes before marking complete
- No hardcoded site-specific logic
- Cost-optimized but spends when needed
- Tested until failure

## Architecture Comparison
| | Claude Code (works) | Current Vision Agent (broken) |
|---|---|---|
| Page understanding | Accessibility tree (structured text) | Screenshot → AI image interpretation |
| Element targeting | `ref=e123` exact refs | `[5]` refs from snapshot, but AI reasons from image |
| Model | Claude Opus (smart) | Gemini Flash free → Llama-8B → Scout (dumb) |
| Planning | Full reasoning in context | Single-step "what next?" |
| Verification | Read snapshot, confirm result | None — marks complete blindly |
| Fallback | N/A | None — gives up or lies |

## Progress

### Session 99 — 2026-03-11

#### Phase 1: Investigation
- [x] Found Luna account (`ebrahimo@mulgrave.com`, user `35080bd8`)
- [x] Analyzed 13 tasks — zero successful bookings despite 8+ attempts
- [x] Identified root causes:
  1. Cheap models can't reason about web UIs
  2. Screenshot-based reasoning is lossy
  3. No outcome verification
  4. Premature completion ("3 actions completed")
  5. No fallback to calling

#### Phase 2: Code Analysis — COMPLETE
- [x] Full vision-agent.ts mapped: entry (L1920) → main loop (L2318-3772) → DONE handler (L3282)
- [x] AI cascade: Gemini Flash → DeepSeek → Llama-70B → Haiku → Scout → Llama-8B
- [x] Completion: DONE action from AI, confirmation URL detection, verification gates
- [x] Accessibility snapshot: getAccessibilitySnapshot() L333-413 — already structured text with [ref] IDs
- [x] Observe→Reason→Act loop: snapshot + optional screenshot → AI prompt → parse actions → execute
- [x] ROOT CAUSE: Cheap models (Gemini/DeepSeek/Llama) can't plan multi-step tasks.
  They output garbage, go in circles, declare DONE without evidence.
  Haiku is 4th in cascade — by the time it's reached, context may be polluted.

#### Phase 3: Fixes — IMPLEMENTED
- [x] **Smart Model Routing** (ai.ts `generateBrowserStepResponse`):
  - Added `taskComplexity` parameter: `'simple'` | `'complex'`
  - Complex tasks (booking/signup/purchase) use **Haiku FIRST** — skips cheap models entirely
  - Simple tasks (click/scroll/extract) still use cheap cascade (Gemini → DeepSeek → Llama)
  - Complexity detection uses existing `isComplexTask` flag in vision-agent.ts
  - Cost: ~$0.006/step for complex vs ~$0.001 for simple. Worth it — cheap models hallucinate on complex tasks.
  - Both call sites updated: planning prompt (L2074) and main loop AI call (L2956)

- [x] **Page Content Verification on DONE** (vision-agent.ts DONE handler):
  - After AI outputs DONE for action tasks, reads actual page content via `document.body.innerText`
  - Checks for positive signals: confirmation, thank you, account created, receipt, reference number
  - Checks for negative signals: error messages, still-active forms
  - Rejects DONE if page shows errors/active forms but no confirmation
  - For booking tasks: requires confirmation evidence (confirmation #, "thank you", reservation details)
  - Exception: phone call results (agent called the business) pass without page check
  - Max 2 page-verify rejections to prevent infinite loops
  - Non-critical: if page evaluation fails, DONE proceeds (don't block on eval errors)

- [x] **Model-Based Quality Gate** (processor.ts + ai.ts `evaluateResponseQuality`):
  - Separate model evaluates every action-task response before sending to user
  - Prompt checks: Is response concrete? Does it report an outcome? Is it first-person? Not advice?
  - Uses Gemini Flash (free) → Haiku ($0.002) cascade for evaluation
  - If quality fails: calls `generateForcedDirectAnswer` to rewrite with feedback
  - Max 2 retry attempts, $0.01 cost cap on eval loop
  - Skips for: research tasks, greetings, signupAutoCompleted, direct-injected results
  - Works generically for all task types — no hardcoded patterns

- [ ] Make accessibility snapshot the PRIMARY AI input (not screenshot) — ALREADY THE CASE
  - Snapshot is primary input; screenshot only used when stuck (sameUrlCount >= 3)
- [ ] Format snapshot like Playwright MCP output — snapshot already uses [ref] IDs, structured text
- [ ] Add "call the business" fallback when browser fails — ALREADY EXISTS
  - BOT-WALL-PHONE escalation (L6756+), RESY-BLOCKED search+call (L6762+)

#### Phase 4: Testing
- [ ] Build and deploy to Railway
- [ ] Test: "Book a reservation at Cactus Club tonight 7pm 4 people"
- [ ] Test: "Sign up for a new account on [random site]"
- [ ] Test: "Cancel my subscription on [service]"
- [ ] Test until failure on each

## Files Modified
1. `packages/agent/src/services/ai.ts`:
   - `generateBrowserStepResponse()`: Added `taskComplexity` param + Haiku-first routing
   - `evaluateResponseQuality()`: New function — model-based response quality evaluation
2. `packages/agent/src/execution/vision-agent.ts`:
   - Main loop AI call: passes `isComplexTask ? 'complex' : 'simple'`
   - Planning prompt: passes `'complex'`
   - DONE handler: added PAGE-VERIFY block for action tasks
3. `packages/agent/src/services/processor.ts`:
   - Added model-based quality evaluation before response delivery
   - 2-attempt loop with $0.01 cost cap
