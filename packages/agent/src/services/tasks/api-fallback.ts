/**
 * API Fallback
 *
 * When browser automation fails, try known service APIs as a fallback.
 * Registry of common services with API endpoints.
 */

import type { CascadeResult } from "../../types/index.js";

// Known service APIs that can be used instead of browser automation
const API_REGISTRY: Record<string, { name: string; note: string }> = {
  "google.com": { name: "Google", note: "Use Google APIs (Search, Calendar, Gmail) when available" },
  "github.com": { name: "GitHub", note: "GitHub REST API can handle repos, issues, PRs" },
  "twitter.com": { name: "Twitter/X", note: "X API for posting, reading timelines" },
  "linkedin.com": { name: "LinkedIn", note: "LinkedIn API for profile data" },
  "amazon.com": { name: "Amazon", note: "Amazon Product API for price checks" },
  "yelp.com": { name: "Yelp", note: "Yelp Fusion API for business search" },
};

/**
 * Attempt an API-based approach for the task.
 * Currently returns guidance on available APIs rather than making direct calls,
 * since API keys for third-party services aren't stored.
 */
export async function tryApiApproach(
  taskType: string,
  goal: string,
  domains: string[]
): Promise<CascadeResult> {
  // Check if any target domain has a known API
  for (const domain of domains) {
    const baseDomain = domain.replace(/^www\./, "");
    const api = API_REGISTRY[baseDomain];

    if (api) {
      return {
        level: 2,
        success: true,
        result: `API alternative available for ${api.name}: ${api.note}. The browser approach failed, but this service has a public API that could handle this task. Consider using the ${api.name} API directly.`,
      };
    }
  }

  // No known API for the target service
  return {
    level: 2,
    success: false,
    error: "No known API fallback for target service",
  };
}
