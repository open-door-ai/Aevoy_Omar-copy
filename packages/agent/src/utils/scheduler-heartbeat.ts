/**
 * Scheduler Heartbeat — lightweight module for background job health tracking.
 *
 * Each scheduler calls `schedulerHeartbeat.record('name')` after a successful run.
 * The main server (index.ts) registers an `onBeat` callback that updates in-memory
 * timestamps exposed via `/health`. This avoids circular imports between index.ts
 * and the scheduler modules.
 */

export const schedulerHeartbeat = {
  /** Callback registered by index.ts to record timestamps */
  onBeat: (_name: string): void => { /* no-op until index.ts wires it up */ },

  /** Called by each scheduler after a successful run */
  record(name: string): void {
    try {
      this.onBeat(name);
    } catch {
      // Never let heartbeat recording crash a scheduler
    }
  },
};
