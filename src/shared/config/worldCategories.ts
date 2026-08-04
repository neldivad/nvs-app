/**
 * worldCategories.ts — the app-curated MASTER VOCABULARY, as a shared BASE MODEL both the world and scene
 * hierarchies inherit from (see internal/open-taxonomy.md).
 *
 * A `BaseCategory` (key · label · description) is the common shape the sidebar context menus listen to — the
 * World rail and the Scene rail both render their create-options by mapping a list of these. World categories
 * extend it with a `folder` + `tracked` (an entity); scene categories are container *types*. A project's
 * `.nvs/structure.json` holds the enabled set, split by domain: { world: WorldCategory[], scene: SceneCategory[] }.
 *
 * `description` doubles as the author's reminder AND the grounding handed to the extraction LLM. `entities.type`
 * (DB) is open free-text; this vocabulary BOUNDS + DESCRIBES it.
 */
export interface BaseCategory {
  key: string // canonical id (=== the folder/type; === entities.type for world)
  label: string // plural display ('Characters', 'Acts')
  description: string // author reminder + LLM grounding
}

/** The arc "shape" of a category — how its entities CHANGE over the story (the entity window pass). The
 *  `archetype` frames the extraction ("an object changes hands; an agent shifts allegiance"); the `facets` are
 *  the guided-open dimensions to watch. The CHANGE axis is universal (gain/loss/shift/reveal — config/entityArc),
 *  NOT declared here. A category WITHOUT `arc` isn't arc-tracked: it's reference (lore) or a lifecycle that
 *  lives in Threads (quest/route/ending). See internal/open-taxonomy.md. */
export type ArcArchetype = 'agent' | 'object'
export interface ArcFacet {
  key: string // the dimension (custody/state/power/…) — === entity_arc_events.category
  blurb: string // one-line guide for the LLM (facets stay open; this only steers)
}
export interface ArcSpec {
  archetype: ArcArchetype
  facets: ArcFacet[]
}

/** A world "bible" category — a fixed top-level folder under content/world, optionally a tracked entity. */
export interface WorldCategory extends BaseCategory {
  folder: string // content/world subfolder
  tracked: boolean // an entity (presence/arc) vs reference-only knowledge (lore)
  arc?: ArcSpec // how its entities change over the story; absent = not arc-tracked (see ArcSpec)
  pillar?: boolean // it lives as its OWN content pillar (e.g. custody → content/custody/), not an addable
                   // world category — the def stays for label/description, but the picker hides it.
}

/** A scene "container" type — a level in the story hierarchy (act › part › chapter). A folder's declared kind. */
export interface SceneCategory extends BaseCategory {
  container: true // marks it a nesting container (vs a leaf scene)
}

