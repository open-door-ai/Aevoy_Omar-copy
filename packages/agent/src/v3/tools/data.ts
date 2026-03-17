/**
 * V3 Data Tools
 *
 * Weather, web search, memory tools.
 * Wraps existing service implementations.
 */

import { registerTool } from '../tool-registry.js';
import { updateMemoryWithFact, loadMemory } from '../../services/memory.js';
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
        while ((match = resultRegex.exec(html)) !== null && count < 8) {
          const url = match[1]?.replace(/.*uddg=([^&]*).*/, (_, u) => decodeURIComponent(u)) || match[1];
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
      const facts = memory.facts || 'No memories found.';
      return { success: true, data: facts, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to recall memory', cost: 0 };
    }
  },
});
