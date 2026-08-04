/**
 * The renderer <-> main contract — "the menu".
 *
 * Single source of truth for what the UI (renderer) may ask the engine (main) to
 * do. Imported by THREE places, which is why it lives in src/shared and must stay
 * free of Node and DOM globals:
 *   - src/main      registers a handler for each item   (the kitchen)
 *   - src/preload   carries each item across the wall   (the waiter)
 *   - src/renderer  calls window.nvs.* with full types  (the customer)
 *
 * Naming: the domain types here follow the canonical NVS object vocabulary
 * (Thread = NarrativeThread, ThreadEvent = a "beat", QuestLog = the view over
 * threads). The app, the engine, and the spec speak one language — no inventing
 * local names like the old "QuestEntry".
 *
 * Rule: everything that crosses the wall must be "structured-cloneable" — plain
 * data (numbers, strings, arrays, plain objects). No functions, no class
 * instances, no DB handles. That's why every type below is just fields.
 */

import type { AiProviderType } from './config/aiProviders'
export type { AiProviderType }
import type { PageEditMode, PromptCategory } from './config/agentCommands'
export type { PageEditMode, PromptCategory }

export type WorkId = string

/** A work as surfaced on the welcome page (the DAW-style library grid). */
/** A world category (from `.nvs/structure.json`) annotated with its live entity count — Project Config / World rail. */
export interface StructureCategory {
  key: string // === entities.type
  label: string
  folder: string
  tracked: boolean // an entity (presence/arc) vs reference-only (lore)
  description: string
  count: number // entities of this type currently in the DB
}

/** A scene container type (act/part/chapter) — the story-hierarchy side of the structure. */
export interface SceneCategoryInfo {
  key: string
  label: string
  description: string
}

/** The project structure, split by domain — what both sidebars + the Project Structure dialog read. */
export interface StructureView {
  world: StructureCategory[]
  scene: SceneCategoryInfo[]
}

/** One scene-anchored evidence row on a relationship edge (conflict naming both, or an arc event naming the other). */
export interface RelEvidenceEvent {
  sceneId: string
  pos: number // linear_pos — the renderer's range filter key
  title: string
  kind: 'conflict' | 'arc'
  change: string | null // arc events: gain/loss/expose (valence); null for conflicts
  owner: 'a' | 'b' | null // WHICH party's arc changed (direction); null for conflicts (mutual)
  facet: string | null // arc category: alignment|knowledge|power|relationship|objective|secret; null for conflicts
  text: string
}
/** Everything the DB knows about one cast-graph edge — GATHERED, not reduced: the dialog filters by the
 *  graph's current scene range (relationships are range-dependent; a static row would lie — see engine/relationship.ts). */
export interface RelationshipEvidence {
  a: { id: string; name: string }
  b: { id: string; name: string }
  declared: { a: string[]; b: string[] } // each page's ## Relationships lines naming the other (static bond)
  coScenes: { sceneId: string; title: string; pos: number }[]
  events: RelEvidenceEvent[]
}

/** One lore topic's disclosure ledger — what the story has revealed about it, scene by scene. */
export interface LoreTopic {
  loreId: string // the producer's snake_case topic handle (resolved to a world/lore page by the renderer)
  label: string // humanized handle ("claudius_regicide" → "claudius regicide")
  hasRetcon: boolean // any disclosure with magnitude 'retcon' — a self-labeled contradiction
  disclosures: { sceneId: string; title: string; pos: number; summary: string; magnitude: string | null }[]
}
/** The Lore pivot's payload: topics + the story clock (in-story time markers per scene, reading order). */
export interface LoreView {
  topics: LoreTopic[]
  clock: { sceneId: string; title: string; pos: number; times: string[] }[]
}

/** A tracked non-character entity (item · faction · …) + its presence trail — the Entity tab's row. */
export interface EntityTrack {
  id: string // entities.entity_id
  type: string // the structure category (item/faction/… — open vocabulary)
  name: string
  significance: string | null // minor | supporting | major (producer-judged) — null for authored-only
  scenes: { sceneId: string; title: string }[] // where it appears (presence, reading order)
}

/** One row of the console DB inspector's table list — a table + its live row count. */
export interface DbTable {
  name: string
  count: number
}
/** A page of raw rows from a DB table (console inspector) — columns + a cell matrix, values coerced to
 *  string|number|null so it crosses the process wall cleanly. */
export interface DbRows {
  columns: string[]
  rows: (string | number | null)[][]
}

export interface WorkCard {
  name: string // folder basename (stable id-ish path segment)
  path: string // absolute path to the work folder
  scenes: number
  worldPages: number
  custodyPages: number
  lastEdited: number // mtime epoch ms — newest first
  title?: string // authored display title (.nvs/project.json) — falls back to `name`
  author?: string
  cover?: string // relative path to the cover image, if set
  forkedFrom?: string // parent title if this work is a fork (drives the lineage badge/filter)
  medium?: string // MEDIUMS value — a tag on the card
  status?: string // STATUSES value — a tag on the card
  genre?: string[] // GENRES values — tag chips on the card
}

/** A recently-opened work — the pointer registry (userData/recents.json) that remembers projects the
 *  library scan can't see (opened via "Open Folder…"). See internal/community-registry.md. */
export interface RecentEntry {
  path: string // absolute path to the work folder
  name: string // folder basename
  lastOpened: number // epoch ms, newest first
  insideLibrary: boolean // true = also on the Welcome grid via the library scan
}

/** One row in the local download history ("reading list") — the immutable record of a community install,
 *  kept in userData/downloads.json even after the local copy is edited or deleted (v1 is a frozen
 *  file-sharing model, so "downloaded" is history, not live state). See internal/community-registry.md. */
export interface DownloadEntry {
  registryId: string // the RegistryWork.id it came from (stable across re-downloads)
  title: string
  author?: string | null
  version: string // the version installed
  sizeBytes?: number
  at: number // epoch ms of the install, newest first
  path?: string // where it landed on disk at install time (may be gone/diverged now)
}

/** One downloadable work in the community registry (nvs-datasets/index.json). Admission is oracle-gated
 *  at publish time; `download` arrives RESOLVED to an absolute URL (main resolves relative paths against
 *  the index location). See internal/community-registry.md. */
export interface RegistryWork {
  id: string // e.g. "shakespeare/hamlet"
  title: string
  author?: string | null
  genre: string[]
  language: string
  scenes: number
  beats: number // legacy metric — no longer surfaced in the UI (a raw beat count means little to a reader)
  characterPages: number
  worldPages?: number // Size breakdown — populated by the converter; absent on older index entries
  custodyPages?: number
  oracleScore: number // 1.0 = clean ✓ on the nvs-parser quality oracle
  version: string
  contentHash?: string // fingerprint of the authored content — same hash ⇒ same version (publish-time ledger)
  minAppVersion?: string // client hides Install with "requires NVS ≥ X" when the app is older
  schemaVersion?: string // the bundle's analysis-DB migration head (import gates on it)
  deprecated?: boolean // retired from the corpus — clients hide it; existing installs keep working
  download: string // absolute URL (https:// or file://) to the .nvsproj bundle
  sha256: string // integrity check, verified by main before import
  sizeBytes: number
  // ── Rich CreativeWork metadata (all OPTIONAL) — a projection of the work's .nvs/project.json (ProjectInfo)
  //    lifted into the index by the publish pipeline, so the store's browse DETAIL can render the full BookCard
  //    (cover · synopsis · themes · credits) BEFORE download. Absent for works that don't carry project.json
  //    yet (BookCard degrades gracefully). Field names mirror ProjectInfo — see registryWorkToProjectInfo().
  subtitle?: string
  logline?: string
  description?: string // synopsis
  medium?: string // MEDIUMS
  status?: string // STATUSES
  inLanguage?: string[] // LANGUAGES (richer than the single `language`)
  about?: string[] // THEMES
  contentRating?: string[] // CONTENT_WARNINGS
  keywords?: string[]
  contributor?: Contributor[] // richer credits than the single `author`
  coverUrl?: string // absolute URL to a cover thumbnail hosted alongside the index (cover lives inside the bundle)
  // A gallery of preview screenshots — what the work looks like INSIDE the app (the writing experience users
  // care about most). Absolute URLs hosted beside the index; lifted by the publish pipeline from each work's
  // `previews/` folder. `label` names the view (Editor · World · Timeline · Threads · …). Empty on thin/older
  // entries — the store's preview strip just hides.
  previews?: { label: string; url: string }[]
}

/** The fetched community registry index. */
export interface RegistryIndex {
  registryVersion: number
  generatedAt: string
  source: string // where the index was fetched from (URL or local path) — shown in the dialog footer
  works: RegistryWork[]
}

/** The handshake verdict (engine/hostApi.checkManifest) crossing the IPC wall. */
export type HandshakeResult =
  | { ok: true; granted: string[]; degraded: string[] }
  | { ok: false; reasons: string[] }

/** What an AMBIENT (declarative) extension contributes to the app while installed + enabled — applied by the
 *  renderer, no subprocess. v1: the manuscript font. `kind: 'ui'` extensions carry this; active ones don't. */
export interface ExtensionContributions {
  editorFont?: { family: string; stack?: string } // swap the writing-surface font (--font-editor)
}

/** One extension as the Extensions tab lists it (bundled sample or installed). */
export interface ExtensionInfo {
  id: string
  name: string
  description?: string
  version: string
  kind: string // producer | reader | transform | integration | ui
  capabilities: { required: string[]; optional?: string[] }
  installed: boolean
  enabled?: boolean // installed-and-on (default true); disable turns off an ambient effect / gates an active one
  contributes?: ExtensionContributions // ambient (ui) contributions the renderer applies when enabled
  panel?: string // an active extension's running-UI entry file — the app hosts it in a sandboxed iframe (nvs-ext://)
  check: { ok: true } | { ok: false; reasons: string[] } // handshake preview against THIS app
  running?: boolean
}

/** Live supervision state of a running extension (renderer polls while the tab is open). */
export interface ExtensionStatus {
  id: string
  state: 'starting' | 'running' | 'done' | 'stopped' | 'crashed' | 'unresponsive'
  startedAt: number
  lastEvent?: unknown // the extension's latest event payload (e.g. the countdown tick)
  result?: unknown // the done payload
  error?: string // honest failure message (crash/unresponsive)
}

/**
 * A project's authored identity/metadata, stored in `.nvs/project.json` (travels in the bundle). The display
 * title falls back to the folder name; `work_id` (in the DB) is the stable id. Lineage fields are set on
 * import/fork, not hand-edited.
 */
/** A schema.org-style contributor — one person, possibly several roles (writer + translator + composer …). */
export interface Contributor {
  name: string
  roles: string[] // CONTRIBUTOR_ROLES values (config/projectSchema)
}

/**
 * Authored project metadata — schema.org/CreativeWork field names so it's machine-readable (JSON-LD-able) and
 * AI/search-friendly. AUTHORED only: characters, story arcs, plot points live in the analysis DB, not here. The
 * controlled vocabularies (medium/status/inLanguage/genre/about/contentRating/contributor roles) are in
 * config/projectSchema. v2 — the rich-editing UI lands later; the simple dialog still works (tags → keywords).
 */
