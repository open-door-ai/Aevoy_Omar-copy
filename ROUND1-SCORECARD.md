# Round 1 Scorecard — 29/50 Tasks Tested
**Date**: 2026-03-31
**Commit**: 9a6d2ca

## Results So Far

| # | Category | Task | Time | Grade | Notes |
|---|----------|------|------|-------|-------|
| 1 | Instant | weather | 12s | PARTIAL | Correct but slow — used web_search not weather tool |
| 2 | Instant | tokyo time | 1s | PASS | "2:41 AM in Tokyo" |
| 3 | Instant | whistler distance | 1s | PASS | "126 km, 1-2 hour drive" — knew Vancouver |
| 4 | Instant | USD/CAD rate | 1s | PARTIAL | Used knowledge not live data |
| 5 | Instant | canucks game | 93s | PARTIAL | Correct (7-3 loss to Calgary) but took 93s |
| 6 | Booking | earls sat 7pm for 2 | 243s | PASS | Reached booking confirmation on OpenTable |
| 9 | Calendar | remind 9am dentist | 1s | PASS | "Tue Mar 31 9:00 AM" |
| 10 | Calendar | remind friday pitch deck | 8s | PARTIAL | Asked for timing (should default to morning) |
| 11 | Calendar | calendar this week | 7s | PASS | "Calendar clear" (no calendar connected) |
| 13 | Communication | email confirming meeting | 4s | PASS | Sent directly |
| 14 | Communication | text mom | 8s | PASS | Asked for phone number (1 smart Q) |
| 15 | Communication | investor follow-up | 8s | PASS | Asked for investor email (1 smart Q) |
| 16 | Communication | cold outreach Anticipy | 13s | PASS | Drafted using Anticipy context |
| 18 | Research | accelerator deadlines | 293s | PASS | Found real accelerators with April 2026 deadlines |
| 19 | Research | shopify vs squarespace | 104s | PASS | Real pricing: Shopify $29, Squarespace $18 |
| 21 | Price | AirPods Pro 2 cheapest | 319s | FAIL | BU task timed out |
| 22 | Price | YVR-SFO flight | 170s | PASS | CA$433 cheapest found on Google Flights |
| 33 | Follow-up | what did I ask yesterday | 1s | PASS | "Book dinner at Earls Ambleside using Resy" |
| 34 | Follow-up | did booking go through | 12s | PARTIAL | Didn't find confirmation #715423 |
| 35 | Follow-up | remind friday confirm earls | 8s | PASS | "Reminder set Friday 2pm" |
| 36 | Follow-up | status update this week | 35s | FAIL | "Browser busy" — hit concurrent limit |
| 40 | Edge | help | 1s | PARTIAL | "What's going on?" — should explain capabilities |
| 41 | Edge | nevermind | 2s | PARTIAL | Assumed frustration — should just acknowledge |
| 42 | Edge | wrong price check again | 200s | PASS | Re-checked: AirPods $309 at Best Buy |
| 43 | Personality | lol | 1s | PARTIAL | "What's going on?" — should match casual energy |
| 44 | Personality | frustrating | 1s | PASS | Empathetic, offered to help |
| 45 | Personality | you're amazing | 1s | PASS | "Thanks. Means a lot." — warm, brief |
| 46 | Personality | urgent flight | 170s | PASS | Found real CA$433 flight |
| 47 | Personality | is this idea stupid | 8s | PASS | Asked what the idea is (reasonable) |

## Score Summary

| Category | Tested | Pass | Partial | Fail | Notes |
|----------|--------|------|---------|------|-------|
| Instant (5) | 5 | 2 | 3 | 0 | Weather slow, USD stale, Canucks slow |
| Bookings (3) | 1 | 1 | 0 | 0 | Earls reached confirmation |
| Calendar (4) | 3 | 2 | 1 | 0 | Friday reminder asked extra Q |
| Communication (4) | 4 | 4 | 0 | 0 | All passed |
| Research (4) | 2 | 2 | 0 | 0 | Both real data |
| Price (3) | 2 | 1 | 0 | 1 | AirPods timed out |
| Account mgmt (3) | 0 | - | - | - | Not tested yet |
| Complex (6) | 0 | - | - | - | Not tested yet |
| Follow-up (4) | 4 | 2 | 1 | 1 | Status update hit browser limit |
| Edge cases (6) | 3 | 1 | 2 | 0 | help/nevermind need better responses |
| Personality (5) | 5 | 4 | 1 | 0 | lol response needs work |
| Compound (3) | 0 | - | - | - | Not tested yet |

**Current: 19 PASS + 8 PARTIAL + 2 FAIL = 29 tested**
**Remaining: 21 tasks to test**

## Failure Analysis

1. **AirPods timeout (FAIL)**: BU task ran >5 min on Amazon. Amazon's anti-bot is aggressive. Fix: use web_search for price checks instead of browser.
2. **Status update (FAIL)**: Hit concurrent browser session limit (3 max). Fix: status updates should use recall/memory, not browser.
3. **Weather slow (PARTIAL)**: Classified as multi_step, used web_search. Should use weather single_tool.
4. **"lol" response (PARTIAL)**: "What's going on?" is too generic. Should match casual energy with something like "haha nice."
5. **"help" response (PARTIAL)**: Should explain capabilities, not just "What's going on?"
6. **"nevermind" response (PARTIAL)**: Assumed frustration. Should just say "Got it." or "No worries."
