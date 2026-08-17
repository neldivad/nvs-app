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
 * `kind` → a reader-facing **Category** name + a one-line plain gloss + the HEADLINE QUESTION the finding
 * card leads with (story-critique.md Slice 0 — every finding is presented as a question the author answers,
 * the trait title demotes to a subtitle). The producer's raw kinds (drift/gap/contradiction/…) are jargon to
 * a first-time author; this is the de-jargon layer. Unknown kinds fall back to a title-cased label, no gloss.
 *
 * `gap` SPLITS at display time into two pseudo-kinds (one stored token, opposite author actions):
 *   `gap:page-silent` — the arc established a trait the page never mentions (enrich the page), vs
 *   `gap:never-shown` — the page promises something no scene dramatizes (plant the beat, or trim).
 * Use `displayKind(kind, declared)` wherever a finding's kind is shown or filtered.
 */
export interface KindGloss {
  label: string
  blurb: string
  question: string
}
const KIND: Record<string, KindGloss> = {
  contradiction: { label: 'Says vs shows', blurb: 'The page says one thing; the scenes show another.', question: 'Your page says one thing — the scenes show another. Which is true?' },
  drift: { label: 'Slow drift', blurb: 'Behaviour is sliding away from the page, with no single breaking moment.', question: 'This character has been sliding away from their page. On purpose?' },
  gap: { label: 'Gap', blurb: 'One side is silent — the page or the story.', question: 'One side is silent here. Should it stay that way?' },
  'gap:page-silent': { label: 'Page is silent', blurb: 'The story established a trait the page never mentions.', question: 'The story proved this — should the page own it?' },
  'gap:never-shown': { label: 'Never shown', blurb: 'The page promises something no scene dramatizes.', question: 'Where’s the scene that shows this?' },
  hole: { label: 'Plot hole', blurb: 'A thread the prose opens but leaves unresolved.', question: 'This thread opens and never lands. Where does it resolve?' },
  sequel_hook: { label: 'Open hook', blurb: 'A setup the prose hasn’t paid off yet.', question: 'This setup hasn’t paid off. Is the payoff coming?' },
  confirmation: { label: 'On track', blurb: 'The divergence is a planned deception, working as written.', question: 'The deception is landing as planned — keep it up?' },
  // Continuity (plot-holes) — the three categories the craft literature logs (Reedsy / Novel Factory / Wikipedia).
  // The fix is to the STORY or the rule, not a page.
  'continuity-error': { label: 'Fact flip', blurb: 'An established fact contradicts an earlier one.', question: 'These two scenes can’t both be true — which wins?' },
  'logic-gap': { label: 'Impossible', blurb: 'An event the story’s own facts make impossible or unearned.', question: 'What made this possible? The story never showed it.' },
  'rule-break': { label: 'Broken rule', blurb: 'The story breaks a rule it declared about its world.', question: 'Your world says this can’t happen. It just did.' },
  // Critique ("Tough questions") — the fourth family (story-critique.md): construction, not consistency.
  // A critique finding's TRAIT is itself the specific question; this gloss question is the kind's generic form.
  inert: { label: 'Cuttable?', blurb: 'A beat nothing downstream depends on — a setup with no payoff on record.', question: 'If this event vanished, would anything downstream change?' },
  'weak-close': { label: 'Really closed?', blurb: 'A close that may not settle what the thread promised.', question: 'Did this ending actually settle what was promised?' }
}
export const kindGloss = (k: string): KindGloss =>
  KIND[k] ?? { label: kindLabel(k).replace(/\b\w/g, (c) => c.toUpperCase()), blurb: '', question: '' }

/** The page-side-is-silent test (shared by the card's "(unstated)" render and the gap split). */
export const declaredSilent = (declared: string | null | undefined): boolean =>
  !declared || /^\(?\s*(unstated|not stated|unmentioned|none|n\/?a|silent|[—-])\s*\)?$/i.test(declared.trim())

/** A finding's DISPLAY kind: `gap` forks on which side is silent; every other kind passes through. */
export const displayKind = (kind: string, declared: string | null | undefined): string =>
  kind === 'gap' ? (declaredSilent(declared) ? 'gap:page-silent' : 'gap:never-shown') : kind

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