export interface ProjectInfo {
  // identity
  title?: string
  subtitle?: string
  logline?: string // a one-line hook
  description?: string // synopsis / abstract (schema.org: abstract)
  // classification (config vocabularies)
  domain?: string // KIND — 'fiction' | 'nonfiction' (DOMAINS). The parent axis above medium/genre: un-loads the
  //                 fiction assumption (asking genre first assumes fiction). Absent → 'fiction'. DECLARATION only
  //                 for now — the analysis profile (fiction vs conversation) is a SEPARATE, derived concern.
  medium?: string // MEDIUMS
  status?: string // STATUSES
  inLanguage?: string[] // LANGUAGES (was the single `language`)
  genre?: string[] // GENRES
  about?: string[] // THEMES (schema.org: about — the AI-discovery layer)
  contentRating?: string[] // CONTENT_WARNINGS
  keywords?: string[] // free-form folksonomy (the simple dialog's "tags" map here)
  // people
  author?: string // primary writer (convenience); richer cast in `contributor`
  contributor?: Contributor[]
  // relationships / IP
  isPartOf?: string // series
  position?: number // installment number in the series
  isBasedOn?: string // adaptation / source work
  forkedFrom?: string | null
  coverOf?: string | null
  promptSource?: string | null
  // assets
  cover?: string // relative path to the cover image (e.g. content/assets/cover.jpg)
  // provenance
  version?: string
  updatedAt?: string // ISO; stamped on every write
}

/** A node in the free-form story folder tree (content/story). */
export interface StoryNode {
  type: 'folder' | 'scene'
  name: string // folder name, or scene filename without .md
  relPath: string // relative to content/story
  path: string // absolute
  sceneId?: string // scene: stable frontmatter scene_id (timeline references this)
  title?: string // scene: frontmatter title
  phase?: string // scene: content-phase
  cover?: string // scene: first image (frontmatter images[0]/avatar) — the timeline card thumbnail
  leadsTo?: string[] // scene: frontmatter leads_to — timeline edges (many-to-many)
  protected?: boolean // folder that can't be renamed/deleted (the archive folder)
  containerType?: string // folder: its structure container kind (act/part/chapter/…); undefined = untyped
  folderId?: string // folder: stable identity (`.id` dotfile) — like scene_id, survives rename/move
  children?: StoryNode[] // folder
}

/**
 * Timeline canvas layout — HOME 2 of 3 (pure view state; see the schema doc).
 * Holds node *placements* + view prefs only. The authored edges live in scene
 * `leads_to`; the rich overlay data is DERIVED (see `TimelineGraph` below).
 * Delete this file → the graph re-lays-out, but nothing authored is lost.
 *
 * v2 (2026-06): nodes became a tagged union (scene | folder) so folders can be
 * collapsible group nodes, and gained `view` (persisted layer toggles). `boardId`
 * is reserved so a later version can partition into boards without another migration
 * (single canvas today = boardId undefined). v1 blobs are migrated on read.
 */
export const TIMELINE_VERSION = 2

/** A named, authored route (the "loadout"): the linear axis + OPTIONALLY its own branch/merge edges and scene
 *  scope. The seed+routes model (internal/timeline-model.md): absent `edges` → this route derives its graph from
 *  the SEED (frontmatter `leads_to`); present `edges` → the route OWNS its graph (route-specific merges, e.g.
 *  variantB where prologue-D merges into B), leaving frontmatter untouched. `scope` = the scene subset this route
 *  analyzes (exclude side-stories); absent → all scenes. Additive fields → wire-compatible with old timeline.json.
 *  See also internal/chart-sequence.md. */
export interface ChartSequence {
  id: string
  name: string
  path: string[] // ordered scene_ids — the linear axis / a valid walk through the connections
  edges?: [string, string][] // OPTIONAL route-owned [from, to] scene_id edges (branch/merge). Absent → use the seed.
  scope?: string[] // OPTIONAL scene_id subset this route includes/analyzes. Absent → all scenes.
}

/**
 * `.nvs/timeline.json` — the PROJECT-WIDE timeline view, and nothing else. The canvas (placed nodes + collapse)
 * and the chart axes live per variant on `TreeVariant` (trees.json) since T11, because each variant owns its own
 * reading of the story. Old projects were converted on disk by `npm run migrate:canvas`.
 */
export interface TimelineLayout {
  version: number
  view?: TimelineView // persisted overlay-layer toggles
}

// ── Tree variants (`tlgLoadout`) — the TREE-VARIANT model (internal/timeline-model.md ★ CORRECTED 2026-07-15) ──
// The tree variant is the FIRST-CLASS structure object: a full branch/merge graph over the story's scenes. MANY
// coexist; the active one drives ALL analysis (thread/coherence/arc/custody) + the chart X-axis. Stored in the
// `.nvs/trees.json` sidecar — NOT frontmatter (N variants can't share one `leads_to` without collision). T1 lands
// the model + sidecar; readers get re-pointed here (T3) and frontmatter `leads_to` is stripped last (T9).
export const TREES_VERSION = 1
export const MAX_TIMELINE_VARIANTS = 20 // cap on tree variants (tlgLoadouts) per project

/** One tree variant: its branch/merge graph as adjacency (`sceneId → out-edges`, i.e. the old `leads_to` targets),
 *  plus the custom linear chart AXES derived-from/limited-to this variant (the re-homed chart-sequences). */
export interface TreeVariant {
  id: string
  name: string
  adjacency: Record<string, string[]> // sceneId → its out-edges (branch/merge); isolated scenes may be omitted
  sequences?: ChartSequence[] // OPTIONAL custom linear axes (scene_id order) for the gantt X over THIS variant; absent → the AUTO chain
  activeSequenceId?: string // which of this variant's sequences drives the gantt; absent → AUTO (the graph's clean chain)
  nodes?: TimelineNode[] // this variant's OWN canvas layout — placed scenes/folders + positions (per-variant canvas)
  collapsed?: string[] // this variant's collapsed folderRels (canvas state)
  cellColors?: Record<string, string> // sceneId → CSS color: routes the author painted in the (view-only) Cell view
}

/** `.nvs/trees.json` — every tree variant + which is active. Registered `authored · exported · survivesReset`. */
export interface TreesFile {
  version: number
  activeId?: string // the active variant; absent → the first variant (or none)
  variants: TreeVariant[]
}

export interface TimelineNodeBase {
  x: number
  y: number
  boardId?: string // reserved — future per-board partition; undefined = the single default board
}
/** A placed scene card. References a scene by its stable `scene_id`. */
export interface TimelineSceneNode extends TimelineNodeBase {
  kind: 'scene'
  sceneId: string
}
/** A placed folder = a collapsible group node. References a story folder by relPath.
 *  Collapse state is NOT here — it lives in `TimelineLayout.collapsed` so nested folders
 *  (which aren't placed nodes) can collapse too. */
export interface TimelineFolderNode extends TimelineNodeBase {
  kind: 'folder'
  folderRel: string
  folderId?: string // stable folder identity — lets readTimeline heal folderRel after a rename/move
}
export type TimelineNode = TimelineSceneNode | TimelineFolderNode

// ── Corkboard (internal/corkboard.md) — a FREEFORM card canvas; multiple boards per project. Its OWN authored
// sidecar `.nvs/corkboard.json` — positions/colors/notes/edges are authored, non-prose, non-derivable, so they
// live neither in frontmatter nor the analysis cache. Domain-agnostic; the user draws their universe by hand. ──
export const CORKBOARD_VERSION = 1
export const MAX_CORKBOARDS = 100 // boards per project
export const MAX_CORKBOARD_CARDS = 100 // cards per board — hand-curated; open another board rather than crowding one
export const MAX_CORK_CARD_REFS = 20 // page/scene links per card — the card is an idea, not a folder
export const MAX_CORK_TITLE = 100 // card title chars — a headline ("Childe is a secret Fatui"), not a paragraph

/** What a card points at (optional — a card can be pure freeform notes with no ref). `id` is the page/scene path. */
export interface CorkRef {
  kind: 'scene' | 'page' | 'thread'
  id: string
  label?: string // display title captured at attach time (chip label + fallback if the page is gone)
  pageKind?: string // finer type for the chip color: 'scene' | a world category (character/location/item/lore/…)
}
/** One appended note on a card — a comment in the card's thread. */
export interface CorkNote {
  id: string
  text: string
  createdAt?: number // epoch ms — drives the "5 min ago" stamp
}
/** One card: a thread of notes and/or attached refs, positioned + sized + colored by the author. */
export interface CorkCard {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  title?: string // the card's headline, author-renamable (≤ MAX_CORK_TITLE); the fast-scan identity
  color?: string // author-chosen label color (design token or hex)
  notes?: CorkNote[] // appended notes (the card's thread) — add/delete individually
  refs?: CorkRef[] // attached scenes/pages/threads (shown as chips, first = priority), or absent for a pure note
}
/** A free connection between two cards — an AUTHORED visual link, NOT the leads_to graph. */
export interface CorkEdge {
  id: string
  source: string // card id
  target: string // card id
}
/** One corkboard. */
export interface CorkBoard {
  id: string
  name: string
  cards: CorkCard[]
  edges: CorkEdge[]
}
/** `.nvs/corkboard.json` — every board + which is active. Authored · exported · survivesReset. */
export interface CorkboardFile {
  version: number
  activeId?: string // the active board; absent → the first (or none)
  boards: CorkBoard[]
}

/** Which overlay layers are on (ArcGIS-style table of contents). Persisted in the layout. */
export interface TimelineLayers {
  phase: boolean // shade nodes by content-phase (on by default)
  presence: boolean // character-presence tint / lifelines
  threads: boolean // narrative-thread ribbons + badges
  revelations: boolean // secret-reveal BEATS per scene (setup ○ / public ★) from the custody lifecycle
}
export interface TimelineView {
  layers: TimelineLayers
}
export const DEFAULT_TIMELINE_VIEW: TimelineView = {
  layers: { phase: true, presence: false, threads: false, revelations: false }
}

/**
 * DERIVED timeline enrichment — HOME 3 of 3 (read-only; produced by ingest/inference,
 * NOT authored). This is the contract the overlay layers read; the engine already
 * materializes all of it in the `.nvs` DB. Spec only for now — the
 * `timelineGraph()` query + IPC get wired when the layers are built.
 */