// ── world master (core + genre packs) ──────────────────────────────────────────
export const MASTER_WORLD: readonly WorldCategory[] = [
  // character is arc-tracked too, but by its OWN tuned window pass (WINDOW_INSTRUCTIONS / arcVisual), not the
  // generic entity pass — so no `arc` here yet. It's archetype:'agent' when the two converge (open-taxonomy).
  { key: 'character', label: 'Characters', folder: 'characters', tracked: true, description: 'A person in the story — someone who acts, speaks, wants, and changes over time.' },
  { key: 'location', label: 'Locations', folder: 'locations', tracked: true, description: 'A place the story happens in — a setting that gathers meaning as events accumulate there.' },
  { key: 'item', label: 'Items', folder: 'items', tracked: true, description: 'An object the plot turns on — not a prop, but *the* ring, *the* letter, *the* heirloom.',
    arc: { archetype: 'object', facets: [
      { key: 'custody', blurb: 'who holds or controls it' },
      { key: 'state', blurb: 'its condition — poisoned, forged, broken, repaired' },
      { key: 'location', blurb: 'where it physically is' },
      { key: 'function', blurb: 'a CHANGE in how it is used in the plot — NOT a description of its purpose (that belongs on its page)' }
    ] } },
  { key: 'faction', label: 'Factions', folder: 'factions', tracked: true, description: 'An organization or group that acts as one — a house, order, company, or force with its own goals.',
    arc: { archetype: 'agent', facets: [
      { key: 'power', blurb: 'military or political strength' },
      { key: 'standing', blurb: 'reputation, legitimacy, public standing' },
      { key: 'allegiance', blurb: 'who it is aligned with or against' },
      { key: 'territory', blurb: 'what it holds or controls' }
    ] } },
  { key: 'lore', label: 'Lore', folder: 'lore', tracked: false, description: 'Background the world declares — history, rules, cosmology. Reference knowledge, not a thing that appears in scenes.' },
  { key: 'information', label: 'Information', folder: 'information', tracked: false, description: 'A declared piece of information — a secret, a fact, a revelation-in-waiting: what it IS and why it matters. Its movement (who learns it, when) is tracked by an anchored Custody topic.' },
  // custody is now its OWN content pillar (content/custody/, the CustodyRail) — a unique class, not an addable
  // world category. `pillar: true` keeps the label/description for that pane but hides it from Add category.
  { key: 'custody', label: 'Custody', folder: 'custody', tracked: false, pillar: true, description: 'An authored timetable of where an item or a piece of information goes — who holds it, who learns it, scene by scene. A revision tool: the CustodyRail draws exactly what these pages declare.' },
  { key: 'suspect', label: 'Suspects', folder: 'suspects', tracked: true, description: 'A person under suspicion — who had motive, means, or opportunity in the mystery.',
    arc: { archetype: 'agent', facets: [
      { key: 'suspicion', blurb: 'how strongly the evidence points at them' },
      { key: 'alibi', blurb: 'their account of where they were' },
      { key: 'motive', blurb: 'their reason to have done it' },
      { key: 'status', blurb: 'cleared · charged · at large' }
    ] } },
  { key: 'clue', label: 'Clues', folder: 'clues', tracked: true, description: 'A piece of evidence that advances (or misdirects) the investigation.',
    arc: { archetype: 'object', facets: [
      { key: 'custody', blurb: 'who holds or has examined it' },
      { key: 'meaning', blurb: 'what it is understood to imply' },
      { key: 'status', blurb: 'a lead · corroborated · a red herring' }
    ] } }
]
export const DEFAULT_WORLD_KEYS = ['character', 'location', 'item', 'faction', 'lore', 'information'] as const

// ── scene master (story-hierarchy LEVELS) ──────────────────────────────────────
// A project's `structure.scene` is an ORDERED LADDER drawn from these (top grouping → down to the leaf). Scene is
// the implicit atomic leaf below the last level. Creation is constrained: inside a level you can only make the
// next level down (or a scene at the bottom). This palette is ordered top→bottom for the ladder editor's picker.
export const MASTER_SCENE: readonly SceneCategory[] = [
  { key: 'book', label: 'Books', container: true, description: 'A whole book — the top grouping of a multi-book work.' },
  { key: 'volume', label: 'Volumes', container: true, description: 'A volume — a large grouping above parts/chapters.' },
  { key: 'part', label: 'Parts', container: true, description: 'A part — a mid-high grouping of acts or chapters.' },
  { key: 'act', label: 'Acts', container: true, description: 'An act — a major structural division of the story.' },
  { key: 'chapter', label: 'Chapters', container: true, description: 'A chapter — the usual home for a run of scenes.' },
  { key: 'section', label: 'Sections', container: true, description: 'A section — a light grouping of scenes within a chapter.' }
]
export const DEFAULT_SCENE_KEYS = ['chapter'] as const // one level: chapters hold scenes

// ── resolvers ──────────────────────────────────────────────────────────────────
export const worldCategoryByKey = (key: string): WorldCategory | undefined => MASTER_WORLD.find((c) => c.key === key)
export const sceneCategoryByKey = (key: string): SceneCategory | undefined => MASTER_SCENE.find((c) => c.key === key)
export const worldCategoriesFor = (keys: readonly string[]): WorldCategory[] => keys.map(worldCategoryByKey).filter((c): c is WorldCategory => !!c)
export const sceneCategoriesFor = (keys: readonly string[]): SceneCategory[] => keys.map(sceneCategoryByKey).filter((c): c is SceneCategory => !!c)

