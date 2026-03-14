/**
 * V3 Processor — Public API
 *
 * Entry point for the V3 tiered processor architecture.
 */

export { processTaskV3 } from './processor-v3.js';
export type { TaskTier, TierClassification, ToolDefinition, ToolCallResult, TaskContext } from './types.js';
export { registerTool, getTool, getAllTools } from './tool-registry.js';
