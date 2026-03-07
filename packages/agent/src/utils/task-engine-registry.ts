/**
 * Task-Engine Registry
 * Maps taskId → { engine, userId } so WebSocket takeover can look up active browser sessions.
 */

import type { ExecutionEngine } from '../execution/engine.js';

interface EngineEntry {
  engine: ExecutionEngine;
  userId: string;
  registeredAt: number;
}

const registry = new Map<string, EngineEntry>();

export function registerEngine(taskId: string, engine: ExecutionEngine, userId: string): void {
  registry.set(taskId, { engine, userId, registeredAt: Date.now() });
  console.log(`[ENGINE-REGISTRY] Registered engine for task ${taskId.slice(0, 8)}`);
}

export function unregisterEngine(taskId: string): void {
  if (registry.delete(taskId)) {
    console.log(`[ENGINE-REGISTRY] Unregistered engine for task ${taskId.slice(0, 8)}`);
  }
}

export function getEngine(taskId: string): EngineEntry | undefined {
  return registry.get(taskId);
}

export function getRegistrySize(): number {
  return registry.size;
}
