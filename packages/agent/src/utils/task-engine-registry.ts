/**
 * Task-Engine Registry
 * Maps taskId → { engine, userId } so WebSocket takeover can look up active browser sessions.
 * Also tracks takeover pause state so the vision agent yields while user is in control.
 */

import type { ExecutionEngine } from '../execution/engine.js';

interface EngineEntry {
  engine: ExecutionEngine;
  userId: string;
  registeredAt: number;
  takeoverActive: boolean;
}

const registry = new Map<string, EngineEntry>();

export function registerEngine(taskId: string, engine: ExecutionEngine, userId: string): void {
  registry.set(taskId, { engine, userId, registeredAt: Date.now(), takeoverActive: false });
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

/** Called by the WebSocket handler when a user connects for takeover */
export function setTakeoverActive(taskId: string, active: boolean): void {
  const entry = registry.get(taskId);
  if (entry) {
    entry.takeoverActive = active;
    console.log(`[ENGINE-REGISTRY] Takeover ${active ? 'ACTIVE' : 'RELEASED'} for task ${taskId.slice(0, 8)}`);
  }
}

/** Called by the vision agent between steps to check if it should yield */
export function isTakeoverActive(taskId: string): boolean {
  const entry = registry.get(taskId);
  return entry?.takeoverActive ?? false;
}
