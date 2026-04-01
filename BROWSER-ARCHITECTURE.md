# Anticipy Browser Automation Architecture

> Complete system diagram — what's deployed, what models run, how tasks flow.

## High-Level Flow

```
                        USER SENDS TASK
                    "Go to amazon.ca and find PS5 price"
                              |
                              v
                    ┌─────────────────────┐
                    │   V3 PROCESSOR       │
                    │   processTaskV3()    │
                    │   40 min timeout     │
                    │   $5 budget cap      │
                    └────────┬────────────┘
                             |
                             v
                    ┌─────────────────────┐
                    │  TIER CLASSIFIER     │
                    │  (Groq Llama 8B)     │
                    │  FREE, <1s           │
                    └────────┬────────────┘
                             |
              ┌──────────────┼──────────────┐
              v              v              v
         ┌─────────┐  ┌───────────┐  ┌──────────────┐
         │ INSTANT  │  │SINGLE_TOOL│  │  MULTI_STEP  │
         │ <1s     │  │ 1-6s      │  │  BROWSER     │
         │ Groq 8B │  │ Groq/DS   │  │  Full Loop   │
         └─────────┘  └───────────┘  └──────┬───────┘
                                            |
                                            v
                              ┌──────────────────────────┐
                              │    MULTI-STEP LOOP        │
                              │    max 500 iterations     │
                              │    40 min timeout         │
                              └──────────┬───────────────┘
                                         |
                                         v
```

## The Multi-Step Browser Loop (Core Engine)

```
┌────────────────────────────────────────────────────────────────────┐
│                     MULTI-STEP LOOP                                │
│                                                                    │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐   │
│  │ LOAD CONTEXT  │────>│ BUILD SYSTEM     │────>│ LOAD TOOLS   │   │
│  │ - Memory      │     │ PROMPT           │     │              │   │
│  │ - Personality │     │ - SOUL.md        │     │ If BU key:   │   │
│  │ - User context│     │ - Tool defs      │     │  browser_agent│   │
│  │ - Budget ($5) │     │ - User knowledge │     │              │   │
│  └──────────────┘     └──────────────────┘     │ If NO BU key:│   │
│                                                 │  browser_go  │   │
│                                                 │  browser_click│  │
│         ┌──────────────────────────────┐        │  browser_fill│   │
│         │                              │        │  browser_snap│   │
│         v                              │        └──────┬───────┘   │
│  ┌──────────────┐                      │               │           │
│  │  CALL AI      │                      │               v           │
│  │  MODEL        │◄─────────────────────┤     ┌──────────────┐     │
│  │               │                      │     │ EXECUTE TOOL  │     │
│  │  Primary:     │                      │     │               │     │
│  │  DeepSeek     │                      │     │ browser_go:   │     │
│  │  $0.28/M in   │                      │     │  Navigate     │     │
│  │  $0.42/M out  │                      │     │  + Stealth    │     │
│  │               │                      │     │  + CAPTCHA    │     │
│  │  Fallback 1:  │                      │     │  + Extract    │     │
│  │  Gemini Flash │                      │     │               │     │
│  │  $0.15/M in   │                      │     │ browser_click:│     │
│  │               │                      │     │  Click elem   │     │
│  │  Fallback 2:  │                      │     │               │     │
│  │  Claude Haiku │                      │     │ browser_fill: │     │
│  │  $1.00/M in   │     LOOP             │     │  Fill form    │     │
│  │  (LAST RESORT)│     BACK             │     └──────┬───────┘     │
│  └──────┬───────┘      │               │            │              │
│         │              │               │            v              │
│         v              │               │     ┌──────────────┐      │
│  ┌──────────────┐      │               │     │ TRACK        │      │
│  │ PARSE         │      │               │     │ - Cost       │      │
│  │ RESPONSE      │      │               │     │ - Progress   │      │
│  │               │      │               │     │ - Stale?     │      │
│  │ Tool calls?───┼──YES─┘               │     │ - Failures   │      │
│  │               │                      │     └──────┬───────┘      │
│  │ No tools =    │                      │            │              │
│  │ Final answer──┼──────────────────────>│            │              │
│  └──────────────┘                       │            v              │
│                                         │     ┌──────────────┐      │
│                                         │     │ COMPRESS      │      │
│                                         │     │ CONTEXT       │      │
│                                         │     │ (every 3      │      │
│                                         └─────│ iterations)   │      │
│                                               └──────────────┘      │
│                                                                      │
│  STOP CONDITIONS:                                                    │
│  - Final answer (no tool calls)                                      │
│  - Timeout (40 min)                                                  │
│  - Cost cap ($1.00 per task)                                         │
│  - Stale streak (8+ iterations no progress)                          │
│  - Max iterations (500)                                              │
│  - 3+ strategy pivots with no progress                               │
└────────────────────────────────────────────────────────────────────┘
                              |
                              v
                    ┌──────────────────┐
                    │  QUALITY GATE     │
                    │                   │
                    │  Cross-reference: │
                    │  - Claims vs acts │
                    │  - Has prices?    │
                    │  - Has URLs?      │
                    │  - Hallucinated?  │
                    │  - Delegated?     │
                    └────────┬─────────┘
                             |
                             v
                    ┌──────────────────┐
                    │  RETURN TO USER   │
                    │  via feed/email   │
                    └──────────────────┘
```

