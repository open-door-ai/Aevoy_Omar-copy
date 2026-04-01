# Browser Automation Technical Audit

**Date:** April 1, 2026  
**System:** Anticipy (aevoy.com)  
**Agent:** Railway (agent-production-1339.up.railway.app)

---

## Status: PARTIALLY WORKING

The browser automation has the right architecture but is misconfigured. Some components work, some are broken, some are disabled. This document covers every layer — what's working, what's not, and exactly where it breaks.

---

## 1. Architecture Overview

```
USER REQUEST
  "Go to amazon.ca and find PS5 price"
        |
        v
+------------------+
|  TIER CLASSIFIER |  Groq Llama 8B (FREE)
|  Detects: URL,   |  Patterns: "go to", "find price", "book", URLs
|  browser intent  |
+--------+---------+
         |
         v
+------------------+
| MULTI-STEP LOOP  |  DeepSeek → Gemini → Haiku (model chain)
| Max 500 iters    |  40 min timeout, $5 budget
| Context compress |
| every 3 iters    |
+--------+---------+
         |
    Tool calls:
    |    |    |    |
    v    v    v    v
+------+ +-----+ +------+ +--------+
|go    | |click| |fill  | |agent   |
|Nav+  | |By # | |By    | |BU Cloud|
|extract| |or  | |name/ | |DISABLED|
|3000ch| |text | |label | |No key  |
|50 elm| |     | |/aria | |        |
+------+ +-----+ +------+ +--------+
    |
    v
+------------------+
| BROWSER SESSION  |  Steel.dev → Local Chrome (fallback)
| steel-browser.ts |
+--------+---------+
         |
    +-----------+-----------+
    |                       |
    v                       v
+----------+         +----------+
|STEEL.DEV |         |LOCAL     |
|Hosted    |         |CHROME   |
|Anti-detect|        |Railway  |
|Res. proxy|         |Docker   |
|100 hrs/mo|         |FREE     |
|          |         |No proxy |
|STATUS:   |         |STATUS:  |
|CONFIGURED|         |WORKS    |
|but untested|       |          |
+----------+         +----------+
         |
         v
+------------------+
| ANTI-DETECTION   |
| - UA rotation    |  Chrome 129-131, Safari, Firefox
| - Viewport rand  |  1920x1080 +-50px
| - webdriver=false|
| - Fake plugins   |
| - CDP UA override|
+------------------+
         |
         v
+------------------+
| CAPTCHA SOLVER   |  CapSolver (primary) + 2Captcha (fallback)
| Auto-detect      |  reCAPTCHA v2/v3, hCaptcha, Turnstile
| Auto-solve       |  ~$0.002/solve
| Transparent      |  AI never sees the CAPTCHA
| STATUS: WORKING  |
+------------------+
         |
         v
+------------------+
| QUALITY GATE     |  Cross-references AI claims vs actual actions
| Hallucination    |  Catches fake bookings, emails, calls
| detection        |  Flags vague or "do it yourself" responses
| STATUS: WORKING  |
+------------------+
```

---

## 2. Component Status Table

| Component | Status | Detail |
|-----------|--------|--------|
| **Task Classification** | WORKING | Regex patterns + AI fallback correctly detect browser tasks |
| **Steel.dev Session** | CONFIGURED, UNTESTED | `STEEL_API_KEY` is set on Railway. Connection untested. |
| **Local Chrome** | WORKING | Dockerfile installs real Google Chrome. Launches headless. |
| **Anti-Detection Stealth** | WORKING | UA rotation, viewport randomization, WebDriver masking |
| **CAPTCHA Detection** | WORKING | Detects reCAPTCHA, hCaptcha, Turnstile, image CAPTCHAs |
| **CAPTCHA Solving** | WORKING | CapSolver API key is set. Auto-solves transparently. |
| **browser_go** | WORKING | Navigates, extracts 3000 chars text + 50 interactive elements |
| **browser_click** | PARTIALLY WORKING | Clicks by index or text. Misses elements beyond index 49. |
| **browser_fill** | PARTIALLY WORKING | Fills by placeholder/name/label/aria. Fails on unlabeled inputs. |
| **browser_snapshot** | WORKING | Reads current page without navigation |
| **browser_screenshot** | WORKING | Takes JPEG screenshot for debugging |
| **browser_agent (BU Cloud)** | DISABLED | `BROWSER_USE_API_KEY` not set. Tool not registered. |
| **DeepSeek (primary model)** | NOT ON LOCAL ENV | Key exists on Railway (apps/web/.env.local has it) |
| **Gemini Flash** | WORKING | `GOOGLE_API_KEY` is set. Used for browser tool-calling. |
| **Claude Haiku** | WORKING | `ANTHROPIC_API_KEY` is set. Last resort fallback. |
| **Quality Gate** | WORKING | Catches hallucinated bookings, emails, calls |
| **Cost Circuit Breaker** | TOO AGGRESSIVE | $1.00 stop limit kills browser tasks mid-flow |
| **Context Compression** | TOO AGGRESSIVE | Compresses every 3 iterations — loses navigation history |
| **Stale Detection** | FRAGILE | 50-char threshold is arbitrary and unreliable |
| **Cookie Persistence** | WORKING | Saves/restores cookies across sessions via Supabase |
| **Proxy** | NOT CONFIGURED | No `PROXY_URL` set. Local Chrome uses datacenter IP. |

