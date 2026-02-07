/**
 * Context Carryover System
 *
 * Remembers context between related tasks for seamless multi-turn interactions.
 * No need to repeat information - AI remembers the conversation.
 *
 * Example:
 *   User: "Book a flight to Tokyo"
 *   AI: *books flight*
 *   User: "Now find a hotel near the airport"  ← knows which airport, which dates
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface TaskContext {
  taskId: string;
  userId: string;
  createdAt: Date;
  entities: Record<string, any>; // Extracted entities (dates, locations, etc.)
  intent: string;
  relatedTaskIds: string[];
  expiresAt: Date; // Context expires after 24 hours
}

/**
 * Extract and store context from completed task
 */
export async function storeTaskContext(
  taskId: string,
  userId: string,
  description: string,
  result: any
): Promise<void> {
  console.log(`[CONTEXT] Storing context for task ${taskId.slice(0, 8)}`);

  // Extract entities using simple pattern matching
  // (In production, would use NER model)
  const entities: Record<string, any> = {};

  // Dates
  const dateMatches = description.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi);
  if (dateMatches) entities.dates = dateMatches;

  // Locations (cities, airports)
  const locationMatches = description.match(/\b(to|in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
  if (locationMatches) {
    entities.locations = locationMatches.map(m => m.replace(/^(to|in|at|from)\s+/, ""));
  }

  // Numbers (prices, quantities)
  const numberMatches = description.match(/\$[\d,]+\.?\d*|\b\d+\s*(people|person|adults?|children|rooms?|nights?|days?)\b/gi);
  if (numberMatches) entities.numbers = numberMatches;

  // Emails
  const emailMatches = description.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
  if (emailMatches) entities.emails = emailMatches;

  // Names (capitalized words)
  const nameMatches = description.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g);
  if (nameMatches) entities.names = nameMatches;

  // Determine intent category
  let intent = "unknown";
  if (/book|reserve|schedule/i.test(description)) intent = "booking";
  else if (/find|search|look for|research/i.test(description)) intent = "search";
  else if (/send|email|message/i.test(description)) intent = "communication";
  else if (/buy|purchase|order/i.test(description)) intent = "transaction";
  else if (/create|write|generate/i.test(description)) intent = "creation";

  const context: TaskContext = {
    taskId,
    userId,
    createdAt: new Date(),
    entities,
    intent,
    relatedTaskIds: [],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  };

  // Store in working memory
  await getSupabaseClient()
    .from("user_memory")
    .insert({
      user_id: userId,
      memory_type: "working",
      encrypted_data: JSON.stringify(context), // Would encrypt in production
      importance: 0.8,
      last_accessed_at: new Date().toISOString(),
    });

  console.log(`[CONTEXT] Stored: ${Object.keys(entities).length} entity types, intent=${intent}`);
}

/**
 * Retrieve recent context for new task
 * Returns context from tasks in last 24 hours
 */
export async function getRecentContext(userId: string, currentDescription: string): Promise<TaskContext | null> {
  console.log(`[CONTEXT] Loading recent context for user ${userId.slice(0, 8)}`);

  const supabase = getSupabaseClient();

  // Get recent working memories (last 24 hours)
  const { data: memories, error } = await supabase
    .from("user_memory")
    .select("encrypted_data, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "working")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !memories || memories.length === 0) {
    console.log(`[CONTEXT] No recent context found`);
    return null;
  }

  // Parse contexts
  const contexts: TaskContext[] = memories.map(m => {
    try {
      return JSON.parse(m.encrypted_data);
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (contexts.length === 0) return null;

  // Find most relevant context based on intent and entity overlap
  const currentIntent = determineIntent(currentDescription);
  const currentEntities = extractEntities(currentDescription);

  let bestMatch: TaskContext | null = null;
  let bestScore = 0;

  for (const ctx of contexts) {
    let score = 0;

    // Same intent = +50 points
    if (ctx.intent === currentIntent && currentIntent !== "unknown") score += 50;

    // Overlapping entities = +10 points each
    for (const [key, values] of Object.entries(ctx.entities)) {
      if (currentEntities[key]) {
        const overlap = (values as string[]).filter(v =>
          (currentEntities[key] as string[]).some(cv => cv.toLowerCase() === v.toLowerCase())
        );
        score += overlap.length * 10;
      }
    }

    // Recency bonus (up to +30 points)
    const ageHours = (Date.now() - new Date(ctx.createdAt).getTime()) / (1000 * 60 * 60);
    score += Math.max(0, 30 - ageHours);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = ctx;
    }
  }

  if (bestMatch && bestScore >= 30) {
    console.log(`[CONTEXT] Found relevant context (score=${bestScore}): ${bestMatch.intent}, ${Object.keys(bestMatch.entities).length} entities`);
    return bestMatch;
  }

  console.log(`[CONTEXT] No relevant context (best score=${bestScore} < 30)`);
  return null;
}

/**
 * Format context for AI prompt injection
 */
export function formatContextForPrompt(context: TaskContext): string {
  let prompt = "\n\n**CONTEXT FROM PREVIOUS TASK:**\n";

  if (context.entities.dates) {
    prompt += `Dates mentioned: ${context.entities.dates.join(", ")}\n`;
  }

  if (context.entities.locations) {
    prompt += `Locations: ${context.entities.locations.join(", ")}\n`;
  }

  if (context.entities.names) {
    prompt += `Names: ${context.entities.names.join(", ")}\n`;
  }

  if (context.entities.emails) {
    prompt += `Emails: ${context.entities.emails.join(", ")}\n`;
  }

  if (context.entities.numbers) {
    prompt += `Numbers: ${context.entities.numbers.join(", ")}\n`;
  }

  prompt += `Previous intent: ${context.intent}\n`;
  prompt += "\nUse this context to interpret the current request without asking for repeated information.";

  return prompt;
}

// Helper functions
function determineIntent(description: string): string {
  if (/book|reserve|schedule/i.test(description)) return "booking";
  if (/find|search|look for|research/i.test(description)) return "search";
  if (/send|email|message/i.test(description)) return "communication";
  if (/buy|purchase|order/i.test(description)) return "transaction";
  if (/create|write|generate/i.test(description)) return "creation";
  return "unknown";
}

function extractEntities(description: string): Record<string, string[]> {
  const entities: Record<string, string[]> = {};

  const dateMatches = description.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|tomorrow|today|next week)\b/gi);
  if (dateMatches) entities.dates = dateMatches;

  const locationMatches = description.match(/\b(to|in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
  if (locationMatches) {
    entities.locations = locationMatches.map(m => m.replace(/^(to|in|at|from)\s+/, ""));
  }

  return entities;
}
