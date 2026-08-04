/**
 * World-page section schema — the SINGLE source of truth for what `## sections` each world-page kind has.
 *
 * Plain data (no renderer/engine deps), so BOTH sides read the same thing: the UI (worldSchema.ts builds
 * its pick-list / scaffold from this) and the page-agent prompt builder (agentCommands.ts tells the model
 * the canonical sections so an edit doesn't invent headings). It lived in renderer historically; moved here
 * so main can read it too — no mirror, no drift.
 */

export type WorldKind = 'character' | 'location' | 'item' | 'lore' | 'custody' | 'information' | 'faction' | 'suspect' | 'clue'

/**
 * A body **section module** — the unit of world-page content. Each is a `## section` authored as plain
 * Markdown; the module supplies the template a `/slash` command (and the PropertyDialog pick-list) insert.
 * Rich sections carry sub-structure (`### Goal`, bullets) that a single frontmatter scalar couldn't hold.
 */
export interface SectionSpec {
  id: string // 'arc' — the slash trigger (and dedupe key)
  heading: string // the ## section title, e.g. 'Arc'
  template: string // Markdown inserted by /slash or the pick-list (## heading + sub-structure)
  core?: boolean // part of the new-page scaffold; always offered
  description?: string // one-liner for the slash menu / pick-list
  /** Spoiler-scoped: the author + the analysis see it; reader-facing surfaces (community share, exported
   *  bibles) exclude it. The layered-truth model (open-taxonomy): the page declares the truth AND who may
   *  know it. Coherence treats divergence explained by a hidden section as deception WORKING, not drift. */
  hidden?: boolean
}

