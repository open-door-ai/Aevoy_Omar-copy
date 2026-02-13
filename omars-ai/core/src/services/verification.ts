/**
 * 3-Step Verification System
 * Part of OpenClaw feature set
 *
 * Steps:
 * 1. Self-check (AI evaluates its own work)
 * 2. Evidence (screenshot/logs/data proof)
 * 3. Smart review (Claude validates if <90% confidence)
 */

import { callAI } from './ai.js';

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  evidence: string[];
  review?: string;
}

export async function verify3Step(
  taskDescription: string,
  executionResult: any,
  screenshot?: string
): Promise<VerificationResult> {
  console.log(`[VERIFY] Starting 3-step verification`);

  // Step 1: Self-check
  const selfCheckPrompt = `Task: ${taskDescription}

Result: ${JSON.stringify(executionResult, null, 2)}

Did this execution successfully complete the task? Rate confidence 0-100.
Respond in JSON: { "success": boolean, "confidence": number, "reasoning": "..." }`;

  const selfCheck = await callAI(selfCheckPrompt, 'You are a task verifier. Be honest and critical.', 'validate');

  let selfCheckData: any;
  try {
    const jsonMatch = selfCheck.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      selfCheckData = JSON.parse(jsonMatch[0]);
    } else {
      selfCheckData = { success: false, confidence: 0, reasoning: 'Could not parse self-check' };
    }
  } catch {
    selfCheckData = { success: false, confidence: 0, reasoning: 'Invalid JSON response' };
  }

  console.log(`[VERIFY] Self-check: ${selfCheckData.confidence}% confidence`);

  const evidence: string[] = [
    `Self-check: ${selfCheckData.reasoning}`,
  ];

  // Step 2: Evidence
  if (screenshot) {
    evidence.push(`Screenshot captured: ${screenshot.length} bytes`);
    console.log(`[VERIFY] Evidence: Screenshot available`);
  }

  if (executionResult.finalUrl) {
    evidence.push(`Final URL: ${executionResult.finalUrl}`);
  }

  if (executionResult.stepsCompleted) {
    evidence.push(`Steps completed: ${executionResult.stepsCompleted}`);
  }

  // Step 3: Smart review (only if confidence < 90%)
  let review: string | undefined;

  if (selfCheckData.confidence < 90) {
    console.log(`[VERIFY] Confidence below 90%, triggering smart review`);

    const reviewPrompt = `Task: ${taskDescription}

Execution result: ${JSON.stringify(executionResult, null, 2)}

Self-check confidence: ${selfCheckData.confidence}%
Self-check reasoning: ${selfCheckData.reasoning}

Evidence:
${evidence.join('\n')}

As an independent reviewer, do you believe this task was successfully completed?
Provide a final verdict: SUCCESS or FAILURE and explain why.`;

    const reviewResponse = await callAI(reviewPrompt, 'You are an independent task reviewer. Be thorough and fair.', 'reason');
    review = reviewResponse.content;

    evidence.push(`Smart review: ${review}`);
    console.log(`[VERIFY] Smart review complete`);
  }

  const finalConfidence = selfCheckData.confidence < 90 && review?.includes('SUCCESS')
    ? 95
    : selfCheckData.confidence;

  return {
    verified: selfCheckData.success && finalConfidence >= 70,
    confidence: finalConfidence,
    evidence,
    review,
  };
}
