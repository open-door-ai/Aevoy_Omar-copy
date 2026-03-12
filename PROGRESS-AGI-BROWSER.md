# AGI Browser Automation Overhaul — Progress Log

## Objective
Make the browser agent work with true AGI intelligence — task COMPLETION not task RESEARCH. "Book a restaurant" = confirmed reservation, not "I found the restaurant's phone number".

## Success Criteria
- Agent can book a restaurant reservation end-to-end
- Agent creates real deliverables (Excel with real data, not AI hallucination essays)
- Agent verifies outcomes before marking complete
- No hardcoded site-specific logic
- Quality gate catches "I found X but didn't do X" as failure
- Cost-optimized, tested on production

## Progress

### Phase 4: Testing Round 1 (2026-03-12, commit 9fac49b)

6 tests submitted. Results:

| # | Task | Status | Cost | Time | Verdict |
|---|------|--------|------|------|---------|
| 1 | DemoQA form fill | completed | $0.027 | 738s | FAIL — quality gate leak ("PASS: false" in response) |
| 2 | Top 3 restaurants | completed | $0.000 | ~30s | FAIL — found 2.5 restaurants, no phone numbers |
| 3 | Notion signup | completed | $0.091 | ~1000s | FAIL — 89 browser steps, never completed, passive response |
| 4 | Businesses + Excel | completed | $0.032 | ~38s | FAIL — found 5 businesses but NO Excel created, no contact emails |
| 5 | Sushi booking | completed | $0.026 | ~500s | FAIL — found Okami Sushi but "no booking confirmation obtained" |
| 6 | DemoQA form (v2) | completed | $0.027 | ~500s | PARTIAL — leaked quality gate text |

**Root Causes Identified:**
1. Quality gate leak — internal eval text in user response (FIXED: commit 3e0d9d4)
2. Agent stops at "found info" without completing the task
3. DOC-FAST-PATH short-circuits compound research+document tasks with AI hallucination
4. Google blocks automated browsers with reCAPTCHA
5. Gemini Flash quality evaluator too lenient — passes "not obtained" responses

### Phase 4: Testing Round 2 (2026-03-12, commit d83790a)

Fixes deployed: RULE 0, DuckDuckGo default, Google CAPTCHA auto-escape

| # | Task | Status | Cost | Time | Verdict |
|---|------|--------|------|------|---------|
| 1 | Sushi booking | completed | $0.070 | 526s | FAIL — DuckDuckGo worked, found 6 restaurants, but STILL didn't book. Quality gate passed "confirmation not obtained" |
| 2 | Coffee shops + Excel | completed | $0.000 | 46s | FAIL — DOC-FAST-PATH blocked but DOC-ACTION-GATE (in-loop) still fired. Excel file empty/malformed |
| 3 | Canva signup | needs_review | $0.012 | 849s | FAIL — Cloudflare blocked browser. Quality gate correctly caught failure |

**New Root Causes:**
1. THREE separate DOC-ACTION-GATE paths in iteration loop — all bypass browsing for compound tasks
2. Quality gate pre-check needed — regex catches "not obtained" before Gemini evaluation
3. Canva/major sites block automated browsers (Cloudflare) — need proxy/stealth improvement

### Fixes Applied (commit 82beb45)

1. **All 3 DOC-ACTION-GATE paths** now skip for compound research+document tasks
   - DOC-FAST-PATH (pre-loop) — already fixed in d83790a
   - DOC-ACTION-GATE rounds 1-2 (line ~4963) — NEW
   - DOC-ACTION-GATE rounds 3+ (line ~5017) — NEW
   - DOC-ACTION-GATE no-actions path (line ~5270) — NEW
   - Compound detection: task has research verb + document type + connector word

2. **Quality gate hard pre-check** — regex catches "not obtained/confirmed/completed" before model eval
   - For action tasks (booking/signup/purchase/cancellation)
   - Auto-marks `needs_review` when response admits failure
   - Skips expensive Gemini/Haiku evaluation

