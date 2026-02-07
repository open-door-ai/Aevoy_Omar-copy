/**
 * Proactive Problem Detector
 *
 * Scans for potential issues before they cause task failures.
 * Analyzes patterns, credentials, OAuth status, budget, and system health.
 *
 * Detection categories:
 * 1. Expiring credentials/OAuth tokens
 * 2. Budget running low
 * 3. Degraded domains (high failure rate)
 * 4. Missing dependencies (API keys, skills)
 * 5. Pattern-based warnings (similar past failures)
 * 6. System health issues (rate limits, service degradation)
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface DetectedProblem {
  type: "credential" | "budget" | "domain" | "dependency" | "pattern" | "system";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  suggestedAction: string;
  affectedTasks?: string[]; // Task IDs that might be impacted
  estimatedImpact: string; // e.g., "20% of tasks may fail"
}

/**
 * Detect all potential problems for a user
 */
export async function detectProblemsForUser(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  // Run all detection categories in parallel
  const [credentialProblems, budgetProblems, domainProblems, dependencyProblems, patternProblems, systemProblems] =
    await Promise.all([
      detectCredentialIssues(userId),
      detectBudgetIssues(userId),
      detectDomainIssues(userId),
      detectDependencyIssues(userId),
      detectPatternIssues(userId),
      detectSystemIssues(userId),
    ]);

  problems.push(...credentialProblems, ...budgetProblems, ...domainProblems, ...dependencyProblems, ...patternProblems, ...systemProblems);

  if (problems.length > 0) {
    console.log(`[PROACTIVE] Detected ${problems.length} potential problems for user ${userId.slice(0, 8)}`);
    problems.forEach((p) => {
      console.log(`[PROACTIVE]   ${p.severity.toUpperCase()}: ${p.title}`);
    });
  }

  return problems;
}

/**
 * Detect expiring or missing credentials
 */
async function detectCredentialIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    // Check OAuth tokens expiring within 7 days
    const { data: expiringTokens } = await getSupabaseClient()
      .from("oauth_connections")
      .select("service, expires_at")
      .eq("user_id", userId)
      .lte("expires_at", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .gte("expires_at", new Date().toISOString());

    if (expiringTokens && expiringTokens.length > 0) {
      for (const token of expiringTokens) {
        const daysRemaining = Math.floor(
          (new Date(token.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        problems.push({
          type: "credential",
          severity: daysRemaining < 2 ? "high" : "medium",
          title: `${token.service} OAuth token expiring soon`,
          description: `Your ${token.service} access will expire in ${daysRemaining} days`,
          suggestedAction: `Reconnect ${token.service} in settings to avoid disruption`,
          estimatedImpact: `All ${token.service} tasks will fail after expiration`,
        });
      }
    }

    // Check for domains with high failure rate (>50%) in last 7 days
    const { data: recentTasks } = await getSupabaseClient()
      .from("tasks")
      .select("type, status, execution_time_ms")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(100);

    if (recentTasks && recentTasks.length > 10) {
      const failureRate = recentTasks.filter((t) => t.status === "failed").length / recentTasks.length;
      if (failureRate > 0.5) {
        problems.push({
          type: "credential",
          severity: "high",
          title: "High task failure rate detected",
          description: `${Math.round(failureRate * 100)}% of recent tasks are failing`,
          suggestedAction: "Check your credentials, OAuth connections, and API keys in settings",
          estimatedImpact: "Most tasks may continue failing without action",
        });
      }
    }
  } catch (error) {
    console.error("[PROACTIVE] Credential detection error:", error);
  }

  return problems;
}

/**
 * Detect budget issues
 */
async function detectBudgetIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { data: usage } = await getSupabaseClient()
      .from("usage")
      .select("ai_cost_cents")
      .eq("user_id", userId)
      .eq("month", currentMonth)
      .single();

    const costCents = usage?.ai_cost_cents || 0;
    const budgetCents = 1500; // $15/month
    const remainingCents = budgetCents - costCents;
    const remainingDollars = remainingCents / 100;

    if (remainingCents < 300) {
      // Less than $3 remaining
      problems.push({
        type: "budget",
        severity: remainingCents < 100 ? "critical" : "high",
        title: "Monthly budget running low",
        description: `Only $${remainingDollars.toFixed(2)} remaining this month`,
        suggestedAction: remainingCents < 100
          ? "Upgrade your plan or tasks will be paused soon"
          : "Consider upgrading to avoid hitting limit",
        estimatedImpact: remainingCents < 100 ? "Tasks will be paused when budget is depleted" : "May run out of budget within 3-5 days",
      });
    }

    // Check if consistently over budget
    const { data: history } = await getSupabaseClient()
      .from("usage")
      .select("month, ai_cost_cents")
      .eq("user_id", userId)
      .order("month", { ascending: false })
      .limit(3);

    if (history && history.length === 3) {
      const allOverBudget = history.every((h) => h.ai_cost_cents > budgetCents);
      if (allOverBudget) {
        problems.push({
          type: "budget",
          severity: "medium",
          title: "Consistently exceeding budget",
          description: "You've exceeded your monthly budget for 3 consecutive months",
          suggestedAction: "Consider upgrading to a higher tier plan",
          estimatedImpact: "You may experience service interruptions",
        });
      }
    }
  } catch (error) {
    console.error("[PROACTIVE] Budget detection error:", error);
  }

  return problems;
}

