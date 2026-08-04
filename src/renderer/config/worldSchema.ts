/**
 * Authoritative field specs for each world-page kind.
 *
 * This is the single place to look up what frontmatter fields a character,
 * location, item, or lore page can carry — update here and the form, preview
 * info-box, and any future validation all stay in sync.
 */

export type FieldType =
  | 'string'   // plain scalar
  | 'array'    // comma-separated in the form, stored as string[]
  | 'nested'   // object — path navigated by nestedPath

export interface FieldSpec {
  key: string         // frontmatter key (top-level)
  label: string       // human-readable label
  type?: FieldType    // default: 'string'
  readOnly?: boolean  // shown but not editable (e.g. id, first_appearance)
  infoBox?: boolean   // include in the wiki-preview info panel
  nestedPath?: string[] // for type 'nested': path segments e.g. ['voice', 'style']
  placeholder?: string
  /** Form section this field belongs to (e.g. 'Identity', 'Voice', 'Arc'). Default: 'Identity'. */
  group?: string
  /** A nested field whose leaf is a list (e.g. voice.quirks). Edited as a comma list, stored as string[]. */
  asArray?: boolean
  /** Render as a multi-line textarea (e.g. a scene's goal/conflict/outcome). */
  multiline?: boolean
  /** Enum choices → rendered as a select. Permissive: an existing off-list value is kept + shown, and '' clears. */
  options?: string[]
}

/** How a page's body is authored — picks the editor + body codec (see [[wikiSerializer]] / blockSerializer). */
export type BodyType = 'fountain' | 'sections'

/**
 * Content phase — the EDITORIAL maturity of a page or scene (how finished it is),
 * orthogonal to in-world `status` (alive/destroyed). Shared by scenes and world
 * pages; rendered as a pill in the Properties header. Stored as frontmatter `phase`.
 */
export const CONTENT_PHASES = ['draft', 'developing', 'canon', 'archived'] as const
export type ContentPhase = (typeof CONTENT_PHASES)[number]

/**
 * The IMPLICIT phase when frontmatter omits `phase` — the single source of truth so surfaces don't disagree.
 * Scenes default to CANON (the analysis gate reads phase-less scenes — see ConsoleDock `canonRows`), world
 * pages default to DRAFT (they're not canon-gated). Anything with an explicit `phase` uses that, not this.
 */
export function defaultPhase(kind: string): ContentPhase {
  return kind === 'scene' ? 'canon' : 'draft'
}

/** Display metadata for a content phase — label + Tailwind color utilities for badges/dots/left-borders. */
export const PHASE_META: Record<string, { label: string; text: string; dot: string; border: string }> = {
  draft:      { label: 'Draft',      text: 'text-faint',    dot: 'bg-faint',     border: 'border-faint' },
  developing: { label: 'Developing', text: 'text-lore',     dot: 'bg-lore',      border: 'border-lore' },
  canon:      { label: 'Canon',      text: 'text-ok',       dot: 'bg-ok',        border: 'border-ok' },
  archived:   { label: 'Archived',   text: 'text-faint/60', dot: 'bg-faint/50',  border: 'border-faint/50' }
}

// The section schema (`## section` modules per kind) is shared with the page-agent prompt builder, so it
// lives in shared config — the single source of truth. Re-exported here so existing renderer imports work.
import { WORLD_SECTIONS, GENERIC_SECTIONS, type SectionSpec } from '@shared/config/worldSections'
import { slugId } from '@shared/contentId'
export type { SectionSpec }

export interface KindSchema {
  kind: string // a world-category key (open — matches WorldPage.kind; resolved via schemaFor)
  label: string
  /** Lucide icon name — decorative metadata (the sidebar resolves icons through entityVisual, not this). */
  icon: string
  /** Tailwind text-color class for accent (decorative; see icon). */
  accent: string
  /** Frontmatter scalars — kept minimal (engine wiring + identity); everything semantic lives in sections. */
  fields: FieldSpec[]
  /** Body section modules — the `/slash` commands + PropertyDialog pick-list for this kind. */
  sections: SectionSpec[]
  /** World pages author their body as named Markdown sections. */
  bodyType: 'sections'
}

/**
 * Scene frontmatter fields — parallel to KindSchema.fields but for scenes.
 * PropertyDialog reads this (via pageSchema) as the scene's frontmatter contract.
 */