3. **DuckDuckGo as default search** (commit d83790a)
   - All `google.com/search` URLs → `duckduckgo.com/?q=`
   - Vision agent SYSTEM_PROMPT: "Use DuckDuckGo, NOT Google"
   - Auto-detect `google.com/sorry` → redirect to DuckDuckGo
   - CAPTCHA fail fallback: try DuckDuckGo after 3 CAPTCHA failures

4. **Excel data quality** (commit d83790a)
   - DOC-FAST-PATH Excel: AI prompted for markdown table format, not essay
   - BFP Excel: AI structures extracted data into multi-column table

### Phase 4: Testing Round 3 (2026-03-12, commit 9dc674d)

Fixes deployed: taskPlan injection into step prompts, action cap (10/iteration), enhanced booking/signup plans.

| # | Task | Status | Cost | Time | Verdict |
|---|------|--------|------|------|---------|
| 1 | DemoQA form fill | completed | $0.024 | ~15min | FAIL — Agent navigated to form, saw all fields, but said "unable to directly interact". 15 browser steps, 0 Haiku calls. |

**Root Cause**: `isComplexTask` regex didn't match "fill out the form" — classified as simple → Gemini Flash (free) instead of Haiku. Gemini Flash describes pages instead of filling forms.

### Fixes Applied (commit e08af2d)

1. **`isComplexTask` expanded**: Now matches `fill.*form`, `submit.*form`, `complete.*form` in addition to signup/booking/purchase patterns. This routes form-fill tasks to Haiku.
2. **Form-fill plan template**: New plan context for form tasks: "For EACH field use FILL [ref], for radios/checkboxes use CLICK, for dropdowns SELECT, then CLICK Submit."
3. **Action cap (commit 9dc674d)**: Max 10 actions per iteration in processor.ts — prevents 862-action explosion.
4. **Plan injection (commit 9dc674d)**: `taskPlan` now passed from main loop to `buildPrompt()` — plan appears in every step prompt.

### Phase 4: Testing Round 4 — PENDING DEPLOY

Commit e08af2d ready locally. GitHub token expired — cannot push. Waiting for auth refresh.

## Architecture

### Smart Model Routing
- Complex tasks (booking/signup/purchase) → Haiku FIRST ($0.006/step)
- Simple tasks (click/scroll/extract) → cheap cascade (Gemini → DeepSeek → Llama)

### Quality Gate Pipeline
```
Response generated
  ↓
HARD PRE-CHECK: regex for "not obtained/confirmed/completed"
  → auto-fail for action tasks
  ↓
MODEL EVALUATION: Gemini Flash (free) → Haiku ($0.002)
  → strict criteria: concrete outcome, not advice, task actually done
  ↓
If fail → generateForcedDirectAnswer (rewrite)
  → max 2 retries, $0.01 cost cap
  ↓
Output to user
```

### Compound Task Flow
```
"Find 5 coffee shops and create Excel"
  ↓
_compoundResearchDoc detected → skip DOC-FAST-PATH
  ↓
Iteration loop → AI generates search actions
  ↓
Browser finds real data (DuckDuckGo search)
  ↓
BFP compound path → AI structures data → createExcelFile
```

### Google CAPTCHA Escape
```
google.com/sorry detected OR hasCaptcha on google.com
  ↓
Extract original query from sorry URL
  ↓
Auto-navigate to duckduckgo.com/?q=<query>
  ↓
Continue browser steps on DuckDuckGo results
```

## Files Modified
1. `packages/agent/src/services/ai.ts`: Smart routing, quality evaluation, RULE 0 in system prompt
2. `packages/agent/src/execution/vision-agent.ts`: Page verification, DuckDuckGo prompt, CAPTCHA escape
3. `packages/agent/src/services/processor.ts`: Quality precheck, compound task guards, DuckDuckGo URLs

## Known Remaining Issues
- **GitHub token expired** — cannot push commits to deploy. Need Codespace auth refresh.
- Canva/major sites block automated browsers (Cloudflare Turnstile)
- Agent finds info but doesn't follow through to booking (RULE 0 + plan injection not yet tested)
- Excel files can be empty when compound task data extraction fails
- Notion signup burned $0.091 for nothing — cost caps need tightening
- Budget: ~$1.55 remaining on Anthropic API. Must test wisely.
- No visual verification of generated files (Excel, PDF quality not checked)