export const WORLD_SECTIONS: Record<WorldKind, SectionSpec[]> = {
  character: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Age, occupation, affiliation', template: '## Profile\n\n- Age: \n- Occupation: \n- Affiliation: \n' }, // role + status are frontmatter fields (Properties form), not body rows
    { id: 'appearance', heading: 'Appearance', core: true, description: 'What people notice first', template: "## Appearance\n\n<!-- What's the first thing people notice about them? -->\n" },
    { id: 'personality', heading: 'Personality', core: true, description: 'What they want, what they hide', template: '## Personality\n\n<!-- What do they want? What do they hide? -->\n' },
    { id: 'background', heading: 'Background', core: true, description: 'Where they come from', template: '## Background\n\n<!-- What shaped them before page one? -->\n' },
    { id: 'voice', heading: 'Voice', description: 'How they speak', template: '## Voice\n\n- Style: \n- Quirks: \n- Sample lines:\n  - \n' },
    { id: 'arc', heading: 'Arc', description: 'Goal, wound, obstacle, lie, truth — may grow over chapters', template: '## Arc\n\n### Goal\n- \n\n### Wound\n- \n\n### Obstacle\n- \n\n### Lie\n- \n\n### Truth\n- \n' },
    { id: 'relationships', heading: 'Relationships', description: 'Who they’re connected to — type @ to link other pages', template: '## Relationships\n\n- @\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Anything else worth remembering', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'Hidden truth — spoiler-scoped (author + analysis only)', template: '## Secrets\n\n<!-- Hidden truth about them — the answer key. The story MAY contradict the sections above when this explains it (a cover identity, a secret motive); analysis reads such divergence as your deception working, not incoherence. Excluded from shared/reader-facing bibles. -->\n- \n' }
  ],
  location: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Type, part-of, status, access', template: '## Profile\n\n- Type: \n- Part of: \n- Status: \n- Access: \n- Controlled by: \n' },
    { id: 'overview', heading: 'Overview', core: true, description: 'The place in one breath', template: '## Overview\n\n<!-- What is this place, in one breath? -->\n' },
    { id: 'description', heading: 'Description', core: true, description: 'Sights, sounds, mood', template: '## Description\n\n<!-- What does it feel like to be here? -->\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Recurring details, what changes', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'Hidden truth — spoiler-scoped (author + analysis only)', template: '## Secrets\n\n<!-- Hidden truth about this place — what it conceals (the buried body, the sealed room, what really happened here). Excluded from shared/reader-facing bibles. -->\n- \n' }
  ],
  item: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Type, status, location, owner', template: '## Profile\n\n- Type: \n- Status: \n- Location: \n- Owner: \n' },
    { id: 'description', heading: 'Description', core: true, description: 'What it is, what it looks like', template: '## Description\n\n<!-- What is it? What does it look like? -->\n' },
    { id: 'provenance', heading: 'Provenance', core: true, description: 'Where it came from, who held it', template: '## Provenance\n\n<!-- Where did it come from? Who has held it? -->\n' },
    { id: 'significance', heading: 'Significance', core: true, description: 'Why it matters to the story', template: '## Significance\n\n<!-- Why does it matter? -->\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'Hidden truth — spoiler-scoped (author + analysis only)', template: '## Secrets\n\n<!-- Hidden truth about it — its real nature or purpose (the fake, the poisoned one, the key that opens something else). Excluded from shared/reader-facing bibles. -->\n- \n' }
  ],
  information: [
    { id: 'overview', heading: 'Overview', core: true, description: 'What this information IS, in one breath', template: '## Overview\n\n<!-- The piece of information — a secret, a fact, a revelation-in-waiting. -->\n' },
    { id: 'significance', heading: 'Significance', core: true, description: 'Why it matters — what it unlocks or destroys', template: '## Significance\n\n<!-- Why this matters to the story — who it would hurt, what it would unlock. -->\n' },
    { id: 'truth', heading: 'Truth', hidden: true, description: 'The full spoiler (author + analysis only)', template: '## Truth\n\n<!-- The complete answer, spoilers included. Excluded from shared/reader-facing bibles. -->\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Open questions', template: '## Notes\n\n' }
  ],
  custody: [
    { id: 'overview', heading: 'Overview', core: true, description: 'What this topic tracks, in one breath', template: '## Overview\n\n<!-- What is being tracked — the object, or the piece of information. -->\n' },
    { id: 'truth', heading: 'Truth', hidden: true, description: 'The full spoiler — what is actually going on (author + analysis only)', template: '## Truth\n\n<!-- The complete answer, spoilers included. Excluded from shared/reader-facing bibles. -->\n' },
    { id: 'timeline', heading: 'Timeline', core: true, description: 'The authored chart — one line per checkpoint; the CustodyRail draws exactly these', template: '## Timeline\n\n<!-- One checkpoint per line. The rail draws THESE — nothing is inferred.\n     items:        - [[scene-id]] what happened (held-by: character)\n     information:  - [[scene-id]] what the reader learns (known-by: character, reader)\n     specials: reader = the audience · public = everyone in-world -->\n- \n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Open questions, planned beats not yet written', template: '## Notes\n\n' }
  ],
  lore: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Type, status', template: '## Profile\n\n- Type: \n- Status: \n' },
    { id: 'overview', heading: 'Overview', core: true, description: 'The thing in one breath', template: '## Overview\n\n<!-- What is this, in one breath? -->\n' },
    { id: 'details', heading: 'Details', core: true, description: 'History, structure, rules', template: '## Details\n\n<!-- History, structure, the substance. -->\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Open questions, disputed versions', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'Hidden truth — spoiler-scoped (author + analysis only)', template: '## Secrets\n\n<!-- The real truth behind the declared version — what the world believes above vs what is actually so. Excluded from shared/reader-facing bibles. -->\n- \n' }
  ],
  // faction — an agent archetype (arc facets: power/standing/allegiance/territory). Profile carries those as
  // scalars the author fills; Goals frames what it's after (the change axis the entity pass watches).
  faction: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Type, leader, seat, standing, allies', template: '## Profile\n\n- Type: \n- Leader: \n- Seat: \n- Standing: \n- Allies: \n- Rivals: \n' },
    { id: 'overview', heading: 'Overview', core: true, description: 'The group in one breath', template: '## Overview\n\n<!-- What is this group, and what does it want? -->\n' },
    { id: 'goals', heading: 'Goals', core: true, description: 'What it is after, who stands in the way', template: '## Goals\n\n<!-- What is it after? Who or what stands in the way? -->\n' },
    { id: 'members', heading: 'Members', description: 'Key figures — type @ to link character pages', template: '## Members\n\n- @\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Recurring details, what shifts', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'Hidden truth — spoiler-scoped (author + analysis only)', template: "## Secrets\n\n<!-- The group's hidden agenda or true allegiance — what it really is behind the public face. Excluded from shared/reader-facing bibles. -->\n- \n" }
  ],
  // suspect (mystery pack) — an agent archetype (facets: suspicion/alibi/motive/status). The Account IS the alibi.
  suspect: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Relation to the victim, means, opportunity', template: '## Profile\n\n- Relation: \n- Status: \n- Means: \n- Opportunity: \n' },
    { id: 'account', heading: 'Account', core: true, description: 'Their alibi — where they say they were', template: '## Account\n\n<!-- Their alibi — where they claim to have been, and who can confirm it. -->\n' },
    { id: 'motive', heading: 'Motive', core: true, description: 'Why they might have done it', template: '## Motive\n\n<!-- What reason would they have? -->\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Evidence for and against', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'The answer key — did they? (author + analysis only)', template: '## Secrets\n\n<!-- Did they do it? What are they actually hiding? The answer key. Excluded from shared/reader-facing bibles. -->\n- \n' }
  ],
  // clue (mystery pack) — an object archetype (facets: custody/meaning/status). Meaning holds the lead vs red-herring read.
  clue: [
    { id: 'profile', heading: 'Profile', core: true, description: 'Type, found where, held by, status', template: '## Profile\n\n- Type: \n- Found at: \n- Held by: \n- Status: \n' },
    { id: 'description', heading: 'Description', core: true, description: 'What it is, what it looks like', template: '## Description\n\n<!-- What is the evidence, concretely? -->\n' },
    { id: 'meaning', heading: 'Meaning', core: true, description: 'What it points to (or misdirects toward)', template: '## Meaning\n\n<!-- What does it imply? A genuine lead or a red herring? -->\n' },
    { id: 'notes', heading: 'Notes', core: true, description: 'Open questions', template: '## Notes\n\n' },
    { id: 'secrets', heading: 'Secrets', hidden: true, description: 'What it really proves (author + analysis only)', template: "## Secrets\n\n<!-- What the clue actually proves — the true significance the reader shouldn't know yet. Excluded from shared/reader-facing bibles. -->\n- \n" }
  ]
}

/** Fallback sections for any kind WITHOUT a tuned spec (a custom, author-invented category) — so a new page is
 *  never blank. Overview + Notes, both core. Tuned kinds above override this via WORLD_SECTIONS. */
export const GENERIC_SECTIONS: SectionSpec[] = [
  { id: 'overview', heading: 'Overview', core: true, description: 'What this is, in one breath', template: '## Overview\n\n<!-- What is this? -->\n' },
  { id: 'notes', heading: 'Notes', core: true, description: 'Anything worth remembering', template: '## Notes\n\n' }
]

/** The ordered `## heading` list for a kind — what the prompt builder hands the model. */
export function sectionHeadings(kind: string): string[] {
  return (WORLD_SECTIONS[kind as WorldKind] ?? []).map((s) => s.heading)
}