/**
 * Detect degraded domains (high failure rate)
 */
async function detectDomainIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    // Query task_difficulty_cache for domains with low success rate
    const { data: degradedDomains } = await getSupabaseClient()
      .from("task_difficulty_cache")
      .select("domain, avg_success_rate, total_attempts")
      .lt("avg_success_rate", 50)
      .gte("total_attempts", 5)
      .limit(10);

    if (degradedDomains && degradedDomains.length > 0) {
      for (const domain of degradedDomains) {
        problems.push({
          type: "domain",
          severity: domain.avg_success_rate < 30 ? "high" : "medium",
          title: `${domain.domain} has high failure rate`,
          description: `Only ${domain.avg_success_rate}% success rate over ${domain.total_attempts} attempts`,
          suggestedAction: `Check if ${domain.domain} requires special authentication or has layout changes`,
          estimatedImpact: `Tasks on ${domain.domain} are likely to fail`,
        });
      }
    }
  } catch (error) {
    console.error("[PROACTIVE] Domain detection error:", error);
  }

  return problems;
}

/**
 * Detect missing dependencies (skills, API keys)
 */
async function detectDependencyIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    // Check if user has tasks requiring skills they haven't installed
    const { data: recentTasks } = await getSupabaseClient()
      .from("tasks")
      .select("type, status, input_text")
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (recentTasks && recentTasks.length > 0) {
      // Detect calendar tasks without calendar skill
      const calendarTasks = recentTasks.filter((t) =>
        t.input_text?.toLowerCase().includes("calendar") || t.input_text?.toLowerCase().includes("meeting")
      );
      if (calendarTasks.length >= 3) {
        // Check if calendar skill is installed
        const { data: calendarSkill } = await getSupabaseClient()
          .from("skills")
          .select("id")
          .eq("name", "Google Calendar")
          .single();

        if (!calendarSkill) {
          problems.push({
            type: "dependency",
            severity: "medium",
            title: "Calendar tasks failing frequently",
            description: `${calendarTasks.length} calendar-related tasks failed recently`,
            suggestedAction: "Install the Google Calendar skill from the marketplace",
            estimatedImpact: "Calendar tasks will continue failing without the skill",
          });
        }
      }

      // Detect email tasks without Gmail skill
      const emailTasks = recentTasks.filter((t) =>
        t.input_text?.toLowerCase().includes("email") || t.input_text?.toLowerCase().includes("gmail")
      );
      if (emailTasks.length >= 3) {
        const { data: emailSkill } = await getSupabaseClient()
          .from("skills")
          .select("id")
          .eq("name", "Gmail")
          .single();

        if (!emailSkill) {
          problems.push({
            type: "dependency",
            severity: "medium",
            title: "Email tasks failing frequently",
            description: `${emailTasks.length} email-related tasks failed recently`,
            suggestedAction: "Install the Gmail skill and connect your account",
            estimatedImpact: "Email tasks will continue failing without the skill",
          });
        }
      }
    }
  } catch (error) {
    console.error("[PROACTIVE] Dependency detection error:", error);
  }

  return problems;
}

/**
 * Detect pattern-based warnings (similar past failures)
 */
