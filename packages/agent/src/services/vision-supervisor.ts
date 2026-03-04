import { getSupabaseClient } from '../utils/supabase.js';

/**
 * Adaptive Timeout Supervisor
 *
 * Replaces the dumb Promise.race([task, setTimeout(reject, 8min)]) with a
 * progress-aware supervisor. Every CHECK_INTERVAL_MS it looks at the task's
 * action_success_count in Supabase. If the count is growing the agent is
 * actively making forward progress, so the timeout is extended by EXTENSION_MS.
 * Maximum MAX_EXTENSIONS extensions are granted, giving up to:
 *   base (8 or 12 min) + 2 × 3 min = up to 18 min for a complex booking.
 */

const MAX_EXTENSIONS   = 2;
const EXTENSION_MS     = 180_000;  // 3 minutes per extension
const CHECK_INTERVAL_MS = 90_000;  // poll every 90 s

export async function runWithAdaptiveTimeout<T>(
  taskPromise: Promise<T>,
  taskId: string,
  baseTimeoutMs: number,
  taskDescription: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let totalTimeoutMs   = baseTimeoutMs;
    let extensionCount   = 0;
    let resolved         = false;
    let lastActionCount  = -1;   // -1 = not yet sampled

    const startTime = Date.now();

    // Forward task resolution/rejection immediately once it settles.
    taskPromise.then(result => {
      if (!resolved) { resolved = true; resolve(result); }
    }).catch(err => {
      if (!resolved) { resolved = true; reject(err); }
    });

    // ── Progress checker ────────────────────────────────────────────
    const checkProgress = async (): Promise<void> => {
      if (resolved) return;

      const elapsed   = Date.now() - startTime;
      const remaining = totalTimeoutMs - elapsed;

      if (remaining > CHECK_INTERVAL_MS) {
        // Plenty of time left — schedule the next check near the deadline.
        const nextCheckDelay = Math.max(remaining - CHECK_INTERVAL_MS, CHECK_INTERVAL_MS);
        setTimeout(() => { void checkProgress(); }, nextCheckDelay);
        return;
      }

      // We are within one CHECK_INTERVAL of the deadline.
      if (remaining > 0) {
        // Wait out the remaining window, then decide.
        setTimeout(() => { void checkProgress(); }, remaining);
        return;
      }

      // ── Deadline reached ─────────────────────────────────────────
      if (extensionCount < MAX_EXTENSIONS) {
        try {
          const { data: task } = await getSupabaseClient()
            .from('tasks')
            .select('action_success_count')
            .eq('id', taskId)
            .single();

          const currentCount = (task?.action_success_count as number) ?? 0;
          const isProgressing = lastActionCount < 0
            ? currentCount > 0               // first sample: any actions = progressing
            : currentCount > lastActionCount; // subsequent: count must have grown

          lastActionCount = currentCount;

          if (isProgressing) {
            extensionCount++;
            totalTimeoutMs += EXTENSION_MS;

            console.log(
              `[SUPERVISOR] Task ${taskId.slice(0, 8)} making progress ` +
              `(${currentCount} actions) — extending by 3 min ` +
              `(extension ${extensionCount}/${MAX_EXTENSIONS})`
            );

            // Best-effort progress note visible in dashboard.
            void getSupabaseClient()
              .from('tasks')
              .update({
                progress_message:
                  `[SUPERVISOR] Timeout extended (${extensionCount}/${MAX_EXTENSIONS}) — agent making progress`,
              })
              .eq('id', taskId);

            // Schedule next check at the new deadline.
            setTimeout(() => { void checkProgress(); }, EXTENSION_MS);
            return;
          }
        } catch {
          /* best effort — if DB call fails, fall through and time out */
        }
      }

      // No progress, or max extensions already used — abort.
      if (!resolved) {
        resolved = true;
        const elapsedMin = ((Date.now() - startTime) / 60_000).toFixed(1);
        console.log(
          `[SUPERVISOR] Task ${taskId.slice(0, 8)} timed out after ${elapsedMin} min ` +
          `(${extensionCount}/${MAX_EXTENSIONS} extensions used) — "${taskDescription.slice(0, 60)}"`
        );
        reject(
          new Error(
            `Vision agent timeout after ${elapsedMin} minutes` +
            (extensionCount > 0 ? ` (${extensionCount} extension${extensionCount > 1 ? 's' : ''} granted)` : '')
          )
        );
      }
    };

    // Schedule the first check to fire just before the baseline deadline.
    const firstCheckDelay = Math.max(totalTimeoutMs - CHECK_INTERVAL_MS * 2, totalTimeoutMs / 2);
    setTimeout(() => { void checkProgress(); }, firstCheckDelay);
  });
}