export interface TimelineGraph {
  scenes: Record<string, TimelineSceneData> // keyed by scene_id (= unit_id)
  edges: TimelineOverlayEdge[] // derived, non-authored edges (e.g. revelations)
}
export interface TimelineSceneData {
  sceneId: string
  summary?: string // extracted_scenes.summary → the quick-read preview
  linearPos?: number // unit_order.linear_pos → spine ordering
  cast: TimelinePresence[] // entity_presence rows for this scene
  threads: TimelineThreadTouch[] // thread_events landing on this scene
  arcBeats?: string[] // entity_arc_events types (INTRODUCED | DEATH | …) for badges
  coherenceFlags?: number // count of coherence_findings → a warning badge
  pov?: string // effective POV entity id: authored frontmatter `pov`, else the scene's dominant speaker
  reveals?: RevealBeat[] // secret-reveal beats landing on this scene (Revelations layer)
}
/** One secret-reveal beat on a scene — sourced from the custody lifecycle (entity_arc_events, category 'secret'). */
export interface RevealBeat {
  kind: 'setup' | 'public' // setup ○ = first planted (earliest gain); public ★ = goes public (expose→public)
  label: string // the declared secret's text (or its id) — the marker's hover title
  secretId?: string // the cited `## Secrets` id, when the event named one
}
export interface TimelinePresence {
  entityId: string
  role?: string
  volume?: number // cumulative dialogue CHARACTERS this entity speaks in the scene (weight / heatmap intensity; 0 = silently present). NB: character volume, not turn/line count — a long answer outweighs many short questions.
}
export interface TimelineThreadTouch {
  threadId: string
  action: string // open | advance | resolve | reopen | supersede
}
export interface TimelineOverlayEdge {
  kind: 'revelation' // future: 'presence-lifeline' | 'co-presence' | …
  source: string // revealed_in_unit_id
  target: string // recontextualizes_unit_id
  description?: string
}

/** A scene `.md` file in the open work, for the navigator + editor. */
export interface SceneFile {
  path: string // absolute path
  relPath: string // path under content/story (for grouping/display)
  sceneId: string // frontmatter scene_id (or filename)
  title: string // frontmatter title (or filename)
  chapter: string // frontmatter chapter (or the story/chapters subfolder)
  phase?: string // content-phase (draft | developing | canon | archived)
}

/** A world "bible" page. `kind` = the project structure's category (character/location/item/faction/lore + custom);
 *  open string, bounded by `.nvs/structure.json` — the four built-ins have tuned field-specs, others fall back. */
export interface WorldPage {
  id: string // frontmatter id (or filename) — what scenes reference
  name: string // display name
  path: string
  kind: string // a structure category key (was the fixed character|location|item|lore enum)
  avatar?: string // relative path from project root, e.g. content/assets/characters/elara.jpg
  phase?: string // content-phase: draft | developing | canon | archived
  aliases?: string[] // other names it goes by — feed the ingest speaker map; also drive the alias-collision lint
}

/** Anything the editor can open: a story scene or a world page. */
export interface PageRef {
  path: string
  title: string
  kind: string // 'scene' | a world category key
}

/** A full-text (content) search hit — a `.md` under content/ whose PROSE contains the query. `kind` is the
 *  openPage kind (scene / custody / a world category), so a click opens the page directly. */
export interface ContentMatch {
  path: string
  relPath: string // under content/
  title: string
  kind: string // pillar: 'scene' | 'custody' | 'world' (renderer resolves a world hit to its precise page kind)
  count: number // total matches in the file
  line: number // 1-based line of the first match
  snippet: string // the first matching line, trimmed to a display window
}

/** One hit from the agent's general `search` — a POINTER (kind + ref) the agent acts on, plus a snippet for
 *  content hits. Never carries a full page body: the agent fetches that via readScene on the `ref` it chooses. */
export interface SearchHit {
  kind: 'folder' | 'scene' | 'character' | 'location' | 'item' | 'lore' | 'information' | 'faction' | 'suspect' | 'clue' | 'custody'
  ref: string // folder/scene relPath, or a page path — pass to queuePageEdit (folder/path) or readScene
  name: string // display name / title
  matchedOn: 'name' | 'content' // why it surfaced (name = fuzzy name/alias; content = prose full-text)
  snippet?: string // content hits only — a one-line excerpt, NEVER the whole body
  sceneCount?: number // folders only — how many scenes beneath
}

/** Top-k search result: `hits` capped to the limit + ranked best-first (name matches before content), with the
 *  full `total` so the agent can narrow instead of assuming it saw everything. */
export interface SearchResult {
  hits: SearchHit[]
  total: number // matches found before the top-k cap
  truncated: boolean // total > hits.length → tell the model to narrow the query
}

/** A scene split into its parts: frontmatter (the form's data) + prose body. */
export interface SceneDoc {
  frontmatter: Record<string, unknown>
  body: string // the markdown after the frontmatter (the writing surface)
  raw: string // the whole file (for the read-only Source view)
}

/** The currently open work. */
export interface ProjectMeta {
  root: string
  workId: WorkId
  name: string
  insideLibrary: boolean // false = opened via "Open Folder…" from outside the library root (drives the save-to-library cue)
  counts: { scenes: number; worldPages: number }
}

/**
 * Thread — a NarrativeThread: a promise/question the reader carries.
 * The QuestLog view returns these. `beats` is the count of ThreadEvents
 * (open · advance · resolve · reopen · supersede). `verdict` (cliffhanger ·
 * sequel-hook · hole · pending) is the interpretation layer — added later.
 */
export interface Thread {
  id: string // thread_id, e.g. "thr:hamlet-a1-s1:ghost_apparition"
  slug: string // the snake_case handle (last id segment): "ghost_apparition" — the under-the-hood key
  title: string | null // the producer's short human title for display (null on pre-title rows → UI humanizes the slug)
  description: string // the question / promise itself
  type: string // thread_type: mystery · promise · conflict · task · …
  status: string // open · closed · reopened
  openedAt: string | null // scene code where it opened, e.g. "A1·S1"
  closedAt: string | null
  beats: number
  builtBy: string | null // provenance: structural (quest span) · authored (frontmatter) · inferred (LLM)
  resolutionCondition: string | null // the close gate set at open — what would pay this off
  succeeds: string | null // thread_id this thread supersedes (a recast/retcon successor)
}

/**
 * Per-work UI state — author choices with no file/DB source of their own (graph tags, the Cast roster
 * filter). Persisted to `.nvs/ui-state.json` so they survive reload / work-switch.
 */
export interface UiState {
  castExcluded: string[]
  nodeColor: Record<string, number>
  paletteLabels: Record<number, string>
  // Folder collapse memory for the rails. UNDEFINED = never set → the rail seeds its "collapse all but the
  // first with content" default; an array (even empty) = the author's saved choice. Scene rail keys by folder
  // relPath, World rail by category key.
  sceneCollapsed?: string[]
  worldCollapsed?: string[]
  // Last-session restore (like VS Code reopening your tabs). openTabs = the editor tab strip; activePath = which
  // was focused; workspace = the active rail; viewMode = write/preview/source. workspace/viewMode are strings
  // (the WorkspaceId/ViewMode unions live in the renderer, out of ipc's reach) — the store casts on restore.
  openTabs?: PageRef[]
  activePath?: string
  workspace?: string
  viewMode?: string
}

/**
 * The menu. Every method returns a Promise because crossing the process wall is
 * asynchronous — you post a message and await a copy of the result (you never
 * get the kitchen's live objects).
 */
export interface NvsApi {
  ping(): Promise<{ ok: true; version: string }> // liveness (P0 smoke)

  // Custom title-bar window controls (frameless on win/linux).
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  toggleDevTools(): Promise<void> // on-demand DevTools from the View menu
  confirmClose(): Promise<void> // renderer OK's the window close (after any unsaved-changes prompt)
  onAppBeforeClose(cb: () => void): () => void // main asks before the window closes (unsaved-changes guard)
  bootOpenWork(): Promise<string | null> // renderer pulls on mount: the project the app was launched to open (`--open <path>`), consumed once. The plugin's task-scoped launch sets it so an app opened *to render a specific project* lands on it, not on the restored/last project. null for a normal launch. Pull (not push) so it can't race the renderer's readiness.

  listWorks(): Promise<WorkCard[]> // scan the library → welcome grid
  listAllJobs(): Promise<JobRow[]> // UNIVERSAL job history across every library work (run ledgers) — for the Jobs dashboard
  readTelemetry(root: string, limit: number): Promise<Record<string, unknown>[]> // tail a work's ingest-telemetry.jsonl (Logs tab)
  storageUsage(): Promise<StorageRow[]> // per-project local-storage breakdown (Storage tab)
  clearStorage(root: string, kind: StorageKind): Promise<void> // clear logs | run history | chat for a project
  compactSnapshots(root: string): Promise<{ freedBytes: number; compacted: number }> // gzip legacy revert snapshots (non-destructive — keeps every revert point)
  getEntitlement(): Promise<Entitlement> // the machine-local Pro flag (Autumn lifetime)
  verifyPro(email: string): Promise<Entitlement> // check an email against the Pro-verify proxy → cache the result
  setProDev(pro: boolean): Promise<Entitlement> // dev/QA: force the Pro flag without a purchase
  createWork(name: string): Promise<WorkCard | null> // clone the sample into the library
  openExternal(): Promise<string | null> // folder picker ("Open elsewhere…")
  openWork(path: string): Promise<ProjectMeta | null> // open a work by path
  currentProject(): Promise<ProjectMeta | null> // the open work, if any
  listRecents(): Promise<RecentEntry[]> // recently opened works incl. outside-library paths
  saveToLibrary(): Promise<{ path: string } | null> // copy the open external work into the library; reopen from path
  fetchRegistry(): Promise<RegistryIndex | null> // the community registry index (null = unreachable)
  installCommunityWork(work: RegistryWork): Promise<ImportResult> // download → sha256 verify → import into the library
  listDownloads(): Promise<DownloadEntry[]> // the reading list — every community install, newest first (survives local deletion)
  sceneAnalysis(unitId: string): Promise<SceneAnalysis | null> // one scene's goals + conflicts (Inspector Purpose); null = not extracted yet
  searchContent(query: string, limit?: number): Promise<ContentMatch[]> // full-text search over content/ prose (command palette "by content")
  listSecretEvents(): Promise<PossessionEvent[]> // secret-category arc events in reading order (the who-knows fold)
  listCustodyEvents(): Promise<PossessionEvent[]> // custody-category arc events in reading order (the holder fold)
  listArcEvents(): Promise<ArcChangeEvent[]> // arc-change events (all facets except secret/custody) — the SceneInspector fold
  listDeclaredSecrets(): Promise<DeclaredSecretInfo[]> // the authored roster (CustodyRail's Information sidebar)
  listCustodyTopics(): Promise<CustodyTopic[]> // authored custody topic pages — the rail's AUTHORED chart source
  /** Grammar-check a drafted page body: records + errors + the CANONICAL rewrite (normalized fence). */
  parseCustodyBlock(markdown: string): Promise<{ records: CustodyRecord[]; errors: string[]; canonical: string }>
  createCustodyTopic(meta: { id: string; name: string; topic: 'item' | 'information'; subject?: string | null }, records: CustodyRecord[]): Promise<CustodyTopic | null>
  updateCustodyRecords(pageId: string, records: CustodyRecord[]): Promise<CustodyTopic | null> // the Records form's save (prose preserved)
  listExtensions(): Promise<ExtensionInfo[]> // bundled + installed extensions, each with its handshake verdict
  installExtension(id: string): Promise<HandshakeResult> // handshake → copy to userData → persist grant
  uninstallExtension(id: string): Promise<void> // stop → drop grant → remove copied files (reverts a bundled sample)
  setExtensionEnabled(id: string, enabled: boolean): Promise<void> // toggle on/off without uninstalling
  startExtension(id: string, params?: Record<string, unknown>): Promise<ExtensionStatus> // spawn under supervision
  stopExtension(id: string): Promise<void>
  extensionStatus(id: string): Promise<ExtensionStatus | null> // poll while the Extensions tab is open

