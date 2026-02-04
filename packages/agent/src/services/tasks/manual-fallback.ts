/**
 * Manual Fallback
 *
 * Last resort: generates step-by-step manual instructions for the user.
 * This always produces a useful result — the cascade never fails completely.
 */

import { quickValidate } from "../ai.js";
import type { CascadeResult } from "../../types/index.js";

/**
 * Generate manual step-by-step instructions for the user.
 * Uses AI to create clear, actionable instructions.
 */
export async function generateManualInstructions(
  goal: string,
  serviceName: string,
  gatheredInfo?: string
): Promise<CascadeResult> {
  try {
    const prompt = `Generate clear, step-by-step instructions for a user to manually complete this task:

Task: ${goal}
Service: ${serviceName}
${gatheredInfo ? `\nContext gathered so far:\n${gatheredInfo}` : ""}

Write 5-10 numbered steps. Be specific about which pages to visit and what to click. Keep it concise.`;

    const { result } = await quickValidate(
      prompt,
      "You are a helpful assistant that generates clear manual instructions. Respond with numbered steps only."
    );

    if (result && result.length > 20) {
      return {
        level: 6,
        success: true,
        result: `I wasn't able to complete this automatically, but here are manual instructions:\n\n${result}`,
      };
    }
  } catch {
    // AI instruction generation failed
  }

  // Even if AI fails, provide basic instructions
  return {
    level: 6,
    success: true,
    result: `I wasn't able to complete "${goal}" automatically on ${serviceName}. Here's what you can do:\n\n1. Go to ${serviceName} in your browser\n2. Log in to your account\n3. Navigate to the relevant section for: ${goal}\n4. Complete the task manually\n5. Let me know if you need any further assistance\n\nI've recorded this so I can learn and try a better approach next time.`,
  };
}
