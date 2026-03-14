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
  description: 'Search the web for information. Returns search results with titles, URLs, and snippets.',
  category: 'data',
  parameters: {
    query: { type: 'string', description: 'Search query' },
  },
  required: ['query'],
  async execute(params): Promise<ToolCallResult> {
    const query = String(params.query);
    try {
      // Use DuckDuckGo instant answer API
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        return { success: false, error: `Search API returned ${res.status}`, cost: 0 };
      }

      const data = await res.json();
      const results: string[] = [];

      if (data.AbstractText) {
        results.push(`Summary: ${data.AbstractText}`);
        if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`);
      }

      if (data.RelatedTopics?.length) {
        results.push('\nRelated:');
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text) {
            results.push(`- ${topic.Text.substring(0, 200)}${topic.FirstURL ? ` (${topic.FirstURL})` : ''}`);
          }
        }
      }

      if (results.length === 0) {
        // DuckDuckGo had no instant answer — return a message suggesting browser search
        return {
          success: true,
          data: `No instant results for "${query}". Try using browser_session to search Google or visit specific websites.`,
          cost: 0,
        };
      }

      return { success: true, data: results.join('\n'), cost: 0 };
    } catch (err) {
      return { success: false, error: 'Web search failed', cost: 0 };
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
