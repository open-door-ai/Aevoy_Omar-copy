/**
 * Dynamic Tool Loader — reduces context window usage per tier
 *
 * Instead of sending all 30+ tool schemas (~8K tokens) with every LLM call,
 * this module loads only the tools relevant to the classified tier.
 *
 * Instant tasks get ~2 tools (recall, weather).
 * Single-tool tasks get ~15 tools (communication, calendar, content, etc.).
 * Multi-step tasks get everything.
 *
 * If the LLM requests a tool that wasn't loaded, expandTools() widens the
 * set and the request is retried — no tool call is ever silently dropped.
 */

import type { ToolDefinition } from './types.js';
import { getAllTools } from './tool-registry.js';

// ── Tool categories — group tools by function (not by ToolDefinition.category) ──

const TOOL_CATEGORIES: Record<string, readonly string[]> = {
  communication: ['send_email', 'send_sms', 'send_telegram', 'send_whatsapp', 'make_call'],
  information: ['web_search', 'weather', 'recall'],
  calendar: ['check_calendar', 'create_event'],
  task: ['schedule_task', 'remember'],
  browser: ['browser_go', 'browser_snapshot', 'browser_click', 'browser_click_text',
    'browser_fill', 'browser_scroll', 'browser_type', 'browser_press',
    'browser_read', 'browser_screenshot', 'browser_click_xy', 'browser_locate',
    'browser_select', 'browser_wait', 'browser_agent', 'browser_session'],
  user: ['ask_user'],
  content: ['generate_image', 'create_document'],
  inbox: ['read_inbox'],
} as const;

// ── Tier -> which tool categories to load ──

const TIER_TOOL_CATEGORIES: Record<string, readonly string[]> = {
  instant: ['information'],
  single_tool: ['communication', 'calendar', 'task', 'information', 'inbox', 'user', 'content'],
  multi_step: Object.keys(TOOL_CATEGORIES),
  autonomous: Object.keys(TOOL_CATEGORIES),
};

/**
 * Get the tool names that should be loaded for a given tier.
 * Returns a flat array of tool name strings.
 */
function getToolNamesForTier(tier: string): string[] {
  const categories = TIER_TOOL_CATEGORIES[tier] || TIER_TOOL_CATEGORIES.multi_step;
  const names: string[] = [];
  for (const cat of categories) {
    const catTools = TOOL_CATEGORIES[cat];
    if (catTools) {
      names.push(...catTools);
    }
  }
  return names;
}

/**
 * Load only the tools relevant to the classified tier.
 *
 * @param tier - The classified task tier (instant, single_tool, multi_step, autonomous)
 * @param allToolDefinitions - The full registry of tool definitions (from getAllTools())
 * @returns Filtered array of ToolDefinitions matching the tier's categories
 */
export function loadToolsForTier(
  tier: string,
  allToolDefinitions: ToolDefinition[]
): ToolDefinition[] {
  const allowedNames = new Set(getToolNamesForTier(tier));
  const filtered = allToolDefinitions.filter(t => allowedNames.has(t.name));

  console.log(
    `[TOOL-LOADER] Tier "${tier}": loaded ${filtered.length}/${allToolDefinitions.length} tools ` +
    `(categories: ${(TIER_TOOL_CATEGORIES[tier] || TIER_TOOL_CATEGORIES.multi_step).join(', ')})`
  );

  return filtered;
}

/**
 * Get the tool names loaded for a tier (without needing the full definitions).
 * Useful for passing to formatToolDescriptions() and buildFunctionSchemas().
 */
export function getToolNamesForTierClassification(tier: string): string[] {
  return getToolNamesForTier(tier);
}

/**
 * Expand the loaded tool set when the LLM requests a tool that wasn't loaded.
 *
 * Strategy: instead of adding just the one missing tool (which might lead to
 * repeated expansions), we expand to the full tool set. This ensures the retry
 * succeeds and avoids multiple expansion cycles.
 *
 * @param currentToolNames - The tool names that were loaded for the current request
 * @param requestedToolName - The tool name the LLM tried to use but wasn't available
 * @param allToolDefinitions - The full registry of tool definitions
 * @returns The expanded array of ToolDefinitions (full set)
 */
export function expandTools(
  currentToolNames: string[],
  requestedToolName: string,
  allToolDefinitions: ToolDefinition[]
): ToolDefinition[] {
  const currentSet = new Set(currentToolNames);
  const wasLoaded = currentSet.has(requestedToolName);
  const allNames = allToolDefinitions.map(t => t.name);

  console.log(
    `[TOOL-LOADER] Expanding tools: "${requestedToolName}" was ${wasLoaded ? 'loaded but failed' : 'NOT loaded'}. ` +
    `Expanding from ${currentToolNames.length} → ${allToolDefinitions.length} tools`
  );

  // Return all tools — guarantees the requested tool is available if it's registered
  return allToolDefinitions;
}

/**
 * Check whether a tool name is in the currently loaded set.
 */
export function isToolLoaded(toolName: string, loadedToolNames: string[]): boolean {
  return loadedToolNames.includes(toolName);
}
