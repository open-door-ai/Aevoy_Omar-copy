/**
 * Task Clarification System
 * 
 * Uses AI to parse vague user requests into structured intents.
 * Determines if confirmation is needed based on user settings and confidence.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Memory } from "../types/index.js";

// Types
export type ConfirmationMode = 'always' | 'unclear' | 'risky' | 'never';

export interface UserSettings {
  confirmationMode: ConfirmationMode;
  verificationMethod: 'forward' | 'virtual_number';
  agentCardEnabled: boolean;
  agentCardLimitTransaction: number;
  agentCardLimitMonthly: number;
  virtualPhone: string | null;
}

export interface StructuredIntent {
  taskType: string;
  goal: string;
  entities: Record<string, string>;
  assumptions: string[];
  unclearParts: string[];
}

export interface ClarifiedTask {
  originalInput: string;
  structuredIntent: StructuredIntent;
  confidence: number;
  needsConfirmation: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  confirmationMode: 'unclear',
  verificationMethod: 'forward',
  agentCardEnabled: false,
  agentCardLimitTransaction: 5000, // $50
  agentCardLimitMonthly: 20000, // $200
  virtualPhone: null
};

/**
 * Load user settings from database
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return DEFAULT_SETTINGS;
    }

    return {
      confirmationMode: data.confirmation_mode || 'unclear',
      verificationMethod: data.verification_method || 'forward',
      agentCardEnabled: data.agent_card_enabled || false,
      agentCardLimitTransaction: data.agent_card_limit_transaction || 5000,
      agentCardLimitMonthly: data.agent_card_limit_monthly || 20000,
      virtualPhone: data.virtual_phone || null
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save user settings to database
 */
export async function saveUserSettings(userId: string, settings: Partial<UserSettings>): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient()
      .from("user_settings")
      .upsert({
        user_id: userId,
        confirmation_mode: settings.confirmationMode,
        verification_method: settings.verificationMethod,
        agent_card_enabled: settings.agentCardEnabled,
        agent_card_limit_transaction: settings.agentCardLimitTransaction,
        agent_card_limit_monthly: settings.agentCardLimitMonthly,
        virtual_phone: settings.virtualPhone,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    return !error;
  } catch {
    return false;
  }
}

/**
 * Clarify a user's task using AI
 */
export async function clarifyTask(
  userMessage: string, 
  memory: Memory,
  userId: string
): Promise<ClarifiedTask> {
  const settings = await getUserSettings(userId);
  
  // Use DeepSeek for classification (cheap)
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseURL: "https://api.deepseek.com"
  });

  const prompt = `User said: "${userMessage}"

User's known preferences and history:
${memory.facts || "No known preferences yet"}

Recent activity:
${memory.recentLogs || "No recent activity"}

Parse this into a structured task. Fill in missing details from their preferences if known.

Respond in valid JSON only:
{
  "taskType": "research|booking|form|email|shopping|reminder|writing|conversation|general",
  "goal": "Clear description of what they want",
  "entities": {
    "date": "...",
    "time": "...",
    "party_size": "...",
    "location": "...",
    "recipient": "...",
    "amount": "..."
  },
  "assumptions": ["assumed X based on history", "filled in Y from preferences"],
  "unclear_parts": ["not sure if they meant X or Y"],
  "confidence": 85
}

Only include entities that are relevant. Remove empty or null values.`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are a task parser. Respond only in valid JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });

    const content = response.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] || "{}");

    const structuredIntent: StructuredIntent = {
      taskType: parsed.taskType || "general",
      goal: parsed.goal || userMessage,
      entities: parsed.entities || {},
      assumptions: parsed.assumptions || [],
      unclearParts: parsed.unclear_parts || []
    };

    let confidence = parsed.confidence || 50;

    // Per-task-type confidence caps for missing required fields
    if (structuredIntent.taskType === 'booking' && !structuredIntent.entities.date) {
      confidence = Math.min(confidence, 60);
    }
    if (structuredIntent.taskType === 'email' && !structuredIntent.entities.recipient) {
      confidence = Math.min(confidence, 50);
    }
    if (structuredIntent.taskType === 'shopping' && !structuredIntent.entities.amount) {
      confidence = Math.min(confidence, 65);
    }

    const needsConfirmation = shouldConfirm(structuredIntent, confidence, settings);

    console.log(`[CLARIFY] Task: ${structuredIntent.taskType}, Confidence: ${confidence}, NeedsConfirm: ${needsConfirmation}`);

    return {
      originalInput: userMessage,
      structuredIntent,
      confidence,
      needsConfirmation
    };
  } catch (error) {
    console.error("[CLARIFY] Error:", error);
    
    // Fallback: basic classification
    return {
      originalInput: userMessage,
      structuredIntent: {
        taskType: "general",
        goal: userMessage,
        entities: {},
        assumptions: [],
        unclearParts: []
      },
      confidence: 50,
      needsConfirmation: settings.confirmationMode !== 'never'
    };
  }
}