  /** The QuestLog view: threads for the open work (open vs paid-off). */
  listThreads(): Promise<Thread[]>
  /** Coherence findings (drift/gap/contradiction/confirmation) for the open work. */
  listCoherenceFindings(): Promise<CoherenceFinding[]>
  /** One thread's full development (umbrella + strands + enriched beats) — for the ThreadSheet. */
  threadDetail(threadId: string): Promise<ThreadDetail>
  /** Every character's windowed arc (entity_arc_events grouped by folder/window) — the Character pivot. */
  listCharacterArcs(): Promise<CharacterArc[]>
  /** Console DB inspector: the co-located DB's tables + row counts (read-only, respects timetravel). */
  inspectTables(): Promise<DbTable[]>
  /** Console DB inspector: a bounded page of raw rows from one table (read-only; table is whitelist-checked). */
  inspectRows(table: string, limit: number, offset: number): Promise<DbRows>
  /** Tracked non-character entities (items/factions/…) + their presence trail — the Entity pivot. */
  listEntityTracks(): Promise<EntityTrack[]>
  /** Windowed arcs for tracked non-character things (items/factions) — the Entity pivot's journey lens. */
  listEntityArcs(): Promise<CharacterArc[]>
  /** Rule a coherence finding intentional (or withdraw the ruling) — persists in .nvs/coherence-rulings.json,
   *  survives re-runs + Reset analysis. Returns the refreshed, annotated findings. */
  setCoherenceRuling(entityId: string, trait: string, intentional: boolean): Promise<CoherenceFinding[]>
  /** Per-work UI state (graph tags + Cast roster filter), persisted in .nvs/ui-state.json. */
  readUiState(): Promise<UiState>
  writeUiState(state: UiState): Promise<boolean>

  // ── Editor: scene files ──────────────────────────────────────────────────
  listScenes(): Promise<SceneFile[]> // every scene .md in the open work
  readScene(path: string): Promise<SceneDoc> // frontmatter + body + raw
  writeScene(path: string, frontmatter: Record<string, unknown>, body: string): Promise<boolean>
  writeSceneRaw(path: string, text: string): Promise<boolean> // verbatim write (opt-in "edit source directly")
  stringifyScene(frontmatter: Record<string, unknown>, body: string): Promise<string> // recombine → raw
  /**
   * Create a scene under content/story/chapters/{chapterSlug}/{id}.md from the
   * renderer-built frontmatter + body. Returns the new SceneFile, or null if a scene
   * with that id already exists in the chapter.
   */
  createScene(
    chapterSlug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ): Promise<SceneFile | null>

  // ── Story tree: free-form folders under content/story ────────────────────
  listStoryTree(): Promise<StoryNode[]>
  createFolder(parentRel: string, name: string, type?: string): Promise<string | null>
  /** Set or clear a folder's optional container label (a soft badge — not enforced). */
  setFolderType(folderRel: string, type: string | null): Promise<boolean>
  renamePath(fromRel: string, toRel: string): Promise<boolean>
  deletePath(rel: string): Promise<boolean>
  setOrder(folderRel: string, names: string[]): Promise<boolean>
  /** Create a scene inside a story folder (folderRel relative to content/story). */
  createSceneInFolder(
    folderRel: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ): Promise<string | null>

  // ── Timeline: the node-canvas layout (.nvs/timeline.json) ────────
  readTimeline(): Promise<TimelineLayout>
  writeTimeline(layout: TimelineLayout): Promise<boolean>
  trees(): Promise<TreesFile> // the tree variants (.nvs/trees.json) — the active one drives the canvas + analysis
  saveTrees(trees: TreesFile): Promise<boolean>
  corkboard(): Promise<CorkboardFile> // the freeform boards (.nvs/corkboard.json) — read-modify-write whole-file
  saveCorkboard(file: CorkboardFile): Promise<boolean>
  /** Derived overlay data for the Timeline's layers (presence/threads/revelations/summary). */
  timelineGraph(): Promise<TimelineGraph>

  // ── World: the bible (cast for the pick-list, + the navigator's World tree) ─
  listWorldPages(): Promise<WorldPage[]>
  /** World pages whose body links to this page id (the "Mentioned by" backlinks). */
  worldBacklinks(pageId: string): Promise<WorldPage[]>
  /**
   * Create a new world page of `kind` with `id` (the filename slug) from the
   * renderer-built frontmatter + body. Returns the new page, or null if a page
   * with that id already exists in that kind's folder.
   */
  createWorldPage(
    kind: WorldPage['kind'],
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ): Promise<WorldPage | null>
  /** Delete a scene or world page `.md` by path (guarded to the open work). */
  deletePage(path: string): Promise<boolean>

  // ── Assets: avatars and other project media ──────────────────────────────
  /**
   * Open a multi-select picker, downsample each chosen image, copy them into
   * content/assets/{pageId}/, and return the new relative paths (to append to a
   * page's `images`). Returns [] if cancelled.
   */
  importImages(pageId: string, kind: string): Promise<string[]>
  /**
   * Same import pipeline as importImages, but the source paths are already known
   * (drag-and-drop) — no open-file dialog. Pair with getPathForFile to resolve
   * dropped File objects first.
   */
  importImagePaths(pageId: string, kind: string, paths: string[]): Promise<string[]>
  /**
   * Resolve a dropped File (from a renderer drag-and-drop event) to its real filesystem
   * path. Synchronous and preload-only (Electron's webUtils) — the one NvsApi method that
   * doesn't round-trip through ipcMain, since webUtils only works outside the sandboxed
   * renderer context.
   */
  getPathForFile(file: File): string

  // ── Analysis: T1 deterministic ingest (no LLM) ───────────────────────────
  /** Re-parse changed scene files into the co-located DB. Safe to call after every save. */
  ingestWork(): Promise<IngestResult>

  /**
   * Rebuild the derived analysis from scratch — the safe escape hatch. Backs up `.nvs/` aside,
   * removes the derived DB + version snapshots (keeps user JSON), then re-ingests T1. Manuscript untouched.
   * AI passes (T2/T3) must be re-run afterward.
   */
  resetAnalysis(): Promise<ResetAnalysisResult>

  // ── Analysis: T2/T3 producer writer (the keystone — internal/write-tier.md) ─
  /**
   * Persist one inferred-tier target (scene / character / diff) through the engine.
   * Idempotent (scoped-replace by target); stamps provenance, validates shape/refs/enums.
   * Returns ok:false + error on failure, leaving the DB untouched.
   */
  writeTier(p: TierWrite): Promise<TierWriteResult>
  /**
   * Fold duplicate threads into one (the earliest opener wins). Repoints events/refs + drops the dupe
   * umbrellas in a single transaction; returns ok:false + error on failure, DB untouched.
   */
  mergeThreads(threadIds: string[]): Promise<MergeResult>
  /** Fold duplicate entities into one (canonical = authored-first); names absorbed as aliases. */
  mergeEntities(entityIds: string[]): Promise<MergeResult>
  /** All scene-anchored evidence for one cast-graph edge — the range-aware relationship dialog's data. */
  relationshipEvidence(aId: string, bId: string): Promise<RelationshipEvidence>
  /** The Lore pivot: disclosure ledgers per topic + the story clock (both write-only tables until now). */
  listLoreView(): Promise<LoreView>
  /** Export the open project to a `.nvsproj` bundle (main prompts for the save location). */
  exportProject(): Promise<ExportResult>
  /** Export just the manuscript (content/ prose + assets) to a plain `.zip` (main prompts for the location). */
  exportManuscript(): Promise<ExportResult>
  /** Export one scene's `.md` (by its absolute path) to a chosen location (main prompts for the location). */
  exportScene(scenePath: string): Promise<ExportResult>
  /** Save a rendered image (a PNG data URL, e.g. the timeline graph) to a chosen location. */
  saveImage(suggestedName: string, dataUrl: string): Promise<ExportResult>
  /** Export the open project's prose as the STRUCTURED interchange — JSON (nested scenes→beats + characters)
   *  or CSV (flat beats table). Matches nvs-parser's `serialize`; main prompts for the save location. */
  exportStructured(format: 'json' | 'csv'): Promise<ExportResult>
  /** Export ONE scene: the same JSON/CSV envelope scoped to that scene (a whole-project dump is too big to be
   *  a useful interchange unit for another app), or `md` = the scene file verbatim. */
  exportSceneStructured(scenePath: string, format: 'json' | 'csv' | 'md' | 'srt'): Promise<ExportResult>
  /** Import an nvs-parser structured JSON as a new library project (main prompts to pick the file). */
  importStructured(): Promise<ImportResult>
  /** Import a `.nvsproj` as a new project in the library (main prompts to pick the file). */
  importProject(): Promise<ImportResult>
  /** Fork a closed project (by its folder path) into an independent library copy that records its parent. */
  forkWork(sourcePath: string): Promise<ImportResult>
  /** Delete a closed project — moves its folder to the OS trash (recoverable). Guarded to the library root. */
  deleteWork(path: string): Promise<{ ok: boolean; error?: string }>
  /** Re-copy the bundled examples (Getting Started + demos) into the library — skips any already present.
   *  The demos ship inside the app forever, so a deleted example is always recoverable, pristine. */
  restoreExamples(): Promise<{ restored: string[] }>
  /** The open project's authored metadata (.nvs/project.json); empty object if none yet. */
  readProjectInfo(): Promise<ProjectInfo>
  /** Any project's authored metadata by folder path — for the library detail preview (work need not be open). */
  readProjectInfoAt(path: string): Promise<ProjectInfo>
  /** The open project's structure (world + scene categories); world annotated with live entity counts. */
  readStructure(): Promise<StructureView>
  /** Persist the structure to the given world + scene category keys (e.g. applying a template); returns it. */
  writeStructure(worldKeys: string[], sceneKeys: string[]): Promise<StructureView>
  /** Merge a patch into the open project's metadata + stamp updatedAt; returns the merged result. */
  writeProjectInfo(patch: Partial<ProjectInfo>): Promise<ProjectInfo>
  /** Pick + resize a cover image into content/assets; returns its project-relative path (or null if cancelled). */
  pickCover(): Promise<string | null>
  /** Same as pickCover but the source path is already known (drag-and-drop) — no open-file dialog. */
  pickCoverFromPath(path: string): Promise<string | null>
  /** Rename a work's folder on disk (e.g. to match its title); null if it's the open project or on failure. */
  renameWork(path: string, newName: string): Promise<WorkCard | null>
  /** Clear the engine's open-work state (on returning to the library), so it no longer reads as a project. */
  closeWork(): Promise<void>
  /**
   * The engine-owned input-hash for a tier target — the SAME recipe the writer records.
   * A producer fetches this at run-start and passes it back in `writeTier`.
   */
  tierInputHash(kind: TierKind, targetId: string, asOf: string | null): Promise<string>
  /** The Ingest dock's canon-set tracer: every scene with its fresh/stale/pending status. */
  listTierStatus(): Promise<TierStatusRow[]>
  /** Per-character coherence freshness (page vs arc) — drives the "Check coherence (N)" count. */
  coherenceStatus(): Promise<CoherenceStatusRow[]>
  /** Timeline slice: is the on-disk analysis for the CURRENT `leads_to` graph, or stale (graph edited
   *  since it ran)? Plus a cycle flag. Drives "no run for this version — run it" + the loadout picker. */
  timelineStatus(): Promise<TimelineStatus>
  /**
   * Apply an ingestion bundle (the agent's / a hand-authored JSON output) by name from
   * .nvs/ingest/<name>.json — each entry written via writeTier (engine stamps the hash).
   * Returns one result per entry.
   */
  runIngestBundle(name: string): Promise<TierWriteResult[]>
  /** List available ingestion bundles in .nvs/ingest/ (names without .json). */
  listIngestBundles(): Promise<string[]>

