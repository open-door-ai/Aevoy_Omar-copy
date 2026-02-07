/**
 * Cross-Task Pattern Detector
 *
 * Detects meta-patterns across different tasks/domains.
 * Example: "All finance sites need 2FA after form submit"
 *
 * Runs as a daily background job via the scheduler.
 * Analyzes failure_memory + learnings to find recurring patterns
 * across domain categories.
 */

import { getSupabaseClient } from "../utils/supabase.js";

// Domain category classification
const DOMAIN_CATEGORIES: Record<string, string[]> = {
  finance: ["bank", "chase", "citi", "wells", "fidelity", "schwab", "paypal", "stripe", "venmo", "coinbase", "robinhood"],
  travel: ["booking", "expedia", "kayak", "airbnb", "hotels", "airline", "delta", "united", "southwest", "tripadvisor"],
  social: ["facebook", "twitter", "instagram", "linkedin", "tiktok", "reddit", "discord", "slack"],
  shopping: ["amazon", "ebay", "walmart", "target", "bestbuy", "etsy", "shopify"],
  healthcare: ["myhealth", "portal", "patient", "medical", "health", "doctor", "clinic"],
  government: ["gov", "irs", "ssa", "dmv", "state", "city", "county"],
  education: ["edu", "university", "college", "school", "canvas", "blackboard"],
};

interface DetectedPattern {
  patternName: string;
  category: string;
  gotcha: string;
  severity: "low" | "medium" | "high" | "critical";
  evidenceCount: number;
  applicableDomains: string[];
}

/**
 * Classify a domain into a category.
 */
function classifyDomain(domain: string): string {
  const lower = domain.toLowerCase();
  for (const [category, keywords] of Object.entries(DOMAIN_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return "other";
}

/**
 * Run pattern detection across failure_memory and learnings.
 * Called daily by the scheduler.
 */
export async function detectPatterns(): Promise<DetectedPattern[]> {
  const patterns: DetectedPattern[] = [];

  try {
    // 1. Analyze failure_memory for repeated gotchas across domains
    const { data: failures } = await getSupabaseClient()
      .from("failure_memory")
      .select("site_domain, action_type, error_type, solution_method, success_rate, times_used")
      .gte("times_used", 2)
      .order("times_used", { ascending: false })
      .limit(200);

    if (failures && failures.length > 0) {
      // Group by category + error type
      const categoryErrors = new Map<string, { domains: Set<string>; errorType: string; count: number }>();

      for (const f of failures) {
        const category = classifyDomain(f.site_domain);
        if (category === "other") continue;

        const key = `${category}:${f.error_type}`;
        const existing = categoryErrors.get(key) || { domains: new Set(), errorType: f.error_type, count: 0 };
        existing.domains.add(f.site_domain);
        existing.count += f.times_used;
        categoryErrors.set(key, existing);
      }

      // Detect patterns: same error type in 3+ domains of same category
      for (const [key, data] of categoryErrors) {
        if (data.domains.size >= 3) {
          const [category] = key.split(":");
          patterns.push({
            patternName: `${category}_${data.errorType}`,
            category,
            gotcha: `${capitalize(category)} sites commonly fail with: ${data.errorType}. Affected domains: ${[...data.domains].slice(0, 5).join(", ")}`,
            severity: data.count > 20 ? "high" : data.count > 10 ? "medium" : "low",
            evidenceCount: data.count,
            applicableDomains: [...data.domains],
          });
        }
      }
    }

    // 2. Analyze learnings for recurring gotchas
    const { data: learnings } = await getSupabaseClient()
      .from("learnings")
      .select("service, task_type, gotchas, difficulty, is_warning")
      .not("gotchas", "is", null)
      .limit(200);

    if (learnings && learnings.length > 0) {
      // Group gotchas by category
      const categoryGotchas = new Map<string, Map<string, string[]>>();

      for (const l of learnings) {
        if (!l.gotchas || !Array.isArray(l.gotchas)) continue;
        const category = classifyDomain(l.service || "");
        if (category === "other") continue;

        if (!categoryGotchas.has(category)) {
          categoryGotchas.set(category, new Map());
        }

        for (const gotcha of l.gotchas) {
          const normalized = normalizeGotcha(gotcha);
          const gotchaMap = categoryGotchas.get(category)!;
          if (!gotchaMap.has(normalized)) {
            gotchaMap.set(normalized, []);
          }
          gotchaMap.get(normalized)!.push(l.service || "unknown");
        }
      }

      // Detect patterns: same gotcha in 3+ services of same category
      for (const [category, gotchaMap] of categoryGotchas) {
        for (const [gotcha, services] of gotchaMap) {
          const uniqueServices = [...new Set(services)];
          if (uniqueServices.length >= 3) {
            patterns.push({
              patternName: `${category}_gotcha_${gotcha.substring(0, 20).replace(/\s/g, "_")}`,
              category,
              gotcha: `Common issue in ${category} sites: ${gotcha}`,
              severity: "medium",
              evidenceCount: uniqueServices.length,
              applicableDomains: uniqueServices,
            });
          }
        }
      }
    }

    // 3. Store detected patterns in database
    for (const pattern of patterns) {
      await getSupabaseClient()
        .from("cross_task_patterns")
        .upsert(
          {
            pattern_name: pattern.patternName,
            condition_domain_category: pattern.category,
            gotcha: pattern.gotcha,
            severity: pattern.severity,
            evidence_count: pattern.evidenceCount,
            applicable_domains: pattern.applicableDomains,
            last_seen: new Date().toISOString(),
          },
          { onConflict: "pattern_name" }
        );
    }

    if (patterns.length > 0) {
      console.log(`[PATTERN] Detected ${patterns.length} cross-task patterns`);
    }

    return patterns;
  } catch (error) {
    console.error("[PATTERN] Detection failed:", error);
    return [];
  }
}

/**
 * Get relevant patterns for a domain before task execution.
 * Returns gotcha warnings to inject into the AI prompt.
 */
export async function getPatternWarnings(domain: string): Promise<string[]> {
  try {
    const category = classifyDomain(domain);
    if (category === "other") return [];

    const { data: patterns } = await getSupabaseClient()
      .from("cross_task_patterns")
      .select("gotcha, severity, evidence_count")
      .eq("condition_domain_category", category)
      .gte("evidence_count", 3)
      .order("evidence_count", { ascending: false })
      .limit(5);

    if (!patterns || patterns.length === 0) return [];

    return patterns.map((p) => {
      const prefix = p.severity === "critical" ? "CRITICAL" : p.severity === "high" ? "WARNING" : "NOTE";
      return `[${prefix}] ${p.gotcha}`;
    });
  } catch {
    return [];
  }
}

// Normalize gotcha text for deduplication
function normalizeGotcha(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
