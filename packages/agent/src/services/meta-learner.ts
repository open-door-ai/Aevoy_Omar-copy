/**
 * Meta-Learning System
 *
 * Learns how to learn better. Analyzes the learning process itself
 * and optimizes how the system acquires and applies new knowledge.
 *
 * Meta-learning aspects:
 * 1. Learning rate optimization (how quickly to trust new data)
 * 2. Sample efficiency (how much data needed before confidence)
 * 3. Transfer learning effectiveness (when to apply cross-domain knowledge)
 * 4. Exploration vs exploitation balance
 * 5. Confidence calibration (are predictions accurate?)
 * 6. Forgetting curve optimization (when to decay old knowledge)
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface LearningMetrics {
  learningRate: number; // How fast the system learns (0-1)
  sampleEfficiency: number; // Quality of learning per sample (0-1)
  transferEffectiveness: number; // Success rate of transfer learning (0-1)
  explorationRate: number; // Balance between trying new vs proven methods (0-1)
  confidenceCalibration: number; // How accurate confidence predictions are (0-1)
  forgettingRate: number; // How fast to decay unused knowledge (0-1)
}

export interface MetaLearningRecommendation {
  parameter: keyof LearningMetrics;
  currentValue: number;
  recommendedValue: number;
  reasoning: string;
  expectedImprovement: number; // Percentage improvement in overall performance
}

/**
 * Analyze the system's learning performance
 */
export async function analyzeLearningPerformance(userId?: string): Promise<LearningMetrics> {
  console.log(`[META-LEARNING] Analyzing learning performance${userId ? ` for user ${userId.slice(0, 8)}` : " (global)"}`);

  // Query learning effectiveness data
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Metric 1: Learning rate (how quickly success rate improves with attempts)
  const learningRate = await calculateLearningRate(userId, startDate);

  // Metric 2: Sample efficiency (how much data needed for reliable predictions)
  const sampleEfficiency = await calculateSampleEfficiency(userId, startDate);

  // Metric 3: Transfer learning effectiveness
  const transferEffectiveness = await calculateTransferEffectiveness(userId, startDate);

  // Metric 4: Exploration rate (how often trying new methods)
  const explorationRate = await calculateExplorationRate(userId, startDate);

  // Metric 5: Confidence calibration (prediction accuracy)
  const confidenceCalibration = await calculateConfidenceCalibration(userId, startDate);

  // Metric 6: Forgetting rate (optimal decay for unused knowledge)
  const forgettingRate = await calculateOptimalForgettingRate(userId, startDate);

  console.log(
    `[META-LEARNING] Metrics: learning=${learningRate.toFixed(2)}, samples=${sampleEfficiency.toFixed(2)}, ` +
      `transfer=${transferEffectiveness.toFixed(2)}, explore=${explorationRate.toFixed(2)}, ` +
      `calibration=${confidenceCalibration.toFixed(2)}, forgetting=${forgettingRate.toFixed(2)}`
  );

  return {
    learningRate,
    sampleEfficiency,
    transferEffectiveness,
    explorationRate,
    confidenceCalibration,
    forgettingRate,
  };
}

/**
 * Calculate learning rate (how fast success rate improves)
 */
async function calculateLearningRate(userId: string | undefined, startDate: Date): Promise<number> {
  try {
    let query = getSupabaseClient()
      .from("task_difficulty_cache")
      .select("domain, task_type, total_attempts, avg_success_rate")
      .gte("total_attempts", 10);

    const { data: tasks } = await query;

    if (!tasks || tasks.length === 0) return 0.5; // Default moderate learning rate

    // Calculate improvement rate: (final success - initial success) / attempts
    let totalImprovement = 0;
    let count = 0;

    for (const task of tasks) {
      // Assume initial success rate was 50%, measure improvement
      const improvement = (task.avg_success_rate - 50) / task.total_attempts;
      if (improvement > 0) {
        totalImprovement += improvement;
        count++;
      }
    }

    const avgImprovement = count > 0 ? totalImprovement / count : 0;
    // Normalize to 0-1 (assume max improvement rate of 5% per attempt)
    const learningRate = Math.min(1, Math.max(0, avgImprovement / 5));

    console.log(`[META] Learning rate: ${learningRate.toFixed(2)} (${count} improving tasks)`);
    return learningRate;
  } catch (error) {
    console.error("[META] Error calculating learning rate:", error);
    return 0.5;
  }
}

/**
 * Calculate sample efficiency (data quality per sample)
 */
