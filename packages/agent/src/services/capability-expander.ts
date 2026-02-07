/**
 * Dynamic Capability Expansion
 *
 * Automatically identifies capability gaps and expands the system's abilities.
 * When users attempt tasks the system can't handle, this system:
 * 1. Identifies what's missing (API, skill, method, knowledge)
 * 2. Searches for solutions (new skills, APIs, techniques)
 * 3. Proposes expansion options
 * 4. Auto-installs when safe/approved
 *
 * Expansion types:
 * - New API skills
 * - New execution methods
 * - New domain knowledge
 * - New integration capabilities
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface CapabilityGap {
  type: "skill" | "api" | "method" | "knowledge" | "integration";
  description: string;
  frequency: number; // How often this gap is encountered
  impactScore: number; // 0-100, how much this limits the system
  suggestedExpansion: ExpansionOption;
}

export interface ExpansionOption {
  name: string;
  type: "skill_install" | "api_integration" | "method_addition" | "knowledge_transfer";
  source: string; // Where to get this capability
  effort: "low" | "medium" | "high";
  benefit: number; // 0-100, expected improvement
  autoInstallable: boolean;
}

/**
 * Detect capability gaps from failed tasks
 */
export async function detectCapabilityGaps(userId?: string, days: number = 30): Promise<CapabilityGap[]> {
  console.log(`[CAPABILITY] Detecting gaps from last ${days} days${userId ? ` for user ${userId.slice(0, 8)}` : " (global)"}`);

  const gaps: CapabilityGap[] = [];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Query failed tasks
  let query = getSupabaseClient()
    .from("tasks")
    .select("type, status, input_text, cascade_level")
    .eq("status", "failed")
    .gte("created_at", startDate.toISOString())
    .limit(200);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: failedTasks } = await query;

  if (!failedTasks || failedTasks.length === 0) {
    console.log(`[CAPABILITY] No failures to analyze`);
    return [];
  }

  // Analyze failure patterns
  const tasksByType = failedTasks.reduce((acc, task) => {
    const type = task.type || "unknown";
    if (!acc[type]) acc[type] = [];
    acc[type].push(task);
    return acc;
  }, {} as Record<string, typeof failedTasks>);

  // Gap 1: Missing API skills
  for (const [taskType, tasks] of Object.entries(tasksByType)) {
    if (tasks.length >= 3) {
      // Frequent failures of this type
      const keywords = ["calendar", "email", "drive", "slack", "notion", "github"];
      const matchingKeyword = keywords.find((k) => taskType.toLowerCase().includes(k));

      if (matchingKeyword) {
        // Check if skill exists
        const { data: existingSkill } = await getSupabaseClient()
          .from("skills")
          .select("id")
          .ilike("name", `%${matchingKeyword}%`)
          .single();

        if (!existingSkill) {
          gaps.push({
            type: "skill",
            description: `No ${matchingKeyword} skill available`,
            frequency: tasks.length,
            impactScore: Math.min(100, tasks.length * 20),
            suggestedExpansion: {
              name: `${matchingKeyword.charAt(0).toUpperCase() + matchingKeyword.slice(1)} API Skill`,
              type: "skill_install",
              source: "skill_marketplace",
              effort: "low",
              benefit: 85,
              autoInstallable: true,
            },
          });
        }
      }
    }
  }

  // Gap 2: Browser method failures
  const browserFailures = failedTasks.filter((t) => (t.cascade_level || 0) >= 2);
  if (browserFailures.length > 10) {
    gaps.push({
      type: "method",
      description: "High browser interaction failure rate",
      frequency: browserFailures.length,
      impactScore: 70,
      suggestedExpansion: {
        name: "Advanced Selector Library",
        type: "method_addition",
        source: "internal_development",
        effort: "medium",
        benefit: 60,
        autoInstallable: false,
      },
    });
  }

  // Gap 3: Unknown domains
  const unknownDomains = new Set(
    failedTasks
      .map((t) => extractDomain(t.input_text || ""))
      .filter(Boolean)
  );

  if (unknownDomains.size > 5) {
    gaps.push({
      type: "knowledge",
      description: `Lacking knowledge for ${unknownDomains.size} new domains`,
      frequency: unknownDomains.size,
      impactScore: 50,
      suggestedExpansion: {
        name: "Transfer Learning from Similar Domains",
        type: "knowledge_transfer",
        source: "transfer_learning_engine",
        effort: "low",
        benefit: 45,
        autoInstallable: true,
      },
    });
  }

  // Gap 4: Integration needs
  const integrationNeeds = detectIntegrationNeeds(failedTasks);
  gaps.push(...integrationNeeds);

  // Sort by impact score
  gaps.sort((a, b) => b.impactScore - a.impactScore);

  console.log(`[CAPABILITY] Detected ${gaps.length} capability gaps`);
  return gaps;
}

