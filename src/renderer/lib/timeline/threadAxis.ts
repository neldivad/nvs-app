/**
 * threadAxis.ts — pure helpers for the branch-aware Threads rail (internal/timeline-model.md).
 *
 * The Gantt draws a thread only where its beats land ON the active axis (the chart-sequence's scene columns).
 * A thread opened on a BRANCH whose scenes aren't on the current route has no column to draw in — so instead of
 * vanishing, it's surfaced in the sidebar tagged "branch — not on this view." This is the off-axis partition,
 * kept pure (no React/store) so it's unit-testable.
 */

/** Threads that HAVE beats but land NONE on the current axis → a branch not on this view. (0-beat threads are
 *  degenerate, not "off-branch", so they're excluded.) `onAxisThreadIds` = thread ids with ≥1 beat on-axis. */
export function offAxisThreads<T extends { id: string; beats: number }>(
  threads: readonly T[],
  onAxisThreadIds: ReadonlySet<string>
): T[] {
  return threads.filter((t) => t.beats > 0 && !onAxisThreadIds.has(t.id))
}
