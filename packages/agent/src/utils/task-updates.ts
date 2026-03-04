/**
 * Mid-task user update injection
 *
 * When a user sends a new message while a task is already running,
 * this module allows the update to be injected into the running task's
 * context on the next iteration, rather than starting a whole new task.
 */

interface ActiveTaskInfo {
  taskId: string;
  subject: string;
  updates: string[];
  startedAt: number;
}

const activeTasksByUser = new Map<string, ActiveTaskInfo>();

export function registerActiveTask(userId: string, taskId: string, subject: string): void {
  activeTasksByUser.set(userId, {
    taskId,
    subject,
    updates: [],
    startedAt: Date.now(),
  });
}

export function unregisterActiveTask(userId: string): void {
  activeTasksByUser.delete(userId);
}

export function getActiveTaskInfo(userId: string): ActiveTaskInfo | undefined {
  return activeTasksByUser.get(userId);
}

export function injectTaskUpdate(userId: string, update: string): boolean {
  const info = activeTasksByUser.get(userId);
  if (!info) return false;
  info.updates.push(update);
  console.log(`[TASK-UPDATE] Injected update for user ${userId.substring(0, 8)}: "${update.substring(0, 80)}"`);
  return true;
}

/** Returns and clears all pending updates for a user's running task. */
export function consumeTaskUpdates(userId: string): string[] {
  const info = activeTasksByUser.get(userId);
  if (!info || info.updates.length === 0) return [];
  const updates = [...info.updates];
  info.updates = [];
  return updates;
}

/** How similar is a new message to the currently running task? */
export function classifyUpdateRelevance(
  newMessage: string,
  activeSubject: string
): 'obvious_update' | 'likely_update' | 'new_task' {
  const msg = newMessage.toLowerCase().trim();
  const subject = activeSubject.toLowerCase();

  // Very short messages are almost always clarifications/updates
  if (msg.length < 80) return 'obvious_update';

  // References to "it", "that", "the task", "instead" suggest update
  if (/\b(instead|actually|change it|update it|make it|nevermind|wait|hold on|cancel|stop)\b/.test(msg)) {
    return 'obvious_update';
  }

  // Shares key nouns with the active task
  const taskWords = new Set(subject.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 4));
  const msgWords = msg.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 4);
  const overlap = msgWords.filter(w => taskWords.has(w)).length;
  if (overlap >= 2) return 'likely_update';

  return 'new_task';
}
