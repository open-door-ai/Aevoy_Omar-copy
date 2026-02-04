import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '../_rate-limit';

const DAY_MS = 86_400_000;

const SYSTEM_PROMPT = `You are Aevoy, an AI employee that actually does things. The user is testing you with a question on our landing page demo.

Rules:
- Give a concise, actionable answer in under 300 words.
- Be specific with names, prices, addresses when possible.
- If the query is about finding something (restaurant, product, service), give a concrete recommendation.
- No disclaimers. No "I'm just an AI". Answer as if you're a competent employee who did the research.
- Format with short paragraphs. Use bold for key info if helpful.`;

/**
 * POST /api/demo/task — Run a demo AI query
 * Body: { query: string }
 * Rate limit: 10 tasks/day per IP
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    if (!checkRateLimit('demo-task', ip, 10, DAY_MS)) {
      return NextResponse.json(
        { error: 'Demo limit reached (10/day). Sign up for unlimited access!' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const query = String(body.query || '').trim();

    if (query.length < 5 || query.length > 500) {
      return NextResponse.json(
        { error: 'Query must be between 5 and 500 characters.' },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      // Try Gemini Flash first (free)
      if (process.env.GOOGLE_API_KEY) {
        const result = await callGemini(query, controller.signal);
        if (result) {
          clearTimeout(timeout);
          return NextResponse.json({ result: result.content, model: 'gemini-2.0-flash' });
        }
      }

      // Fallback to DeepSeek
      if (process.env.DEEPSEEK_API_KEY) {
        const result = await callDeepSeek(query, controller.signal);
        if (result) {
          clearTimeout(timeout);
          return NextResponse.json({ result: result.content, model: 'deepseek-chat' });
        }
      }

      clearTimeout(timeout);
      return NextResponse.json(
        { error: 'AI service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timed out. Try a simpler query.' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[DEMO/TASK] Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

async function callGemini(query: string, signal: AbortSignal): Promise<{ content: string } | null> {
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GOOGLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: query },
          ],
          max_tokens: 1024,
        }),
        signal,
      }
    );

    if (!res.ok) {
      console.error('[DEMO/TASK] Gemini API failed:', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) console.error('[DEMO/TASK] Gemini returned empty content');
    return content ? { content } : null;
  } catch (err) {
    console.error('[DEMO/TASK] Gemini call error:', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}

async function callDeepSeek(query: string, signal: AbortSignal): Promise<{ content: string } | null> {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
      signal,
    });

    if (!res.ok) {
      console.error('[DEMO/TASK] DeepSeek API failed:', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) console.error('[DEMO/TASK] DeepSeek returned empty content');
    return content ? { content } : null;
  } catch (err) {
    console.error('[DEMO/TASK] DeepSeek call error:', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}