/**
 * Determine if confirmation is needed based on settings and task
 */
function shouldConfirm(
  intent: StructuredIntent,
  confidence: number,
  settings: UserSettings
): boolean {
  // Conversational/greeting messages NEVER need confirmation
  const conversationalTypes = ['conversation', 'greeting', 'general'];
  const greetingPatterns = /^(hi|hello|hey|howdy|sup|yo|good\s*(morning|afternoon|evening|night)|what'?s?\s*up|how\s*(are\s*you|do\s*you\s*do)|thanks|thank\s*you|bye|goodbye)/i;

  if (conversationalTypes.includes(intent.taskType) &&
      (greetingPatterns.test(intent.goal) || confidence >= 70)) {
    return false;
  }

  switch (settings.confirmationMode) {
    case 'always':
      return true;

    case 'never':
      return false;

    case 'risky':
      const riskyTypes = ['payment', 'login', 'email', 'delete', 'shopping'];
      return riskyTypes.includes(intent.taskType);

    case 'unclear':
    default:
      // Only confirm if confidence is very low OR has unclear parts AND it's not a simple task
      return (confidence < 60 && intent.unclearParts.length > 0) ||
             intent.taskType === 'payment' ||
             intent.taskType === 'delete';
  }
}

/**
 * Format clarified task for confirmation email
 */
export function formatConfirmationMessage(clarified: ClarifiedTask): string {
  const { structuredIntent } = clarified;
  
  let message = `Here's what I understood:\n\n`;
  message += `**${structuredIntent.goal}**\n\n`;
  
  // Format entities
  const entities = Object.entries(structuredIntent.entities)
    .filter(([_, v]) => v && v !== '')
    .map(([k, v]) => `  • ${formatKey(k)}: ${v}`)
    .join('\n');
  
  if (entities) {
    message += `Details:\n${entities}\n\n`;
  }
  
  // Format assumptions
  if (structuredIntent.assumptions.length > 0) {
    message += `I assumed:\n`;
    message += structuredIntent.assumptions.map(a => `  • ${a}`).join('\n');
    message += '\n\n';
  }
  
  // Format unclear parts
  if (structuredIntent.unclearParts.length > 0) {
    message += `I'm not sure about:\n`;
    message += structuredIntent.unclearParts.map(u => `  • ${u}`).join('\n');
    message += '\n\n';
  }
  
  message += `Reply **YES** to confirm, or tell me what to change.`;
  
  return message;
}

function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Parse user's confirmation reply
 */
export function parseConfirmationReply(text: string): 'yes' | 'no' | 'changes' | 'unclear' {
  const normalized = text.toLowerCase().trim();

  if (normalized === 'yes' || normalized === 'y' || normalized === 'confirm' || normalized === 'ok' || normalized === 'go ahead' || normalized === 'do it') {
    return 'yes';
  }

  if (normalized === 'no' || normalized === 'n' || normalized === 'cancel' || normalized === 'stop' || normalized === 'nevermind') {
    return 'no';
  }

  // Handle uncertain replies
  if (normalized.includes("not sure") || normalized.includes("maybe") || normalized.includes("i guess") || normalized.includes("uncertain")) {
    return 'unclear';
  }

  return 'changes';
}

/**
 * Check if this is a card management command
 */
export function parseCardCommand(text: string): { type: string; amount?: number } | null {
  const normalized = text.toLowerCase();
  
  // Check for balance inquiry
  if (normalized.includes('card balance') || normalized.includes("what's my card") || normalized.includes('balance')) {
    return { type: 'balance' };
  }
  
  // Check for freeze
  if (normalized.includes('freeze my card') || normalized.includes('freeze card')) {
    return { type: 'freeze' };
  }
  
  // Check for unfreeze
  if (normalized.includes('unfreeze my card') || normalized.includes('unfreeze card')) {
    return { type: 'unfreeze' };
  }
  
  // Check for funding (numeric)
  const fundMatch = normalized.match(/add\s+\$?(\d+(?:\.\d{2})?)\s+to\s+(?:my\s+)?card/i);
  if (fundMatch) {
    const amount = parseFloat(fundMatch[1]) * 100; // Convert to cents
    return { type: 'fund', amount };
  }

  // Check for funding (word-form amounts)
  const wordAmounts: Record<string, number> = {
    'ten': 10, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100,
    'five': 5, 'fifteen': 15, 'twenty-five': 25, 'two hundred': 200,
    'five hundred': 500, 'thousand': 1000,
  };
  for (const [word, dollars] of Object.entries(wordAmounts)) {
    if (normalized.includes(`add ${word}`) && normalized.includes('card')) {
      return { type: 'fund', amount: dollars * 100 };
    }
  }

  return null;
}