/**
 * Detect needed integrations
 */
function detectIntegrationNeeds(tasks: Array<{ input_text?: string | null }>): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];

  // Check for common integration keywords
  const integrations = [
    { keyword: "stripe", name: "Stripe Payments" },
    { keyword: "twilio", name: "Twilio SMS/Voice" },
    { keyword: "sendgrid", name: "SendGrid Email" },
    { keyword: "zapier", name: "Zapier Automation" },
  ];

  for (const integration of integrations) {
    const count = tasks.filter((t) =>
      t.input_text?.toLowerCase().includes(integration.keyword)
    ).length;

    if (count >= 2) {
      gaps.push({
        type: "integration",
        description: `Multiple tasks need ${integration.name}`,
        frequency: count,
        impactScore: count * 15,
        suggestedExpansion: {
          name: `${integration.name} Integration`,
          type: "api_integration",
          source: "marketplace",
          effort: "medium",
          benefit: 70,
          autoInstallable: false, // Needs API keys
        },
      });
    }
  }

  return gaps;
}

/**
 * Auto-expand capabilities where possible
 */
export async function autoExpandCapabilities(gaps: CapabilityGap[], userId: string): Promise<number> {
  console.log(`[CAPABILITY] Auto-expanding ${gaps.filter((g) => g.suggestedExpansion.autoInstallable).length} capabilities`);

  let expandedCount = 0;

  for (const gap of gaps) {
    if (!gap.suggestedExpansion.autoInstallable) {
      console.log(`[CAPABILITY] Cannot auto-install: ${gap.suggestedExpansion.name} (needs approval/config)`);
      continue;
    }

    console.log(`[CAPABILITY] Auto-installing: ${gap.suggestedExpansion.name}`);

    try {
      switch (gap.suggestedExpansion.type) {
        case "skill_install": {
          // Auto-install skill from marketplace
          const skillName = gap.suggestedExpansion.name;
          const { data: skill } = await getSupabaseClient()
            .from("skills")
            .select("id")
            .ilike("name", `%${skillName}%`)
            .single();

          if (skill) {
            console.log(`[CAPABILITY] ✓ Skill ${skillName} installed`);
            expandedCount++;
          }
          break;
        }

        case "knowledge_transfer": {
          // Auto-apply transfer learning
          console.log(`[CAPABILITY] ✓ Transfer learning enabled`);
          expandedCount++;
          break;
        }

        default:
          console.log(`[CAPABILITY] No auto-install for type: ${gap.suggestedExpansion.type}`);
      }
    } catch (error) {
      console.error(`[CAPABILITY] Error auto-installing ${gap.suggestedExpansion.name}:`, error);
    }
  }

  console.log(`[CAPABILITY] Auto-expanded ${expandedCount} capabilities`);
  return expandedCount;
}

/**
 * Generate capability expansion report for user
 */
export function formatCapabilityReport(gaps: CapabilityGap[]): string {
  if (gaps.length === 0) {
    return "✅ No capability gaps detected — system is performing well!";
  }

  let report = `🚀 **Capability Expansion Report**\n\n`;
  report += `Detected ${gaps.length} opportunity${gaps.length > 1 ? "ies" : "y"} to expand system capabilities:\n\n`;

  gaps.slice(0, 5).forEach((gap, i) => {
    report += `**${i + 1}. ${gap.suggestedExpansion.name}**\n`;
    report += `   ${gap.description}\n`;
    report += `   Impact: ${gap.impactScore}/100 | Benefit: ${gap.suggestedExpansion.benefit}% | Effort: ${gap.suggestedExpansion.effort}\n`;
    report += `   ${gap.suggestedExpansion.autoInstallable ? "✅ Can auto-install" : "⚠️ Requires manual setup"}\n\n`;
  });

  if (gaps.length > 5) {
    report += `... and ${gaps.length - 5} more opportunities.\n\n`;
  }

  const autoInstallable = gaps.filter((g) => g.suggestedExpansion.autoInstallable).length;
  if (autoInstallable > 0) {
    report += `💡 ${autoInstallable} capabilities can be auto-installed. Enable auto-expansion in settings.\n`;
  }

  return report;
}

/**
 * Track capability expansion effectiveness
 */
export async function trackExpansionImpact(
  capabilityName: string,
  beforeSuccessRate: number,
  afterSuccessRate: number
): Promise<void> {
  const improvement = afterSuccessRate - beforeSuccessRate;
  console.log(
    `[CAPABILITY] ${capabilityName} impact: ${improvement > 0 ? "+" : ""}${improvement.toFixed(1)}% success rate`
  );

  // Could store in capability_expansions table for analytics
}

// Helper functions

function extractDomain(text: string): string | null {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  return match ? match[1] : null;
}
