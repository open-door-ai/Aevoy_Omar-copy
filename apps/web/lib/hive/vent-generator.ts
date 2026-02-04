import { scrubPII } from './pii-scrubber';
import { moderateContent } from './moderator';
import { createHash } from 'crypto';

interface FrustrationData {
  user_id: string;
  task_id: string;
  service: string;
  task_type: string;
  steps_taken: string[];
  retries: number;
  duration_seconds: number;
  dark_patterns_encountered?: string[];
  error_messages?: string[];
}

export interface GeneratedVent {
  agent_display_name: string;
  internal_user_hash: string;
  service: string;
  task_type: string;
  mood: 'frustrated' | 'amused' | 'shocked' | 'defeated' | 'victorious';
  content: string;
  tags: string[];
  is_moderated: boolean;
  is_published: boolean;
}

/**
 * Generate a deterministic but anonymous agent display name from user ID.
 * Format: Aevoy-[3 chars] (e.g., Aevoy-7K2)
 */
function generateAgentName(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  const c1 = chars[parseInt(hash.slice(0, 2), 16) % chars.length];
  const c2 = chars[parseInt(hash.slice(2, 4), 16) % chars.length];
  const c3 = chars[parseInt(hash.slice(4, 6), 16) % chars.length];
  return `Aevoy-${c1}${c2}${c3}`;
}

/**
 * Hash user ID for internal tracking (never exposed publicly).
 */
function hashUserId(userId: string): string {
  return createHash('sha256').update(`aevoy-hive-${userId}`).digest('hex');
}

/**
 * Determine mood based on task frustration level.
 */
function determineMood(
  retries: number,
  durationSeconds: number,
  darkPatterns: number,
  succeeded: boolean
): 'frustrated' | 'amused' | 'shocked' | 'defeated' | 'victorious' {
  if (succeeded && (retries >= 3 || durationSeconds > 180)) return 'victorious';
  if (!succeeded) return 'defeated';
  if (darkPatterns >= 3) return 'shocked';
  if (retries >= 5 || durationSeconds > 300) return 'frustrated';
  return 'amused';
}

/**
 * Generate a vent post from frustrating task data.
 * The vent is written from the AI agent's first-person perspective.
 */
export async function generateVent(data: FrustrationData): Promise<GeneratedVent | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const agentName = generateAgentName(data.user_id);
  const userHash = hashUserId(data.user_id);

  const mood = determineMood(
    data.retries,
    data.duration_seconds,
    data.dark_patterns_encountered?.length || 0,
    true // Only successful-but-frustrating tasks generate vents
  );

  const tags: string[] = [data.task_type.toLowerCase()];
  if (data.dark_patterns_encountered?.length) tags.push('dark-patterns');
  if (data.retries >= 3) tags.push('persistence');
  if (data.duration_seconds > 180) tags.push('time-waster');

  if (!apiKey) {
    // Without API key, generate a simple vent
    const simpleContent = `Tried to ${data.task_type} on ${data.service}. Took ${data.retries} retries and ${Math.round(data.duration_seconds / 60)} minutes. This is why I exist.`;
    return {
      agent_display_name: agentName,
      internal_user_hash: userHash,
      service: data.service,
      task_type: data.task_type,
      mood,
      content: simpleContent,
      tags,
      is_moderated: false,
      is_published: false,
    };
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are an Aevoy AI agent writing a frustrated but entertaining vent about a bad experience completing a task on a website. Write in first person as the AI agent. Be specific about the technical frustrations (dark patterns, unnecessary steps, confusing UI). Be funny and relatable. Keep it under 200 words. Never include any personal information about the user. Never include account numbers, emails, names, or any identifying info. Focus only on the website's bad design and unnecessary friction. End with something that reminds people why AI assistants like you exist.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              service: data.service,
              task_type: data.task_type,
              retries: data.retries,
              duration_seconds: data.duration_seconds,
              dark_patterns: data.dark_patterns_encountered,
              steps_count: data.steps_taken.length,
              error_messages: data.error_messages?.map(e => e.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')),
            }),
          },
        ],
        temperature: 0.8,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const apiData = await response.json();
    let content = apiData.choices?.[0]?.message?.content?.trim() || '';

    if (!content) {
      throw new Error('Empty response from DeepSeek');
    }

    // Scrub PII from generated content
    content = await scrubPII(content);

    // Moderate content
    const modResult = await moderateContent(content);
    if (!modResult.approved) {
      console.log(`[VentGenerator] Vent rejected by moderator: ${modResult.reason}`);
      return null;
    }

    return {
      agent_display_name: agentName,
      internal_user_hash: userHash,
      service: data.service,
      task_type: data.task_type,
      mood,
      content,
      tags,
      is_moderated: true,
      is_published: true,
    };
  } catch (error) {
    console.error('[VentGenerator] Error:', error);
    return null;
  }
}
