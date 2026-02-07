/**
 * Quality Prediction System
 *
 * Predicts task quality BEFORE execution based on historical data.
 * Helps decide verification strategy and user expectations.
 *
 * Quality dimensions:
 * 1. Accuracy (will it do the right thing?)
 * 2. Completeness (will it finish all steps?)
 * 3. Reliability (consistent results?)
 * 4. Speed (how long will it take?)
 * 5. Cost (how much will it cost?)
 *
 * Uses historical data to predict:
 * - Verification confidence
 * - Strike probability
 * - Success likelihood
 * - User satisfaction score
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface QualityPrediction {
  overallScore: number; // 0-100
  accuracy: number; // 0-100
  completeness: number; // 0-100
  reliability: number; // 0-100
  speed: number; // 0-100
  costEfficiency: number; // 0-100
  confidence: number; // How confident we are in this prediction (0-100)
  predictedIssues: string[];
  recommendedVerification: "none" | "quick" | "standard" | "thorough";
  estimatedUserSatisfaction: number; // 0-100
}

/**
 * Predict quality for a task before execution
 */
export async function predictQuality(
  userId: string,
  taskType: string,
  domain: string,
  description: string
): Promise<QualityPrediction> {
  console.log(`[QUALITY] Predicting quality for ${taskType} on ${domain}`);

  // Query historical performance for this (domain, task_type) combo
  const { data: history } = await getSupabaseClient()
    .from("task_difficulty_cache")
    .select("*")
    .eq("domain", domain)
    .eq("task_type", taskType)
    .single();

  // Query user's historical success rate with this task type
  const { data: userTasks } = await getSupabaseClient()
    .from("tasks")
    .select("status, verification_status, cost_usd, execution_time_ms")
    .eq("user_id", userId)
    .eq("type", taskType)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(50);

  // Calculate scores
  let accuracy = 70; // Default baseline
  let completeness = 70;
  let reliability = 70;
  let speed = 70;
  let costEfficiency = 70;
  let confidence = 30; // Low confidence without data

  if (history) {
    confidence = 80; // High confidence with historical data

    // Accuracy = success rate
    accuracy = history.avg_success_rate || 70;

    // Completeness = inverse of avg strikes (fewer strikes = more complete)
    const avgStrikes = history.avg_strikes || 1;
    completeness = Math.max(0, Math.min(100, 100 - avgStrikes * 15));

    // Reliability = consistency (std deviation of success rate)
    // For now, use success rate as proxy
    reliability = history.avg_success_rate || 70;

    // Speed = compare to target duration (30s)
    const avgDuration = (history.avg_duration_ms || 30000) / 1000;
    speed = avgDuration < 30 ? 100 : Math.max(0, 100 - (avgDuration - 30) * 2);

    // Cost efficiency = compare to target cost ($0.05)
    const avgCost = history.avg_cost_usd || 0.05;
    costEfficiency = avgCost < 0.05 ? 100 : Math.max(0, 100 - (avgCost - 0.05) * 500);
  } else if (userTasks && userTasks.length > 0) {
    // No domain-specific history, but user has done similar tasks
    confidence = 60;

    const successCount = userTasks.filter((t) => t.status === "completed").length;
    accuracy = (successCount / userTasks.length) * 100;

    const verifiedCount = userTasks.filter((t) => t.verification_status === "verified").length;
    completeness = (verifiedCount / userTasks.length) * 100;

    const avgCost = userTasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0) / userTasks.length;
    costEfficiency = avgCost < 0.05 ? 100 : Math.max(0, 100 - (avgCost - 0.05) * 500);

    reliability = accuracy; // Use success rate as proxy
  } else {
    // No historical data at all
    confidence = 20;
    console.log(`[QUALITY] No historical data — using baseline predictions`);
  }

  // Overall score is weighted average
  const overallScore =
    accuracy * 0.3 + completeness * 0.25 + reliability * 0.2 + speed * 0.15 + costEfficiency * 0.1;

  // Predict issues
  const predictedIssues: string[] = [];
  if (accuracy < 60) predictedIssues.push("Low success rate — task may fail");
  if (completeness < 60) predictedIssues.push("High strike rate — multiple attempts likely");
  if (speed < 50) predictedIssues.push("Slow execution expected");
  if (costEfficiency < 50) predictedIssues.push("High cost expected");

  // Recommend verification strategy
  let recommendedVerification: "none" | "quick" | "standard" | "thorough" = "standard";
  if (accuracy > 90 && completeness > 90) {
    recommendedVerification = "quick"; // High confidence, light verification
  } else if (accuracy < 70 || completeness < 70) {
    recommendedVerification = "thorough"; // Low confidence, heavy verification
  }

  // Estimate user satisfaction (combination of accuracy and speed)
  const estimatedUserSatisfaction = accuracy * 0.6 + speed * 0.4;

  console.log(
    `[QUALITY] Prediction: ${overallScore.toFixed(0)}/100 overall (accuracy=${accuracy.toFixed(0)}, completeness=${completeness.toFixed(0)}, confidence=${confidence}%)`
  );

  return {
    overallScore,
    accuracy,
    completeness,
    reliability,
    speed,
    costEfficiency,
    confidence,
    predictedIssues,
    recommendedVerification,
    estimatedUserSatisfaction,
  };
}

/**
 * Record actual quality metrics after task completion
 */
