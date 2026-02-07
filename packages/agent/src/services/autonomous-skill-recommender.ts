/**
 * Autonomous Skill Recommendation System
 *
 * Analyzes user task patterns and proactively suggests relevant skills.
 * Learns from: task history, failed attempts, user context, domain patterns.
 *
 * Never asks permission - just analyzes and recommends.
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface SkillRecommendation {
  skillId: string;
  skillName: string;
  reason: string;
  confidence: number; // 0-100
  estimatedTimeSavings: number; // seconds per task
  estimatedCostSavings: number; // USD per task
  relevantTasks: string[]; // Task IDs that triggered this
}

/**
 * Analyze user's task history and recommend skills
 */
export async function recommendSkills(userId: string): Promise<SkillRecommendation[]> {
  console.log(`[SKILL-REC] Analyzing task patterns for user ${userId.slice(0, 8)}`);

  const supabase = getSupabaseClient();

  // Get recent tasks (last 30 days)
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, type, description, cascade_level, cost_usd, tokens_used, status")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !tasks || tasks.length === 0) {
    console.log(`[SKILL-REC] No recent tasks for user ${userId.slice(0, 8)}`);
    return [];
  }

  console.log(`[SKILL-REC] Analyzing ${tasks.length} tasks`);

  const recommendations: SkillRecommendation[] = [];

  // Pattern 1: Frequent browser tasks that could use API
  const browserTasks = tasks.filter(t =>
    t.cascade_level && t.cascade_level >= 2 &&
    (t.description?.includes("gmail") || t.description?.includes("calendar") || t.description?.includes("drive"))
  );

  if (browserTasks.length >= 3) {
    const avgCost = browserTasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0) / browserTasks.length;

    if (browserTasks.some(t => t.description?.includes("gmail"))) {
      recommendations.push({
        skillId: "gmail_api",
        skillName: "Gmail API Skill",
        reason: `You've used browser automation for Gmail ${browserTasks.filter(t => t.description?.includes("gmail")).length} times. Gmail API is 10x faster and cheaper.`,
        confidence: Math.min(95, 60 + browserTasks.length * 5),
        estimatedTimeSavings: 25, // API ~5s vs browser ~30s
        estimatedCostSavings: avgCost * 0.8,
        relevantTasks: browserTasks.slice(0, 3).map(t => t.id),
      });
    }

    if (browserTasks.some(t => t.description?.includes("calendar"))) {
      recommendations.push({
        skillId: "google_calendar_api",
        skillName: "Google Calendar API Skill",
        reason: `Browser automation detected for calendar tasks. API is instant and more reliable.`,
        confidence: 75,
        estimatedTimeSavings: 20,
        estimatedCostSavings: avgCost * 0.7,
        relevantTasks: browserTasks.filter(t => t.description?.includes("calendar")).slice(0, 3).map(t => t.id),
      });
    }
  }

  // Pattern 2: Failed tasks that need specialized skills
  const failedTasks = tasks.filter(t => t.status === "failed");

  if (failedTasks.length >= 2) {
    // Check for common failure patterns
    const failureDescriptions = failedTasks.map(t => t.description?.toLowerCase() || "").join(" ");

    if (failureDescriptions.includes("excel") || failureDescriptions.includes("spreadsheet")) {
      recommendations.push({
        skillId: "excel_manipulation",
        skillName: "Excel/Sheets Manipulation Skill",
        reason: `Detected ${failedTasks.filter(t => t.description?.toLowerCase().includes("excel")).length} failed spreadsheet tasks. Specialized skill handles complex formulas and data.`,
        confidence: 80,
        estimatedTimeSavings: 60,
        estimatedCostSavings: 0.05,
        relevantTasks: failedTasks.slice(0, 3).map(t => t.id),
      });
    }

    if (failureDescriptions.includes("pdf") || failureDescriptions.includes("document")) {
      recommendations.push({
        skillId: "pdf_processing",
        skillName: "PDF Processing Skill",
        reason: "Multiple PDF/document tasks failed. Specialized parser handles forms, tables, and extraction.",
        confidence: 75,
        estimatedTimeSavings: 45,
        estimatedCostSavings: 0.03,
        relevantTasks: failedTasks.slice(0, 2).map(t => t.id),
      });
    }
  }

  // Pattern 3: High-cost tasks that could be optimized
  const expensiveTasks = tasks.filter(t => (t.cost_usd || 0) > 0.10);

  if (expensiveTasks.length >= 2) {
    recommendations.push({
      skillId: "cost_optimizer",
      skillName: "Cost Optimization Skill",
      reason: `${expensiveTasks.length} tasks cost >$0.10 each. Auto-optimizer finds cheaper models and caching strategies.`,
      confidence: 85,
      estimatedTimeSavings: 0,
      estimatedCostSavings: expensiveTasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0) * 0.4,
      relevantTasks: expensiveTasks.slice(0, 3).map(t => t.id),
    });
  }

  // Pattern 4: Repetitive tasks that could be automated
  const taskTypes = tasks.map(t => t.type).filter(Boolean);
  const typeCounts = taskTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [type, countValue] of Object.entries(typeCounts)) {
    const count = countValue as number;
    if (count >= 5 && type !== "unknown") {
      recommendations.push({
        skillId: `${type}_automation`,
        skillName: `${type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())} Automation`,
        reason: `You've done ${count} ${type} tasks. Workflow automation can handle this pattern automatically.`,
        confidence: 70,
        estimatedTimeSavings: 120, // Fully automated
        estimatedCostSavings: 0.02 * count,
        relevantTasks: tasks.filter(t => t.type === type).slice(0, 3).map(t => t.id),
      });
    }
  }

  // Sort by confidence * savings
  recommendations.sort((a, b) => {
    const scoreA = a.confidence * (a.estimatedCostSavings + a.estimatedTimeSavings / 100);
    const scoreB = b.confidence * (b.estimatedCostSavings + b.estimatedTimeSavings / 100);
    return scoreB - scoreA;
  });

  console.log(`[SKILL-REC] Generated ${recommendations.length} recommendations`);
  recommendations.slice(0, 5).forEach(r => {
    console.log(`[SKILL-REC] - ${r.skillName} (${r.confidence}% confidence, saves $${r.estimatedCostSavings.toFixed(3)}/task)`);
  });

  return recommendations.slice(0, 5); // Top 5
}

