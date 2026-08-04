/**
 * Entity-arc MECHANICS — the universal change axis + the resolvers that read a category's declared arc shape.
 *
 * The per-category vocabulary itself now lives ON the category (MASTER_WORLD[key].arc — archetype + facets),
 * mirroring how `folder`/`tracked`/`description` are declared. This file owns only what's category-INDEPENDENT:
 * the ONE change axis every arc event moves along, and the helpers that combine it with a category's facets.
 *
 * Read by three layers: the extraction prompt builder (main), writeTier.validate (engine), the renderer arc
 * visuals. `tone` maps every change onto the shared 4-color arc palette so item/faction changes render with the
 * same grammar as character gain/loss/expose.
 */
import { worldCategoryByKey } from './worldCategories'

export type ArcTone = 'gain' | 'loss' | 'expose' | 'neutral'

export interface ArcChangeDef {
  key: string
  verb: string // human label in the arc sheet
  tone: ArcTone // color bucket
}

/**
 * THE universal change axis — every arc event (any category) moves along one of these four. The old
 * per-category verb sets (acquired/rises, destroyed/falls, transferred/altered, exposed) were all synonyms of
 * these; the `value` field carries the specifics. gain=strengthen/acquire, loss=weaken/destroy,
 * shift=lateral move (change hands, alter, realign), reveal=becomes known.
 */
export const ARC_CHANGES: ArcChangeDef[] = [
  { key: 'gain', verb: 'gains', tone: 'gain' },
  { key: 'loss', verb: 'loses', tone: 'loss' },
  { key: 'shift', verb: 'shifts', tone: 'neutral' },
  { key: 'reveal', verb: 'revealed', tone: 'expose' }
]

/** The character window pass keeps its historical 3-verb axis (gain/loss/expose) — it's a separate, tuned pass.
 *  Kept here so the shared resolvers cover characters too; converges with ARC_CHANGES when the passes unify. */
const CHARACTER_CHANGES: ArcChangeDef[] = [
  { key: 'gain', verb: 'gains', tone: 'gain' },
  { key: 'loss', verb: 'loses', tone: 'loss' },
  { key: 'expose', verb: 'revealed', tone: 'expose' }
]

/** Does this category get an entity-arc (has a declared `arc` shape)? item/faction/suspect/clue yes; lore/route no. */
export function hasArc(categoryKey: string): boolean {
  return !!worldCategoryByKey(categoryKey)?.arc
}

/** Allowed change keys for a category — the universal axis for arc categories, the 3-verb axis for character. */
export function allowedArcChanges(categoryKey: string): Set<string> {
  const src = categoryKey === 'character' ? CHARACTER_CHANGES : ARC_CHANGES
  return new Set(src.map((c) => c.key))
}

/** Allowed facet keys for a category — its declared arc facets; empty set = "don't enforce" (facets stay open). */
export function allowedArcFacets(categoryKey: string): Set<string> {
  const arc = worldCategoryByKey(categoryKey)?.arc
  return new Set(arc ? arc.facets.map((f) => f.key) : [])
}

/** change key → tone, across the universal axis + the character axis (the renderer's color map). */
const TONE_BY_CHANGE: Record<string, ArcTone> = Object.fromEntries(
  [...ARC_CHANGES, ...CHARACTER_CHANGES].map((c) => [c.key, c.tone])
)
export function arcChangeTone(changeKey: string): ArcTone {
  return TONE_BY_CHANGE[changeKey] ?? 'neutral'
}