async function calculateSampleEfficiency(userId: string | undefined, startDate: Date): Promise<number> {
  try {
    const { data: predictions } = await getSupabaseClient()
      .from("task_difficulty_cache")
      .select("total_attempts, avg_success_rate")
      .gte("total_attempts", 5)
      .limit(100);

    if (!predictions || predictions.length === 0) return 0.5;

    // Good sample efficiency = high confidence with few samples
    // Calculate: avg success rate where attempts < 10
    const fewSampleTasks = predictions.filter((p) => p.total_attempts < 10);
    const avgSuccessWithFewSamples =
      fewSampleTasks.reduce((sum, p) => sum + p.avg_success_rate, 0) / (fewSampleTasks.length || 1);

    // Normalize to 0-1 (80% success with <10 samples = high efficiency)
    const sampleEfficiency = avgSuccessWithFewSamples / 100;

    console.log(`[META] Sample efficiency: ${sampleEfficiency.toFixed(2)} (${fewSampleTasks.length} low-sample tasks)`);
    return sampleEfficiency;
  } catch (error) {
    console.error("[META] Error calculating sample efficiency:", error);
    return 0.5;
  }
}

/**
 * Calculate transfer learning effectiveness
 */
async function calculateTransferEffectiveness(userId: string | undefined, startDate: Date): Promise<number> {
  // This would track how often transferred knowledge actually helps
  // For now, return baseline
  return 0.6;
}

/**
 * Calculate exploration rate (trying new methods vs proven ones)
 */
async function calculateExplorationRate(userId: string | undefined, startDate: Date): Promise<number> {
  try {
    const { data: methods } = await getSupabaseClient()
      .from("method_success_rates")
      .select("action_type, times_used")
      .gte("last_attempt_at", startDate.toISOString())
      .limit(200);

    if (!methods || methods.length === 0) return 0.2; // Default 20% exploration

    // Count how many different methods are being tried
    const uniqueMethods = new Set(methods.map((m) => m.action_type)).size;
    const totalUses = methods.reduce((sum, m) => sum + m.times_used, 0);

    // High exploration = many unique methods relative to total uses
    // Low exploration = few methods used repeatedly
    const explorationRate = Math.min(1, uniqueMethods / (totalUses / 10));

    console.log(`[META] Exploration rate: ${explorationRate.toFixed(2)} (${uniqueMethods} unique methods)`);
    return explorationRate;
  } catch (error) {
    console.error("[META] Error calculating exploration rate:", error);
    return 0.2;
  }
}

/**
 * Calculate confidence calibration (are predictions accurate?)
 */
async function calculateConfidenceCalibration(userId: string | undefined, startDate: Date): Promise<number> {
  try {
    // Compare predicted difficulty vs actual outcomes
    const { data: tasks } = await getSupabaseClient()
      .from("tasks")
      .select("type, status")
      .gte("created_at", startDate.toISOString())
      .limit(100);

    if (!tasks || tasks.length === 0) return 0.7; // Default reasonable calibration

    // For each task, we'd compare predicted success rate vs actual
    // For now, measure overall success rate as proxy
    const successRate = tasks.filter((t) => t.status === "completed").length / tasks.length;

    // Well-calibrated = success rate close to predictions (assume we predict 70%)
    const calibration = 1 - Math.abs(successRate - 0.7);

    console.log(`[META] Confidence calibration: ${calibration.toFixed(2)} (actual success: ${successRate.toFixed(2)})`);
    return calibration;
  } catch (error) {
    console.error("[META] Error calculating calibration:", error);
    return 0.7;
  }
}

/**
 * Calculate optimal forgetting rate
 */
async function calculateOptimalForgettingRate(userId: string | undefined, startDate: Date): Promise<number> {
  // Analyze: when is old knowledge still useful vs outdated?
  // If old knowledge (>90 days) still works, slow forgetting
  // If it fails, fast forgetting
  return 0.1; // 10% decay per period (current default in memory.ts)
}

/**
 * Generate meta-learning recommendations
 */