## Browser Session: How It Connects

```
┌──────────────────────────────────────────────────────────────┐
│                  BROWSER SESSION CREATION                      │
│                  steel-browser.ts → createSession()            │
│                                                                │
│  ┌─────────────────────┐                                       │
│  │ TRY: Steel.dev      │ ◄── STEEL_API_KEY set?               │
│  │                     │                                       │
│  │ POST steel.dev/v1/  │     YES                               │
│  │   sessions          │──────┐                                │
│  │                     │      v                                │
│  │ Connect via CDP:    │  ┌─────────────────┐                  │
│  │ wss://connect.steel │  │ Hosted Browser   │                  │
│  │ .dev?apiKey=...     │  │ Anti-detect      │                  │
│  │                     │  │ Residential proxy│                  │
│  │ Timeout: 15s        │  │ (Steel provides) │                  │
│  └─────────┬───────────┘  └─────────────────┘                  │
│            │                                                    │
│            │ FAIL (timeout, API error, rate limit)              │
│            v                                                    │
│  ┌─────────────────────┐                                       │
│  │ FALLBACK: Local     │ ◄── Always available on Railway       │
│  │ Chrome              │                                       │
│  │                     │                                       │
│  │ chromium.launch()   │     ┌─────────────────┐               │
│  │ --no-sandbox        │────>│ Local Headless   │               │
│  │ --disable-gpu       │     │ Chrome           │               │
│  │ --proxy-server=     │     │ Railway Docker   │               │
│  │   $PROXY_URL        │     │ FREE             │               │
│  │   (if set)          │     │ No residential   │               │
│  └─────────────────────┘     │ proxy            │               │
│                              └─────────────────┘               │
│                                                                │
│  AFTER CONNECTION:                                              │
│  ┌─────────────────────────────────────┐                       │
│  │ applyStealthMeasures(page)          │                       │
│  │                                     │                       │
│  │ 1. User-Agent rotation              │                       │
│  │    Chrome 129-131, Safari, Firefox  │                       │
│  │                                     │                       │
│  │ 2. Viewport randomization           │                       │
│  │    1920±50 x 1080±30               │                       │
│  │                                     │                       │
│  │ 3. navigator.webdriver = false      │                       │
│  │                                     │                       │
│  │ 4. Fake plugins array [1,2,3,4,5]  │                       │
│  │                                     │                       │
│  │ 5. CDP User-Agent override          │                       │
│  │                                     │                       │
│  │ 6. Sec-CH-UA header spoofing        │                       │
│  └─────────────────────────────────────┘                       │
│                                                                │
│  SESSION LIMITS:                                                │
│  - Max 3 concurrent sessions                                    │
│  - 10 min timeout per session                                   │
│  - Cookies saved to Supabase on close                           │
└──────────────────────────────────────────────────────────────┘
```

## AI Model Routing

```
┌──────────────────────────────────────────────────────┐
│              MODEL ROUTER (model-router.ts)            │
│                                                        │
│  CLASSIFY tier (fast):                                 │
│  ┌──────────┐   ┌──────────┐                          │
│  │ Groq 8B  │──>│ DeepSeek │   (FREE → $0.28/M)      │
│  │ FREE     │   │ $0.28/M  │                          │
│  └──────────┘   └──────────┘                          │
│                                                        │
│  INSTANT tier:                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ Groq 8B  │─>│ Groq     │─>│ DeepSeek │─>│Gemini │ │
│  │ FREE     │  │ Scout    │  │ $0.28/M  │  │$0.15/M│ │
│  └──────────┘  │ FREE     │  └──────────┘  └───────┘ │
│                └──────────┘                           │
│                                                        │
│  MULTI-STEP tier (BROWSER):                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ DeepSeek     │─>│ Gemini Flash │─>│ Claude Haiku │ │
│  │ deepseek-chat│  │ gemini-2.5   │  │ haiku-4.5    │ │
│  │ $0.28/M in  │  │ $0.15/M in   │  │ $1.00/M in   │ │
│  │ $0.42/M out │  │ $0.60/M out  │  │ $5.00/M out  │ │
│  │ PRIMARY     │  │ FALLBACK     │  │ LAST RESORT  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                        │
│  FALLBACK TRIGGERS:                                    │
│  429 Rate limit  → back off 30-60s, skip to next      │
│  402 No credits  → back off 5 min, skip model         │
│  500 Server err  → back off 10s                       │
│  Timeout         → skip to next (no backoff)          │
│  >80% fail rate  → mark unreliable, skip              │
└──────────────────────────────────────────────────────┘
```

