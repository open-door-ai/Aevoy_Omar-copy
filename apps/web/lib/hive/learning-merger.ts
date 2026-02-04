import type { GeneratedLearning } from './learning-generator';

interface ExistingLearning {
  id: string;
  service: string;
  task_type: string;
  title: string;
  steps: string[];
  gotchas: string[];
  success_rate: number;
  total_attempts: number;
  total_successes: number;
  avg_duration_seconds: number | null;
  difficulty: string;
  requires_login: boolean;
  requires_2fa: boolean;
  tags: string[];
  is_warning: boolean;
  warning_details: string | null;
  merged_count: number;
}

interface MergeResult {
  shouldMerge: boolean;
  mergedData?: Partial<ExistingLearning>;
}

/**
 * Merge new learning data into an existing learning record.
 * Updates success rates, adds new gotchas, refreshes timestamps.
 */
export function mergeLearning(
  existing: ExistingLearning,
  newLearning: GeneratedLearning,
  newOutcome: 'success' | 'failure'
): MergeResult {
  const newAttempts = existing.total_attempts + 1;
  const newSuccesses = existing.total_successes + (newOutcome === 'success' ? 1 : 0);
  const newSuccessRate = Math.round((newSuccesses / newAttempts) * 10000) / 100;

  // Merge gotchas: add any new ones that don't already exist
  const existingGotchasLower = existing.gotchas.map(g => g.toLowerCase());
  const newGotchas = [
    ...existing.gotchas,
    ...(newLearning.gotchas || []).filter(
      g => !existingGotchasLower.some(eg => eg.includes(g.toLowerCase().slice(0, 30)))
    ),
  ];

  // Merge tags
  const allTags = [...new Set([...existing.tags, ...newLearning.tags])];

  // Update average duration (running average)
  const existingDuration = existing.avg_duration_seconds || newLearning.avg_duration_seconds;
  const newAvgDuration = Math.round(
    (existingDuration * existing.merged_count + newLearning.avg_duration_seconds) /
    (existing.merged_count + 1)
  );

  // Use the more detailed steps if new learning has more
  const steps = newLearning.steps.length > existing.steps.length
    ? newLearning.steps
    : existing.steps;

  // Use the harder difficulty (keep the worst case)
  const difficultyOrder = ['easy', 'medium', 'hard', 'nightmare'];
  const existingDiffIdx = difficultyOrder.indexOf(existing.difficulty);
  const newDiffIdx = difficultyOrder.indexOf(newLearning.difficulty);
  const difficulty = difficultyOrder[Math.max(existingDiffIdx, newDiffIdx)];

  // Merge warning status
  const isWarning = existing.is_warning || newLearning.is_warning;
  const warningDetails = newLearning.is_warning
    ? newLearning.warning_details || existing.warning_details
    : existing.warning_details;

  return {
    shouldMerge: true,
    mergedData: {
      steps,
      gotchas: newGotchas,
      success_rate: newSuccessRate,
      total_attempts: newAttempts,
      total_successes: newSuccesses,
      avg_duration_seconds: newAvgDuration,
      difficulty,
      requires_login: existing.requires_login || newLearning.requires_login,
      requires_2fa: existing.requires_2fa || newLearning.requires_2fa,
      tags: allTags,
      is_warning: isWarning,
      warning_details: warningDetails,
      merged_count: existing.merged_count + 1,
    },
  };
}
