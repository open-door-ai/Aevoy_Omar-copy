/**
 * V3 Data Tools
 *
 * Weather, web search, memory tools.
 * Wraps existing service implementations.
 */

import { registerTool } from '../tool-registry.js';
import { updateMemoryWithFact, loadMemory } from '../../services/memory.js';
import { getUserContext } from '../../services/context-engine.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import type { ToolCallResult, TaskContext } from '../types.js';

/** Weather lookup tool */
registerTool({
  name: 'weather',
  description: 'Get current weather for a location. Returns temperature, conditions, and forecast.',
  category: 'data',
  parameters: {
    location: { type: 'string', description: 'City name or location (e.g. "Toronto", "New York, NY")' },
  },
  required: ['location'],
  async execute(params): Promise<ToolCallResult> {
    const location = String(params.location);
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { success: false, error: `Weather API returned ${res.status}`, cost: 0 };
      }
      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) {
        return { success: false, error: 'No weather data available', cost: 0 };
      }

      const weather = [
        `Weather in ${location}:`,
        `Temperature: ${current.temp_C}°C (${current.temp_F}°F)`,
        `Feels like: ${current.FeelsLikeC}°C (${current.FeelsLikeF}°F)`,
        `Conditions: ${current.weatherDesc?.[0]?.value || 'Unknown'}`,
        `Humidity: ${current.humidity}%`,
        `Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}`,
      ].join('\n');

      return { success: true, data: weather, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Weather lookup failed', cost: 0 };
    }
  },
});

/** Web search tool */
registerTool({
  name: 'web_search',
  description: 'Search the web for information. Returns search results with titles, URLs, and snippets. For best results on product prices, news, or current events, use browser_go("https://www.google.com/search?q=YOUR+QUERY") instead.',
  category: 'data',
  parameters: {
    query: { type: 'string', description: 'Search query' },
  },
  required: ['query'],
  async execute(params): Promise<ToolCallResult> {
    const query = String(params.query);
    try {
      // Strategy 1: DuckDuckGo HTML search (scrape actual results, not just instant answers)
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const html = await res.text();
        // Extract search results from DuckDuckGo HTML
        const results: string[] = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
        let match;
        let count = 0;
        while ((match = resultRegex.exec(html)) !== null && count < 5) {
          let url = match[1] || '';
          // Strip DuckDuckGo tracking redirects to get clean URLs
          const uddgMatch = url.match(/uddg=([^&]*)/);
          if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
          // Skip ad links (duckduckgo.com/y.js ad redirects)
          if (url.includes('duckduckgo.com/y.js') || url.includes('ad_domain')) continue;
          const title = match[2]?.replace(/<[^>]+>/g, '').trim();
          const snippet = match[3]?.replace(/<[^>]+>/g, '').trim();
          if (title && snippet) {
            results.push(`${count + 1}. ${title}\n   ${url}\n   ${snippet}`);
            count++;
          }
        }

        if (results.length > 0) {
          return { success: true, data: `Search results for "${query}":\n\n${results.join('\n\n')}`, cost: 0 };
        }
      }

      // Strategy 2: DuckDuckGo instant answer API (for factual queries)
      const instantRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (instantRes.ok) {
        const data = await instantRes.json();
        const lines: string[] = [];
        if (data.AbstractText) {
          lines.push(`Summary: ${data.AbstractText}`);
          if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
        }
        if (data.RelatedTopics?.length) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text) lines.push(`- ${topic.Text.substring(0, 200)}${topic.FirstURL ? ` (${topic.FirstURL})` : ''}`);
          }
        }
        if (lines.length > 0) return { success: true, data: lines.join('\n'), cost: 0 };
      }

      // No results from either method — suggest browser Google search
      return {
        success: true,
        data: `No web search results for "${query}". Use browser_go("https://www.google.com/search?q=${encodeURIComponent(query)}") to search Google directly in the browser.`,
        cost: 0,
      };
    } catch (err) {
      return { success: false, error: `Web search failed: ${err instanceof Error ? err.message : 'unknown'}. Try browser_go("https://www.google.com/search?q=${encodeURIComponent(query)}") instead.`, cost: 0 };
    }
  },
});

