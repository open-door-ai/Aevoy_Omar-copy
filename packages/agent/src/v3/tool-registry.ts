/**
 * V3 Tool Registry
 *
 * Central registry for all tools the AI can call.
 * Each tool has a JSON schema, description, and execute function.
 * Replaces the 40+ ACTION types parsed from [ACTION:...] strings.
 */

import type { ToolDefinition, ToolCallResult, ToolCall, TaskContext } from './types.js';

// ── Tool Registry ──

const tools: Map<string, ToolDefinition> = new Map();

/** Register a tool */
export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool);
}

/** Get a tool by name */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

/** Get all registered tools */
export function getAllTools(): ToolDefinition[] {
  return Array.from(tools.values());
}

/** Execute a tool call */
export async function executeToolCall(
  call: ToolCall,
  ctx: TaskContext
): Promise<ToolCallResult> {
  const tool = tools.get(call.name);
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${call.name}. Available tools: ${Array.from(tools.keys()).join(', ')}`,
      cost: 0,
    };
  }

  const startTime = Date.now();
  // Browser tools need up to 15 minutes (vision agent has 13-min internal timeout)
  const timeoutMs = tool.category === 'browser' ? 900000 : 120000;
  try {
    const result = await Promise.race([
      tool.execute(call.arguments, ctx),
      new Promise<ToolCallResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${call.name} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);

    console.log(`[V3-TOOL] ${call.name} ${result.success ? 'OK' : 'FAIL'} (${Date.now() - startTime}ms, $${result.cost.toFixed(4)})`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[V3-TOOL] ${call.name} ERROR (${Date.now() - startTime}ms):`, errorMsg);
    return {
      success: false,
      error: `Tool ${call.name} failed: ${errorMsg}`,
      cost: 0,
    };
  }
}

/**
 * Build tool descriptions for the AI system prompt.
 * Returns a formatted string describing all available tools.
 * Optionally filters to only specific tool names for reduced context window usage.
 */
export function formatToolDescriptions(toolNames?: string[]): string {
  let toolList = getAllTools();
  if (toolNames) {
    const nameSet = new Set(toolNames);
    toolList = toolList.filter(t => nameSet.has(t.name));
  }
  if (toolList.length === 0) return 'No tools available.';

  return toolList.map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([name, param]) => {
        const req = tool.required?.includes(name) ? ' (required)' : ' (optional)';
        return `    - ${name}: ${param.type}${req} — ${param.description}${param.enum ? ` [${param.enum.join(', ')}]` : ''}`;
      })
      .join('\n');

    return `${tool.name}: ${tool.description}\n  Parameters:\n${params}`;
  }).join('\n\n');
}

/**
 * Build OpenAI-compatible function schemas for native tool calling.
 * Supports filtering by category (legacy) or by explicit tool name list (dynamic loading).
 * For browser tasks: pass 'browser' to only include browser tools + web_search.
 */
export function buildFunctionSchemas(categoryOrNames?: string | string[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}> {
  let toolList = getAllTools();
  if (Array.isArray(categoryOrNames)) {
    // Filter by explicit tool name list (dynamic tool loading)
    const nameSet = new Set(categoryOrNames);
    toolList = toolList.filter(t => nameSet.has(t.name));
  } else if (categoryOrNames) {
    // Legacy: filter by ToolDefinition.category + always include web_search and ask_user
    toolList = toolList.filter(t => t.category === categoryOrNames || t.name === 'web_search' || t.name === 'ask_user');
  }
  return toolList.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([name, param]) => [
            name,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
              ...(param.default !== undefined ? { default: param.default } : {}),
            },
          ])
        ),
        ...(tool.required?.length ? { required: tool.required } : {}),
      },
    },
  }));
}

/**
 * Parse tool calls from a text response (fallback for models without native tool calling).
 * Looks for JSON blocks like: {"tool": "name", "arguments": {...}}
 */
export function parseToolCallsFromText(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Match JSON code blocks
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
  let match;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && parsed.arguments) {
        calls.push({ name: parsed.tool, arguments: parsed.arguments });
      }
    } catch { /* ignore malformed JSON */ }
  }

  // Also match inline JSON objects with "tool" key
  if (calls.length === 0) {
    const inlineRegex = /\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool && parsed.arguments) {
          calls.push({ name: parsed.tool, arguments: parsed.arguments });
        }
      } catch { /* ignore */ }
    }
  }

  return calls;
}