---

## 3. What Actually Happens When You Send a Browser Task

### Scenario: "Go to amazon.ca and find the PS5 price"

```
Step 1: Task classified as multi_step (regex: "go to" + ".ca" domain)
Step 2: Tools loaded: browser_go, browser_click, browser_fill, browser_snapshot, web_search, recall...
Step 3: AI model called (Gemini Flash — DeepSeek not available locally)

ITERATION 1:
  AI decides: browser_go { url: "https://www.amazon.ca" }
  Steel.dev: STEEL_API_KEY check...
    → If key works: Hosted browser with residential proxy
    → If key fails: Local Chrome on Railway (datacenter IP)
  Stealth applied: random UA, viewport, webdriver masking
  Page loads... Amazon.ca
  
  PROBLEM: Amazon might block datacenter IPs (Railway = Google Cloud)
  If blocked: browser_go returns "BOT DETECTION: This site is blocking automated access"
  AI sees the warning, tries mobile UA (retry 3)
  Still blocked? AI falls back to web_search
  
  If NOT blocked:
  Returns: page title, 3000 chars of text, 50 interactive elements
  AI sees search bar, navigation, etc.

ITERATION 2:
  AI decides: browser_fill { fields: { "Search Amazon.ca": "PS5 console" } }
  Fill strategy: tries placeholder match "Search Amazon.ca" → FOUND
  Types "PS5 console" into search bar
  
ITERATION 3:
  AI decides: browser_click { text: "Search" } or browser_click { index: 5 }
  Click fires. Page navigates to search results.
  
  PROBLEM: Context compression fires (iteration 3 % 3 === 0)
  Previous navigation history LOST. AI only sees:
  - System prompt
  - Original task
  - Progress summary
  - Last 10 messages

ITERATION 4-8:
  AI reads results, extracts prices, may click into product page
  Each iteration: Gemini Flash call (~$0.003) + tool execution
  Total so far: ~$0.015-0.025

ITERATION 9:
  Context compression fires AGAIN (iteration 9)
  AI forgets earlier search results
  
ITERATION 10-15:
  AI has enough info, returns final answer
  OR: gets stuck in loop, stale detection fires at 8 iterations

TOTAL COST: ~$0.03-0.05 (Gemini) or ~$0.01-0.02 (if DeepSeek were available)
TOTAL TIME: 30-90 seconds
```

---

## 4. Breakpoints (Where It Fails)

### BREAKPOINT 1: Amazon/Major Sites Block Datacenter IPs

**Where:** `browser_go` → navigation step  
**Why:** Local Chrome on Railway uses Google Cloud IP. Amazon, Best Buy, and other major retailers detect and block datacenter IP ranges.  
**Fix:** Steel.dev provides residential proxies. Or configure `PROXY_URL` with a residential proxy service.  
**Current workaround:** AI falls back to `web_search` tool instead of browsing.

### BREAKPOINT 2: browser_agent Disabled + Manual Tools Removed

**Where:** `processor-v3.ts` lines 674-679  
**Why:** When `browser_agent` IS registered, manual browser tools get removed. But if `BROWSER_USE_API_KEY` is missing mid-session (e.g., quota exceeded), the tool throws an error AND there are no manual tools to fall back to.  
**Fix:** Already fixed — `browser_agent` only registers when API key exists. If key is missing, manual tools stay.

### BREAKPOINT 3: Context Compression Every 3 Iterations

**Where:** `processor-v3.ts` line 1238  
**Why:** The loop compresses conversation history every 3 iterations to save tokens. But browser tasks need 10-20 iterations. By iteration 15, the AI has been through 5 compressions and can't remember what it already tried.  
**Symptom:** AI re-navigates to pages it already visited, re-fills forms, loops on the same strategy.  
**Fix:** Change compression interval to 6-8 iterations for multi_step tier, or increase messages kept from 10 to 20.

