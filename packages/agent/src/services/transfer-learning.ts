/**
 * Transfer Learning Engine
 *
 * Applies learnings from one domain to similar domains.
 * When a new domain is encountered, finds similar domains and transfers knowledge.
 *
 * Transfer strategies:
 * 1. Domain similarity (amazon.com → walmart.com)
 * 2. Task type similarity (email → calendar → drive)
 * 3. Layout pattern similarity (e-commerce sites)
 * 4. Framework detection (React, Vue, etc.)
 *
 * Examples:
 * - Learn login on amazon.com → apply to walmart.com
 * - Learn form filling on one React app → apply to others
 * - Learn 2FA flow on one banking site → apply to all banking sites
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface DomainSimilarity {
  sourceDomain: string;
  targetDomain: string;
  similarityScore: number; // 0-100
  sharedPatterns: string[];
  transferableKnowledge: TransferableKnowledge[];
}

export interface TransferableKnowledge {
  type: "method" | "selector" | "workflow" | "pattern";
  source: string;
  confidence: number; // How confident we are this will transfer
  adaptation: string; // What might need to change
}

/**
 * Find similar domains to transfer knowledge from
 */
export async function findSimilarDomains(targetDomain: string, limit: number = 5): Promise<DomainSimilarity[]> {
  console.log(`[TRANSFER] Finding domains similar to ${targetDomain}`);

  // Get all domains we have experience with
  const { data: knownDomains } = await getSupabaseClient()
    .from("task_difficulty_cache")
    .select("domain, task_type, avg_success_rate, total_attempts")
    .gte("total_attempts", 5) // Only consider domains with sufficient data
    .limit(200);

  if (!knownDomains || knownDomains.length === 0) {
    console.log(`[TRANSFER] No known domains to transfer from`);
    return [];
  }

  // Calculate similarity scores
  const similarities: DomainSimilarity[] = [];

  for (const known of knownDomains) {
    if (known.domain === targetDomain) continue; // Skip self

    const score = calculateDomainSimilarity(known.domain, targetDomain);
    if (score < 30) continue; // Only consider reasonably similar domains

    const patterns = detectSharedPatterns(known.domain, targetDomain);
    const transferable = await getTransferableKnowledge(known.domain, targetDomain);

    similarities.push({
      sourceDomain: known.domain,
      targetDomain,
      similarityScore: score,
      sharedPatterns: patterns,
      transferableKnowledge: transferable,
    });
  }

  // Sort by similarity score descending
  similarities.sort((a, b) => b.similarityScore - a.similarityScore);

  const topSimilar = similarities.slice(0, limit);
  console.log(
    `[TRANSFER] Found ${topSimilar.length} similar domains: ${topSimilar.map((s) => `${s.sourceDomain} (${s.similarityScore}%)`).join(", ")}`
  );

  return topSimilar;
}

/**
 * Calculate similarity score between two domains
 */
function calculateDomainSimilarity(domain1: string, domain2: string): number {
  let score = 0;

  // Same TLD = +20
  const tld1 = domain1.split(".").pop();
  const tld2 = domain2.split(".").pop();
  if (tld1 === tld2) score += 20;

  // Same category (e.g., both e-commerce, both social, etc.)
  const cat1 = categorizeDomain(domain1);
  const cat2 = categorizeDomain(domain2);
  if (cat1 === cat2 && cat1 !== "unknown") score += 40;

  // Similar name (Levenshtein distance)
  const name1 = domain1.split(".")[0];
  const name2 = domain2.split(".")[0];
  const nameSimilarity = 100 - (levenshteinDistance(name1, name2) / Math.max(name1.length, name2.length)) * 100;
  score += nameSimilarity * 0.4; // Up to 40 points

  return Math.min(100, score);
}

/**
 * Categorize a domain by type
 */
function categorizeDomain(domain: string): string {
  const ecommerce = ["amazon", "ebay", "walmart", "target", "etsy", "shopify", "shop"];
  const social = ["facebook", "twitter", "instagram", "linkedin", "tiktok", "reddit"];
  const email = ["gmail", "outlook", "yahoo", "protonmail"];
  const productivity = ["notion", "asana", "trello", "monday", "jira"];
  const finance = ["chase", "wellsfargo", "bankofamerica", "paypal", "stripe"];

  const name = domain.split(".")[0].toLowerCase();

  if (ecommerce.some((e) => name.includes(e))) return "ecommerce";
  if (social.some((s) => name.includes(s))) return "social";
  if (email.some((e) => name.includes(e))) return "email";
  if (productivity.some((p) => name.includes(p))) return "productivity";
  if (finance.some((f) => name.includes(f))) return "finance";

  return "unknown";
}

/**
 * Detect shared patterns between domains
 */