  // ── Ingest runner (Phase 2): the single "Update analysis" action ──
  /** Start the dedicated analysis run — snapshots the DB, then processes the frontier target-by-target.
   *  Progress streams via onIngestProgress; resolves when the run finishes (or is a no-op if one's live).
   *  depth: 'skim' = fast mode (light scene contract, no window/profile rollups) · 'full' = expert (default). */
  startIngestRun(forceScenes?: string[], depth?: AnalysisDepth): Promise<void> // forceScenes = re-read these even if fresh (manual re-analyze)
  /** Dry-run the frontier for the pre-run dialog: per-kind step counts at a given depth. Plans nothing. */
  planIngestPreview(depth?: AnalysisDepth): Promise<IngestPreview>
  /** Start the coherence check — its own trigger (one AI call diffing every character's page vs their arc).
   *  Shares the runner's progress stream + version history with the analysis update. No-op if a run is live. */
  startCoherenceRun(): Promise<void>
  /** Stop the current run after the in-flight step (aborts the live AI call). */
  cancelIngestRun(): Promise<void>
  /** Subscribe to the live run's progress (pushed on every step change). Returns an unsubscribe. */
  onIngestProgress(cb: (progress: IngestProgress | null) => void): () => void
  /** Past runs (newest first) + which version the live DB currently reflects (the "you are here" pointer). */
  listIngestSessions(): Promise<{ sessions: IngestSession[]; current: string | null }>
  /** Restore a past version (reversible — moves the current pointer; nothing is lost). False if its snapshot is gone. */
  revertIngestSession(id: string): Promise<boolean>
  /**
   * Timetravel: point the analysis read queries at a version's snapshot (read-only), or null for live.
   * Resolves false when the version can't be viewed (its snapshot was pruned) — reads stay live.
   */
  setViewingVersion(snapshotId: string | null): Promise<boolean>

  // ── Agent: the in-app MCP server (localhost) ──────────────────────────────
  /** Status of the in-app MCP server an agent connects to (running, URL, exposed tools). */
  mcpStatus(): Promise<McpStatus>
  /** The paths + snippet for wiring the HEADLESS stdio server into Claude Code / Desktop (the "Add to Claude Code" panel). */
  mcpHeadlessInfo(): Promise<McpHeadlessInfo>
  /** Generate a Claude Desktop PLUGIN (.zip, paths baked in) — the one-click install instead of hand-editing a config. */
  generateClaudePlugin(): Promise<ExportResult>

  // ── AI: host mode — a registry of provider connections, one active (the router) ──
  /** All saved connections + which is active (the one the agent uses). */
  aiConnections(): Promise<AiState>
  /** Create (omit id) or update a connection; pass `secret` to set/replace its key. */
  saveConnection(input: SaveConnectionInput): Promise<AiState>
  /** Delete a connection (and its stored key). */
  removeConnection(id: string): Promise<AiState>
  /** Make one connection active — or null for none. Only the active one ever fires. */
  setActiveConnection(id: string | null): Promise<AiState>
  /** Pin a dedicated ANALYSIS connection (scene/window/coherence passes) — null = follow active. */
  setAnalysisConnection(id: string | null): Promise<AiState>
  /** Run the in-app agent over the chat history via the active connection. `context` is the page the
   *  user is viewing (so "this page" requests work). Events stream via `onAgentEvent`; resolves with
   *  the final status + assistant reply (for chat history). */
  runAgent(history: ChatMessage[], context?: ChatContext | null): Promise<AgentRunResult>
  /** Subscribe to streamed agent events (text / tool / tool_result) during a run. Returns an unsubscribe. */
  onAgentEvent(cb: (event: AgentEvent) => void): () => void
  /** Abort the in-flight agent run (the chat Stop button). */
  cancelAgent(): Promise<void>

  /** One-shot in-editor WRITE command (ephemeral, no chat): page + composed instruction → edited Markdown.
   *  The renderer applies the result as one editor transaction (native undo). */
  runPageAgent(input: PageAgentInput): Promise<PageAgentResult>
  /** Abort the in-flight page-agent run. */
  cancelPageAgent(): Promise<void>

  /** Enqueue a background WRITE task (the Tasks inbox). Runs via the active connection, serialized;
   *  the renderer applies its `result` to the page on review. Returns the task id. */
  enqueueTask(input: TaskInput): Promise<string>
  /** The current task list (queued/running/done/…). */
  listTasks(): Promise<AgentTask[]>
  /** Subscribe to the full task list on any change (push). Returns an unsubscribe. */
  onTaskUpdate(cb: (tasks: AgentTask[]) => void): () => void
  /** Pushed when an out-of-band write (e.g. an agent createPage/setPhase) changed files on disk, so the
   *  renderer re-fetches the tree/scenes/world + analysis and toasts what happened. Returns an unsubscribe. */
  onProjectChanged(cb: (change: ProjectChange) => void): () => void
  /** Cancel a queued/running task. */
  cancelTask(id: string): Promise<void>
  /** Remove a task from the inbox (any status). */
  dismissTask(id: string): Promise<void>
  /** Clear all finished tasks (keeps queued/running). */
  clearDoneTasks(): Promise<void>

  /** The global Prompt Library — built-in + user-saved reusable instructions. */
  listPrompts(): Promise<SavedPrompt[]>
  /** Upsert a prompt (empty id = create). Returns the full list. */
  savePrompt(prompt: SavedPrompt): Promise<SavedPrompt[]>
  /** Delete a user prompt (built-ins are kept). Returns the full list. */
  deletePrompt(id: string): Promise<SavedPrompt[]>

  /** Open a web/mail URL in the system browser (for help/docs links). */
  openUrl(url: string): Promise<void>

  // ── Chat sessions — persisted per-project under .nvs/chat/ (index.json + sessions/<id>.jsonl) ──────
  // LAZY by design: the picker loads only lightweight metas; a session's heavy body loads on demand; a mutation
  // rewrites only that one session's small file. A legacy .nvs/chat.json is migrated on first list, then removed.
  /** Load the session METAS (empty history/events) + the active id — fast, no bodies. */
  listChatSessions(): Promise<ChatStore>
  /** Load ONE session's full body (history + events). Null if it's gone. */
  readChatSession(id: string): Promise<ChatSession | null>
  /** Persist ONE session (its body + meta in the index). */
  writeChatSession(session: ChatSession): Promise<boolean>
  /** Set which session is active (index only). */
  setActiveChatSession(id: string | null): Promise<boolean>
  /** Delete ONE session (its file + index meta); re-points active if it was the one. */
  deleteChatSession(id: string): Promise<boolean>
}

/** One named chat session — conversation (resumable context) + event log (audit/display). */
export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  history: ChatMessage[]
  events: AgentEvent[]
}

/** Lightweight session header for the picker — everything but the heavy body. */
export interface ChatSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** A work's chat sessions + the active one. `listChatSessions` returns metas as empty-body sessions. */
export interface ChatStore {
  sessions: ChatSession[]
  activeId: string | null
}

/** A page reference handed to a chat run (the open page, or a user-attached one). */
export interface ChatRef {
  kind: 'scene' | 'world'
  path: string
  title: string
}

/** Context for a chat run: the page being viewed + any pages the user attached as focus. */
export interface ChatContext {
  active: ChatRef | null // the page currently open (so "this page/character" resolves)
  attached?: ChatRef[] // pages the user tagged via the attach menu — the agent reads them with readScene
}

/** A saved AI provider connection (a "card"). Exactly one is active at a time. */
export type AiConnectionStatus = 'active' | 'ready' | 'needs-key'

export interface AiConnection {
  id: string
  type: AiProviderType
  label: string
  model: string
  hasSecret: boolean // a key is stored for this connection
  secretLen: number // length of the stored key (0 if none) — for a masked-dots hint, never the key
  status: AiConnectionStatus // active (the router pick) · ready (key saved) · needs-key
}

export interface AiState {
  connections: AiConnection[]
  activeId: string | null // the active connection — chat/agent route here
  analysisId: string | null // dedicated analysis connection (scene/window/coherence); null = follow active
}

export interface SaveConnectionInput {
  id?: string // omit to create a new connection
  type: AiProviderType
  label: string
  model?: string // defaults to the provider's default if omitted
  secret?: string // set/replace the key; omit to leave the stored key unchanged
}

/** One message in the host chat (the user-visible text exchange). */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

/** One step in the chat transcript — shown in the chat + persisted. */
export type AgentEvent =
  | { type: 'user'; text: string; attached?: ChatRef[] } // the human's prompt (+ any pages they attached) — echoed by the UI
  | { type: 'text'; text: string } // assistant prose (a settled bubble)
  | { type: 'text_delta'; text: string } // a streamed prose chunk — the store merges it into the trailing 'text' bubble (never persisted on its own)
  | { type: 'tool'; name: string; input: unknown } // a tool call
  | { type: 'tool_result'; name: string; result: unknown } // its result
  | { type: 'error'; message: string } // a run failure (logged in-transcript)

export interface AgentRunResult {
  ok: boolean
  reply: string // the assistant's text for chat history (events themselves arrive via onAgentEvent)
  error?: string
}

/** Input for a one-shot in-editor write command. `mode` decides what the model returns + how it lands. */
export interface PageAgentInput {
  pageText: string // the page's current Markdown (what the agent edits/appends to)
  instruction: string // composed free-text + chained preset directives
  mode: PageEditMode // 'append' (return only new text) | 'replace' (return the full revised page)
  kind: PageRef['kind'] // scene vs world — picks the on-disk format spec so the edit conforms
  pageTitle?: string // the subject's name — anchors a world page so the model doesn't rename the character
}

