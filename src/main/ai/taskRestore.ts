import type { AgentTask } from '@shared/ipc'

/** The error stamped on a task that was mid-flight (queued/running) when the app closed. */
export const INTERRUPTED_MSG = 'Interrupted when the app closed — re-run if you still need this edit.'

/**
 * PURE reconcile step for the durable task inbox on open: sort by creation, and downgrade any task caught
 * mid-flight (queued/running) to FAILED (interrupted). We never auto-resume — an API call that may already
 * have run must not be silently re-charged, and a queued task is surfaced for the author to re-trigger by
 * choice. `done`/`failed`/`cancelled` pass through untouched, so the PAID results the author still needs to
 * apply survive the restart intact. The caller owns disk I/O + persisting the downgrades.
 */
export function reconcileLoadedTasks(loaded: AgentTask[], nowIso: string): AgentTask[] {
  return [...loaded]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((t) =>
      t.status === 'queued' || t.status === 'running'
        ? { ...t, status: 'failed' as const, error: INTERRUPTED_MSG, finishedAt: t.finishedAt ?? nowIso }
        : t
    )
}
