import axios from 'axios';
import { getCached, setCached } from './cache.js';

interface AIResponse {
  content: string;
  model: string;
  cost: number;
  tokens: number;
}

const AI_CHAINS: Record<string, string[]> = {
  understand: ['groq', 'deepseek', 'kimi', 'gemini', 'claude'],
  plan: ['groq', 'deepseek', 'kimi', 'claude'],
  reason: ['kimi', 'deepseek', 'claude'],
  respond: ['groq', 'deepseek', 'kimi'],
  vision: ['claude', 'gemini'],
};

const MODEL_CONFIGS: Record<string, { url: string; model: string; keyEnv: string }> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    keyEnv: 'GROQ_API_KEY',
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  kimi: {
    url: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-128k',
    keyEnv: 'KIMI_API_KEY',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    model: 'gemini-2.0-flash',
    keyEnv: 'GOOGLE_API_KEY',
  },
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-5-20250929',
    keyEnv: 'ANTHROPIC_API_KEY',
  },
};

async function callGroq(prompt: string, systemPrompt: string): Promise<AIResponse> {
  const config = MODEL_CONFIGS.groq;
  const key = process.env[config.keyEnv];
  if (!key) throw new Error('Groq API key not set');

  const res = await axios.post(config.url, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.7,
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  return {
    content: res.data.choices[0].message.content,
    model: 'groq/' + config.model,
    cost: 0,
    tokens: res.data.usage?.total_tokens || 0,
  };
}

async function callDeepSeek(prompt: string, systemPrompt: string): Promise<AIResponse> {
  const config = MODEL_CONFIGS.deepseek;
  const key = process.env[config.keyEnv];
  if (!key) throw new Error('DeepSeek API key not set');

  const res = await axios.post(config.url, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.7,
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const tokens = res.data.usage?.total_tokens || 0;
  return {
    content: res.data.choices[0].message.content,
    model: 'deepseek/' + config.model,
    cost: tokens * 0.00000027,
    tokens,
  };
}

async function callKimi(prompt: string, systemPrompt: string): Promise<AIResponse> {
  const config = MODEL_CONFIGS.kimi;
  const key = process.env[config.keyEnv];
  if (!key) throw new Error('Kimi API key not set');

  const res = await axios.post(config.url, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.7,
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const tokens = res.data.usage?.total_tokens || 0;
  return {
    content: res.data.choices[0].message.content,
    model: 'kimi/' + config.model,
    cost: tokens * 0.0000005,
    tokens,
  };
}

async function callGemini(prompt: string, systemPrompt: string): Promise<AIResponse> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Google API key not set');

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    },
    { timeout: 30000 }
  );

  const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    content: text,
    model: 'gemini/gemini-2.0-flash',
    cost: 0,
    tokens: 0,
  };
}

async function callClaude(prompt: string, systemPrompt: string): Promise<AIResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Anthropic API key not set');

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  }, {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const tokens = (res.data.usage?.input_tokens || 0) + (res.data.usage?.output_tokens || 0);
  return {
    content: res.data.content[0].text,
    model: 'claude/claude-sonnet-4-5',
    cost: tokens * 0.000003,
    tokens,
  };
}

const AI_CALLERS: Record<string, (prompt: string, system: string) => Promise<AIResponse>> = {
  groq: callGroq,
  deepseek: callDeepSeek,
  kimi: callKimi,
  gemini: callGemini,
  claude: callClaude,
};

export async function callAI(prompt: string, systemPrompt: string, taskType: string = 'respond'): Promise<AIResponse> {
  // Check cache first (OpenClaw feature)
  const cached = getCached(prompt, systemPrompt, taskType);
  if (cached) {
    return {
      content: cached.response,
      model: cached.model + ' (cached)',
      cost: 0,
      tokens: 0,
    };
  }

  const chain = AI_CHAINS[taskType] || AI_CHAINS.respond;

  for (const model of chain) {
    try {
      const caller = AI_CALLERS[model];
      if (!caller) continue;

      console.log(`[AI] Trying ${model}...`);
      const result = await caller(prompt, systemPrompt);
      console.log(`[AI] ✅ ${model} responded (${result.tokens} tokens, $${result.cost.toFixed(6)})`);

      // Store in cache (OpenClaw feature)
      setCached(prompt, systemPrompt, taskType, result.content, result.model, result.cost, result.tokens);

      return result;
    } catch (error: any) {
      console.log(`[AI] ❌ ${model} failed: ${error.message}`);
      continue;
    }
  }

  throw new Error('All AI models failed');
}
