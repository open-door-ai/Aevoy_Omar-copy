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
import type { VerificationResult } from "../types/index.js";

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
};

// ---- Main Verification Function ----

/**
 * Run 3-step verification on a completed task.
 * Returns verification result with confidence score.
 */
export async function verifyTask(
  taskType: string,
  page: Page | null,
  responseText: string,
  additionalContext?: string
): Promise<VerificationResult> {
  const criteria = VERIFICATION_CRITERIA[taskType] || VERIFICATION_CRITERIA.form;

  // Step 1: Self-Check (using page text or response text)
  const step1 = await selfCheck(page, responseText, criteria);
  if (step1.confidence >= 95) {
    return step1;
  }

  // Step 2: Evidence Check (code-based, no AI)
  const step2 = await evidenceCheck(page, responseText, criteria);
  if (step2.confidence >= 90) {
    return step2;
  }

  // Combine step 1 and step 2 confidence
  const combinedConfidence = Math.max(step1.confidence, step2.confidence);

  // Step 3: Smart Review (Claude Sonnet) — only if confidence < 90%
  if (combinedConfidence < 90 && page && criteria.requiresScreenshot) {
    const step3 = await smartReview(page, taskType, additionalContext);
    return step3;
  }

  // Return the best result from steps 1+2
  return combinedConfidence >= 70
    ? { passed: true, confidence: combinedConfidence, method: "self_check", evidence: step2.evidence }
    : { passed: false, confidence: combinedConfidence, method: "evidence" };
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
      confidence: 50,
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