### BREAKPOINT 4: 50-Element Cap on Page Extraction

**Where:** `browser.ts` line 154  
**Why:** Complex pages (Amazon, booking sites, job boards) have 100-200+ interactive elements. Capping at 50 means the AI can't see most buttons, links, and form fields.  
**Symptom:** AI says "I don't see a Search button" when the button is element #67.  
**Fix:** Increase to 100 elements, or implement focused extraction (only extract elements within a specific container/section).

### BREAKPOINT 5: browser_fill Fails on Modern React/Vue Apps

**Where:** `browser.ts` lines 302-338  
**Why:** The fill strategy only tries: placeholder, name/id, label, aria-label. Modern apps often use `data-testid`, `class`, CSS selectors, or have inputs inside Shadow DOM. All 4 strategies fail on these.  
**Symptom:** browser_fill returns "MISS" for every field.  
**Fix:** Add `data-testid` and `data-*` attribute matching. Consider using Playwright's `getByRole()` as a fallback.

### BREAKPOINT 6: $1.00 Cost Cap Kills Browser Tasks

**Where:** `processor-v3.ts` lines 780-791  
**Why:** The cost circuit breaker force-stops tasks at $1.00 cumulative cost. Browser tasks with Gemini Flash can burn through $0.50-1.00 in 15-20 iterations (especially with long page content in context).  
**Symptom:** Task stops mid-flow with "cost limit reached" and returns incomplete results.  
**Fix:** Increase to $2-3 for multi_step tier. The $5 budget cap is the real limit; $1 is premature.

### BREAKPOINT 7: 10-Minute Browser Session Timeout

**Where:** `steel-browser.ts` line 20  
**Why:** Browser sessions auto-close after 10 minutes. But the task timeout is 40 minutes. Complex booking/signup flows can take 15-20 minutes.  
**Symptom:** Browser session dies mid-task. Next `browser_go` call creates a new session (losing cookies, login state, cart contents).  
**Fix:** Increase session timeout to 30 minutes, or implement session renewal.

### BREAKPOINT 8: Stale Detection is Fragile

**Where:** `processor-v3.ts` line 1081  
**Why:** A tool result is "meaningful" if `resultStr.length > 50`. But `browser_click` always returns 50-80 chars ("Clicked. Page now: [title]\nURL: [url]"). This means clicking IS counted as meaningful even when it accomplishes nothing (clicking the wrong element repeatedly).  
**Symptom:** AI clicks the same wrong element 8 times without triggering stale detection, wasting iterations and cost.  
**Fix:** Track actual URL or page content changes, not just response length.

---

## 5. Model Chain for Browser Tasks

```
WHO MAKES THE DECISIONS?

For each iteration in the browser loop, ONE of these models decides
what tool to call next:

Priority 1: DeepSeek Chat
  - Cost: $0.28/M input, $0.42/M output
  - Speed: Fast (90s timeout)
  - Quality: Good at tool-calling, follows instructions
  - Status: KEY EXISTS ON RAILWAY (apps/web/.env.local)
  - Agent .env: NOT SET (may be set on Railway separately)

Priority 2: Gemini 2.5 Flash
  - Cost: $0.15/M input, $0.60/M output  
  - Speed: Fast (45s timeout)
  - Quality: Good but expensive for long outputs
  - Status: WORKING (GOOGLE_API_KEY set)
  - Issue: Rate-limited at high volume

Priority 3: Claude Haiku 4.5
  - Cost: $1.00/M input, $5.00/M output
  - Speed: Medium (30s timeout)
  - Quality: Best reasoning but 10x more expensive
  - Status: WORKING (ANTHROPIC_API_KEY set)
  - Used only when DeepSeek AND Gemini both fail

FALLBACK BEHAVIOR:
  Model fails? → Back off 30-60s → Try next model
  Rate limited? → One retry after 5s → Then back off
  All models down? → Return partial results
```

---

## 6. Services & API Keys

| Service | Purpose | Key Set? | Cost |
|---------|---------|----------|------|
| **Steel.dev** | Hosted anti-detect browser | Yes (Railway) | 100 free hrs/mo, then $29/mo |
| **Browser Use Cloud** | AI browser automation | No | ~$0.01/step |
| **CapSolver** | CAPTCHA solving | Yes | ~$0.002/solve |
| **2Captcha** | CAPTCHA fallback | Unknown | ~$0.003/solve |
| **DeepSeek** | Primary AI model | Yes (web .env.local) | $0.28/$0.42 per M tokens |
| **Gemini** | Fallback AI model | Yes | $0.15/$0.60 per M tokens |
| **Claude Haiku** | Last resort AI | Yes | $1.00/$5.00 per M tokens |
| **Groq** | Fast/free classification | Yes | Free |