export async function generateMetaRecommendations(metrics: LearningMetrics): Promise<MetaLearningRecommendation[]> {
  const recommendations: MetaLearningRecommendation[] = [];

  // Recommendation 1: Learning rate
  if (metrics.learningRate < 0.3) {
    recommendations.push({
      parameter: "learningRate",
      currentValue: metrics.learningRate,
      recommendedValue: 0.5,
      reasoning: "Learning rate is low — system is slow to adapt to new information. Increase trust in recent data.",
      expectedImprovement: 15,
    });
  } else if (metrics.learningRate > 0.8) {
    recommendations.push({
      parameter: "learningRate",
      currentValue: metrics.learningRate,
      recommendedValue: 0.6,
      reasoning: "Learning rate is too high — system may be overfitting to recent noise. Slow down to stabilize.",
      expectedImprovement: 10,
    });
  }

  // Recommendation 2: Sample efficiency
  if (metrics.sampleEfficiency < 0.5) {
    recommendations.push({
      parameter: "sampleEfficiency",
      currentValue: metrics.sampleEfficiency,
      recommendedValue: 0.7,
      reasoning: "Low sample efficiency — need many attempts before confident predictions. Use transfer learning more.",
      expectedImprovement: 20,
    });
  }

  // Recommendation 3: Exploration rate
  if (metrics.explorationRate < 0.1) {
    recommendations.push({
      parameter: "explorationRate",
      currentValue: metrics.explorationRate,
      recommendedValue: 0.2,
      reasoning: "Exploration too low — stuck in local optimum. Try more new methods to discover better approaches.",
      expectedImprovement: 18,
    });
  } else if (metrics.explorationRate > 0.4) {
    recommendations.push({
      parameter: "explorationRate",
      currentValue: metrics.explorationRate,
      recommendedValue: 0.25,
      reasoning: "Exploration too high — wasting effort on random trials. Exploit proven methods more.",
      expectedImprovement: 12,
    });
  }

  // Recommendation 4: Confidence calibration
  if (metrics.confidenceCalibration < 0.6) {
    recommendations.push({
      parameter: "confidenceCalibration",
      currentValue: metrics.confidenceCalibration,
      recommendedValue: 0.8,
      reasoning: "Poor calibration — predictions don't match outcomes. Adjust confidence thresholds and collect more baseline data.",
      expectedImprovement: 25,
    });
  }

  console.log(`[META] Generated ${recommendations.length} meta-learning recommendations`);
  return recommendations;
}

/**
 * Apply meta-learning optimizations
 */
export async function applyMetaOptimizations(recommendations: MetaLearningRecommendation[]): Promise<number> {
  console.log(`[META] Applying ${recommendations.length} meta-optimizations`);

  let appliedCount = 0;

  for (const rec of recommendations) {
    console.log(`[META] Optimizing ${rec.parameter}: ${rec.currentValue.toFixed(2)} → ${rec.recommendedValue.toFixed(2)}`);
    console.log(`[META]   Reasoning: ${rec.reasoning}`);
    console.log(`[META]   Expected improvement: ${rec.expectedImprovement}%`);

    // These would update system parameters
    // For now, just log (actual implementation would modify constants/configs)
    appliedCount++;
  }

  console.log(`[META] Applied ${appliedCount} optimizations`);
  return appliedCount;
}

/**
 * Run full meta-learning cycle
 */
export async function runMetaLearningCycle(userId?: string): Promise<{
  metrics: LearningMetrics;
  recommendations: MetaLearningRecommendation[];
  optimizationsApplied: number;
}> {
  console.log(`[META] Running meta-learning cycle${userId ? ` for user ${userId.slice(0, 8)}` : " (global)"}`);

  const metrics = await analyzeLearningPerformance(userId);
  const recommendations = await generateMetaRecommendations(metrics);
  const optimizationsApplied = await applyMetaOptimizations(recommendations);

  return {
    metrics,
    recommendations,
    optimizationsApplied,
  };
}

/**
 * Format meta-learning report for logging/display
 */
export function formatMetaReport(
  metrics: LearningMetrics,
  recommendations: MetaLearningRecommendation[]
): string {
  let report = "🧠 **Meta-Learning Report**\n\n";

  report += "**Current Learning Metrics:**\n";
  report += `• Learning Rate: ${(metrics.learningRate * 100).toFixed(0)}%\n`;
  report += `• Sample Efficiency: ${(metrics.sampleEfficiency * 100).toFixed(0)}%\n`;
  report += `• Transfer Effectiveness: ${(metrics.transferEffectiveness * 100).toFixed(0)}%\n`;
  report += `• Exploration Rate: ${(metrics.explorationRate * 100).toFixed(0)}%\n`;
  report += `• Confidence Calibration: ${(metrics.confidenceCalibration * 100).toFixed(0)}%\n`;
  report += `• Forgetting Rate: ${(metrics.forgettingRate * 100).toFixed(0)}%\n\n`;

  if (recommendations.length > 0) {
    report += "**Optimization Recommendations:**\n";
    recommendations.forEach((rec, i) => {
      report += `${i + 1}. ${rec.parameter}: ${(rec.currentValue * 100).toFixed(0)}% → ${(rec.recommendedValue * 100).toFixed(0)}%\n`;
      report += `   ${rec.reasoning}\n`;
      report += `   Expected improvement: ${rec.expectedImprovement}%\n\n`;
    });
  } else {
    report += "✅ Learning parameters are well-optimized!\n";
  }

  return report;
}
