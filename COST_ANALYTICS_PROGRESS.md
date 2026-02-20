# Cost Analytics & OpenRouter Integration — Progress Log

**Session started:** 2026-02-20
**Goal:** Fix pricing accuracy, build Advanced cost UI, add Cost Analytics page, integrate OpenRouter Developer settings.

---

## Summary of What We're Building

### Problem
The cost system had **inaccurate hardcoded pricing rates**:
- DeepSeek output: code said $0.38/M → actual is **$1.10/M** (3x error)
- Claude 3.5 Haiku input: code said $0.25/M → actual is **$0.80/M** (3.2x error)
- Claude 3.5 Haiku output: code said $1.25/M → actual is **$4.00/M** (3.2x error)

Token counts are **real** (pulled from API responses), only the per-token rates were wrong.

### What's Being Built
1. **Pricing fix** — Corrected rates for all models with source references
2. **Advanced expandable** on task detail page — per-call model breakdown from `ai_cost_log`
3. **Cost Analytics page** — full `/dashboard/cost-analytics` with monthly model breakdown
4. **OpenRouter Developer Mode** — Settings → Danger Zone → Developer Mode
5. **OpenRouter in agent** — optional routing through OpenRouter when user provides key

---

## Implementation Checkpoints

### ✅ Checkpoint 1: Pricing Fix
- [ ] `packages/agent/src/utils/cost-calculator.ts` — updated rates
- [ ] `packages/agent/src/services/ai.ts` — ROUTING_TABLE rates updated
- **Models used & correct rates (Feb 2026):**
  - Groq llama-3.3-70b-versatile: $0.59/$0.79 ✓ (already correct)
  - DeepSeek deepseek-chat (V3): $0.27/$1.10 (was $0.25/$0.38)
  - Kimi K2: $0.60/$2.50 ✓ (already correct)
  - Gemini 2.0 Flash: Free tier $0/$0 ✓ (correct for free)
  - Claude Sonnet 4: $3.00/$15.00 ✓ (already correct)
  - Claude 3.5 Haiku: $0.80/$4.00 (was $0.25/$1.25 — old claude-3-haiku price)

### ✅ Checkpoint 2: Database Migration v29
- [ ] `apps/web/supabase/migration_v29_openrouter_settings.sql`
- Adds to `user_settings`: `openrouter_api_key`, `openrouter_enabled`, `openrouter_model_preset`
- Applied to live Supabase: `eawoquqgfndmphogwjeu`

### ✅ Checkpoint 3: API Endpoints
- [ ] `GET /api/tasks/[id]/ai-costs` — returns `ai_cost_log` rows for a task
- [ ] `GET /api/cost-analytics` — monthly breakdown by model/provider
- [ ] `GET/PUT /api/settings/openrouter` — read/write OpenRouter API key (encrypted)

### ✅ Checkpoint 4: Frontend — Task Detail Advanced Section
- [ ] `/dashboard/tasks/[id]/page.tsx` — "Advanced" collapsible card
- Shows: per-call model, input tokens, output tokens, cost, purpose

### ✅ Checkpoint 5: Frontend — Cost Analytics Page
- [ ] `/dashboard/cost-analytics/page.tsx` — full analytics page
- Monthly cost by provider table, pricing reference, 7-day trend

### ✅ Checkpoint 6: OpenRouter Developer Settings
- [ ] `/dashboard/settings/page.tsx` — Developer Mode section above Danger Zone
- API key field (masked), model preset, pricing from OpenRouter API, warnings

### ✅ Checkpoint 7: Agent — OpenRouter Integration
- [ ] `packages/agent/src/services/ai.ts` — OpenRouter as optional provider
- User-level routing: if `openrouter_enabled=true` and key exists, route through OpenRouter

### ✅ Checkpoint 8: Build & Deploy
- [ ] `pnpm --filter agent build` — clean
- [ ] `pnpm --filter web build` — clean
- [ ] `git push` → Railway auto-deploys agent, Vercel auto-deploys web

### ✅ Checkpoint 9: Playwright Verification
- [ ] Screenshot: `/dashboard/cost-analytics` — pricing table visible
- [ ] Screenshot: `/dashboard/tasks/[id]` — Advanced section with model breakdown
- [ ] Screenshot: `/dashboard/settings` — Developer Mode section with OpenRouter

---

## Technical Notes

### Token Count Accuracy
Token counts come directly from API responses:
```typescript
// From callProvider() in ai.ts:
inputTokens: response.usage.prompt_tokens,
outputTokens: response.usage.completion_tokens,
```
These are **exact** — not estimates.

### Pricing Data Source
Provider APIs don't expose pricing programmatically (no "get current prices" endpoint).
Our rates are maintained constants based on official pricing pages, last verified Feb 2026.
**OpenRouter exception**: `GET https://openrouter.ai/api/v1/models` returns live pricing.

### ai_cost_log Schema
```sql
provider TEXT,    -- 'groq', 'deepseek', 'kimi', 'gemini', 'sonnet', 'haiku', 'openrouter'
model TEXT,       -- exact model name e.g. 'llama-3.3-70b-versatile'
input_tokens INTEGER,
output_tokens INTEGER,
cost_usd NUMERIC,
purpose TEXT,     -- 'understand', 'plan', 'generate', etc.
task_id UUID,     -- link to tasks table
```

---

## Status: IN PROGRESS
