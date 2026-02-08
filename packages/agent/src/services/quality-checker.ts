/**
 * Quality Checker - Stripe-Style AI Verification
 * 
 * Enforces 99th percentile quality for complex tasks
 * Iterative improvement until threshold met
 * No result returned until quality verified
 */

import { generateResponse, generateVisionResponse } from "./ai.js";
import { Page } from "playwright";

interface QualityCheck {
  passed: boolean;
  score: number; // 0-100
  percentile: number;
  breakdown: {
    completeness: number;
    accuracy: number;
    security: number;
    efficiency: number;
    userIntent: number;
  };
  feedback: string;
  improvementPrompt: string;
  evidence: {
    screenshots?: string[];
    logs?: string[];
    apiResponses?: any[];
  };
}

interface QualityThreshold {
  simple: 90;
  medium: 95;
  complex: 99;
  critical: 99.9;
}

const THRESHOLDS: QualityThreshold = {
  simple: 90,
  medium: 95,
  complex: 99,
  critical: 99.9,
};

export class QualityChecker {
  /**
   * Verify task result meets quality threshold
   * Iteratively improves until threshold met or max attempts
   */
  async verifyWithImprovement(
    taskType: "simple" | "medium" | "complex" | "critical",
    originalTask: string,
    result: any,
    page: Page | null,
    maxAttempts: number = 5
  ): Promise<{ success: boolean; finalResult: any; quality: QualityCheck; attempts: number }> {
    const threshold = THRESHOLDS[taskType];
    let currentResult = result;
    let bestQuality: QualityCheck | null = null;
    let attempts = 0;

    console.log(`[QUALITY] Verifying ${taskType} task with ${threshold}th percentile threshold`);

    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      // Perform quality check
      const quality = await this.checkQuality(originalTask, currentResult, page);
      
      console.log(`[QUALITY] Attempt ${attempts}/${maxAttempts}: Score ${quality.score}/100 (${quality.percentile}th percentile)`);

      // Track best result
      if (!bestQuality || quality.score > bestQuality.score) {
        bestQuality = quality;
      }

      // Check if threshold met
      if (quality.percentile >= threshold) {
        console.log(`[QUALITY] ✓ Threshold met at ${quality.percentile}th percentile`);
        return { success: true, finalResult: currentResult, quality, attempts };
      }

      // Max attempts reached
      if (attempts >= maxAttempts) {
        console.log(`[QUALITY] ✗ Max attempts reached. Best: ${bestQuality.percentile}th percentile`);
        return { 
          success: false, 
          finalResult: currentResult, 
          quality: bestQuality, 
          attempts 
        };
      }

      // Improve result
      console.log(`[QUALITY] Improving... Feedback: ${quality.feedback.substring(0, 100)}...`);
      currentResult = await this.improveResult(originalTask, currentResult, quality.improvementPrompt, page);
    }