export interface SceneSchema {
  fields: FieldSpec[]
  /** Scenes author their body as free Fountain prose. */
  bodyType: 'fountain'
}

export const SCENE_SCHEMA: SceneSchema = {
  bodyType: 'fountain',
  fields: [
    { key: 'title',              label: 'Title',              placeholder: 'Scene title', group: 'Scene' },
    { key: 'chapter',            label: 'Chapter',            placeholder: 'Chapter slug or number', group: 'Scene' },
    // POV is analysis-relevant (whose perspective — feeds character arc), unlike the cross-refs below. Stored
    // as a single character id; when unset the engine defaults it to the scene's dominant speaker.
    { key: 'pov',                label: 'POV',                placeholder: "Whose eyes we're in — defaults to the scene's main speaker", group: 'Scene' },
    { key: 'goal',               label: 'Goal',               multiline: true, placeholder: 'What does the POV character want here?', group: 'Task spec' },
    { key: 'conflict',           label: 'Conflict',           multiline: true, placeholder: 'What stands in the way?', group: 'Task spec' },
    { key: 'outcome',            label: 'Outcome',            multiline: true, placeholder: 'How does it resolve?', group: 'Task spec' },
    // Cross-refs: optional quick-links to world pages. NOT analysis inputs — presence/setting are read from the
    // PROSE (dialogue cues + LLM), so these are author convenience/navigation only. (See schema-durability /
    // the "demote to cross-refs" decision.) Grouped last + flagged so they don't imply they drive analysis.
    { key: 'characters_present', label: 'Characters', type: 'array', placeholder: 'character-id, …', group: 'Cross-refs' },
    { key: 'location',           label: 'Locations',  type: 'array', placeholder: 'location-id, …',  group: 'Cross-refs' },
    { key: 'items',              label: 'Items',      type: 'array', placeholder: 'item-id, …',      group: 'Cross-refs' }
  ]
}

/** Optional per-group helper note rendered under a group's header in the PropertyDialog. */
export const GROUP_NOTES: Record<string, string> = {
  'Cross-refs': 'Optional quick-links to world pages — for your reference and navigation. Analysis reads the prose, not these tags.'
}

/** Frontmatter floor shared by every world kind — identity + engine wiring only. */
const IDENTITY_FIELDS: FieldSpec[] = [
  { key: 'id',      label: 'ID',      readOnly: true, group: 'Identity' },
  { key: 'name',    label: 'Name',    placeholder: 'Display name', group: 'Identity' },
  { key: 'aliases', label: 'Aliases', type: 'array', placeholder: 'Other names it goes by', group: 'Identity' }
]

// Characters carry two structured attributes in frontmatter (form-editable, and usable by analysis, e.g. filter
// the cast by role) — NOT in the Profile body. `role` is a permissive enum; `status` is free (active/deceased/…).
const CHARACTER_FIELDS: FieldSpec[] = [
  ...IDENTITY_FIELDS,
  { key: 'role',   label: 'Role',   options: ['main', 'supporting', 'minor', 'background'], infoBox: true, group: 'Casting' },
  { key: 'status', label: 'Status', placeholder: 'e.g. active, deceased, missing', infoBox: true, group: 'Casting' }
]

// Section schemas come from the shared single source (WORLD_SECTIONS); this layer adds the UI-only bits
// (label / icon / accent / frontmatter fields) per kind.
export const WORLD_SCHEMA: KindSchema[] = [
  { kind: 'character', label: 'Characters', icon: 'Users', accent: 'text-character', bodyType: 'sections', fields: CHARACTER_FIELDS, sections: WORLD_SECTIONS.character },
  { kind: 'location', label: 'Locations', icon: 'MapPin', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.location },
  { kind: 'item', label: 'Items', icon: 'Package', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.item },
  { kind: 'lore', label: 'Lore', icon: 'ScrollText', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.lore },
  { kind: 'information', label: 'Information', icon: 'KeyRound', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.information },
  { kind: 'faction', label: 'Factions', icon: 'Boxes', accent: 'text-character', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.faction },
  { kind: 'suspect', label: 'Suspects', icon: 'Fingerprint', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.suspect },
  { kind: 'clue', label: 'Clues', icon: 'Search', accent: 'text-lore', bodyType: 'sections', fields: IDENTITY_FIELDS, sections: WORLD_SECTIONS.clue },
  {
    kind: 'custody',
    label: 'Custody',
    icon: 'KeyRound',
    accent: 'text-lore',
    bodyType: 'sections',
    fields: [
      ...IDENTITY_FIELDS,
      { key: 'topic', label: 'Topic', placeholder: 'item | information', infoBox: true, group: 'Identity' },
      { key: 'subject', label: 'Subject', placeholder: 'entity id this rides on (the artifact / the keeper)', group: 'Identity' }
    ],
    sections: WORLD_SECTIONS.custody
  }
]

