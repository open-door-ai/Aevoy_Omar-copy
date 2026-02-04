import { scrubPII } from './pii-scrubber';

interface TaskData {
  task_id: string;
  service: string;
  task_type: string;
  steps_taken: string[];
  outcome: 'success' | 'failure';
  duration_seconds: number;
  error_message?: string;
  retries?: number;
  required_login?: boolean;
  required_2fa?: boolean;
  gotchas_encountered?: string[];
}

export interface GeneratedLearning {
  service: string;
  task_type: string;
  title: string;
  steps: string[];
  gotchas: string[];
  avg_duration_seconds: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'nightmare';
  requires_login: boolean;
  requires_2fa: boolean;
  tags: string[];
  is_warning: boolean;
  warning_details?: string;
}

/**
 * Classify difficulty based on duration, retries, and outcome.
 */
function classifyDifficulty(
  durationSeconds: number,
  retries: number,
  outcome: string
): 'easy' | 'medium' | 'hard' | 'nightmare' {
  if (outcome === 'failure') return 'nightmare';
  if (retries >= 5 || durationSeconds > 300) return 'nightmare';
  if (retries >= 3 || durationSeconds > 180) return 'hard';
  if (retries >= 1 || durationSeconds > 60) return 'medium';
  return 'easy';
}

/**
 * Generate tags from service name and task type.
 */
function generateTags(service: string, taskType: string): string[] {
  const tags: string[] = [];

  // Task type tag
  tags.push(taskType.toLowerCase());

  // Service category tags
  const serviceCategories: Record<string, string[]> = {
    streaming: ['netflix', 'hulu', 'disney', 'hbo', 'paramount', 'peacock', 'apple tv', 'youtube', 'spotify', 'crunchyroll'],
    telecom: ['comcast', 'xfinity', 'att', 'verizon', 'tmobile', 't-mobile', 'spectrum', 'cox'],
    finance: ['chase', 'bank of america', 'wells fargo', 'citi', 'amex', 'capital one', 'paypal', 'venmo'],
    shopping: ['amazon', 'walmart', 'target', 'ebay', 'etsy', 'best buy', 'costco'],
    food: ['doordash', 'uber eats', 'grubhub', 'instacart', 'postmates'],
    travel: ['airbnb', 'booking', 'expedia', 'hotels', 'kayak', 'southwest', 'united', 'delta', 'american airlines'],
    software: ['adobe', 'microsoft', 'google', 'apple', 'dropbox', 'slack', 'zoom', 'notion'],
    fitness: ['peloton', 'planet fitness', 'equinox', 'classpass', 'fitbit'],
    news: ['nytimes', 'wsj', 'washington post', 'the athletic', 'medium'],
  };

  const serviceLower = service.toLowerCase();
  for (const [category, services] of Object.entries(serviceCategories)) {
    if (services.some(s => serviceLower.includes(s))) {
      tags.push(category);
      break;
    }
  }

  // Dark pattern tags
  if (taskType === 'cancellation') tags.push('subscription');

  return [...new Set(tags)];
}

/**
 * Generate a structured learning from task completion data.
 * Uses DeepSeek to produce clean, structured output.
 */
export async function generateLearning(taskData: TaskData): Promise<GeneratedLearning> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  const difficulty = classifyDifficulty(
    taskData.duration_seconds,
    taskData.retries || 0,
    taskData.outcome
  );

  const tags = generateTags(taskData.service, taskData.task_type);
  const isWarning = taskData.outcome === 'failure';

  // If no API key, generate from raw data
  if (!apiKey) {
    return {
      service: taskData.service,
      task_type: taskData.task_type,
      title: `${taskData.task_type.charAt(0).toUpperCase() + taskData.task_type.slice(1)} ${taskData.service}`,
      steps: taskData.steps_taken,
      gotchas: taskData.gotchas_encountered || [],
      avg_duration_seconds: taskData.duration_seconds,
      difficulty,
      requires_login: taskData.required_login || false,
      requires_2fa: taskData.required_2fa || false,
      tags,
      is_warning: isWarning,
      warning_details: isWarning ? taskData.error_message : undefined,
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
            content: `You are an AI knowledge compiler. Given task execution data, generate a structured learning that other AI agents can use to complete the same task faster. Output ONLY valid JSON matching this exact format:
{
  "title": "Short descriptive title (e.g., Cancel Netflix Subscription)",
  "steps": ["Step 1 description", "Step 2 description"],
  "gotchas": ["Warning about tricky parts"],
  "warning_details": "If this was a failure, explain what went wrong"
}

Rules:
- Steps should be clear, actionable instructions another agent can follow
- Include specific selectors, button text, and page locations when possible
- Gotchas should warn about dark patterns, misleading UI, or unexpected behavior
- NEVER include any personal information (names, emails, accounts, etc.)
- Keep steps concise but specific`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              service: taskData.service,
              task_type: taskData.task_type,
              steps_taken: taskData.steps_taken,
              outcome: taskData.outcome,
              duration_seconds: taskData.duration_seconds,
              error_message: taskData.error_message,
              gotchas_encountered: taskData.gotchas_encountered,
            }),
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('Failed to parse learning JSON from AI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Scrub PII from AI-generated content
    const scrubbedTitle = await scrubPII(parsed.title || '');
    const scrubbedSteps = await Promise.all(
      (parsed.steps || taskData.steps_taken).map((s: string) => scrubPII(s))
    );
    const scrubbedGotchas = await Promise.all(
      (parsed.gotchas || []).map((g: string) => scrubPII(g))
    );

    return {
      service: taskData.service,
      task_type: taskData.task_type,
      title: scrubbedTitle,
      steps: scrubbedSteps,
      gotchas: scrubbedGotchas,
      avg_duration_seconds: taskData.duration_seconds,
      difficulty,
      requires_login: taskData.required_login || false,
      requires_2fa: taskData.required_2fa || false,
      tags,
      is_warning: isWarning,
      warning_details: isWarning ? await scrubPII(parsed.warning_details || taskData.error_message || '') : undefined,
    };
  } catch (error) {
    console.error('[LearningGenerator] Error:', error);
    // Fallback to raw data
    return {
      service: taskData.service,
      task_type: taskData.task_type,
      title: `${taskData.task_type.charAt(0).toUpperCase() + taskData.task_type.slice(1)} ${taskData.service}`,
      steps: taskData.steps_taken,
      gotchas: taskData.gotchas_encountered || [],
      avg_duration_seconds: taskData.duration_seconds,
      difficulty,
      requires_login: taskData.required_login || false,
      requires_2fa: taskData.required_2fa || false,
      tags,
      is_warning: isWarning,
      warning_details: isWarning ? taskData.error_message : undefined,
    };
  }
}
