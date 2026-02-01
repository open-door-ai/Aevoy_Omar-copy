/**
 * Privacy.com Integration
 * 
 * Manages virtual prepaid cards for agent purchases.
 * Each user can have a virtual card with limits that the agent uses for purchases.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserSettings } from "./clarifier.js";

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return supabase;
}

const PRIVACY_API_BASE = "https://api.privacy.com/v1";

interface PrivacyConfig {
  apiKey: string;
}

function getPrivacyConfig(): PrivacyConfig | null {
  const apiKey = process.env.PRIVACY_API_KEY;
  
  if (!apiKey) {
    console.warn("[PRIVACY] Not configured - missing PRIVACY_API_KEY");
    return null;
  }
  
  return { apiKey };
}

export interface AgentCard {
  id: string;
  user_id: string;
  card_id: string;
  last_four: string;
  balance_cents: number;
  is_frozen: boolean;
  created_at: string;
}

export interface CardDetails {
  cardNumber: string;
  cvv: string;
  expMonth: string;
  expYear: string;
  lastFour: string;
}

/**
 * Create a new agent card for a user
 */
export async function createAgentCard(userId: string): Promise<{ 
  success: boolean; 
  card?: AgentCard; 
  error?: string 
}> {
  const config = getPrivacyConfig();
  if (!config) {
    return { success: false, error: "Privacy.com not configured" };
  }
  
  try {
    // Get user's settings for limits
    const settings = await getUserSettings(userId);
    
    // Create card via Privacy.com API
    const response = await fetch(`${PRIVACY_API_BASE}/card`, {
      method: 'POST',
      headers: {
        'Authorization': `api-key ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'UNLOCKED', // Can be used anywhere
        spend_limit: settings.agentCardLimitTransaction, // Per-transaction limit
        spend_limit_duration: 'TRANSACTION',
        memo: `Aevoy Agent - ${userId.slice(0, 8)}`
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Privacy API error: ${response.status} - ${errorText}`);
    }
    
    const cardData = await response.json() as {
      token: string;
      last_four: string;
      state: string;
    };
    
    // Store in database (encrypted card_id/token, not full card number)
    const { data: card, error: dbError } = await getSupabaseClient()
      .from("agent_cards")
      .insert({
        user_id: userId,
        card_id: cardData.token,
        last_four: cardData.last_four,
        balance_cents: 0,
        is_frozen: false
      })
      .select()
      .single();
    
    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }
    
    // Update user settings
    await getSupabaseClient()
      .from("user_settings")
      .upsert({
        user_id: userId,
        agent_card_enabled: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    
    console.log(`[PRIVACY] Created card for user ${userId}: ****${cardData.last_four}`);
    
    return { success: true, card: card as AgentCard };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PRIVACY] Error creating card:", message);
    return { success: false, error: message };
  }
}

/**
 * Get user's agent card
 */
export async function getAgentCard(userId: string): Promise<AgentCard | null> {
  const { data, error } = await getSupabaseClient()
    .from("agent_cards")
    .select("*")
    .eq("user_id", userId)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return data as AgentCard;
}

/**
 * Get card details for making a purchase (sensitive - use carefully)
 */
export async function getCardDetails(userId: string): Promise<CardDetails | null> {
  const config = getPrivacyConfig();
  if (!config) {
    return null;
  }
  
  const card = await getAgentCard(userId);
  if (!card || card.is_frozen) {
    return null;
  }
  
  try {
    // Get card details from Privacy.com
    const response = await fetch(`${PRIVACY_API_BASE}/card/${card.card_id}`, {
      headers: {
        'Authorization': `api-key ${config.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Privacy API error: ${response.status}`);
    }
    
    const data = await response.json() as {
      pan: string;
      cvv: string;
      exp_month: string;
      exp_year: string;
      last_four: string;
    };
    
    return {
      cardNumber: data.pan,
      cvv: data.cvv,
      expMonth: data.exp_month,
      expYear: data.exp_year,
      lastFour: data.last_four
    };
  } catch (error) {
    console.error("[PRIVACY] Error getting card details:", error);
    return null;
  }
}

/**
 * Fund the agent card (adds balance)
 * In production, this would first charge the user's main payment method via Stripe
 */
export async function fundAgentCard(
  userId: string, 
  amountCents: number
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  const card = await getAgentCard(userId);
  if (!card) {
    return { success: false, newBalance: 0, error: "No agent card found" };
  }
  
  try {
    // In production: charge user's Stripe payment method first
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // await stripe.charges.create({
    //   amount: amountCents,
    //   currency: 'usd',
    //   customer: user.stripe_customer_id,
    //   description: 'Fund Aevoy Agent Card'
    // });
    
    // Update balance in database
    const newBalance = card.balance_cents + amountCents;
    
    const { error } = await getSupabaseClient()
      .from("agent_cards")
      .update({ balance_cents: newBalance })
      .eq("id", card.id);
    
    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }
    
    console.log(`[PRIVACY] Funded card for user ${userId}: +$${(amountCents / 100).toFixed(2)}`);
    
    return { success: true, newBalance };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PRIVACY] Error funding card:", message);
    return { success: false, newBalance: card.balance_cents, error: message };
  }
}