/** Look up the schema for a given kind. Returns undefined if kind is unknown. */
export function schemaFor(kind: string): KindSchema | undefined {
  return WORLD_SCHEMA.find((s) => s.kind === kind)
}

/** Fields that should appear in the wiki-preview info box for a given kind. */
export function infoBoxFields(kind: string): FieldSpec[] {
  return schemaFor(kind)?.fields.filter((f) => f.infoBox) ?? []
}

/** Bucket a field list by `group` in first-seen order. Used to render the form in sections. */
export function groupFields(fields: FieldSpec[]): Array<{ group: string; fields: FieldSpec[] }> {
  const order: string[] = []
  const byGroup = new Map<string, FieldSpec[]>()
  for (const f of fields) {
    const g = f.group ?? 'Identity'
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      order.push(g)
    }
    byGroup.get(g)!.push(f)
  }
  return order.map((group) => ({ group, fields: byGroup.get(group)! }))
}

/** Fields for a world kind, grouped (back-compat wrapper over groupFields). */
export function fieldGroups(kind: string): Array<{ group: string; fields: FieldSpec[] }> {
  return groupFields(schemaFor(kind)?.fields ?? [])
}

/**
 * The unified page contract any PropertyDialog / editor reads: frontmatter `fields`,
 * body `sections`, and the `bodyType` that picks the editor + body codec. Resolves
 * scenes (SCENE_SCHEMA) and world kinds (WORLD_SCHEMA) to one shape — the seam that
 * lets one PropertyDialog serve every kind.
 */
export interface PageSchema {
  kind: string
  fields: FieldSpec[]
  sections: SectionSpec[]
  bodyType: BodyType
}

export function pageSchema(kind: string): PageSchema {
  if (kind === 'scene') {
    return { kind, fields: SCENE_SCHEMA.fields, sections: [], bodyType: SCENE_SCHEMA.bodyType }
  }
  const s = schemaFor(kind)
  // Unknown/custom kind → identity frontmatter + the generic scaffold (never a blank page).
  return s
    ? { kind, fields: s.fields, sections: s.sections, bodyType: s.bodyType }
    : { kind, fields: IDENTITY_FIELDS, sections: GENERIC_SECTIONS, bodyType: 'sections' }
}

/** All section modules for a kind — the `/slash` commands + PropertyDialog pick-list. A world kind without a
 *  tuned schema (a custom category) falls back to the generic Overview+Notes so its pages are never blank. */
export function sectionModules(kind: string): SectionSpec[] {
  if (kind === 'scene') return [] // scenes are Fountain prose, not sectioned
  return schemaFor(kind)?.sections ?? GENERIC_SECTIONS
}

/**
 * The body written into a freshly-created world page: the kind's CORE section templates,
 * concatenated. The `<!-- prompts -->` are stripped in Preview but visible in Write as
 * scaffolding. Optional modules (Voice, Arc…) are added later via /slash or the pick-list.
 */
export function defaultBody(kind: string): string {
  const core = sectionModules(kind).filter((s) => s.core)
  return core.map((s) => s.template.trimEnd()).join('\n\n') + '\n'
}

/**
 * Default frontmatter for a new page: id + name from the slug, phase 'draft'. Kept lean —
 * the form fills in voice/arc/etc. on demand rather than seeding empty skeletons.
 */
export function defaultFrontmatter(id: string, name: string): Record<string, unknown> {
  return { id, name, phase: 'draft' as ContentPhase }
}

/** "See Yi Oh" → "see-yi-oh" — the NVS id convention. Delegates to the ONE slug rule (@shared/contentId,
 *  internal/content-id.md) so world-page ids match every other content id (NFKC + combining marks preserved). */
export function slugify(name: string): string {
  return slugId(name)
}