/**
 * Check if user should be notified about skill recommendations
 * Avoids spam - only notify when high-confidence recs available
 */
export async function shouldNotifySkillRecommendations(
  userId: string,
  recommendations: SkillRecommendation[]
): Promise<boolean> {
  if (recommendations.length === 0) return false;

  // Only notify if at least one high-confidence recommendation
  const highConfidence = recommendations.filter(r => r.confidence >= 80);
  if (highConfidence.length === 0) return false;

  // Check last notification time (don't spam)
  const supabase = getSupabaseClient();
  const { data: lastNotif } = await supabase
    .from("tasks")
    .select("created_at")
    .eq("user_id", userId)
    .eq("type", "skill_recommendation")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (lastNotif) {
    const daysSinceLastNotif = (Date.now() - new Date(lastNotif.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastNotif < 7) {
      console.log(`[SKILL-REC] Last notification ${daysSinceLastNotif.toFixed(1)} days ago, waiting`);
      return false; // Wait at least 7 days between notifications
    }
  }

  console.log(`[SKILL-REC] ${highConfidence.length} high-confidence recs, notifying user`);
  return true;
}

/**
 * Format skill recommendations for user notification
 */
export function formatSkillRecommendations(recommendations: SkillRecommendation[]): string {
  let message = "🤖 Your AI analyzed your task patterns and found optimization opportunities:\n\n";

  recommendations.forEach((rec, i) => {
    message += `${i + 1}. **${rec.skillName}**\n`;
    message += `   ${rec.reason}\n`;

    const savings = [];
    if (rec.estimatedTimeSavings > 0) savings.push(`${rec.estimatedTimeSavings}s faster`);
    if (rec.estimatedCostSavings > 0) savings.push(`$${rec.estimatedCostSavings.toFixed(3)} cheaper`);
    if (savings.length > 0) {
      message += `   💰 Savings: ${savings.join(", ")}\n`;
    }

    message += `   ✓ ${rec.confidence}% confidence\n\n`;
  });

  message += "Install these skills from your dashboard → Skills Marketplace";

  return message;
}