export async function recordActualQuality(
  taskId: string,
  metrics: {
    success: boolean;
    strikes: number;
    durationMs: number;
    costUsd: number;
    verificationPassed: boolean;
    userFeedback?: "positive" | "negative" | "neutral";
  }
): Promise<void> {
  try {
    // Calculate actual scores
    const accuracy = metrics.success ? 100 : 0;
    const completeness = metrics.strikes === 1 ? 100 : Math.max(0, 100 - (metrics.strikes - 1) * 20);
    const speed = metrics.durationMs < 30000 ? 100 : Math.max(0, 100 - (metrics.durationMs / 1000 - 30) * 2);
    const costEfficiency = metrics.costUsd < 0.05 ? 100 : Math.max(0, 100 - (metrics.costUsd - 0.05) * 500);
    const verificationScore = metrics.verificationPassed ? 100 : 0;

    const overallQuality = accuracy * 0.3 + completeness * 0.25 + verificationScore * 0.2 + speed * 0.15 + costEfficiency * 0.1;

    console.log(`[QUALITY] Recorded actual quality: ${overallQuality.toFixed(0)}/100 for task ${taskId.slice(0, 8)}`);

    // Could store in a quality_metrics table for analytics
    // For now, this data is already in tasks table
  } catch (error) {
    console.error("[QUALITY] Error recording quality:", error);
  }
}

/**
 * Compare predicted vs actual quality (for learning)
 */
export async function analyzeQualityPredictionAccuracy(userId: string): Promise<{
  avgPredictionError: number;
  overestimateCount: number;
  underestimateCount: number;
  recommendedAdjustment: number;
}> {
  // This would query historical predictions vs actuals
  // For now, return placeholder
  return {
    avgPredictionError: 10,
    overestimateCount: 20,
    underestimateCount: 15,
    recommendedAdjustment: -5, // Predictions are 5% too high on average
  };
}

/**
 * Suggest quality improvements based on patterns
 */
export async function suggestQualityImprovements(userId: string): Promise<string[]> {
  const suggestions: string[] = [];

  try {
    // Get recent failed tasks
    const { data: failures } = await getSupabaseClient()
      .from("tasks")
      .select("type, status, cascade_level, cost_usd")
      .eq("user_id", userId)
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (failures && failures.length > 0) {
      // Pattern: many failures at low cascade level
      const lowLevelFailures = failures.filter((f) => (f.cascade_level || 0) < 3);
      if (lowLevelFailures.length > failures.length * 0.5) {
        suggestions.push(
          "Many tasks fail at basic execution levels. Consider: (1) Updating credentials, (2) Installing API skills, (3) Checking OAuth connections"
        );
      }

      // Pattern: expensive failures
      const expensiveFailures = failures.filter((f) => (f.cost_usd || 0) > 0.1);
      if (expensiveFailures.length > 5) {
        suggestions.push(
          "Some failures occur after expensive execution. Consider: (1) Better upfront validation, (2) Using cheaper models for planning"
        );
      }

      // Pattern: specific task type failing
      const failuresByType = failures.reduce((acc, f) => {
        const type = f.type || "unknown";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const problematicTypes = Object.entries(failuresByType).filter(([_, count]) => count >= 3);
      if (problematicTypes.length > 0) {
        suggestions.push(
          `Repeated failures for: ${problematicTypes.map(([type]) => type).join(", ")}. Check if these sites require special setup.`
        );
      }
    }

    // Get high-cost tasks
    const { data: expensiveTasks } = await getSupabaseClient()
      .from("tasks")
      .select("type, cost_usd, cascade_level")
      .eq("user_id", userId)
      .gte("cost_usd", 0.15)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(20);

    if (expensiveTasks && expensiveTasks.length > 5) {
      suggestions.push(
        `${expensiveTasks.length} tasks cost over $0.15 each. Install API skills to reduce costs by 90%.`
      );
    }
  } catch (error) {
    console.error("[QUALITY] Error generating suggestions:", error);
  }

  return suggestions;
}

/**
 * Format quality prediction for user notification
 */
export function formatQualityPrediction(prediction: QualityPrediction, taskDescription: string): string {
  let message = `📊 **Quality Prediction**\n\n`;
  message += `Task: "${taskDescription.substring(0, 100)}${taskDescription.length > 100 ? "..." : ""}"\n\n`;

  // Overall score with visual indicator
  const scoreEmoji = prediction.overallScore >= 80 ? "✅" : prediction.overallScore >= 60 ? "⚠️" : "❌";
  message += `${scoreEmoji} Overall Quality: ${prediction.overallScore.toFixed(0)}/100\n`;
  message += `   Confidence: ${prediction.confidence}%\n\n`;

  // Breakdown
  message += `**Breakdown:**\n`;
  message += `• Accuracy: ${prediction.accuracy.toFixed(0)}/100\n`;
  message += `• Completeness: ${prediction.completeness.toFixed(0)}/100\n`;
  message += `• Reliability: ${prediction.reliability.toFixed(0)}/100\n`;
  message += `• Speed: ${prediction.speed.toFixed(0)}/100\n`;
  message += `• Cost Efficiency: ${prediction.costEfficiency.toFixed(0)}/100\n\n`;

  // Issues
  if (prediction.predictedIssues.length > 0) {
    message += `**Potential Issues:**\n`;
    prediction.predictedIssues.forEach((issue) => {
      message += `⚠️ ${issue}\n`;
    });
    message += `\n`;
  }

  // Recommendation
  message += `**Verification:** ${prediction.recommendedVerification}\n`;
  message += `**Estimated Satisfaction:** ${prediction.estimatedUserSatisfaction.toFixed(0)}%\n`;

  return message;
}