/**
 * Deduct from card balance after a purchase
 */
export async function deductFromCard(
  userId: string, 
  amountCents: number
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  const card = await getAgentCard(userId);
  if (!card) {
    return { success: false, newBalance: 0, error: "No agent card found" };
  }
  
  if (card.is_frozen) {
    return { success: false, newBalance: card.balance_cents, error: "Card is frozen" };
  }
  
  if (card.balance_cents < amountCents) {
    return { success: false, newBalance: card.balance_cents, error: "Insufficient balance" };
  }
  
  const settings = await getUserSettings(userId);
  if (amountCents > settings.agentCardLimitTransaction) {
    return { 
      success: false, 
      newBalance: card.balance_cents, 
      error: `Amount exceeds transaction limit of $${(settings.agentCardLimitTransaction / 100).toFixed(2)}` 
    };
  }
  
  const newBalance = card.balance_cents - amountCents;
  
  const { error } = await getSupabaseClient()
    .from("agent_cards")
    .update({ balance_cents: newBalance })
    .eq("id", card.id);
  
  if (error) {
    return { success: false, newBalance: card.balance_cents, error: error.message };
  }
  
  console.log(`[PRIVACY] Deducted from card for user ${userId}: -$${(amountCents / 100).toFixed(2)}`);
  
  return { success: true, newBalance };
}

/**
 * Freeze the agent card
 */
export async function freezeCard(userId: string): Promise<boolean> {
  const config = getPrivacyConfig();
  const card = await getAgentCard(userId);
  
  if (!card) {
    return false;
  }
  
  try {
    // Freeze via Privacy.com API
    if (config) {
      await fetch(`${PRIVACY_API_BASE}/card/${card.card_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `api-key ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'PAUSED' })
      });
    }
    
    // Update database
    await getSupabaseClient()
      .from("agent_cards")
      .update({ is_frozen: true })
      .eq("id", card.id);
    
    console.log(`[PRIVACY] Froze card for user ${userId}`);
    
    return true;
  } catch (error) {
    console.error("[PRIVACY] Error freezing card:", error);
    return false;
  }
}

/**
 * Unfreeze the agent card
 */
export async function unfreezeCard(userId: string): Promise<boolean> {
  const config = getPrivacyConfig();
  const card = await getAgentCard(userId);
  
  if (!card) {
    return false;
  }
  
  try {
    // Unfreeze via Privacy.com API
    if (config) {
      await fetch(`${PRIVACY_API_BASE}/card/${card.card_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `api-key ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'OPEN' })
      });
    }
    
    // Update database
    await getSupabaseClient()
      .from("agent_cards")
      .update({ is_frozen: false })
      .eq("id", card.id);
    
    console.log(`[PRIVACY] Unfroze card for user ${userId}`);
    
    return true;
  } catch (error) {
    console.error("[PRIVACY] Error unfreezing card:", error);
    return false;
  }
}

/**
 * Delete/close the agent card
 */
export async function deleteAgentCard(userId: string): Promise<boolean> {
  const config = getPrivacyConfig();
  const card = await getAgentCard(userId);
  
  if (!card) {
    return true; // No card to delete
  }
  
  try {
    // Close via Privacy.com API
    if (config) {
      await fetch(`${PRIVACY_API_BASE}/card/${card.card_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `api-key ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'CLOSED' })
      });
    }
    
    // Delete from database
    await getSupabaseClient()
      .from("agent_cards")
      .delete()
      .eq("id", card.id);
    
    // Update user settings
    await getSupabaseClient()
      .from("user_settings")
      .update({
        agent_card_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId);
    
    console.log(`[PRIVACY] Deleted card for user ${userId}`);
    
    return true;
  } catch (error) {
    console.error("[PRIVACY] Error deleting card:", error);
    return false;
  }
}

/**
 * Check if Privacy.com is configured
 */
export function isPrivacyConfigured(): boolean {
  return getPrivacyConfig() !== null;
}

/**
 * Check if user can make a purchase with their agent card
 */
export async function canMakePurchase(
  userId: string, 
  amountCents: number
): Promise<{ allowed: boolean; reason?: string }> {
  const card = await getAgentCard(userId);
  
  if (!card) {
    return { allowed: false, reason: "No agent card set up" };
  }
  
  if (card.is_frozen) {
    return { allowed: false, reason: "Card is frozen" };
  }
  
  if (card.balance_cents < amountCents) {
    return { 
      allowed: false, 
      reason: `Insufficient balance. Current: $${(card.balance_cents / 100).toFixed(2)}, Required: $${(amountCents / 100).toFixed(2)}` 
    };
  }
  
  const settings = await getUserSettings(userId);
  if (amountCents > settings.agentCardLimitTransaction) {
    return { 
      allowed: false, 
      reason: `Exceeds transaction limit of $${(settings.agentCardLimitTransaction / 100).toFixed(2)}` 
    };
  }
  
  return { allowed: true };
}