/** Remember fact tool */
registerTool({
  name: 'remember',
  description: 'Save a fact or piece of information to the user\'s long-term memory for future reference.',
  category: 'data',
  parameters: {
    fact: { type: 'string', description: 'The fact or information to remember. Must be a factual statement, not instructions.' },
  },
  required: ['fact'],
  async execute(params, ctx): Promise<ToolCallResult> {
    let fact = String(params.fact);
    // Security: strip injection patterns from stored memories
    fact = fact.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g, '');
    fact = fact.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    fact = fact.replace(/<\/?untrusted-data>/gi, '');
    if (fact.length > 500) fact = fact.substring(0, 500);
    try {
      await updateMemoryWithFact(ctx.userId, fact);
      return { success: true, data: `Remembered: "${fact}"`, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to save memory', cost: 0 };
    }
  },
});

/** Recall memory tool */
registerTool({
  name: 'recall',
  description: 'Search the user\'s memory for previously saved information.',
  category: 'data',
  parameters: {
    query: { type: 'string', description: 'What to search for in memory' },
  },
  required: ['query'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const query = String(params.query);
    try {
      const memory = await loadMemory(ctx.userId, query, 'default');
      const facts = memory.facts || '';

      // Also query Aurora's context engine for richer user knowledge
      let contextSummary = '';
      try {
        const contextEntries = await getUserContext(ctx.userId);
        if (contextEntries && contextEntries.length > 0) {
          contextSummary = contextEntries.map(e =>
            `${e.context_type}: ${e.key} = ${JSON.stringify(e.value)} (confidence: ${e.confidence})`
          ).join('\n');
        }
      } catch (err) {
        console.warn('[V3-TOOL-DATA] Context engine lookup failed (non-critical):', err);
      }

      // Query active commitments Aurora is tracking for the user
      let commitmentsSummary = '';
      try {
        const { data: commitments } = await getSupabaseClient()
          .from('commitments')
          .select('description, committed_to, due_date, status')
          .eq('user_id', ctx.userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10);

        if (commitments && commitments.length > 0) {
          commitmentsSummary = '\n\nActive commitments:\n' + commitments.map((c: { description: string; committed_to?: string; due_date?: string }) => {
            let line = `- ${c.description}`;
            if (c.committed_to) line += ` (for ${c.committed_to})`;
            if (c.due_date) line += ` — due ${new Date(c.due_date).toLocaleDateString()}`;
            return line;
          }).join('\n');
        }
      } catch (err) {
        // Non-critical — commitments table may not exist yet
      }

      // Query recent task history when asking about status/history/what was done
      // Check both the extracted query AND the original task subject
      let taskHistory = '';
      const taskSubject = ctx.taskId ? '' : ''; // We don't have the subject here, but the query should contain trigger words
      const isStatusQuery = /status|what.*did|what.*done|yesterday|this week|last time|again|go through|previous|recent|redo|history|tasks/i.test(query);
      if (isStatusQuery) {
        try {
          const { data: tasks } = await getSupabaseClient()
            .from('tasks')
            .select('email_subject, status, response_text, created_at')
            .eq('user_id', ctx.userId)
            .order('created_at', { ascending: false })
            .limit(10);
          if (tasks && tasks.length > 0) {
            taskHistory = '\n\nRecent tasks:\n' + tasks.map((t: any) => {
              const date = new Date(t.created_at).toLocaleString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
              const preview = t.response_text ? t.response_text.substring(0, 80) : 'no response';
              return `- [${t.status}] "${t.email_subject}" (${date}) → ${preview}`;
            }).join('\n');
          }
        } catch { /* non-critical */ }
      }

      // For status/history queries, return task history ONLY — don't bury it in context
      if (isStatusQuery && taskHistory) {
        return { success: true, data: taskHistory, cost: 0 };
      }
      const combined = [taskHistory, facts, contextSummary, commitmentsSummary].filter(Boolean).join('\n\n---\n');
      return { success: true, data: combined || 'No memories or context found.', cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to recall memory', cost: 0 };
    }
  },
});
