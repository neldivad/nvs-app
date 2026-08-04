/**
 * Character-arc visuals + vocabulary — the shared config for the arc enums (mirrors coherenceVisual /
 * threadVisual). Two orthogonal dimensions: a FACET (what kind of thing changed) and a CHANGE (how it
 * moved). One canonical map each, with graceful fallback so an unknown enum value never breaks styling.
 */
export interface FacetVisual {
  text: string
  sw: string
}

/** The arc FACETS in display order — the universal enum the producer tags each entity_arc_event with. */
export const FACETS = ['alignment', 'knowledge', 'power', 'relationship', 'objective', 'secret'] as const
export type Facet = (typeof FACETS)[number]

/** facet → palette (tokens live in globals.css --facet-*). Literal class strings so Tailwind detects them. */
const FACET: Record<string, FacetVisual> = {
  alignment: { text: 'text-facet-alignment', sw: 'bg-facet-alignment' },
  knowledge: { text: 'text-facet-knowledge', sw: 'bg-facet-knowledge' },
  power: { text: 'text-facet-power', sw: 'bg-facet-power' },
  relationship: { text: 'text-facet-relationship', sw: 'bg-facet-relationship' },
  objective: { text: 'text-facet-objective', sw: 'bg-facet-objective' },
  secret: { text: 'text-facet-secret', sw: 'bg-facet-secret' }
}
/** Humanize a category tag: "open_objective" → "objective". */
export const catLabel = (c: string): string => c.replace(/^open_/, '').replace(/_/g, ' ')
export const facetVisual = (c: string): FacetVisual => FACET[catLabel(c)] ?? { text: 'text-faint', sw: 'bg-faint' }

/** One-line gloss per facet — the help table + filter tooltips read from here. */
export const FACET_BLURB: Record<string, string> = {
  alignment: 'who they side with / their moral stance',
  knowledge: 'what they know or have learned',
  power: 'leverage, authority, or capability they hold',
  relationship: 'a tie to another character',
  objective: 'a goal they are pursuing',
  secret: 'something hidden about them'
}

export interface ChangeVisual {
  dot: string
  text: string
  verb: string
}
/** Arc change → color + verb (gain = acquired, loss = lost, expose = revealed). */
const CHANGE: Record<string, ChangeVisual> = {
  gain: { dot: 'bg-ok', text: 'text-ok', verb: 'gains' },
  loss: { dot: 'bg-flag', text: 'text-flag', verb: 'loses' },
  expose: { dot: 'bg-lore', text: 'text-lore', verb: 'revealed' }
}
export const changeVisual = (c: string): ChangeVisual => CHANGE[c] ?? { dot: 'bg-faint', text: 'text-faint', verb: c }
export const changeDot = (c: string): string => CHANGE[c]?.dot ?? 'bg-faint'
