/**
 * Coherence visuals. We color by **severity** — a small, stable axis (high/medium/low) — not by `kind`.
 * `kind` is free text the producer can drift on (contradiction · hole · confirmation · sequel_hook · …),
 * so it's only ever a label; that way a new/unknown kind never breaks the color scheme. Mirrors the
 * threadVisual / entityVisual philosophy: one canonical visual map, graceful fallback.
 */
export interface SeverityVisual {
  dot: string
  text: string
  rank: number
}

const SEVERITY: Record<string, SeverityVisual> = {
  high: { dot: 'bg-flag', text: 'text-flag', rank: 0 },
  medium: { dot: 'bg-warn', text: 'text-warn', rank: 1 },
  low: { dot: 'bg-faint', text: 'text-faint', rank: 2 }
}

export const severityVisual = (s: string): SeverityVisual => SEVERITY[s] ?? { dot: 'bg-faint', text: 'text-faint', rank: 3 }

/** A subtle header WASH by severity — harmonizes the finding card with the thread/arc tinted-header grammar. */
export const severityWash = (s: string): string => (s === 'high' ? 'bg-flag/[0.06]' : s === 'medium' ? 'bg-warn/[0.06]' : 'bg-panel-soft/40')

/** `kind` → human label. Free text from the producer, so just normalize underscores. */
export const kindLabel = (k: string): string => k.replace(/_/g, ' ')

/**
 * `kind` → a reader-facing **Category** name + a one-line plain gloss of what it means. The producer's
 * raw kinds (drift/gap/contradiction/hole/sequel_hook/…) are jargon to a first-time author; this is the
 * de-jargon layer the finding card reads from. Unknown kinds fall back to a title-cased label, no gloss.
 */
export interface KindGloss {
  label: string
  blurb: string
}
const KIND: Record<string, KindGloss> = {
  contradiction: { label: 'Contradiction', blurb: 'The page says one thing; the prose shows another.' },
  drift: { label: 'Drift', blurb: 'Behaviour is sliding away from how the character is written.' },
  gap: { label: 'Gap', blurb: 'The profile promises something the prose never delivers.' },
  hole: { label: 'Plot hole', blurb: 'A thread the prose opens but leaves unresolved.' },
  sequel_hook: { label: 'Open hook', blurb: 'A setup the prose hasn’t paid off yet.' },
  confirmation: { label: 'Confirmation', blurb: 'The prose matches what was declared — nothing to fix.' },
  // Continuity (plot-holes) — the three categories the craft literature logs (Reedsy / Novel Factory / Wikipedia).
  // The fix is to the STORY or the rule, not a page.
  'continuity-error': { label: 'Continuity error', blurb: 'An established fact contradicts an earlier one.' },
  'logic-gap': { label: 'Logic gap', blurb: 'An event the story’s own facts make impossible or unearned.' },
  'rule-break': { label: 'Rule break', blurb: 'The story breaks a rule it declared about its world.' }
}
export const kindGloss = (k: string): KindGloss =>
  KIND[k] ?? { label: kindLabel(k).replace(/\b\w/g, (c) => c.toUpperCase()), blurb: '' }

/** Severity word, title-cased for prose ("Medium"). */
export const severityLabel = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Trait de-jargon. A finding's `trait` follows a `<aspect>: <detail>` convention where the aspect is a
 * DB-ish enum ("never_says", "arc secret", "authority limits", …). We split it off, humanize it, and let
 * the card render it as a TAG CHIP so "never_says: a number she can't source" reads as a labeled note,
 * not a machine string. Aspects are lowercase by convention — a Capitalized prefix is treated as prose.
 */
const TRAIT_LABEL: Record<string, string> = {
  never_says: 'Never says',
  arc_secret: 'Secret',
  arc_goal: 'Goal',
  arc_wound: 'Wound',
  arc_nature: 'Nature',
  character_nature: 'Nature',
  authority_scope: 'Authority',
  authority_limits: 'Authority limit',
  voice: 'Voice',
  relationship: 'Relationship'
}
const traitKey = (raw: string): string => raw.trim().toLowerCase().replace(/[-\s]+/g, '_')
export const humanizeTraitTag = (raw: string): string =>
  TRAIT_LABEL[traitKey(raw)] ?? raw.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
export function splitTrait(trait: string): { tag: string | null; text: string } {
  const t = (trait ?? '').trim()
  // lowercase aspect prefix + delimiter (: – — -) + a detail clause
  const m = t.match(/^([a-z][a-z _-]{0,28}?)\s*[:–—-]\s+(.+)$/)
  if (m) return { tag: humanizeTraitTag(m[1]), text: m[2].trim() }
  // a bare aspect with no detail ("authority scope") — chip it, no body text
  if (TRAIT_LABEL[traitKey(t)]) return { tag: humanizeTraitTag(t), text: '' }
  return { tag: null, text: t }
}

/** Pull a chapter number out of a checkpoint/evidence id — "c:C4", "C4", "od-c2-s7" → "4"/"2". null if none. */
export const chapterNum = (id: string): string | null => {
  const m = id.match(/c[:\-]?\s*0*(\d+)/i)
  return m ? m[1] : null
}
/** "c:C4" / "C4" → "Chapter 4" (the reader-facing form of an `asOf` checkpoint). Falls back to the raw id. */
export const chapterLabel = (id: string): string => {
  const n = chapterNum(id)
  return n ? `Chapter ${n}` : id
}
