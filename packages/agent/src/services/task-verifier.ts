/**
 * 3-Step Task Verification System
 *
 * Ensures every task passes verification before returning to user.
 *
 * Step 1: Self-Check — Gemini Flash (free) reviews screenshot
 * Step 2: Evidence Check — Code-based proof checking (no AI needed)
 * Step 3: Smart Review — Claude Sonnet reviews if confidence < 90%
 */

import type { Page } from "playwright";
import { quickValidate, generateVisionResponse } from "./ai.js";
import type { VerificationResult, QualityTier } from "../types/index.js";

// ---- Task-Specific Verification Criteria ----

interface VerificationCriteria {
  successIndicators: string[];
  errorIndicators: string[];
  evidencePatterns: RegExp[];
  requiresScreenshot: boolean;
}

const VERIFICATION_CRITERIA: Record<string, VerificationCriteria> = {
  booking: {
    successIndicators: [
      "confirmation",
      "confirmed",
      "reserved",
      "booked",
      "reservation number",
      "booking reference",
      "thank you for your reservation",
    ],
    errorIndicators: [
      "not available",
      "sold out",
      "no availability",
      "try another",
      "error",
      "failed",
    ],
    evidencePatterns: [
      /confirmation\s*(?:#|number|code|id)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /reference\s*(?:#|number|code|id)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /booking\s*(?:#|number|code|id)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /reservation\s*(?:#|number|code|id)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
    ],
    requiresScreenshot: true,
  },
  email: {
    successIndicators: ["sent", "delivered", "message sent", "email sent"],
    errorIndicators: ["failed to send", "not delivered", "bounced", "error sending"],
    evidencePatterns: [/sent\s+to\s+([^\s]+@[^\s]+)/i],
    requiresScreenshot: false,
  },
  form: {
    successIndicators: [
      "success",
      "submitted",
      "thank you",
      "received",
      "form submitted",
      "application received",
    ],
    errorIndicators: [
      "required",
      "invalid",
      "error",
      "please fill",
      "missing",
      "incorrect",
    ],
    evidencePatterns: [
      /submitted\s+successfully/i,
      /thank\s+you\s+for\s+(your\s+)?submission/i,
    ],
    requiresScreenshot: true,
  },
  login: {
    successIndicators: [
      "dashboard",
      "welcome",
      "account",
      "profile",
      "home",
      "inbox",
      "logged in",
    ],
    errorIndicators: [
      "invalid password",
      "incorrect",
      "wrong password",
      "login failed",
      "try again",
    ],
    evidencePatterns: [/welcome,?\s+(\w+)/i, /logged\s+in\s+as\s+(\w+)/i],
    requiresScreenshot: true,
  },
  purchase: {
    successIndicators: [
      "order confirmed",
      "purchase complete",
      "order number",
      "order placed",
      "receipt",
      "payment successful",
    ],
    errorIndicators: [
      "payment failed",
      "declined",
      "insufficient",
      "error processing",
      "card declined",
    ],
    evidencePatterns: [
      /order\s*(?:#|number|id)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /total\s*[:.]?\s*\$?([\d,.]+)/i,
    ],
    requiresScreenshot: true,
  },
  download: {
    successIndicators: ["downloaded", "download complete", "file saved"],
    errorIndicators: ["download failed", "file not found", "404", "access denied"],
    evidencePatterns: [/downloaded?\s+(.+\.\w{2,4})/i],
    requiresScreenshot: false,
  },
  calendar: {
    successIndicators: [
      "event created",
      "added to calendar",
      "scheduled",
      "event saved",
    ],
    errorIndicators: ["conflict", "overlap", "could not create", "error"],
    evidencePatterns: [
      /event\s+(?:created|added|saved)/i,
      /scheduled\s+for\s+(.+)/i,
    ],
    requiresScreenshot: false,
  },
  research: {
    successIndicators: ["results", "found", "here are", "summary"],
    errorIndicators: ["no results", "not found", "error"],
    evidencePatterns: [],
    requiresScreenshot: false,
  },
  shopping: {
    successIndicators: [
      "added to cart",
      "add to bag",
      "in your cart",
      "cart updated",
      "added to basket",
      "checkout",
      "view cart",
    ],
    errorIndicators: [
      "out of stock",
      "unavailable",
      "sold out",
      "error",
      "could not add",
    ],
    evidencePatterns: [
      /added?\s+to\s+(your\s+)?cart/i,
      /cart\s*\(\d+\)/i,
      /bag\s*\(\d+\)/i,
    ],
    requiresScreenshot: true,
  },
  payment: {
    successIndicators: [
      "payment successful",
      "payment confirmed",
      "transaction complete",
      "receipt",
      "paid",
      "charge confirmed",
    ],
    errorIndicators: [
      "payment failed",
      "declined",
      "insufficient funds",
      "card declined",
      "transaction failed",
      "payment error",
    ],
    evidencePatterns: [
      /transaction\s*(?:#|id|number)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /receipt\s*(?:#|number)?\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /amount\s*(?:charged|paid)?\s*[:.]?\s*\$?([\d,.]+)/i,
    ],
    requiresScreenshot: true,
  },
  account_creation: {
    successIndicators: [
      "account created",
      "welcome",
      "registration complete",
      "verify your email",
      "sign up successful",
      "congratulations",
    ],
    errorIndicators: [
      "already exists",
      "email taken",
      "username taken",
      "registration failed",
      "try again",
    ],
    evidencePatterns: [
      /account\s+(?:created|registered)\s+successfully/i,
      /welcome,?\s+(\w+)/i,
    ],
    requiresScreenshot: true,
  },
  '2fa_completion': {
    successIndicators: [
      "verified",
      "authentication successful",
      "identity confirmed",
      "logged in",
      "dashboard",
      "welcome back",
    ],
    errorIndicators: [
      "invalid code",
      "expired",
      "incorrect code",
      "try again",
      "too many attempts",
    ],
    evidencePatterns: [
      /(?:verified|authenticated)\s+successfully/i,
    ],
    requiresScreenshot: true,
  },
};

// ---- Quality Tiers ----

export const QUALITY_TIERS: Record<QualityTier, { target: number; maxStrikes: number; alwaysVision: boolean }> = {
  financial:      { target: 99, maxStrikes: 3, alwaysVision: true },
  browser_action: { target: 95, maxStrikes: 3, alwaysVision: false },
  communication:  { target: 90, maxStrikes: 2, alwaysVision: false },
  research:       { target: 80, maxStrikes: 2, alwaysVision: false },
  simple:         { target: 70, maxStrikes: 1, alwaysVision: false },
};

export function getQualityTier(taskType: string): QualityTier {
  switch (taskType) {
    case 'purchase':
    case 'payment':
      return 'financial';
    case 'booking':
    case 'form':
    case 'login':
    case 'shopping':
    case 'account_creation':
    case '2fa_completion':
      return 'browser_action';
    case 'email':
    case 'calendar':
      return 'communication';
    case 'research':
    case 'download':
      return 'research';
    default:
      return 'simple';
  }
}

// ---- Correction Hint Generation ----

function generateCorrectionHints(
  selfCheckResult: VerificationResult,
  evidenceResult: VerificationResult,
  pageText: string,
  actionSuccessRate: number
): string[] {
  const hints: string[] = [];
  const criteria = VERIFICATION_CRITERIA[selfCheckResult.method] || VERIFICATION_CRITERIA.form;

  // Check for error indicators on page
  const textLower = pageText.toLowerCase();
  const foundErrors = (criteria?.errorIndicators || []).filter(e => textLower.includes(e.toLowerCase()));
  if (foundErrors.length > 0) {
    hints.push(`Error indicators found on page: ${foundErrors.join(', ')}`);
  }

  // No confirmation evidence
  if (evidenceResult.confidence < 50) {
    hints.push('No confirmation/evidence found — task may not have completed');
  }

  // Low action success rate
  if (actionSuccessRate < 80) {
    const failedPct = 100 - actionSuccessRate;
    hints.push(`Action success rate low (${actionSuccessRate}%) — ${failedPct}% of actions failed`);
  }

  // Self-check specific hints
  if (selfCheckResult.evidence) {
    hints.push(selfCheckResult.evidence);
  }

  return hints;
}

// ---- Composite Scoring ----

function computeCompositeScore(
  selfCheckScore: number,
  evidenceScore: number,
  actionSuccessRate: number | undefined,
  needsBrowser: boolean
): number {
  if (needsBrowser && actionSuccessRate !== undefined) {
    return Math.round(selfCheckScore * 0.3 + evidenceScore * 0.3 + actionSuccessRate * 0.4);
  }
  return Math.round(selfCheckScore * 0.55 + evidenceScore * 0.45);
}

// ---- Main Verification Function ----

/**
 * Run 3-step verification on a completed task.
 * Returns verification result with confidence score and correction hints.
 */
export async function verifyTask(
  taskType: string,
  page: Page | null,
  responseText: string,
  additionalContext?: string,
  actionSuccessRate?: number
): Promise<VerificationResult> {
  const criteria = VERIFICATION_CRITERIA[taskType] || VERIFICATION_CRITERIA.form;
  const needsBrowser = !!page;

  // Step 1: Self-Check (using page text or response text)
  const step1 = await selfCheck(page, responseText, criteria);

  // Step 2: Evidence Check (code-based, no AI)
  const step2 = await evidenceCheck(page, responseText, criteria);

  // Compute composite score incorporating action success rate for browser tasks
  let compositeScore = computeCompositeScore(
    step1.confidence,
    step2.confidence,
    actionSuccessRate,
    needsBrowser
  );

  // Early return if composite score is high enough
  if (compositeScore >= 95) {
    return {
      passed: true,
      confidence: compositeScore,
      method: step2.confidence >= step1.confidence ? 'evidence' : 'self_check',
      evidence: step2.evidence || step1.evidence,
      correctionHints: [],
    };
  }

  // Verification retry: if score < 50, wait and re-check
  if (compositeScore < 50 && page) {
    console.log("[VERIFY] Low confidence, retrying verification after 2s...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retryStep1 = await selfCheck(page, responseText, criteria);
    const retryStep2 = await evidenceCheck(page, responseText, criteria);
    const retryScore = computeCompositeScore(
      retryStep1.confidence,
      retryStep2.confidence,
      actionSuccessRate,
      needsBrowser
    );
    if (retryScore > compositeScore) {
      compositeScore = retryScore;
      console.log(`[VERIFY] Retry improved composite score to ${retryScore}%`);
    }
  }

  // Step 3: Smart Review (Claude Sonnet) — only if composite score < 90%
  if (compositeScore < 90 && page && criteria.requiresScreenshot) {
    const step3 = await smartReview(page, taskType, additionalContext);

    // Generate correction hints from all steps
    let pageText = '';
    try {
      pageText = (await page.textContent('body')) || '';
    } catch {
      // Page unavailable
    }
    const hints = generateCorrectionHints(step1, step2, pageText, actionSuccessRate ?? 100);

    return {
      ...step3,
      correctionHints: hints,
    };
  }

  // Generate correction hints for results below threshold
  let pageText = '';
  if (page) {
    try {
      pageText = (await page.textContent('body')) || '';
    } catch {
      // Page unavailable
    }
  }
  const hints = compositeScore < 90
    ? generateCorrectionHints(step1, step2, pageText, actionSuccessRate ?? 100)
    : [];

  const passed = compositeScore >= 70;
  return {
    passed,
    confidence: compositeScore,
    method: step2.confidence >= step1.confidence ? 'evidence' : 'self_check',
    evidence: step2.evidence || step1.evidence,
    correctionHints: hints,
  };
}

// ---- Step 1: Self-Check ----

async function selfCheck(
  page: Page | null,
  responseText: string,
  criteria: VerificationCriteria
): Promise<VerificationResult> {
  let text = responseText.toLowerCase();

  // Also check page content if available
  if (page) {
    try {
      const pageText = await page.textContent("body");
      if (pageText) {
        text = `${text} ${pageText.toLowerCase()}`;
      }
    } catch {
      // Page not available
    }
  }

  // Check for success indicators
  const successCount = criteria.successIndicators.filter((s) =>
    text.includes(s.toLowerCase())
  ).length;

  // Check for error indicators
  const errorCount = criteria.errorIndicators.filter((e) =>
    text.includes(e.toLowerCase())
  ).length;

  if (errorCount > 0 && successCount === 0) {
    return {
      passed: false,
      confidence: 20,
      method: "self_check",
      evidence: "Error indicators found on page",
    };
  }

  if (successCount > 0 && errorCount === 0) {
    const confidence = Math.min(50 + successCount * 15, 95);
    return {
      passed: true,
      confidence,
      method: "self_check",
      evidence: `Found ${successCount} success indicator(s)`,
    };
  }

  if (successCount > 0 && errorCount > 0) {
    // Mixed signals — low confidence
    return {
      passed: successCount > errorCount,
      confidence: 40,
      method: "self_check",
      evidence: `Mixed signals: ${successCount} success, ${errorCount} error indicators`,
    };
  }

  return {
    passed: false,
    confidence: 30,
    method: "self_check",
    evidence: "No clear success or error indicators found",
  };
}

// ---- Step 2: Evidence Check ----

async function evidenceCheck(
  page: Page | null,
  responseText: string,
  criteria: VerificationCriteria
): Promise<VerificationResult> {
  let text = responseText;

  if (page) {
    try {
      const pageText = await page.textContent("body");
      if (pageText) {
        text = `${text}\n${pageText}`;
      }
    } catch {
      // Page not available
    }
  }

  // Check evidence patterns (confirmation numbers, etc.)
  for (const pattern of criteria.evidencePatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        passed: true,
        confidence: 95,
        method: "evidence",
        evidence: `Found evidence: "${match[0]}"`,
      };
    }
  }

  // Check URL for success patterns
  if (page) {
    const url = page.url().toLowerCase();
    const successUrlPatterns = [
      "success",
      "thank-you",
      "thankyou",
      "confirmation",
      "complete",
      "done",
      "receipt",
      "order-confirmed",
    ];

    for (const pattern of successUrlPatterns) {
      if (url.includes(pattern)) {
        return {
          passed: true,
          confidence: 90,
          method: "evidence",
          evidence: `URL contains success pattern: "${pattern}"`,
        };
      }
    }
  }

  return {
    passed: false,
    confidence: 20,
    method: "evidence",
    evidence: "No concrete evidence found",
  };
}

// ---- Step 3: Smart Review (Claude Sonnet) ----

async function smartReview(
  page: Page,
  taskType: string,
  additionalContext?: string
): Promise<VerificationResult> {
  // Only use if we have Claude API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      passed: false,
      confidence: 25,
      method: "smart_review",
      evidence: "Smart review unavailable (no Anthropic API key)",
    };
  }

  try {
    const screenshot = await page.screenshot({ type: "png" });
    const base64 = screenshot.toString("base64");

    const prompt = `Analyze this screenshot and determine if the following task was completed successfully.

Task type: ${taskType}
${additionalContext ? `Context: ${additionalContext}` : ""}

Respond with JSON ONLY:
{
  "success": true/false,
  "confidence": 0-100,
  "reason": "brief explanation"
}`;

    const { content, cost } = await generateVisionResponse(
      prompt,
      base64,
      "You are a task verification system. Analyze screenshots to determine if tasks were completed successfully."
    );

    try {
      const result = JSON.parse(content);
      return {
        passed: result.success === true,
        confidence: Math.min(result.confidence || 70, 100),
        method: "smart_review",
        evidence: result.reason || "Smart review completed",
        screenshotBase64: base64,
      };
    } catch {
      // If JSON parse fails, try to interpret the text
      const isSuccess = content.toLowerCase().includes("success") || content.toLowerCase().includes("completed");
      return {
        passed: isSuccess,
        confidence: 60,
        method: "smart_review",
        evidence: content.substring(0, 200),
        screenshotBase64: base64,
      };
    }
  } catch (error) {
    console.error("[VERIFY] Smart review error:", error);
    return {
      passed: false,
      confidence: 30,
      method: "smart_review",
      evidence: "Smart review failed",
    };
  }
}

/**
 * Quick verification for simple tasks that don't need screenshots.
 * Uses text analysis only.
 */
export async function quickVerify(
  taskType: string,
  responseText: string
): Promise<VerificationResult> {
  return verifyTask(taskType, null, responseText);
}