export interface PageAgentResult {
  ok: boolean
  text: string // the Markdown to apply (append or replace, per mode)
  error?: string
}

/** A reusable instruction in the global Prompt Library (the composer's pills + the RightRail Prompts panel). */
export interface SavedPrompt {
  id: string
  label: string // the pill / list label
  directive: string // the instruction fragment handed to the page-agent (or sent to chat for analysis)
  mode: PageEditMode // append (add text) | replace (rewrite the page) — ignored for analysis
  category: PromptCategory // maintenance/generation edit the page; analysis runs in chat
  builtIn?: boolean // seeded defaults — editable, not deletable
}

/** A background WRITE task (the Tasks inbox). Lean + session-scoped: in-memory in main, lost on quit. */
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export interface TaskInput {
  pagePath: string // the page this edit targets
  pageTitle: string // for display in the inbox
  pageKind: PageRef['kind'] // so apply can re-open the page if the author navigated away
  instruction: string // composed directive (free-text + presets)
  mode: PageEditMode
  baseText: string // the page content the edit ran against — for the apply-time staleness guard
  stamp?: boolean // true → fold an AI-provenance note into the applied text (generation edits only)
}
export interface AgentTask extends TaskInput {
  id: string
  status: TaskStatus
  result?: string // the edited Markdown (when done) — applied to the page on the renderer side
  error?: string
  createdAt: string
  startedAt?: string // when it began running — for the live + final elapsed display
  finishedAt?: string // when it reached a terminal state (done/failed/cancelled)
  groupId?: string // set when a burst of same-instruction edits is queued (chat fan-out) → one inbox entry
}

/** Payload of `onProjectChanged` — what an out-of-band agent write did, so the renderer can toast it. */
export interface ProjectChange {
  action: 'create' | 'setPhase'
  path: string
  title?: string
  phase?: string // setPhase only
}

/** The in-app MCP server's live status — surfaced in the console's Agent tab. */
export interface McpStatus {
  running: boolean
  url: string | null // the localhost connect URL while running
  tools: string[] // the engine capabilities exposed as MCP tools
  error: string | null // last bind/handle error, if any (e.g. port in use)
}

/** Everything the "Use NVS from Claude Code" panel needs to render copy-paste setup for the HEADLESS stdio server. */
export interface McpHeadlessInfo {
  command: string // the Electron/app binary to run (as node via ELECTRON_RUN_AS_NODE)
  script: string // the bundled headless entry (out/headless/mcp.cjs)
  built: boolean // whether `script` exists yet (dev: needs `npm run mcp:build`)
  toolCount: number // how many tools the headless server exposes (incl. lifecycle)
  httpUrl: string | null // the in-app HTTP server URL (the "app-running" alternative), if up — CONTAINS THE AUTH TOKEN
  home: string // the user's home dir — the UI redacts it to `~` in the DISPLAYED (screenshot-safe) command, not the copied one
  liveConfig: string // path to the live-app handshake file — pass as `--live` so the headless server hands off to the running app (path only; the token stays inside the file)
}

/**
 * One beat in a thread's development (a row of thread_events), enriched with its scene's
 * extracted context (the "where/who") and the agent's justification (evidence + confidence —
 * the transparency: a thread is the model's reading, not authored truth).
 */
export interface ThreadBeat {
  action: string // open | advance | resolve | reopen | supersede
  subject: string | null // the strand this beat belongs to (a thread can fork per subject); null = the one anonymous strand
  sceneId: string // the scene where it happened (resolves to a title/page)
  sceneCode: string | null // formatted scene code, e.g. "A2·S3"
  sceneTitle: string | null // the scene's title, if it resolves
  sceneSummary: string | null // extracted_scenes.summary — what the scene was about
  location: string | null // extracted_scenes.locations_json[0] — where it happened
  cast: string[] // extracted_scenes.characters_json — who was present
  evidence: string // the line/beat that justifies the action
  description: string
  confidence: number | null // producer confidence (low closes deserve review)
}

/** A thread's full development: the umbrella, its strands, and the enriched beat log. */
export interface ThreadDetail {
  thread: Thread
  strands: { subject: string | null; status: string; beats: number }[]
  beats: ThreadBeat[]
}

/**
 * One arc event — a character's state-change in a window (entity_arc_events). Windowed by design:
 * a trait is longitudinal, accumulated over a folder's scenes, not recorded per scene.
 */
export interface ArcEvent {
  category: string // alignment | knowledge | power | relationship | open_objective | secret
  change: string // gain | loss | expose
  value: string // the thing gained/lost/exposed
  description: string
  sceneId?: string // the SCENE the change happened in (new rows) — lets a per-scene surface highlight THIS event; absent on legacy rows
}

/** A character's arc within one window (folder/"chapter") — the band that spans the window's scenes. */
export interface ArcWindow {
  windowId: string // the folder/chapter unit_id the arc was accumulated over
  title: string // the folder's title
  sceneIds: string[] // the window's scenes, in reading order (maps the band onto scene columns)
  summary: string | null // character_windows.summary — the narrative synthesis for this character × chapter
  goals: { goal: string; status: string }[] // what they wanted this window + the outcome (extracted_scenes.goals)
  conflicts: { over: string; with: string[]; kind: string }[] // tensions they're in (extracted_scenes.conflicts)
  events: ArcEvent[] // the atomic state-change ledger (entity_arc_events)
}

/** One character's windowed arc across the work — rows of the Character pivot + its Sheet. */
export interface CharacterArc {
  entityId: string
  name: string
  windows: ArcWindow[]
}

/**
 * A coherence finding (T2/T3): a place where the dialogue drifts from / fills a gap in /
 * contradicts / confirms what a page declares. Surfaced in the Coherence panel.
 */
export interface CoherenceFinding {
  id: string
  entityId: string | null // who it's about (null = work-level / thread-level)
  threadId: string | null // for `quest:` findings — the thread the flag is about (parsed from finding_id)
  asOf: string | null // checkpoint scene code, e.g. "A2·S3"
  trait: string // the aspect under review
  declared: string // HOW it's declared — what the page / prior state says
  observed: string // WHEN it's observed — what the prose shows
  why: string | null // WHY it matters — the breach's significance (producer field; null until extraction emits it)
  kind: string // free-text from the producer: contradiction | hole | confirmation | sequel_hook | drift | gap | …
  severity: string // low | medium | high — the color/triage axis (kind is just a label, drift-tolerant)
  suggestion: string
  evidence: string[] // scene_ids the finding draws on (evidence_json) — the violating/supporting scenes
  secret: string | null // confirmations: the covering `## Secrets` entry id (the slip↔secret link; null = uncited)
  /** The AUTHOR ruled this divergence intentional (deception/twist by design) — overlaid from the rulings
   *  ledger (.nvs/coherence-rulings.json), never produced by analysis. Quiet ✓ rendering, excluded from triage. */
  intentional?: boolean
}

/** Counts returned after a T1 ingest pass. */
export interface IngestResult {
  chapters: number
  scenes: number
  dialogNodes: number
  changed: number
  skipped: number
}

/** Outcome of a reset-analysis: where the old `.nvs/` was backed up + the fresh T1 ingest counts. */
export interface ResetAnalysisResult {
  ok: boolean
  backupDir: string | null // absolute path of the `.nvs.bak-<ts>/` backup (null if there was nothing to back up)
  ingest: IngestResult | null
  error?: string
}


// ── writeTier: the T2/T3 producer-writer contract (see internal/write-tier.md) ──
// A producer supplies SEMANTIC content only; the engine stamps work_id / created_at /
// model / input_hash and validates shape + refs + enums. Discriminated by `kind`
// (the three producer passes, mirroring inference_runs.kind).

/** T2 scene pass: extracted_scenes (the model's structured reading of one scene). */
export interface ExtractedSceneRow {
  summary: string | null
  premise?: string | null // why the scene starts / its setup (analysis-components.md); NULL on legacy rows → UI falls back to summary
  conclusion?: string | null // how it ends / the cliffhanger
  pov: string | null // entity_id (FK-checked) or null
  characters: string[] // entity_ids present
  locations: string[]
  plotTimes: string[] // in-story time markers
  goals: { actor: string; goal: string; status: string }[]
  conflicts: { between: string[]; over: string; kind: string }[]
  enters: { entity: string; kind: string }[]
  exits: { entity: string; kind: string; reversible?: boolean }[]
  sceneContexts: string[] // related scene_ids
  /** The THIRD BUCKET (open-taxonomy.md): notable non-character things this scene features — items, factions,
   *  and any other tracked world category. `category` must be one of the project structure's enabled tracked
   *  categories (the producer is handed that enum — it never invents one). Resolved against existing entities
   *  by name/alias; unresolved names create a typed entity + presence. */
  things?: { name: string; category: string; significance?: string | null; evidence?: string | null; confidence?: number | null }[]
}
/** One thread_events beat; `umbrella` is set on the beat that opens a new thread. */
export interface ThreadBeatRow {
  threadId: string
  subject: string | null // strand; null = the thread's one anonymous strand
  action: 'open' | 'advance' | 'resolve' | 'reopen' | 'supersede'
  sortPos: number | null // revelation-order position (scene linear_pos) for the fold
  evidence: string | null // the line/beat justifying a resolve/reopen
  confidence: number | null
  description: string | null
  umbrella?: {
    description: string
    title?: string | null // short human title for the UI (the slug stays the under-the-hood key)
    threadType?: string | null
    builtBy?: string | null // structural | authored | inferred
    resolutionCondition?: string | null // the close gate, set at open
    succeeds?: string | null // thread_id this supersedes
  }
}
/** One lore_updates row (a lore disclosure in this scene). */
export interface LoreUpdateRow {
  loreId: string
  summary: string
  magnitude?: string | null // minor | major | retcon
  builtBy?: string | null // inferred | authored
}
export interface SceneRows {
  extracted: ExtractedSceneRow
  threads: ThreadBeatRow[]
  lore: LoreUpdateRow[]
}

/** T2 window pass: one character×chapter window summary + its flattened state-change events. */
export interface CharacterWindowRow {
  summary: string | null
}
export interface ArcEventRow {
  category: string // the FACET — character: alignment|knowledge|power|…; item: custody|state|function; faction: power|standing|… (config/entityArc)
  change: string // character: gain|loss|expose; entity: the category's own verbs (acquired|transferred|…). Validated per-category in writeTier.
  value: string // the thing gained/lost/exposed / the new custody/state
  description: string
  sceneId: string // unit_id where the change happened
  target?: string | null // category=secret + change=expose ONLY: who it was revealed TO ('public' | entity_id). gain needs none — the OWNER is the learner.
  secret?: string | null // category=secret ONLY: the declared `## Secrets` entry id this concerns (from the roster; validated, never invented)
}
export interface WindowRows {
  window: CharacterWindowRow
  arcEvents: ArcEventRow[]
}

