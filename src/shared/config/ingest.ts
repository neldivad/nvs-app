/**
 * The user-facing vocabulary for the analysis/ingest surface — the ONE source the Analysis dock,
 * the rail freshness badges, and the notification mailbox all read, so they never drift apart.
 *
 * Register: PLAIN / NEUTRAL (decided 2026-06-22, internal/ingest-model.md). We keep the craft nouns
 * the NVS ontology uses (threads · drift · dropped threads) but NOT the warmer
 * "the reader / the web" persona — plain status reads clearest and also fits the non-fiction works
 * (podcasts, group chats) the ontology calls out.
 *
 * Engine status (`fresh|stale|pending`) is the internal truth; everything the author SEES comes from here.
 */
import type { TierStatus, TierStatusRow } from '@shared/ipc'

/** Engine status → the word the author sees. */
export const STATUS_LABEL: Record<TierStatus, string> = {
  fresh: 'Up to date',
  stale: 'Outdated',
  pending: 'Not read'
}

/** Engine status → DESIGN color token (the dot / accent). */
export const STATUS_COLOR: Record<TierStatus, string> = {
  fresh: 'var(--ok)',
  stale: 'var(--warn)',
  pending: 'var(--faint)'
}

/** The verb on the primary action and the nudge. */
export const UPDATE_VERB = 'Update'

export interface FreshnessCounts {
  fresh: number
  stale: number
  pending: number
  /** Scenes outside the analyzed set (phase ≠ canon) — shown as "Draft", not counted as work to do. */
  draft: number
  /** Canon scenes read only at SKIM depth (fresh, but a full/Expert pass would DEEPEN them — build the arcs &
   *  profiles skim skips). A SUBSET of `fresh`, not a separate bucket: they're up to date for Fast, upgradeable
   *  for Expert. Drives the "Expert pass available" affordance so a Fast run doesn't lock the arc path away. */
  skim: number
  /** Total analyzable scenes (canon set) = fresh + stale + pending. */
  total: number
}

/** Tally a tracer over the canon set. Draft (non-canon) scenes are split out, not counted as outdated. */
export function freshnessCounts(rows: TierStatusRow[]): FreshnessCounts {
  const c: FreshnessCounts = { fresh: 0, stale: 0, pending: 0, draft: 0, skim: 0, total: 0 }
  for (const r of rows) {
    // A scene is in the analyzed set only when its phase is canon (the ingest gate).
    if (r.phase && r.phase !== 'canon') {
      c.draft++
      continue
    }
    c[r.status]++
    c.total++
    // Fresh-but-skim = up to date for Fast, still upgradeable by an Expert pass. Counted alongside fresh.
    if (r.status === 'fresh' && r.depth === 'skim') c.skim++
  }
  return c
}

/** Scenes that need a pass — edited since last read (stale) + never read (pending). */
export function outdatedCount(c: FreshnessCounts): number {
  return c.stale + c.pending
}

/**
 * The one-line health summary the dock header and rail badge speak.
 * - no AI connected → the analysis layer is simply OFF (T1 still works); don't cry "outdated".
 * - mid-run → progress.
 * - else → up to date, or N outdated.
 */
export function healthLine(c: FreshnessCounts, opts?: { hasAi?: boolean; updating?: number | null }): string {
  if (opts?.updating != null) return `Updating ${opts.updating} of ${c.total}…`
  if (opts?.hasAi === false) return 'Add an AI key to build story memory'
  if (c.total === 0) return 'Nothing to read yet'
  const n = outdatedCount(c)
  if (n === 0) return 'Up to date'
  return `${n} scene${n === 1 ? '' : 's'} outdated`
}

/** Does the rail/badge have anything worth flagging? (drives whether the "Update" doorway shows.) */
export function needsAttention(c: FreshnessCounts): boolean {
  return outdatedCount(c) > 0
}