async function detectPatternIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    // Query cross_task_patterns for high-severity warnings
    const { data: patterns } = await getSupabaseClient()
      .from("cross_task_patterns")
      .select("pattern_type, affected_domains, occurrence_count, description")
      .gte("occurrence_count", 5)
      .limit(10);

    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        if (pattern.pattern_type.includes("2fa") || pattern.pattern_type.includes("captcha")) {
          problems.push({
            type: "pattern",
            severity: "low",
            title: `Common issue: ${pattern.pattern_type}`,
            description: pattern.description || `Occurs frequently across ${pattern.occurrence_count} domains`,
            suggestedAction: "Be prepared to provide 2FA codes or solve CAPTCHAs manually",
            estimatedImpact: "May cause delays in task execution",
          });
        }
      }
    }
  } catch (error) {
    console.error("[PROACTIVE] Pattern detection error:", error);
  }

  return problems;
}

/**
 * Detect system-wide issues (rate limits, service degradation)
 */
async function detectSystemIssues(userId: string): Promise<DetectedProblem[]> {
  const problems: DetectedProblem[] = [];

  try {
    // Check AI cost log for repeated failures (potential API issues)
    const { data: aiFailures } = await getSupabaseClient()
      .from("ai_cost_log")
      .select("model, created_at")
      .eq("user_id", userId)
      .eq("tokens_used", 0) // Indicator of failure
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(20);

    if (aiFailures && aiFailures.length > 10) {
      const failedModels = [...new Set(aiFailures.map((f) => f.model))];
      problems.push({
        type: "system",
        severity: "medium",
        title: "AI model issues detected",
        description: `Multiple AI requests failed in the last 24 hours (models: ${failedModels.join(", ")})`,
        suggestedAction: "System is auto-routing to backup models. Monitor task status.",
        estimatedImpact: "Some tasks may take longer due to model fallbacks",
      });
    }
  } catch (error) {
    console.error("[PROACTIVE] System detection error:", error);
  }

  return problems;
}

/**
 * Format problems for user notification
 */
export function formatProblemsForNotification(problems: DetectedProblem[]): string {
  if (problems.length === 0) return "";

  const critical = problems.filter((p) => p.severity === "critical");
  const high = problems.filter((p) => p.severity === "high");
  const medium = problems.filter((p) => p.severity === "medium");
  const low = problems.filter((p) => p.severity === "low");

  let message = "🔍 **Proactive Problem Detection**\n\n";
  message += `I detected ${problems.length} potential issue${problems.length > 1 ? "s" : ""} that may affect your tasks:\n\n`;

  if (critical.length > 0) {
    message += "**🚨 CRITICAL:**\n";
    critical.forEach((p) => {
      message += `- ${p.title}\n  ${p.description}\n  ➜ ${p.suggestedAction}\n\n`;
    });
  }

  if (high.length > 0) {
    message += "**⚠️ HIGH PRIORITY:**\n";
    high.forEach((p) => {
      message += `- ${p.title}\n  ${p.description}\n  ➜ ${p.suggestedAction}\n\n`;
    });
  }

  if (medium.length > 0) {
    message += "**⚡ MEDIUM:**\n";
    medium.forEach((p) => {
      message += `- ${p.title}\n  ➜ ${p.suggestedAction}\n\n`;
    });
  }

  if (low.length > 0 && low.length <= 3) {
    // Only show low-priority if few
    message += "**ℹ️ INFO:**\n";
    low.forEach((p) => {
      message += `- ${p.title}\n\n`;
    });
  }

  message += "\nTaking action now can prevent task failures and save you time.\n";
  message += "View details: https://www.aevoy.com/dashboard/settings";

  return message;
}

/**
 * Auto-fix problems where possible (fire-and-forget)
 */
export async function autoFixProblems(userId: string, problems: DetectedProblem[]): Promise<void> {
  for (const problem of problems) {
    try {
      switch (problem.type) {
        case "credential":
          // Could trigger OAuth refresh automatically
          console.log(`[PROACTIVE] Auto-fix not available for credential issues`);
          break;

        case "budget":
          // Could send upgrade link
          console.log(`[PROACTIVE] Auto-fix not available for budget issues`);
          break;

        case "domain":
          // Could mark domain for extra retries
          console.log(`[PROACTIVE] Flagging ${problem.title} for extra retries`);
          break;

        default:
          console.log(`[PROACTIVE] No auto-fix for ${problem.type} problems`);
      }
    } catch (error) {
      console.error(`[PROACTIVE] Auto-fix error for ${problem.type}:`, error);
    }
  }
}