/** T3 coherence pass: findings at a checkpoint. */
export interface CoherenceFindingRow {
  trait: string
  declared: string
  observed: string
  kind: 'drift' | 'gap' | 'contradiction' | 'confirmation'
  severity: 'low' | 'medium' | 'high'
  suggestion: string
  evidence: string[] // contributing scene unit_ids
  why?: string | null // the breach's significance (written iff the column exists)
  secret?: string | null // confirmations only: the declared `## Secrets` entry id that covers the divergence
}
export interface CoherenceRows {
  findings: CoherenceFindingRow[]
}

/** One CONTINUITY (plot-hole) finding — the story vs itself (internal/continuity-coherence.md). Cross-entity:
 *  `entityId` is null for a work-level hole (most of them). Kinds are the three the plot-hole craft literature
 *  logs — continuity-error / logic-gap / rule-break (CONTINUITY_KINDS). */
export interface ContinuityFindingRow {
  entityId: string | null // null = work-level / cross-cutting (most continuity holes)
  trait: string
  declared: string // the rule / earlier fact now contradicted
  observed: string // the later scene/decision that breaks it
  kind: 'continuity-error' | 'logic-gap' | 'rule-break'
  severity: 'low' | 'medium' | 'high'
  suggestion: string // the fix goes to the STORY or the RULE, not a page
  evidence: string[] // scene_ids and/or thread_ids the finding rests on
}
export interface ContinuityRows {
  findings: ContinuityFindingRow[]
}

/**
 * A producer's write of one inferred-tier target. `run_id` is derived; never sent.
 * Kinds mirror the live inference_runs vocabulary: scene · window · coherence.
 */
/** How deep a scene extraction went: 'full' = the complete ledger contract, 'skim' = fast mode (summary +
 *  threads + presence only). Expert runs re-read skim scenes; fast runs accept either. */
export type AnalysisDepth = 'skim' | 'full'

export type TierWrite =
  | { tier: 't2'; kind: 'scene'; targetId: string; asOfUnitId?: null; model: string; inputHash: string; rows: SceneRows; depth?: AnalysisDepth }
  | { tier: 't2'; kind: 'window'; targetId: string; asOfUnitId: string; model: string; inputHash: string; rows: WindowRows }
  | { tier: 't3'; kind: 'coherence'; targetId: string; asOfUnitId: string; model: string; inputHash: string; rows: CoherenceRows }
  | { tier: 't3'; kind: 'continuity'; targetId: 'story'; asOfUnitId: string; model: string; inputHash: string; rows: ContinuityRows }

export interface TierWriteResult {
  ok: boolean
  runId: string
  written: Record<string, number> // table → rows written
  rebuilt: string[] // thread umbrella ids whose cached status was recomputed
  error?: string // set when ok:false (validation / DB failure; DB left untouched)
  stack?: string // on an UNEXPECTED crash (not a validation reject): the JS stack, for the auditable telemetry log
}

/** The manifest inside a `.nvsproj` bundle (see internal/export-gallery.md). Lineage fields null in v1. */
export interface BundleManifest {
  nvsproj: number // format version
  workId: string
  title: string
  author: string | null
  schemaVersion: string // the DB's `_migrations` head — the import gate reads it
  appVersion: string
  exportedAt: string // ISO
  forkedFrom: string | null
  coverOf: string | null
  promptSource: string | null
}

/** Result of exporting a project to a `.nvsproj`. */
export interface ExportResult {
  ok: boolean
  file?: string // the written bundle path
  title?: string
  error?: string
}

/** Result of importing a `.nvsproj` into the library (a new project; rolled back on failure). */
export interface ImportResult {
  ok: boolean
  name?: string // the deduped library folder name
  path?: string // absolute path to the new project (open it)
  title?: string
  error?: string
}

/** Result of folding duplicate threads (see engine/threadMerge). DB untouched on ok:false (one transaction). */
export interface MergeResult {
  ok: boolean
  canonicalId?: string // the kept thread (earliest opener)
  merged?: string[] // the folded-away thread ids
  repointed?: Record<string, number> // what moved: thread_events · succeeds · revelations · coherence_findings
  error?: string
}

/** One secret/custody-category arc event with knowledge fields (014) — the possession folds' raw input. */
/** One scene's dramatic purpose (T2 extraction) — the Scene Inspector's Purpose section. `actor`/`between` are
 *  entity ids (resolved to names for display by the renderer). */
export interface SceneGoal { actor: string; goal: string; status?: string | null }
export interface SceneConflict { between: string[]; over: string; kind?: string | null }
export interface SceneAnalysis { premise: string | null; conclusion: string | null; summary: string | null; goals: SceneGoal[]; conflicts: SceneConflict[] }

export interface PossessionEvent {
  entityId: string // the event's owner (for `gain` on secrets: the LEARNER; for custody: the item)
  sceneId: string
  change: string
  value: string
  target: string | null // secrets, expose only: who it reached ('public' | entity_id)
  secret: string | null // the declared `## Secrets` entry id this event cites (null = uncited/free-text)
  description: string
}

/** One per-scene ARC-CHANGE (entity_arc_events, all facets EXCEPT secret/custody) — the SceneInspector's Arc/Entity fold. */
export interface ArcChangeEvent {
  entityId: string
  sceneId: string
  category: string // facet — character: alignment|knowledge|power|relationship|open_objective; entity: state|function|standing|…
  change: string // gain | loss | expose (character) · the facet's own verb (entity)
  value: string // the thing gained/lost/exposed
  description: string
}

/** The closed event vocabulary of a custody checkpoint (structure-canonical; see secret-lifecycle.md). */
/** Grammar v2 — THREE verbs; what a verb MEANS comes from the topic kind (item: possession · information:
 *  knowledge). Legacy v1 verbs (held-by → gain · known-by → gain · forgotten-by → lost) and `since`
 *  (folded into `scene`) are accepted by the parser and normalized — never written back. */
export type CustodyEventKind = 'gain' | 'lost' | 'public'

/** One authored checkpoint record from a topic page's fenced ```custody block. EVENTS ONLY — state is
 *  always derived by the chart fold. `who` may include the special 'audience' (the reader). */
export interface CustodyRecord {
  scene: string // a scene id, or 'start' (true before page one) — validated at entry
  event: CustodyEventKind
  who: string[] // entity ids/names. On an ITEM topic a character's gain IMPLIES the prior holder's loss (one record per handoff, never two).
  note?: string | null // the why — rides along, never load-bearing
}

/** A custody TOPIC page (content/custody/), parsed — the CustodyRail's AUTHORED chart source. */
export interface CustodyTopic {
  pageId: string
  name: string
  path: string
  topic: 'item' | 'information' // frontmatter `topic:`; inferred from record events when absent
  subject: string | null // the anchor entity id
  records: CustodyRecord[]
  errors: string[] // entry-validation messages (bad enum / unknown scene / unresolvable who) — surfaced by the form
}

/** A declared `## Secrets` entry with its owner — the roster (authored identity; see engine/secrets.ts). */
export interface DeclaredSecretInfo {
  id: string
  text: string
  ownerId: string
  ownerName: string
}

/** The three producer passes, matching the live inference_runs vocabulary. */
export type TierKind = 'scene' | 'window' | 'coherence' | 'continuity' | 'digest' | 'profile' // digest/profile = working-set reductions (M2/M3); continuity = plot-holes (story vs itself)

/** A tier target's freshness vs the staleness ledger (the Ingest dock tab reads these). */
export type TierStatus = 'fresh' | 'stale' | 'pending'

/**
 * One row of the Ingest dock's canon-set tracer (scene pass). `status` is derived from the
 * staleness DAG — pending (no run) · stale (file edited since the run) · fresh — NOT from
 * input_hash equality (a prior producer may have used a different hash recipe).
 */
/** Timeline slice-2 status — the analysis is bound to a `leads_to` GRAPH version; this says whether the
 *  on-disk analysis matches the current graph (fresh) or predates an edit (stale → offer re-run), + a cycle. */
export interface TimelineStatus {
  currentVersion: string // graphVersion() of the current leads_to DAG
  ranVersion: string | null // the version the on-disk analysis rows are stamped with (null = never stamped)
  stale: boolean // analysis exists but for a DIFFERENT graph version → "no run for this version — run it"
  hasAnalysis: boolean // any analysis rows at all
  cycle: string[] | null // a leads_to cycle (blocks a clean walk) — surface loud, don't analyze
}

export interface TierStatusRow {
  unitId: string
  code: string | null // formatted scene code, e.g. "A1·S1"
  title: string
  phase: string | null // canon | developing | draft | … (the ingest gate; null if unset)
  status: TierStatus
  lastRun: string | null // inference_runs.created_at of the t2:scene run, if any
  depth: AnalysisDepth | null // how deep the last extraction went (null = never run; pre-depth rows read as 'full')
}

/**
 * One character's coherence freshness (the "Check coherence" counterpart of TierStatusRow). Reuses TierStatus
 * so the dock shows the same words — fresh = "Up to date", stale = "Outdated", pending = "Not read". Stale
 * when the character's page or their dialogue-through-the-checkpoint changed since the last coherence check.
 */
export interface CoherenceStatusRow {
  entityId: string
  name: string
  status: TierStatus
}

/** One ordered dialogue line of a scene — the producer's input for the scene-read pass (Phase 3). */
export interface SceneDialogueLine {
  speaker: string
  type: string // speech | monologue | narration | chorus (dialogue_type)
  text: string
}

// ── Ingest runner: the dedicated analysis run (Phase 2) — a snapshotted, streamed, per-target pass ──

/** One unit of work in an analysis run — a target the runner reads/writes, with its live state. */
export interface IngestStep {
  id: string // stable within a run (the target's run_id)
  kind: TierKind
  targetId: string
  label: string // human label (scene code · title, or the target id)
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  note: string | null // rows written, the error, or why skipped
  startedAt: string | null // when this step began running (drives the live elapsed clock)
  ms: number | null // how long it took once settled (the per-file time cue)
}

/** The current run's progress, pushed to the renderer step-by-step (onIngestProgress). */
/** Jobs dashboard (JobRail). Kinds/statuses/columns are declared in renderer config/jobs.ts; these are the
 *  runtime shapes. A JobRow is assembled from the live run + local telemetry — cost/memory/provider are
 *  MACHINE-LOCAL (never exported with the nvsproj — see config/jobs.ts persistence boundary). */
export type JobKind = 'analysis' | 'coherence' | 'skim' | 'extension' | 'export'
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
export interface JobRow {
  id: string
  kind: JobKind
  projectName: string
  projectRoot: string
  status: JobStatus
  done: number
  total: number
  currentLabel?: string | null
  etaMs?: number | null
  elapsedMs?: number | null
  cost?: { usd?: number; inputTokens?: number; outputTokens?: number; backend?: string } | null // local-only
  memoryMb?: number | null // local-only
  provider?: string | null
  result?: { ok: number; failed: number; skipped: number } | null
  at?: string | null // ISO finish (history) / start (live) — sorts the universal list, newest first
}