## CAPTCHA Handling (Transparent)

```
┌──────────────────────────────────────────────┐
│         CAPTCHA PIPELINE                      │
│         captcha-solver.ts                     │
│         (runs inside browser_go)              │
│                                               │
│  After page loads:                            │
│  ┌───────────────┐                            │
│  │ DETECT CAPTCHA │                            │
│  │                │                            │
│  │ reCAPTCHA v2? │                            │
│  │ reCAPTCHA v3? │                            │
│  │ hCaptcha?     │                            │
│  │ Turnstile?    │                            │
│  │ FunCaptcha?   │                            │
│  │ Image?        │                            │
│  └───────┬───────┘                            │
│          │                                    │
│    Found │  Not found                         │
│          v     │                              │
│  ┌───────────┐ │                              │
│  │ SOLVE:    │ │                              │
│  │           │ │                              │
│  │ CapSolver │ │  ◄── $CAPSOLVER_API_KEY      │
│  │ (primary) │ │      ~$0.001/solve           │
│  │           │ │                              │
│  │ 2Captcha  │ │  ◄── $TWOCAPTCHA_API_KEY     │
│  │ (fallback)│ │      (backup)                │
│  └───────────┘ │                              │
│       │        │                              │
│       v        v                              │
│  [Token injected]  [Continue normally]        │
│  [Auto-submit]                                │
│                                               │
│  AI NEVER SEES THE CAPTCHA.                   │
│  Fully transparent. Cost: $0.002 if solved.   │
└──────────────────────────────────────────────┘
```

## What's Currently Deployed (Apr 1, 2026)

```
┌────────────────────────────────────────────────────────────┐
│  PRODUCTION (Railway)                                       │
│                                                             │
│  Agent: agent-production-1339.up.railway.app                │
│  Region: us-east4                                           │
│                                                             │
│  BROWSER APPROACH:                                          │
│  ├── Steel.dev (STEEL_API_KEY set)                          │
│  │   └── Hosted browser + residential proxy                 │
│  │       100 free hrs/month                                 │
│  │                                                          │
│  ├── Local Chrome (FORCE_LOCAL_BROWSER=true)                │
│  │   └── Fallback: headless Chrome on Railway               │
│  │       FREE, no proxy (datacenter IP)                     │
│  │                                                          │
│  └── Browser Use Cloud (BROWSER_USE_API_KEY NOT SET)        │
│      └── DISABLED — browser_agent tool not registered       │
│                                                             │
│  AI MODELS:                                                 │
│  ├── DeepSeek (PRIMARY) — $0.28/M tokens                    │
│  ├── Gemini Flash (FALLBACK) — $0.15/M                      │
│  ├── Claude Haiku (LAST RESORT) — $1.00/M                   │
│  └── Groq Llama 8B (CLASSIFY/INSTANT) — FREE                │
│                                                             │
│  CAPTCHA:                                                   │
│  ├── CapSolver (PRIMARY)                                     │
│  └── 2Captcha (FALLBACK)                                     │
│                                                             │
│  NOT DEPLOYED / NOT USED:                                    │
│  ├── Nstbrowser (never integrated)                           │
│  ├── BrightData (removed)                                    │
│  ├── Browserbase (dead code in health-system only)           │
│  ├── VPS Chrome at 77.42.31.185 (decommissioned)             │
│  └── Patchright (never used)                                 │
└────────────────────────────────────────────────────────────┘
```

## Cost Per Browser Task

```
TYPICAL BROWSER TASK (10 iterations):
  Model calls:  10 x $0.003 (DeepSeek)    = $0.030
  browser_go:    3 x $0.001               = $0.003
  CAPTCHA:       1 x $0.002 (if needed)   = $0.002
  browser_agent: NOT USED                 = $0.000
  ─────────────────────────────────────────
  TOTAL:                                    ~$0.035

HARD LIMITS:
  Per-task cost cap:  $1.00 (force stop)
  Per-task warn:      $0.50 (inject "wrap up")
  Per-task budget:    $5.00 (max possible)
  Per-task timeout:   40 minutes
```
