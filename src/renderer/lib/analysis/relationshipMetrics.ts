/**
 * Relationship metric reducer — the DERIVED foundation of the RelationshipRail (internal/relationship-rail.md).
 * Pure: given a (range-filtered) set of `RelEvidenceEvent`s, compute the four lenses. Called by the dialog/rail
 * on the events the current scene-range keeps, so range scrubs never hit IPC.
 *
 * Facet → axis routing (the honest split; secrets/knowledge stay OUT of the headline metrics):
 *   warmth   ← alignment + relationship   (valence-summed → tab A trajectory)
 *   leverage ← power                       (signed, per owner → tab B "upper hand")
 *   focus    ← every owner-attributed event (count → tab B "screen-time"; POV, kept separate from leverage)
 *   facets   ← all facets per owner        (tab C)
 */
import type { RelEvidenceEvent } from '@shared/ipc'

const WARMTH_FACETS = new Set(['alignment', 'relationship'])
const LEVERAGE_FACETS = new Set(['power'])

/** gain warms/empowers (+1), loss cools/weakens (−1); expose/neutral don't move the in-world axes (0). */
const valence = (change: string | null): number => (change === 'gain' ? 1 : change === 'loss' ? -1 : 0)

export interface WarmthPoint {
  sceneId: string
  pos: number
  title: string
  delta: number
  cumulative: number
}

export interface RelationshipMetrics {
  /** narrative screen-time per party (count of their arc events) — the POV axis, NOT power. */
  focus: { a: number; b: number }
  /** signed net of `power` events per party (gain-over = +, loss-to = −) — the in-world upper hand. */
  leverage: { a: number; b: number }
  /** the warmth trajectory in reading order — cumulative is RELATIVE (normalize by the pair's own range in UI). */
  warmth: WarmthPoint[]
  /** all facets per owner, for the facet breakdown (tab C). */
  facetsByOwner: { a: Record<string, number>; b: Record<string, number> }
  net: number // final cumulative warmth (relative)
  trend: 'warming' | 'cooling' | 'flat' // sign of the last few warmth deltas
}

export function relationshipMetrics(events: RelEvidenceEvent[]): RelationshipMetrics {
  const inOrder = [...events].sort((x, y) => x.pos - y.pos)

  const focus = { a: 0, b: 0 }
  const leverage = { a: 0, b: 0 }
  const facetsByOwner: { a: Record<string, number>; b: Record<string, number> } = { a: {}, b: {} }
  const warmth: WarmthPoint[] = []
  let cumulative = 0

  for (const e of inOrder) {
    if (e.owner) focus[e.owner] += 1
    if (e.owner && e.facet) facetsByOwner[e.owner][e.facet] = (facetsByOwner[e.owner][e.facet] ?? 0) + 1
    if (e.owner && e.facet && LEVERAGE_FACETS.has(e.facet)) leverage[e.owner] += valence(e.change)

    // Warmth = alignment/relationship valence, PLUS conflicts as cooling. The probe (Polonius↔Hamlet) showed
    // alignment/relationship gain-loss is sparse (mostly `expose`, valence 0), so adversarial pairs read flat
    // without conflicts — yet conflict IS the relationship's cooling signal, so fold it in at −1.
    const delta =
      e.kind === 'conflict' ? -1 : e.facet && WARMTH_FACETS.has(e.facet) ? valence(e.change) : 0
    if (delta !== 0) {
      cumulative += delta
      warmth.push({ sceneId: e.sceneId, pos: e.pos, title: e.title, delta, cumulative })
    }
  }

  const recent = warmth.slice(-3).reduce((s, p) => s + p.delta, 0)
  const trend = recent > 0 ? 'warming' : recent < 0 ? 'cooling' : 'flat'
  return { focus, leverage, warmth, facetsByOwner, net: cumulative, trend }
}