/** Per-project local-storage usage (Jobs → Storage tab). All machine-local, never exported. */
export interface StorageRow {
  root: string
  name: string
  logsBytes: number // ingest-telemetry.jsonl (+ rotated)
  historyBytes: number // run ledger sessions + revert snapshots
  chatBytes: number // chat.json (the unbounded one)
  tasksBytes: number // background-task inbox (.nvs/tasks/*.json)
  backupsBytes: number // `.nvs.bak-<ts>/` full copies left by "Reset analysis" (project root) — nothing else GCs them
  dbBytes: number // nvs.db (+ -wal/-shm) — the analysis; usually the biggest artifact, not clearable (Reset rebuilds it)
  totalBytes: number // the honest footprint: entire `.nvs/` + root-level reset backups
}
export type StorageKind = 'logs' | 'history' | 'chat' | 'tasks' | 'backups'

/** Pro entitlement (Autumn lifetime) — the machine-local flag Pro features gate on. See main/entitlement.ts. */
export interface Entitlement {
  pro: boolean
  email: string | null
  verifiedAt: string | null
}

export interface IngestProgress {
  sessionId: string
  projectRoot: string // the project this run is bound to — so a switch/quit can warn, and it can never write to another
  projectName: string // for the "analysis running on {name}" reminder
  steps: IngestStep[]
  startedAt: string
  finishedAt: string | null // null while active
  active: boolean
  error?: { kind: string; message: string } | null // a FATAL stop (credits/auth/session/persistent rate limit) — run paused
  // Live enrichment for the Jobs dashboard (computed in the runner's broadcast). All machine-local.
  etaMs?: number | null // phase-aware: serial scene reads dominate; parallel window/profile/digest rollups are far cheaper
  memoryMb?: number // main-process RSS sample (the plan host is a separate subprocess)
  provider?: string | null // the connection this run routes through (plan | anthropic | openrouter …)
  cost?: { inTokens: number; outTokens: number; calls: number } | null // estimated from chars — LOCAL, never exported
  depth?: AnalysisDepth // fast (skim) vs expert (full) — what this run's scene reads extract
}

/** The pre-run dialog's dry-run: how big would a run be right now, per step kind. */
export interface IngestPreview {
  depth: AnalysisDepth
  counts: Record<string, number> // step kind → planned count (scene | window | profile | digest)
  total: number
}

/** A finished run, kept in the history log (.nvs/ingest-runs.json) for the "Recent updates" list. */
/** One target a run actually wrote — the provenance of a version (what scenes/chapters/characters it
 *  processed). The set of these IS the delta that run addressed (the stale frontier it cleared). */
export interface IngestTarget {
  kind: TierKind
  targetId: string
  label: string // the human label shown on the queue (scene code · title, "arcs · C1", "Coherence check")
}
export interface IngestSession {
  id: string
  kind?: 'analysis' | 'coherence' // analysis = the versioned story-state spine; coherence = a child of it. Absent = legacy (treat as analysis).
  basedOn?: string | null // (coherence only) the analysis version id this check diffed — its parent in the timeline
  startedAt: string
  finishedAt: string
  total: number
  ok: number
  failed: number
  skipped: number
  rowsWritten: number
  snapshotId: string | null // the pre-run DB backup this session can revert to (analysis only; coherence is re-derivable, never snapshotted)
  snapshotAvailable?: boolean // is that snapshot file STILL on disk? false ⇒ pruned (only the newest are kept) → can't preview/restore
  targets?: IngestTarget[] // what this version covered (provenance); absent on legacy sessions
}

/**
 * The "address" each order is sent to. ipcRenderer.invoke(CHANNELS.listThreads, …)
 * on one side, ipcMain.handle(CHANNELS.listThreads, …) on the other — both read the
 * same constant so a typo can't split them.
 *
 * `satisfies Record<keyof NvsApi, string>` is a compile-time guarantee: every
 * method in NvsApi MUST have a channel here, or the build fails.
 */
export const CHANNELS = {
  ping: 'app:ping',
  minimizeWindow: 'window:minimize',
  toggleMaximizeWindow: 'window:toggle-maximize',
  closeWindow: 'window:close',
  toggleDevTools: 'window:toggle-devtools',
  confirmClose: 'window:confirm-close',
  onAppBeforeClose: 'window:before-close',
  bootOpenWork: 'window:boot-open-work',
  listWorks: 'library:list',
  listAllJobs: 'jobs:list-all',
  readTelemetry: 'jobs:read-telemetry',
  storageUsage: 'jobs:storage-usage',
  clearStorage: 'jobs:clear-storage',
  compactSnapshots: 'jobs:compact-snapshots',
  getEntitlement: 'pro:get',
  verifyPro: 'pro:verify',
  setProDev: 'pro:set-dev',
  createWork: 'library:create',
  openExternal: 'library:open-external',
  openWork: 'project:open',
  currentProject: 'project:current',
  listRecents: 'library:recents',
  saveToLibrary: 'library:save-to-library',
  fetchRegistry: 'registry:fetch',
  installCommunityWork: 'registry:install',
  listDownloads: 'registry:downloads',
  sceneAnalysis: 'engine:scene-analysis',
  searchContent: 'engine:search-content',
  listSecretEvents: 'engine:secret-events',
  listCustodyEvents: 'engine:custody-events',
  listArcEvents: 'engine:arc-events',
  listDeclaredSecrets: 'engine:declared-secrets',
  listCustodyTopics: 'engine:custody-topics',
  parseCustodyBlock: 'engine:custody-parse',
  createCustodyTopic: 'engine:custody-create',
  updateCustodyRecords: 'engine:custody-update',
  listExtensions: 'extensions:list',
  installExtension: 'extensions:install',
  uninstallExtension: 'extensions:uninstall',
  setExtensionEnabled: 'extensions:set-enabled',
  startExtension: 'extensions:start',
  stopExtension: 'extensions:stop',
  extensionStatus: 'extensions:status',
  listThreads: 'engine:listThreads',
  listCoherenceFindings: 'engine:coherence',
  threadDetail: 'engine:thread-detail',
  listCharacterArcs: 'engine:character-arc',
  inspectTables: 'engine:db-tables',
  inspectRows: 'engine:db-rows',
  listEntityArcs: 'engine:entity-arc',
  setCoherenceRuling: 'engine:coherence-ruling',
  listEntityTracks: 'engine:entity-tracks',
  readUiState: 'ui:read',
  writeUiState: 'ui:write',
  listScenes: 'scenes:list',
  readScene: 'scenes:read',
  writeScene: 'scenes:write',
  writeSceneRaw: 'scenes:writeRaw',
  stringifyScene: 'scenes:stringify',
  createScene: 'scenes:create',
  listStoryTree: 'story:tree',
  createFolder: 'story:create-folder',
  setFolderType: 'story:set-folder-type',
  renamePath: 'story:rename',
  deletePath: 'story:delete',
  setOrder: 'story:set-order',
  createSceneInFolder: 'story:create-scene',
  readTimeline: 'timeline:read',
  writeTimeline: 'timeline:write',
  trees: 'trees:read',
  saveTrees: 'trees:write',
  corkboard: 'corkboard:read',
  saveCorkboard: 'corkboard:write',
  timelineGraph: 'timeline:graph',
  listWorldPages: 'world:pages',
  worldBacklinks: 'world:backlinks',
  createWorldPage: 'world:create',
  deletePage: 'pages:delete',
  importImages: 'asset:import-images',
  importImagePaths: 'asset:import-image-paths',
  // getPathForFile never goes through ipcMain (preload-only webUtils call) but CHANNELS is typed
  // Record<keyof NvsApi, string>, so every NvsApi member needs an entry here — unused by design.
  getPathForFile: 'asset:get-path-for-file',
  ingestWork: 'engine:ingest',
  resetAnalysis: 'engine:reset-analysis',
  writeTier: 'engine:write-tier',
  mergeThreads: 'engine:merge-threads',
  mergeEntities: 'engine:merge-entities',
  relationshipEvidence: 'engine:relationship-evidence',
  listLoreView: 'engine:lore-view',
  exportProject: 'project:export',
  exportManuscript: 'project:export-manuscript',
  exportScene: 'project:export-scene',
  saveImage: 'project:save-image',
  exportStructured: 'project:export-structured',
  exportSceneStructured: 'project:export-scene-structured',
  importStructured: 'project:import-structured',
  importProject: 'project:import',
  forkWork: 'library:fork',
  deleteWork: 'library:delete',
  restoreExamples: 'library:restore-examples',
  readProjectInfo: 'project:info-read',
  readProjectInfoAt: 'project:info-read-at',
  readStructure: 'project:structure-read',
  writeStructure: 'project:structure-write',
  writeProjectInfo: 'project:info-write',
  pickCover: 'project:pick-cover',
  pickCoverFromPath: 'project:pick-cover-from-path',
  renameWork: 'library:rename',
  closeWork: 'project:close',
  tierInputHash: 'engine:tier-hash',
  listTierStatus: 'engine:tier-status',
  coherenceStatus: 'engine:coherence-status',
  timelineStatus: 'engine:timeline-status',
  runIngestBundle: 'engine:run-bundle',
  listIngestBundles: 'engine:list-bundles',
  startIngestRun: 'ingest:start-run',
  planIngestPreview: 'ingest:plan-preview',
  startCoherenceRun: 'ingest:start-coherence',
  cancelIngestRun: 'ingest:cancel-run',
  onIngestProgress: 'ingest:progress',
  listIngestSessions: 'ingest:list-sessions',
  revertIngestSession: 'ingest:revert-session',
  setViewingVersion: 'ingest:set-viewing',
  mcpStatus: 'mcp:status',
  mcpHeadlessInfo: 'mcp:headless-info',
  generateClaudePlugin: 'mcp:generate-claude-plugin',
  aiConnections: 'ai:connections',
  saveConnection: 'ai:save-conn',
  removeConnection: 'ai:remove-conn',
  setActiveConnection: 'ai:set-active',
  setAnalysisConnection: 'ai:set-analysis',
  runAgent: 'ai:run-agent',
  onAgentEvent: 'ai:agent-event',
  cancelAgent: 'ai:cancel-agent',
  runPageAgent: 'ai:run-page-agent',
  cancelPageAgent: 'ai:cancel-page-agent',
  enqueueTask: 'ai:enqueue-task',
  listTasks: 'ai:list-tasks',
  onTaskUpdate: 'ai:task-update',
  onProjectChanged: 'project:changed',
  cancelTask: 'ai:cancel-task',
  dismissTask: 'ai:dismiss-task',
  clearDoneTasks: 'ai:clear-done-tasks',
  listPrompts: 'ai:list-prompts',
  savePrompt: 'ai:save-prompt',
  deletePrompt: 'ai:delete-prompt',
  openUrl: 'app:open-url',
  listChatSessions: 'chat:list',
  readChatSession: 'chat:read-session',
  writeChatSession: 'chat:write-session',
  setActiveChatSession: 'chat:set-active',
  deleteChatSession: 'chat:delete-session'
} as const satisfies Record<keyof NvsApi, string>

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