---

## 7. What Needs to Be Fixed (Priority Order)

### P0 — Critical (Browser doesn't work without these)

1. **Verify DEEPSEEK_API_KEY on Railway** — Check if it's in Railway env vars. DeepSeek is 3x cheaper than Gemini for browser tasks.
2. **Verify STEEL_API_KEY on Railway** — Steel gives residential proxy IPs so Amazon/OpenTable don't block us.
3. **Test Steel connection** — Nobody has verified the Steel API key actually works. It might be expired.

### P1 — High (Browser works but poorly)

4. **Increase cost cap** from $1.00 to $3.00 for multi_step tasks
5. **Increase context compression interval** from every 3 to every 6 iterations
6. **Increase element cap** from 50 to 100 in browser_go
7. **Increase session timeout** from 10 min to 25 min

### P2 — Medium (Specific sites break)

8. **Add `data-testid` selector** to browser_fill strategies
9. **Fix stale detection** to track URL/content changes, not response length
10. **Add focused extraction** — extract only form/booking section, not entire page

### P3 — Nice to Have

11. **Add Nstbrowser** as free anti-detect alternative to Steel
12. **Add residential proxy** config for local Chrome fallback
13. **Implement session renewal** to survive 10-min timeout

---

## 8. Test Results (Live Production, April 1 2026)

| Task | Type | Result | Time | Notes |
|------|------|--------|------|-------|
| "What is the capital of France?" | Instant | PASS "Paris. Been there?" | <1s | No browser needed |
| "Weather in Vancouver" | Single tool | PASS 7C, light rain | 2s | Weather API |
| "PS5 price in Canada" | Web search | PASS $819.99 after Apr 2 | 5s | Used web_search, not browser |
| "Best headphones under $300" | Web search | PASS Sony XM5 $247 | 8s | Used web_search, not browser |
| "Send me a joke" | Instant | PASS Pavlov/Schrodinger joke | 1s | Personality working |
| "Schedule dentist Tuesday" | Single tool | PASS "Reminder set for 2PM" | 2s | Scheduling works |
| "Go to espn.com, find NBA scores" | Browser | STUCK (processing) | >5min | browser_agent was disabled, no fallback |
| "Go to books.toscrape.com" | Browser→Search | PASS (via Kaggle data) | 15s | Classifier routed to web_search instead |
| "Go to amazon.ca find PS5" | Browser→Search | PASS (via web search) | 10s | Same — web_search fallback, not browser |

**Key finding:** The AI avoids browser tools entirely. Even when classified as `multi_step`, the AI calls `web_search` instead of `browser_go` because it's faster and cheaper. The browser tools are loaded but unused.

---

## 9. Intent Detection (Proactive Listening)

Separately from browser automation, the ambient listening engine was rebuilt:

| Component | Status | Detail |
|-----------|--------|--------|
| Rolling conversation buffer | WORKING | Accumulates full session transcript, caps at 5000 words |
| LLM intent detection | WORKING | Groq Llama 70B analyzes full buffer for actionable intents |
| False positive filtering | WORKING | Rejects fiction, sarcasm, past tense, hypotheticals |
| Confirmation UI | WORKING | Shows "Do it" / "Not now" buttons for detected intents |
| Test results | 28/28 PASS | 7 short + 8 long conversations + 13 brutal edge cases |

---

## 10. Bottom Line

**What works today:**
- Instant tasks, web search, weather, scheduling, email drafts, jokes
- Intent detection from ambient speech (28/28 tests pass)
- CAPTCHA solving (CapSolver configured)
- Anti-detection stealth (UA rotation, webdriver masking)
- Quality gate (hallucination detection)

**What doesn't work today:**
- Actual browser navigation to real websites via browser tools
- The AI prefers web_search over browser_go (cheaper/faster)
- No verification that Steel.dev connection works
- Context compression too aggressive for multi-step tasks
- Cost cap too low for browser tasks

**To fix browser automation:**
1. Verify Steel.dev API key works (test connection)
2. Set DeepSeek as primary model on Railway
3. Force browser_go for explicit "go to [url]" tasks (override AI's preference for web_search)
4. Increase cost cap, compression interval, element cap, session timeout
5. Test against a real site (books.toscrape.com with browser, not web_search)