// ── templates (set BOTH domains) ───────────────────────────────────────────────
export interface StructureTemplate {
  key: string
  label: string
  description: string
  world: string[]
  scene: string[]
  /** KIND this template belongs to (DOMAINS). The create wizard filters templates by the chosen KIND. Non-fiction
   *  templates reuse the SAME master categories for now (speakers = `character`, refs = `faction`/`lore`); the
   *  vocabulary relabel (character→speaker) is the domain-profile's job in a later slice, not a structure change. */
  kind: 'fiction' | 'nonfiction'
}
export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [
  // ── Fiction ──────────────────────────────────────────────────────────────────
  { key: 'novel', label: 'Novel', kind: 'fiction', description: 'The default — people, places, things, groups, and lore; chapters.', world: ['character', 'location', 'item', 'faction', 'lore', 'information', 'custody'], scene: ['chapter'] },
  { key: 'mystery', label: 'Mystery / Detective', kind: 'fiction', description: 'Adds suspects and clues to track the investigation.', world: ['character', 'suspect', 'clue', 'location', 'item', 'lore', 'information', 'custody'], scene: ['part', 'chapter'] },
  // Routes/endings are NOT world categories (author's ruling 2026-07-09): a branch is a PATH through
  // scenes — model each route as a saved chart-sequence (Timeline → Chart Config) and re-run analysis
  // per route. The 'route'/'ending' keys had no MASTER entries and silently filtered out anyway.
  { key: 'visual-novel', label: 'Visual Novel', kind: 'fiction', description: 'Branching routes and multiple endings — model each route as a saved chart-sequence (Timeline → Chart Config).', world: ['character', 'location', 'item', 'lore', 'information', 'custody'], scene: ['chapter'] },
  { key: 'game', label: 'Game / RPG', kind: 'fiction', description: 'Quests and factions for a systems-driven world.', world: ['character', 'location', 'item', 'faction', 'quest', 'lore', 'information', 'custody'], scene: ['act', 'chapter'] },
  { key: 'screenplay', label: 'Screenplay / Film', kind: 'fiction', description: 'Cast, locations, and props; acts hold scenes.', world: ['character', 'location', 'item', 'faction', 'lore', 'information', 'custody'], scene: ['act'] },
  { key: 'epic', label: 'Epic / Multi-book', kind: 'fiction', description: 'A deep hierarchy: Books › Volumes › Chapters › Scenes.', world: ['character', 'location', 'item', 'faction', 'lore', 'information', 'custody'], scene: ['book', 'volume', 'chapter'] },
  // ── Non-fiction (declaration slice) ──────────────────────────────────────────
  // Reuse the SAME master categories for now — speakers = `character`, orgs/parties = `faction`, references/
  // background = `lore`, claims/facts = `information`. The vocabulary relabel (character→speaker, thread→topic)
  // is the domain-profile's job in a later slice, NOT a structure change. Scene hierarchy = light segments.
  { key: 'podcast', label: 'Podcast / Interview', kind: 'nonfiction', description: 'Speakers and the references & claims they discuss, segment by segment.', world: ['character', 'faction', 'lore', 'information'], scene: ['chapter'] },
  { key: 'lecture', label: 'Lecture / Talk', kind: 'nonfiction', description: 'One or few speakers; the ideas, references, and claims across a talk.', world: ['character', 'lore', 'information'], scene: ['section'] },
  { key: 'panel', label: 'Panel / Roundtable', kind: 'nonfiction', description: 'Several speakers and the positions & disagreements between them.', world: ['character', 'faction', 'lore', 'information'], scene: ['chapter'] },
  { key: 'hearing', label: 'Hearing / Legal', kind: 'nonfiction', description: 'Speakers, parties, precedent and rulings; parts hold the record.', world: ['character', 'faction', 'lore', 'information'], scene: ['part', 'chapter'] },
  { key: 'meeting', label: 'Meeting / Call', kind: 'nonfiction', description: 'Attendees, the topics raised, and the decisions or action items.', world: ['character', 'information'], scene: ['chapter'] }
]

/** Templates for a KIND — the create wizard renders these once the user picks Fiction / Non-fiction. */
export const structureTemplatesForKind = (kind: 'fiction' | 'nonfiction'): StructureTemplate[] =>
  STRUCTURE_TEMPLATES.filter((t) => t.kind === kind)