function detectSharedPatterns(domain1: string, domain2: string): string[] {
  const patterns: string[] = [];

  const cat1 = categorizeDomain(domain1);
  const cat2 = categorizeDomain(domain2);

  if (cat1 === cat2) {
    switch (cat1) {
      case "ecommerce":
        patterns.push("product_pages", "checkout_flow", "search_functionality", "cart_management");
        break;
      case "social":
        patterns.push("post_creation", "feed_browsing", "messaging", "profile_management");
        break;
      case "email":
        patterns.push("compose_email", "inbox_browsing", "folder_management", "search");
        break;
      case "productivity":
        patterns.push("task_creation", "project_management", "collaboration", "calendar");
        break;
      case "finance":
        patterns.push("login_2fa", "transaction_viewing", "transfer_money", "bill_pay");
        break;
    }
  }

  return patterns;
}

/**
 * Get transferable knowledge from source to target domain
 */
async function getTransferableKnowledge(sourceDomain: string, targetDomain: string): Promise<TransferableKnowledge[]> {
  const transferable: TransferableKnowledge[] = [];

  try {
    // Get successful methods from source domain
    const { data: sourceMethods } = await getSupabaseClient()
      .from("method_success_rates")
      .select("action_type, success_rate, times_used")
      .eq("domain", sourceDomain)
      .gte("success_rate", 70)
      .gte("times_used", 3)
      .order("success_rate", { ascending: false })
      .limit(10);

    if (sourceMethods && sourceMethods.length > 0) {
      for (const method of sourceMethods) {
        transferable.push({
          type: "method",
          source: `${method.action_type} (${method.success_rate}% success)`,
          confidence: method.success_rate,
          adaptation: "May need selector adjustments for new domain",
        });
      }
    }

    // Get successful learnings from source domain
    const { data: sourceLearnings } = await getSupabaseClient()
      .from("learnings")
      .select("task_type, steps, gotchas")
      .eq("service", sourceDomain)
      .limit(5);

    if (sourceLearnings && sourceLearnings.length > 0) {
      for (const learning of sourceLearnings) {
        transferable.push({
          type: "workflow",
          source: `${learning.task_type} workflow`,
          confidence: 60, // Lower confidence for workflows
          adaptation: "Workflow steps may need reordering or modification",
        });
      }
    }
  } catch (error) {
    console.error("[TRANSFER] Error getting transferable knowledge:", error);
  }

  return transferable;
}

/**
 * Apply transfer learning from similar domain
 */
export async function applyTransferLearning(
  targetDomain: string,
  taskType: string
): Promise<{
  applied: boolean;
  sourceDomain: string | null;
  transferredKnowledge: string[];
  confidence: number;
}> {
  console.log(`[TRANSFER] Attempting transfer learning for ${taskType} on ${targetDomain}`);

  const similarDomains = await findSimilarDomains(targetDomain, 3);
  if (similarDomains.length === 0) {
    return { applied: false, sourceDomain: null, transferredKnowledge: [], confidence: 0 };
  }

  const bestMatch = similarDomains[0];
  console.log(`[TRANSFER] Best match: ${bestMatch.sourceDomain} (${bestMatch.similarityScore}% similar)`);

  // Transfer knowledge
  const transferred: string[] = [];
  for (const knowledge of bestMatch.transferableKnowledge) {
    if (knowledge.confidence >= 60) {
      transferred.push(knowledge.source);
      console.log(`[TRANSFER] Transferring: ${knowledge.source} (confidence: ${knowledge.confidence}%)`);
    }
  }

  return {
    applied: transferred.length > 0,
    sourceDomain: bestMatch.sourceDomain,
    transferredKnowledge: transferred,
    confidence: bestMatch.similarityScore,
  };
}

/**
 * Record successful transfer for learning
 */
export async function recordTransferSuccess(
  sourceDomain: string,
  targetDomain: string,
  taskType: string,
  transferType: string
): Promise<void> {
  try {
    console.log(`[TRANSFER] Recording successful transfer: ${sourceDomain} → ${targetDomain} (${transferType})`);
    // Could store in a transfer_success table for meta-learning
  } catch (error) {
    console.error("[TRANSFER] Error recording transfer success:", error);
  }
}

/**
 * Levenshtein distance for string similarity
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Batch transfer learning for all pending tasks
 */
export async function batchTransferLearning(userId: string): Promise<number> {
  console.log(`[TRANSFER] Running batch transfer learning for user ${userId.slice(0, 8)}`);

  // Get recent failed tasks on new domains
  const { data: failedTasks } = await getSupabaseClient()
    .from("tasks")
    .select("id, type, input_text")
    .eq("user_id", userId)
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(50);

  if (!failedTasks || failedTasks.length === 0) return 0;

  let transferCount = 0;
  for (const task of failedTasks) {
    const domain = extractDomain(task.input_text || "");
    if (!domain) continue;

    const transfer = await applyTransferLearning(domain, task.type || "unknown");
    if (transfer.applied) {
      transferCount++;
      console.log(`[TRANSFER] Applied knowledge from ${transfer.sourceDomain} to ${domain}`);
    }
  }

  console.log(`[TRANSFER] Applied transfer learning to ${transferCount} tasks`);
  return transferCount;
}

/**
 * Extract domain from text
 */
function extractDomain(text: string): string | null {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  return match ? match[1] : null;
}
