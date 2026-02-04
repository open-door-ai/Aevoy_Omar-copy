/**
 * Email Fallback
 *
 * When browser and API approaches fail, try contacting the service via email.
 * Composes an email to the service's support or generates a draft for the user.
 */

import type { CascadeResult } from "../../types/index.js";

// Known support email addresses for common services
const SUPPORT_EMAILS: Record<string, string> = {
  "google.com": "support@google.com",
  "amazon.com": "cs-reply@amazon.com",
  "apple.com": "support@apple.com",
  "microsoft.com": "support@microsoft.com",
};

/**
 * Try an email-based approach: either email the service's support or
 * generate a draft email for the user to send manually.
 */
export async function tryEmailApproach(
  userId: string,
  username: string,
  goal: string,
  serviceName: string
): Promise<CascadeResult> {
  const baseDomain = serviceName.replace(/^www\./, "");
  const supportEmail = SUPPORT_EMAILS[baseDomain];

  if (supportEmail) {
    return {
      level: 3,
      success: true,
      result: `Browser automation failed for ${serviceName}. You can contact their support directly at ${supportEmail}. Here's a suggested message:\n\nSubject: Request: ${goal}\n\nHi ${serviceName} support,\n\nI need help with the following: ${goal}\n\nPlease let me know the next steps.\n\nThanks,\n${username}`,
    };
  }

  // No known support email — generate a draft for the user
  return {
    level: 4,
    success: true,
    result: `Browser automation failed for ${serviceName}. I couldn't find a direct support email. Here's a draft you can send to their support (usually found on their "Contact Us" page):\n\nSubject: Help needed: ${goal}\n\nHi,\n\nI'm trying to: ${goal}\n\nI wasn't able to complete this through your website. Could you assist me with this?\n\nThanks,\n${username}`,
  };
}
