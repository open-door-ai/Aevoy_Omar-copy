/**
 * API Fallback
 *
 * When browser automation fails, try known service APIs as a fallback.
 * Makes actual HTTP requests where public/free APIs are available.
 * Returns success: false (not fake success) when no API is available.
 */

import type { CascadeResult } from "../../types/index.js";

interface ApiHandler {
  name: string;
  /** Attempt the API call. Returns result text on success, null on failure. */
  attempt: (goal: string) => Promise<string | null>;
}

/**
 * Extract a search query from a goal string.
 * Strips common action verbs to get the core query.
 */
function extractQuery(goal: string): string {
  return goal
    .replace(/^(search|find|look up|lookup|get|fetch|check)\s+(for\s+)?/i, "")
    .trim();
}

// Registry of services with actual API implementations
const API_HANDLERS: Record<string, ApiHandler> = {
  "google.com": {
    name: "Google",
    attempt: async (goal: string): Promise<string | null> => {
      // Use DuckDuckGo Instant Answer API as a free proxy for search
      const query = extractQuery(goal);
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const data = await res.json() as {
          Abstract?: string;
          AbstractText?: string;
          Answer?: string;
          RelatedTopics?: Array<{ Text?: string }>;
        };
        if (data.AbstractText) {
          return `Search result for "${query}":\n\n${data.AbstractText}`;
        }
        if (data.Answer) {
          return `Answer for "${query}": ${data.Answer}`;
        }
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
          const topics = data.RelatedTopics
            .slice(0, 5)
            .filter((t) => t.Text)
            .map((t) => `- ${t.Text}`)
            .join("\n");
          if (topics) return `Related results for "${query}":\n\n${topics}`;
        }
        return null;
      } catch {
        return null;
      }
    },
  },

  "github.com": {
    name: "GitHub",
    attempt: async (goal: string): Promise<string | null> => {
      // GitHub public API — no auth needed for public data
      const query = extractQuery(goal);
      try {
        // Try repo search
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`;
        const res = await fetch(url, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Aevoy-Agent" },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const data = await res.json() as {
          total_count: number;
          items: Array<{ full_name: string; description: string | null; html_url: string; stargazers_count: number }>;
        };
        if (data.items && data.items.length > 0) {
          const results = data.items
            .map((r) => `- ${r.full_name} (${r.stargazers_count} stars): ${r.description || "No description"}\n  ${r.html_url}`)
            .join("\n");
          return `GitHub results for "${query}" (${data.total_count} total):\n\n${results}`;
        }
        return null;
      } catch {
        return null;
      }
    },
  },

  "yelp.com": {
    name: "Yelp",
    attempt: async (goal: string): Promise<string | null> => {
      // Yelp Fusion API requires an API key — check if configured
      const apiKey = process.env.YELP_API_KEY;
      if (!apiKey) return null;
      const query = extractQuery(goal);
      try {
        const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(query)}&location=default&limit=5`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const data = await res.json() as {
          businesses: Array<{ name: string; rating: number; review_count: number; location: { display_address: string[] }; url: string }>;
        };
        if (data.businesses && data.businesses.length > 0) {
          const results = data.businesses
            .map((b) => `- ${b.name} (${b.rating} stars, ${b.review_count} reviews): ${b.location.display_address.join(", ")}\n  ${b.url}`)
            .join("\n");
          return `Yelp results for "${query}":\n\n${results}`;
        }
        return null;
      } catch {
        return null;
      }
    },
  },
};

/**
 * Attempt an API-based approach for the task.
 * Makes actual HTTP requests for services with public/free APIs.
 * Returns success: false when no API is available or calls fail.
 */
export async function tryApiApproach(
  taskType: string,
  goal: string,
  domains: string[]
): Promise<CascadeResult> {
  // Try each target domain for a matching API handler
  for (const domain of domains) {
    const baseDomain = domain.replace(/^www\./, "");
    const handler = API_HANDLERS[baseDomain];

    if (handler) {
      console.log(`[CASCADE] Trying ${handler.name} API fallback for: ${goal}`);
      const result = await handler.attempt(goal);
      if (result) {
        console.log(`[CASCADE] ${handler.name} API fallback succeeded`);
        return {
          level: 2,
          success: true,
          result: `Browser automation failed, but I got results via the ${handler.name} API:\n\n${result}`,
        };
      }
      console.log(`[CASCADE] ${handler.name} API fallback returned no results`);
    }
  }

  // For search/research tasks, try DuckDuckGo regardless of domain
  if (taskType === "research" || taskType === "search") {
    const handler = API_HANDLERS["google.com"];
    if (handler) {
      const result = await handler.attempt(goal);
      if (result) {
        return {
          level: 2,
          success: true,
          result: `Browser automation failed, but I found results via search API:\n\n${result}`,
        };
      }
    }
  }

  // No API available or all calls failed
  return {
    level: 2,
    success: false,
    error: "No API fallback available or API calls returned no results",
  };
}