    return { success: false, finalResult: currentResult, quality: bestQuality!, attempts };
  }

  /**
   * Multi-dimensional quality check
   */
  private async checkQuality(
    originalTask: string,
    result: any,
    page: Page | null
  ): Promise<QualityCheck> {
    const [completeness, accuracy, security, efficiency, userIntent] = await Promise.all([
      this.checkCompleteness(originalTask, result),
      this.checkAccuracy(originalTask, result, page),
      this.checkSecurity(originalTask, result),
      this.checkEfficiency(result),
      this.checkUserIntentMatch(originalTask, result),
    ]);

    // Weighted average
    const weights = { completeness: 0.25, accuracy: 0.30, security: 0.20, efficiency: 0.10, userIntent: 0.15 };
    const score = Math.round(
      completeness * weights.completeness +
      accuracy * weights.accuracy +
      security * weights.security +
      efficiency * weights.efficiency +
      userIntent * weights.userIntent
    );

    const percentile = this.scoreToPercentile(score);

    // Generate feedback
    const feedback = this.generateFeedback({ completeness, accuracy, security, efficiency, userIntent });
    const improvementPrompt = this.generateImprovementPrompt(originalTask, result, { completeness, accuracy, security, efficiency, userIntent });

    return {
      passed: false, // Will be set by caller based on threshold
      score,
      percentile,
      breakdown: { completeness, accuracy, security, efficiency, userIntent },
      feedback,
      improvementPrompt,
      evidence: {
        screenshots: page ? [await this.getScreenshot(page)] : undefined,
      },
    };
  }

  /**
   * Check completeness - did we do everything required?
   */
  private async checkCompleteness(originalTask: string, result: any): Promise<number> {
    const prompt = `
Task: "${originalTask}"

Result: ${JSON.stringify(result)}

Rate the COMPLETENESS (0-100):
- Did all required actions get performed?
- Are there any missing steps?
- Is the task fully finished or partially done?

Respond with ONLY a number 0-100.
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Quality Check",
      prompt,
      "system"
    );

    const match = response.content.match(/(\d+)/);
    return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : 50;
  }

  /**
   * Check accuracy - are the results correct?
   */
  private async checkAccuracy(originalTask: string, result: any, page: Page | null): Promise<number> {
    let evidence = "";
    
    if (page) {
      const screenshot = await this.getScreenshot(page);
      const visionCheck = await generateVisionResponse(
        `Verify this result is correct for task: "${originalTask}"`,
        screenshot,
        "You are verifying task completion. Rate confidence 0-100."
      );
      evidence = visionCheck.content;
    }

    const prompt = `
Task: "${originalTask}"
Result: ${JSON.stringify(result)}
${evidence ? `Visual Evidence: ${evidence}` : ""}

Rate the ACCURACY (0-100):
- Are the facts/data correct?
- Were the right actions taken?
- Any errors or mistakes?

Respond with ONLY a number 0-100.
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Quality Check",
      prompt,
      "system"
    );

    const match = response.content.match(/(\d+)/);
    return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : 50;
  }

  /**
   * Check security - no vulnerabilities introduced?
   */
  private async checkSecurity(originalTask: string, result: any): Promise<number> {
    const prompt = `
Task: "${originalTask}"
Result: ${JSON.stringify(result)}

Rate the SECURITY (0-100):
- Were credentials handled safely?
- Any suspicious redirects or phishing?
- Were permissions appropriate?
- Any data leakage risks?

Respond with ONLY a number 0-100.
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Security Check",
      prompt,
      "system"
    );

    const match = response.content.match(/(\d+)/);
    return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : 50;
  }

  /**
   * Check efficiency - optimal path taken?
   */
  private async checkEfficiency(result: any): Promise<number> {
    const steps = result.steps?.length || 1;
    const time = result.durationMs || 60000;
    
    // Heuristic scoring
    let score = 100;
    if (steps > 20) score -= 20;
    if (steps > 10) score -= 10;
    if (time > 300000) score -= 15; // >5 min
    if (time > 60000) score -= 5;  // >1 min

    return Math.max(0, score);
  }

  /**
   * Check user intent match - did we do what they wanted?
   */
  private async checkUserIntentMatch(originalTask: string, result: any): Promise<number> {
    const prompt = `
Original Request: "${originalTask}"
What We Did: ${JSON.stringify(result)}

Rate the USER INTENT MATCH (0-100):
- Did we solve the actual problem?
- Is the result what the user wanted?
- Any misinterpretations?

Respond with ONLY a number 0-100.
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Intent Check",
      prompt,
      "system"
    );

    const match = response.content.match(/(\d+)/);
    return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : 50;
  }

  /**
   * Improve result based on feedback
   */
  private async improveResult(
    originalTask: string,
    currentResult: any,
    improvementPrompt: string,
    page: Page | null
  ): Promise<any> {
    const prompt = `
${improvementPrompt}

Original Task: "${originalTask}"
Current Result: ${JSON.stringify(currentResult)}

Provide the IMPROVED result only.
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Improve Result",
      prompt,
      "system"
    );

    try {
      // Try to parse as JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Return as text result
    }

    return { ...currentResult, improvedContent: response.content };
  }

  /**
   * Generate human-readable feedback
   */
  private generateFeedback(breakdown: QualityCheck["breakdown"]): string {
    const issues: string[] = [];
    
    if (breakdown.completeness < 90) issues.push("Task may be incomplete");
    if (breakdown.accuracy < 90) issues.push("Accuracy concerns");
    if (breakdown.security < 90) issues.push("Security review needed");
    if (breakdown.efficiency < 70) issues.push("Could be more efficient");
    if (breakdown.userIntent < 90) issues.push("May not match user intent");

    if (issues.length === 0) return "High quality result";
    return issues.join("; ");
  }

  /**
   * Generate improvement prompt for AI
   */
  private generateImprovementPrompt(
    originalTask: string,
    result: any,
    breakdown: QualityCheck["breakdown"]
  ): string {
    const fixes: string[] = [];

    if (breakdown.completeness < 90) {
      fixes.push("- Ensure ALL required steps are completed");
      fixes.push("- Verify nothing was skipped");
    }
    if (breakdown.accuracy < 90) {
      fixes.push("- Double-check all facts and data");
      fixes.push("- Verify results are correct");
    }
    if (breakdown.security < 90) {
      fixes.push("- Review security of actions taken");
      fixes.push("- Ensure credentials were handled safely");
    }
    if (breakdown.efficiency < 70) {
      fixes.push("- Optimize the execution path");
      fixes.push("- Remove unnecessary steps");
    }
    if (breakdown.userIntent < 90) {
      fixes.push("- Re-read the original request carefully");
      fixes.push("- Ensure we're solving the right problem");
    }

    return `QUALITY ISSUES IDENTIFIED:
${fixes.join("\n")}

Please fix these issues and provide an improved result.`;
  }

  /**
   * Convert score to percentile
   */
  private scoreToPercentile(score: number): number {
    // Rough approximation of percentile from score
    if (score >= 99) return 99.9;
    if (score >= 95) return 99;
    if (score >= 90) return 95;
    if (score >= 80) return 90;
    if (score >= 70) return 80;
    if (score >= 60) return 70;
    return 50;
  }

  private async getScreenshot(page: Page): Promise<string> {
    const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
    return buffer.toString("base64");
  }
}

export const qualityChecker = new QualityChecker();
