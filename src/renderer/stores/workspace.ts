import { create } from 'zustand'
import { TreesHistory } from '@/lib/timeline/treesHistory'
import type { AgentEvent, AgentTask, AiState, AnalysisDepth, ChatContext, ChatRef, ChatSession, CharacterArc, CoherenceFinding, EntityTrack, IngestProgress, IngestSession, PageRef, ProjectChange, ProjectInfo, ProjectMeta, RecentEntry, SavedPrompt, SceneFile, StoryNode, StructureView, TaskInput, Thread, TimelineLayout, TimelineGraph, TimelineLayers, ChartSequence, TreesFile, TreeVariant, WorkCard, WorldPage , MergeResult, LoreView, CustodyTopic, ExtensionStatus, UpdateCheck } from '@shared/ipc'

const EMPTY_STRUCTURE: StructureView = { world: [], scene: [] }
import { TIMELINE_VERSION, DEFAULT_TIMELINE_VIEW, MAX_TIMELINE_VARIANTS } from '@shared/ipc'
import { provenanceNote } from '@shared/config/agentCommands'
import { sceneIndex } from '@/lib/timeline/leadsTo'
import { anyDirty, saveAllDirty } from '@/lib/editor/saveTarget'
import { firstTime } from '@/lib/onceFlag'
import { activeVariant, adjacencyHas, addAdjacency, removeAdjacency, adjacencyReaches } from '@/lib/timeline/treeVariant'
import { canvasSceneIds } from '@/lib/timeline/canvasScenes'
import { defaultBody, defaultFrontmatter, slugify } from '@/config/worldSchema'
import i18n, { applyLocale, type UiLocale } from '@/config/i18n'

/** A fresh, empty timeline layout — project-wide view only (canvas lives per variant). Overwritten by readTimeline. */
const emptyTimeline: TimelineLayout = { version: TIMELINE_VERSION, view: DEFAULT_TIMELINE_VIEW }
const emptyTrees: TreesFile = { version: 1, activeId: undefined, variants: [] }

/** Replace the variant `id` with a patched copy → the next TreesFile (per-variant canvas/adjacency writes). */
function withVariant(trees: TreesFile, id: string, patch: Partial<TreeVariant>): TreesFile {
  return { ...trees, variants: trees.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) }
}
const emptyGraph: TimelineGraph = { scenes: {}, edges: [] }

/** Find a story node by its relPath (depth-first). */
function findNode(nodes: StoryNode[], relPath: string): StoryNode | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return n
    if (n.children) {
      const hit = findNode(n.children, relPath)
      if (hit) return hit
    }
  }
  return null
}

/** relPath `a` is an ancestor of (or equal to) `b` — e.g. "chapters" covers "chapters/act1". */
function coversPath(a: string, b: string): boolean {
  return b === a || b.startsWith(a + '/')
}

/** Every scene in the tree, depth-first in `.order` (the reading sequence). */
function orderedScenes(tree: StoryNode[]): StoryNode[] {
  const out: StoryNode[] = []
  const walk = (ns: StoryNode[]): void => {
    for (const n of ns) {
      if (n.type === 'scene') out.push(n)
      else walk(n.children ?? [])
    }
  }
  walk(tree)
  return out
}

/** All scene_ids beneath a folder (by relPath), at any depth. */
function folderSceneIds(tree: StoryNode[], folderRel: string): Set<string> {
  const out = new Set<string>()
  const folder = findNode(tree, folderRel)
  const walk = (n: StoryNode): void => {
    for (const c of n.children ?? []) {
      if (c.type === 'scene') out.add(c.sceneId ?? c.name)
      else walk(c)
    }
  }
  if (folder) walk(folder)
  return out
}

/** The rail workspaces (listThreads is a dock, not a workspace). */
export type WorkspaceId = 'editor' | 'world' | 'threads' | 'cast' | 'relationships' | 'custody' | 'coherence' | 'timeline' | 'corkboard'

/** The bottom console's tabs (the Analysis / What's-known / Agent surfaces). */
export type DockTab = 'ingest' | 'database' | 'agent'

/**
 * The two canvas modes DESIGN.md pins, named by the universal identifiers: `dark` (the warm "focus" drafting
 * canvas, the default) and `light` (the warm "manuscript" paper, review/print). A global UI preference,
 * persisted in localStorage. The class `.dark` on <html> selects dark; its absence selects light (:root) —
 * see applyTheme. (The old identifiers were `focus`/`manuscript`; migrated on read below.)
 */
// Global (per-user) feature preferences — persisted in localStorage, same tier as `theme`. The first is `showMood`
// (VN-style delivery tags): a subset feature that's bloat for most authors, so it's a global visibility toggle. It
// NEVER touches prose — a `(mood)` written into a scene stays in the file and in the Source view; this only hides
// the Write-view mood chip. Future global prefs (AI master switch, language) join this tier.
const SHOW_MOOD_KEY = 'nvs.showMood'
function initialShowMood(): boolean {
  try { return localStorage.getItem(SHOW_MOOD_KEY) !== 'off' } catch { return true } // default ON (current behavior)
}
// Timing tags ([start → end] on a beat) — brand-new + niche (subtitle/transcript work), so default OFF; the toggle
// only shows/hides the Write-view chip (the timecodes stay in prose + Source), same visibility rule as showMood.
const SHOW_TIMING_KEY = 'nvs.showTiming'
function initialShowTiming(): boolean {
  try { return localStorage.getItem(SHOW_TIMING_KEY) === 'on' } catch { return false } // default OFF
}
// "Edit source directly" — an ADVANCED, power-user escape hatch: it makes the Source view an editable CodeMirror
// whose Save writes the file verbatim (writeSceneRaw), bypassing the structured frontmatter/body form. Default OFF
// and gated behind a warning, because a broken frontmatter/fountain edit here breaks what the parser + analysis
// read. Unlike showMood/showTiming (visibility only), this one genuinely lets the author change file bytes.
const EDITABLE_SOURCE_KEY = 'nvs.editableSource'
function initialEditableSource(): boolean {
  try { return localStorage.getItem(EDITABLE_SOURCE_KEY) === 'on' } catch { return false } // default OFF
}
// AI features master switch — hides ALL generative-AI UI when OFF: the assistant (chat/tasks) + its rail button,
// prompt library, /agent + AI-write, custody AI-suggest, AND analysis running (Update / Jobs). Result panels
// (cast/threads/coherence) and the Store/Claude-connect stay — only the AI ACTIONS go. Default ON.
const AI_ENABLED_KEY = 'nvs.aiEnabled'
function initialAiEnabled(): boolean {
  try { return localStorage.getItem(AI_ENABLED_KEY) !== 'off' } catch { return true } // default ON
}
// The floating dock (Composition/Settings/Theme) is OFF by default — summoned by the status-bar handle. Persisted
// so it stays how the author left it.
const FLOAT_DOCK_KEY = 'nvs.floatDock'
function initialFloatDock(): boolean {
  try { return localStorage.getItem(FLOAT_DOCK_KEY) === 'on' } catch { return false } // default OFF
}
// UI language (chrome only) — the NVS Settings "Language" row. `system` follows the OS/app locale; en/zh/ja pin it.
// NEVER touches prose or the AI's output (those follow project.inLanguage / the user's request) — see config/i18n.ts.
// The app-update nudge remembers the last release the user dismissed, so we never re-nag for the SAME version
// (a newer one still notifies). '' = never dismissed. We do NOT auto-update — see internal/distribution-updates.md.
const UPDATE_DISMISSED_KEY = 'nvs.updateDismissed'
function initialUpdateDismissed(): string {
  try { return localStorage.getItem(UPDATE_DISMISSED_KEY) ?? '' } catch { return '' }
}
const UI_LOCALE_KEY = 'nvs.uiLocale'
function initialUiLocale(): UiLocale {
  try {
    const v = localStorage.getItem(UI_LOCALE_KEY)
    if (v === 'system' || v === 'en' || v === 'zh' || v === 'ja') return v
  } catch { /* localStorage unavailable — fall through to the default */ }
  return 'system' // default: follow the OS/app locale
}

export type ThemeMode = 'light' | 'dark'
const THEME_KEY = 'nvs.theme'
function initialTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
    if (v === 'focus') return 'dark' // migrate legacy identifiers (renamed 2026-07-23)
    if (v === 'manuscript') return 'light'
  } catch { /* localStorage unavailable — fall through to the default */ }
  return 'dark' // DESIGN.md: dark (the warm focus canvas) is the default; the app boots with .dark applied
}
/**
 * Flip the single class DESIGN.md's token system resolves through — no component re-styles.
 *
 * The flip changes the resolved color of every token-driven element at once, and the ~134 `transition-colors`
 * elements on screen would each animate that change over ~150ms — a mass cross-fade that janks the whole tree and
 * reads as toggle "latency". So we disable transitions for the flip only: inject `transition:none`, toggle the
 * class, force a synchronous restyle (so the new colors commit un-animated), then remove the killer — normal hover
 * transitions resume on the very next interaction. (next-themes' `disableTransitionOnChange`; harmless at boot.)
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  const killer = document.createElement('style')
  killer.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.appendChild(killer)
  root.classList.toggle('dark', mode === 'dark')
  void root.offsetHeight // read layout → force a synchronous restyle so the flip commits WITHOUT transitions
  killer.remove()
}

/**
 * A persistent notification for the bottom-right mailbox (warnings, run results, the "catch up" nudge).
 * Distinct from the transient `notice` toast: these stick until dismissed. `id` is caller-owned so a
 * source can replace its own card (e.g. one freshness nudge, not a pile). Renderer-only for now; when the
 * ingest runner lands (Phase 2) its failures/results push here.
 */
export interface AppNotification {
  id: string
  kind: 'warning' | 'success' | 'info'
  title: string
  body?: string
  href?: string // when set, the mailbox card shows an action button that opens this URL externally (e.g. the update nudge)
  actionLabel?: string // label for that button — localized at push time; the mailbox falls back to a generic "Open"
  ts: number
  read?: boolean
}

/** Editor view: the prose surface (frontmatter hidden) vs the raw markdown. */
export type ViewMode = 'write' | 'preview' | 'source'

/** One page-write in the tasks-inbox history (see pageHistory). `body` = restore target; `redoBody` = the other
 *  end of the write, stored so undo/redo doesn't read the live buffer. */
interface PageWrite { body: string; label: string; taskId?: string; redoBody?: string }

// An unsaved-changes prompt is pending for one of these exit intents.
// `nav` = a deferred in-app navigation (page switch, custody tab/topic switch) held behind the unsaved-changes
// prompt; `then` runs it once the user picks Save or Don't Save. The others exit the project/app/tab.
export type PendingExit = { kind: 'library' } | { kind: 'tab'; path: string } | { kind: 'app' } | { kind: 'nav'; then: () => void }

/**
 * The renderer's single source of UI state. The rail, sidebar, dock, and main
 * content all read/act on this — no prop-drilling. Actions call window.nvs (the
 * bridge) directly; the store is the seam between UI and engine.
 */
interface WorkspaceState {
  works: WorkCard[]
  recents: RecentEntry[] // recently opened works incl. outside-library paths (userData pointer registry)
  detailWork: WorkCard | null // the library work being previewed in the detail dialog (null = closed)
  setDetailWork: (work: WorkCard | null) => void
  project: ProjectMeta | null
  projectInfo: ProjectInfo | null // the open project's authored metadata (.nvs/project.json)
  loadProjectInfo: () => Promise<void>
  saveProjectInfo: (patch: Partial<ProjectInfo>) => Promise<void>
  pickCover: () => Promise<void>
  pickCoverFromPath: (path: string) => Promise<void>
  workspace: WorkspaceId
  threads: Thread[] | null // null = not loaded yet
  coherence: CoherenceFinding[] | null // null = not loaded yet — the work-wide narrative-debt roll-up
  characterArc: CharacterArc[] | null // null = not loaded yet — windowed character arcs (Character pivot)
  entityTracks: EntityTrack[] | null // null = not loaded yet — tracked items/factions + presence (Entity pivot)
  entityArcs: CharacterArc[] | null // null = not loaded yet — windowed arcs for items/factions (Entity journey lens)
  loreView: LoreView | null // null = not loaded yet — disclosure ledgers + story clock (Lore pivot)
  custodyTopics: CustodyTopic[] // authored custody topic pages (Custody pillar) — mirrored here so global search can reach them
  selectedLoreId: string | null
  setSelectedLore: (id: string | null) => void
  dockOpen: boolean // the bottom tracker console; collapsed by default (local-first — flow over panel)
  dockTab: DockTab // which console tab is showing (lifted so the rail badges can deep-link to it)
  // Bumped whenever analysis freshness may have changed (post-save T1 ingest, an Update run) — the rail
  // freshness badges + the Analysis dock re-read `listTierStatus` when this changes. Cheap shared signal.
  freshnessVersion: number

  // editor — the active page (scene OR world page) split into form + prose
  scenes: SceneFile[]
  storyTree: StoryNode[] // the free-form content/story folder tree
  timeline: TimelineLayout // the manual node-canvas layout (positions only)
  trees: TreesFile // the tree variants (.nvs/trees.json) — the active one drives the canvas + analysis (T3b)
  timelineGraph: TimelineGraph // derived overlay data (presence/threads/revelations) for the layers
  worldPages: WorldPage[]
  characters: WorldPage[] // derived: the cast (for the pick-list)
  structure: StructureView // the project's categories (.nvs/structure.json), split world/scene — drives both rails
  loadStructure: () => Promise<void>
  applyStructure: (worldKeys: string[], sceneKeys: string[]) => Promise<void> // persist an edited/templated structure
  structureDialogOpen: boolean // the Project Structure dialog (shared: Rail button + rail "Extend schema…")
  setStructureDialogOpen: (open: boolean) => void
  jobsOpen: boolean // the RightRail JobRail → Jobs dashboard (analysis/coherence run tracking + controls)
  setJobsOpen: (open: boolean) => void
  pro: boolean // Pro entitlement (Autumn lifetime) — gates the prettier export theme; files are never gated
  refreshPro: () => Promise<void> // load the machine-local Pro flag on startup
  setProDev: (pro: boolean) => Promise<void> // dev/QA toggle
  // Shared open-state for the project dialogs moved into the TitleBar menus.
  detailsDialogOpen: boolean // Project → Info (title/author/cover)
  setDetailsDialogOpen: (open: boolean) => void
  shareDialogOpen: boolean // Project → Share
  setShareDialogOpen: (open: boolean) => void
  discoverOpen: 'community' | 'extensions' | 'claude' | null // the Store pages (community works · extensions · use-with-Claude)
  setDiscoverOpen: (tab: 'community' | 'extensions' | 'claude' | null) => void
  extensionRunOpen: boolean // the RightRail extension-tools launcher (RUN surface — invoke installed active extensions)
  setExtensionRunOpen: (open: boolean) => void
  // Live runs of active extensions (the UI rung): id → its name + supervised status (carries lastEvent). The
  // launcher writes on start/stop; a poller keeps them live; the floating ExtensionActivity card + the launcher
  // both read here. `dismissed` hides a finished card without dropping the row.
  extensionRuns: Record<string, { name: string; status: ExtensionStatus; dismissed?: boolean }>
  setExtensionRun: (id: string, name: string, status: ExtensionStatus) => void
  dismissExtensionRun: (id: string) => void
  paneHelpOpen: boolean // F8 / the Fab's Help → the CURRENT pane's help dialog (one rail mounted at a time)
  setPaneHelpOpen: (open: boolean) => void
  custodySelection: { kind: 'topic' | 'item' | 'secret'; id: string } | null // CustodyRail: topic page (authored) or unpaged object
  setCustodySelection: (sel: { kind: 'topic' | 'item' | 'secret'; id: string } | null) => void
  custodyTick: number // bumped after any custody page write — BOTH the sidebar and the panel refetch on it
  bumpCustody: () => void
  // "Ask AI" from anywhere (e.g. the Records tab) → the sidebar-owned AiSuggestDialog opens on this pane
  custodyAiRequest: { tab: 'recommend' | 'populate'; sel?: string } | null
  setCustodyAiRequest: (req: { tab: 'recommend' | 'populate'; sel?: string } | null) => void
  // task ids whose result is currently ON the page (applied from the inbox OR the AI pane) — the AI
  // pane's Undo/re-Apply reads this, so both apply paths share one state
  appliedTasks: string[]
  markTaskApplied: (taskId: string, on: boolean) => void
  // Per-page WRITE HISTORY — every programmatic write (AI apply, records save) pushes the page's prior
  // body first, so rollback survives task-clearing, tab toggles, and SEQUENTIAL edits to one file (a
  // linear stack per page — per-task baseText goes stale the moment a second edit lands). Bounded at
  // 10+10 snapshots per page (KB-scale bodies → no leak), session-scoped.
  // Each entry: `body` = the state to RESTORE (pre-body in `past`, post-body in `future`); `redoBody` = the OTHER
  // end, captured at apply time so undo/redo is DETERMINISTIC — it never reads the live buffer, which the editor's
  // own Ctrl/Cmd+Z (or the debounced body sync) can desync from the history (the "redo does nothing" bug).
  pageHistory: Record<string, { past: PageWrite[]; future: PageWrite[] }>
  pushPageHistory: (path: string, body: string, label: string, taskId?: string, redoBody?: string) => void
  undoPageWrite: (path: string) => Promise<void>
  redoPageWrite: (path: string) => Promise<void>
  // bumped whenever the ACTIVE page's buffer is replaced from disk (rollback/redo) — keyed editors remount on it
  bufferEpoch: number
  reloadActiveBuffer: () => Promise<void>
  // the REPLAYABLE app tour (Help → Tour the app): a step index into TOUR_STEPS (TourOverlay); null =
  // closed. Steps spotlight data-region markers — the tour reads the same registry the debug overlay does.
  tourStep: number | null
  setTourStep: (step: number | null) => void
  helpDialogOpen: boolean // Help → Reference & Docs
  setHelpDialogOpen: (open: boolean) => void
  // Relationships rail — the selected matchup pair (relA = sidebar roster, relB = pane roster). null = unset.
  relA: string | null
  relB: string | null
  setRelA: (id: string | null) => void
  setRelB: (id: string | null) => void
  searchOpen: boolean // the global quick-open palette (TitleBar search / Cmd·Ctrl+P) — searches rail content
  setSearchOpen: (open: boolean) => void
  pendingExit: PendingExit | null // the unsaved-changes prompt intent (null = no prompt showing)
  requestReturnToLibrary: () => void // dirty-aware: leave directly when clean, prompt when unsaved
  requestCloseTab: (path: string) => void // dirty-aware tab close (only the active tab can be unsaved)
  requestCloseApp: () => void // dirty-aware app quit (driven by the main-process close intercept)
  requestNav: (proceed: () => void) => void // dirty-aware IN-APP navigation: prompt when unsaved, else run now
  resolvePendingExit: (choice: 'save' | 'discard' | 'cancel') => Promise<void>
  openTabs: PageRef[]     // all pages currently open in the editor (like VSCode tabs)
  activePage: PageRef | null
  frontmatter: Record<string, unknown>
  body: string
  raw: string // recomputed for the read-only Source view
  viewMode: ViewMode
  sceneDirty: boolean

  loadWorks: () => Promise<void>
  renameWork: (path: string, newName: string) => Promise<boolean> // rename a (closed) work's folder on disk
  openWork: (path: string) => Promise<void>
  openExternal: () => Promise<void>
  saveToLibrary: () => Promise<boolean> // copy the open external work into the library + rebind to the copy
  createWork: (name: string) => Promise<boolean>
  importProject: () => Promise<boolean> // open a .nvsproj as a new project (main prompts for the file)
  forkWork: (sourcePath: string) => Promise<boolean> // fork a closed project into an independent library copy
  deleteWork: (path: string) => Promise<boolean> // move a closed project's folder to the OS trash
  exportProject: () => Promise<boolean> // export the open project to a .nvsproj (main prompts for the location)
  exportManuscript: () => Promise<boolean> // export just the manuscript (content/) to a plain .zip
  exportStructured: (format: 'json' | 'csv') => Promise<boolean> // export prose as structured JSON/CSV (matches nvs-parser)
  exportSceneStructured: (scenePath: string, format: 'json' | 'csv' | 'md' | 'srt') => Promise<boolean> // export ONE scene (consumable unit)
  importStructured: () => Promise<boolean> // import an nvs-parser structured JSON as a new project
  exportScene: (scenePath: string) => Promise<boolean> // export one scene's .md to a chosen location
  saveImage: (suggestedName: string, dataUrl: string) => Promise<boolean> // save a rendered PNG (e.g. timeline graph)
  closeWork: () => void
  setWorkspace: (w: WorkspaceId) => void

  openPage: (ref: PageRef, force?: boolean) => Promise<void> // force = skip the unsaved-changes guard (used by the prompt continuation)
  openLinkedPage: (ref: string) => void // open a page from a chat link: "scene:<id>" | "page:<id>" (fuzzy-resolved)
  closeTab: (path: string) => void
  reorderTabs: (from: number, to: number) => void
  setBody: (body: string) => void
  setFrontmatter: (frontmatter: Record<string, unknown>) => void
  setViewMode: (mode: ViewMode) => Promise<void>
  saveScene: () => Promise<void>
  refreshWorldPages: () => Promise<void>
  createWorldPage: (kind: WorldPage['kind'], name: string) => Promise<WorldPage | null>
  refreshScenes: () => Promise<void>
  createScene: (chapter: string, name: string) => Promise<SceneFile | null>
  deletePage: (path: string) => Promise<boolean>
  setPagePhase: (path: string, phase: string) => Promise<void>
  setPagePhaseBulk: (paths: string[], phase: string) => Promise<void> // one re-ingest for the whole batch
  renameWorldPage: (path: string, name: string) => Promise<void>

  // story tree (free-form folders)
  refreshStoryTree: () => Promise<void>
  refreshTrees: () => Promise<void> // re-read trees.json after an agent write (the canvas graph + variants)
  populateCanvasFromGraph: () => Promise<void> // place every connected scene of the active variant onto its canvas
  reloadTimeline: () => Promise<void> // Reload button: re-read from disk + populate an empty-but-wired canvas
  createFolder: (parentRel: string, name: string, type?: string) => Promise<boolean>
  setFolderType: (folderRel: string, type: string | null) => Promise<void> // optional soft folder label
  createSceneInFolder: (folderRel: string, name: string) => Promise<boolean>
  renamePath: (fromRel: string, toRel: string) => Promise<boolean>
  deleteStoryPath: (rel: string) => Promise<boolean>
  retitleScene: (path: string, title: string) => Promise<void>
  reorder: (folderRel: string, names: string[]) => Promise<void>

  // timeline canvas (layout only)
  placeOnTimeline: (sceneId: string, x: number, y: number) => Promise<void>
  timelineTab: 'canvas' | 'cells' | 'config' // Timeline rail sub-tab; drives the Sidebar swap (ScenePalette ↔ sequence list)
  setTimelineTab: (t: 'canvas' | 'cells' | 'config') => void
  // Custom linear chart axes — RE-HOMED onto the active tree variant (variant.sequences / activeSequenceId)
  saveChartSequence: (seq: ChartSequence) => Promise<void> // upsert a custom axis by id + make it active (on the active variant)
  deleteChartSequence: (id: string) => Promise<void>
  renameChartSequence: (id: string, name: string) => Promise<void>
  setActiveChartSequence: (id: string | undefined) => Promise<void> // which of the variant's axes drives the charts (undefined = auto)
  moveTimelineNode: (sceneId: string, x: number, y: number) => Promise<void>
  moveTimelineNodes: (moves: { kind: 'scene' | 'folder'; ref: string; x: number; y: number }[]) => Promise<void> // batched group-move → ONE saveTrees (multi-select drag)
  removeTimelineNode: (sceneId: string) => Promise<void>
  // timeline folder group nodes
  placeFolderOnTimeline: (folderRel: string, x: number, y: number) => Promise<void>
  moveTimelineFolder: (folderRel: string, x: number, y: number) => Promise<void>
  toggleFolderCollapse: (folderRel: string) => Promise<void>
  collapseToDepth: (depth: number) => Promise<void> // bulk: collapse every folder at/below `depth` (Infinity = expand all)
  removeTimelineFolder: (folderRel: string) => Promise<void>
  // timeline edges — written to the ACTIVE tree variant (.nvs/trees.json), NOT frontmatter (tree-variant model)
  linkScenes: (fromSceneId: string, toSceneId: string) => Promise<void>
  unlinkScenes: (fromSceneId: string, toSceneId: string) => Promise<void>
  // tree-variant CRUD (T8): the active variant drives the canvas + analysis + axis
  createVariant: () => Promise<void> // new variant = a copy of the active one's graph ("born by copying"), made active
  renameVariant: (id: string, name: string) => Promise<void>
  deleteVariant: (id: string) => Promise<void> // refuses the last one; re-picks active if the active is deleted
  setActiveVariant: (id: string) => Promise<void>
  // timeline overlay layers (toggle persists in timeline.view.layers)
  setTimelineLayer: (layer: keyof TimelineLayers, on: boolean) => Promise<void>
  // bulk connector ops (destructive — UI confirms first)
  resetConnectors: () => Promise<void> // clear leads_to on every scene
  quickConnectSorted: () => Promise<void> // chain every scene to the next in .order
  // Timeline routing driven from the GLOBAL keydown (AppShell) so the hotkeys fire regardless of canvas focus.
  timelineConfirm: 'reset' | 'quick' | null // which bulk-op confirm dialog is open (null = none)
  setTimelineConfirm: (v: 'reset' | 'quick' | null) => void
  timelineSelection: string[] // scene ids currently marquee-selected on the canvas (mirrored from React Flow)
  setTimelineSelection: (ids: string[]) => void
  connectSelectedScenes: () => Promise<void> // chain the marquee selection in reading order
  disconnectSelectedScenes: () => Promise<void> // cut every edge touching the marquee selection
  setRouteColor: (sceneIds: string[], color: string | null) => Promise<void> // Cell view: paint (or clear) a route's color
  // transient toast (e.g. why a connection was refused)
  notice: string | null
  undoTrees: () => void // timeline undo — restore the previous trees.json snapshot (graph + canvas)
  redoTrees: () => void // timeline redo
  setNotice: (text: string | null) => void
  // host-agent chat inbox — multi-session, persisted per-project; lives here so it survives unmounts
  chatSessions: ChatSession[]
  chatActiveId: string | null
  chatBusy: boolean
  chatError: string | null
  chatOpen: boolean // the right-side chat panel toggle
  setChatOpen: (open: boolean) => void
  chatDraft: string | null // PREFILL the composer (analysis hand-offs, e.g. Lore "Learn more") — author reviews + sends; never auto-sent. null once consumed.
  setChatDraft: (v: string | null) => void
  newChat: () => void // start a fresh session (becomes active)
  switchChat: (id: string) => void
  deleteChat: (id: string) => void
  sendChat: (text: string, attached?: PageRef[]) => Promise<void> // runs against the active session (+ any attached pages as context)
  stopChat: () => void // abort the in-flight run
  appendChatEvent: (event: AgentEvent) => void // streamed-event subscription → active session
  resetChat: () => void // clear the active session's transcript
  // the agent surface is ONE float with two tabs: the chat (orchestrator) and the tasks inbox (workers)
  agentTab: 'chat' | 'tasks'
  setAgentTab: (t: 'chat' | 'tasks') => void
  // the in-editor `/ag` write composer — a store flag so EITHER editor (world CodeMirror, scene TipTap) opens it
  agentComposerOpen: boolean
  agentComposerAnchor: { top: number; left: number } | null // caret coords → the composer opens inline there
  setAgentComposerOpen: (open: boolean, anchor?: { top: number; left: number }) => void
  // the global Prompt Library — built-in + user instructions; the composer's pills + the RightRail Prompts panel
  prompts: SavedPrompt[]
  promptsOpen: boolean
  setPromptsOpen: (open: boolean) => void
  loadPrompts: () => Promise<void>
  savePrompt: (p: SavedPrompt) => Promise<void>
  deletePrompt: (id: string) => Promise<void>
  // Tasks inbox — ephemeral background WRITE tasks (slash + chat fan-out); the list is owned by main,
  // mirrored here via the onTaskUpdate push (see AppShell). Lost on quit, by design.
  tasks: AgentTask[]
  setTasks: (tasks: AgentTask[]) => void // subscription sink — also fires the completion toast
  enqueueTask: (input: TaskInput) => Promise<string> // queue a write; opens the agent float on Tasks
  applyTask: (id: string) => Promise<void> // open the target page (if needed) + stage its edit for the editor
  pendingApply: AgentTask | null // a done task awaiting the editor's apply transaction (staleness-guarded)
  finishApply: () => void // editor calls this once the staged edit is applied/skipped — just unstages it
  applyGroup: (ids: string[]) => Promise<void> // "Apply all": apply every DONE task in a fan-out group in turn
  applyBatch: string[] | null // remaining ids of an in-progress Apply-all (non-null = force, skip per-task confirm)
  // (the task STAYS in the inbox after applying — undo is Ctrl+Z; re-apply is clicking it again; X dismisses)
  // the bottom tracker console (threads + coherence agenda) — summoned, not always-on
  setDockOpen: (open: boolean) => void
  setDockTab: (tab: DockTab) => void
  openDockTab: (tab: DockTab) => void // open the console AND switch to a tab — the rail badge's "Update" doorway
  bumpFreshness: () => void // signal that analysis freshness may have changed (re-reads the badges + dock)
  // bottom-right notification mailbox (persistent; warnings + run results + the catch-up nudge)
  notifications: AppNotification[]
  pushNotification: (n: Omit<AppNotification, 'ts' | 'read'>) => void // same id replaces (dedupe by source)
  dismissNotification: (id: string) => void
  markNotificationsRead: () => void
  clearNotifications: () => void
  // App-update nudge (no auto-update): compare installed vs latest public release, push a dismissible card.
  updateDismissed: string // last release version the user dismissed the nudge for ('' = none)
  updateLatest: string | null // version the current nudge points at, so dismiss can record it
  runUpdateCheck: (opts?: { force?: boolean }) => Promise<UpdateCheck | null> // force ignores the dismissed version (manual "check now")
  // global feature prefs (per-user, localStorage) — the NVS Settings dialog
  showMood: boolean // VN-style delivery tags in the Write editor; off = hidden (prose + Source keep them)
  setShowMood: (v: boolean) => void
  showTiming: boolean // [start → end] timing chips in the Write editor; off = hidden (prose + Source keep them)
  setShowTiming: (v: boolean) => void
  editableSource: boolean // ADVANCED: makes the Source view editable (verbatim file write); off = read-only
  setEditableSource: (v: boolean) => void
  aiEnabled: boolean // master switch — off hides ALL generative-AI UI (assistant, /agent, AI-write, analysis running)
  setAiEnabled: (v: boolean) => void
  uiLocale: UiLocale // NVS UI language (chrome only), persisted. Never affects prose or AI output.
  setUiLocale: (l: UiLocale) => void
  saveSceneRaw: (text: string) => Promise<void> // write the Source buffer verbatim, then re-sync the split buffer
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
  floatDockOpen: boolean // the floating macOS-style dock (Composition/Settings/Theme); summoned by the status-bar handle
  setFloatDockOpen: (v: boolean) => void
  // canvas mode (focus dark / manuscript light) — DESIGN.md's two pinned modes, persisted
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
  // composition mode — chrome hidden, just the writing surface (transient; not persisted across launches)
  composing: boolean
  setComposing: (v: boolean) => void
  // analysis runner (Phase 2): live progress (pushed from main) + the run history
  ingestProgress: IngestProgress | null
  ingestSessions: IngestSession[]
  currentVersion: string | null // the version (session id) the live DB reflects — the "you are here" pointer
  viewingVersion: string | null // a PAST version being viewed read-only (timetravel); null = live/current
  applyIngestProgress: (p: IngestProgress | null) => void // the onIngestProgress sink (AppShell wires it)
  startIngestRun: (forceScenes?: string[], depth?: AnalysisDepth) => Promise<void> // forceScenes = re-read these even if fresh
  resetAnalysis: () => Promise<void> // backup-aside + rebuild the derived analysis from the manuscript (escape hatch)
  checkCoherence: (opts?: { critique?: boolean }) => Promise<void> // the coherence pass — its own trigger (page vs arc), shares the queue; opts.critique = also ask the tough questions
  aiState: AiState | null // the active AI connection set — drives the status-bar provider chip (null = not loaded)
  setAiState: (s: AiState) => void
  refreshAiState: () => Promise<void>
  loadIngestSessions: () => Promise<void>
  revertIngestSession: (id: string) => Promise<void>
  viewVersion: (sessionId: string | null) => Promise<void> // enter/exit read-only timetravel of a version
  refreshAnalysisViews: () => Promise<void> // re-pull threads/coherence/arcs/map from the current read source
  refreshProject: (change?: ProjectChange) => Promise<void> // re-fetch file-derived views + analysis after an out-of-band write (agent create/setPhase); toasts the change
  // ThreadsRail / Cast Gantt overlay LAYERS — toggleable like the Timeline's (TOC pattern). `chapters` = the
  // folder/window bands over the scene columns; `pov` = glow each character's POV scenes; `silent` = also show
  // present-but-silent cast (the extraction's prose-read room) in the Cast grid. Append more keys here.
  ganttLayers: { chapters: boolean; pov: boolean; silent: boolean; presence: boolean; warmth: boolean; events: boolean; observed: boolean; irony: boolean; empty: boolean; mutual: boolean }
  setGanttLayer: (key: 'chapters' | 'pov' | 'silent' | 'presence' | 'warmth' | 'events' | 'observed' | 'irony' | 'empty' | 'mutual', on: boolean) => void
  // Threads workspace — the thread selected in the sidebar (highlights its lane + opens the sheet)
  selectedThreadId: string | null
  threadFocus: string | null // the scene a thread was opened FROM (deep-link) → the ThreadDetail pre-selects that scene's beat
  setSelectedThread: (id: string | null, focus?: string | null) => void
  // ThreadsRail pivot — which lens the sidebar + main area show (rows pivot; columns stay scenes)
  threadsTab: 'thread' | 'character' | 'entity' | 'lore'
  setThreadsTab: (t: 'thread' | 'character' | 'entity' | 'lore') => void
  // the character selected in the Character pivot (opens the arc Sheet)
  selectedArcId: string | null
  setSelectedArc: (id: string | null, chapter?: string | null) => void
  selectedEntityId: string | null // the Entity pivot's selected track
  entityFocus: string | null // the scene an entity was opened FROM (deep-link) → EntityDetail pre-opens/highlights it
  setSelectedEntity: (id: string | null, focus?: string | null) => void
  // Optional chapter scope for the open arc float — set when jumping from a coherence finding so the arc
  // shows only that finding's chapter window (a chapter key / folder relPath). null = whole arc.
  arcChapter: string | null
  setArcChapter: (chapter: string | null) => void
  // Coherence workspace — the finding selected in the sidebar (opens the CoherenceDetailFloat)
  selectedFindingId: string | null
  setSelectedFinding: (id: string | null) => void
  // The "Highlight" filter on the coherence map — shared (not local) so the detail FLOAT can truncate
  // its finding list to the same category the map is highlighting. null = no filter (show all).
  coherenceKind: string | null
  setCoherenceKind: (k: string | null) => void
  // Same idea for the character-arc Gantt: the highlighted FACET, shared so the arc float truncates to it.
  arcFacet: string | null
  setArcFacet: (f: string | null) => void
  // Same again for the Entity Gantt: the highlighted facet, shared so the entity float truncates to it.
  entityFacet: string | null
  setEntityFacet: (f: string | null) => void
  // Rule a coherence finding intentional (or withdraw) — writes the ledger, refreshes `coherence`.
  setCoherenceRuling: (entityId: string, trait: string, intentional: boolean) => Promise<void>
  // Fold duplicate entities into one (canonical = authored-first) → refreshes the entity views.
  mergeEntities: (ids: string[]) => Promise<MergeResult>
  // Cast workspace — characters excluded from the presence/co-presence matrices (sidebar roster toggles)
  castExcluded: string[]
  toggleCastChar: (id: string) => void
  setCastExcluded: (ids: string[]) => void
  // Relationship graph — flat, author-assigned node colors (session-scoped; no faction/linking/frontmatter).
  // characterId → palette index; the palette's swatch labels are customizable.
  nodeColor: Record<string, number>
  paletteLabels: Record<number, string>
  setNodeColor: (id: string, idx: number | null) => void
  setPaletteLabel: (idx: number, label: string) => void
  // Rail folder-collapse memory (persisted in ui-state.json). null = never set → the rail seeds its
  // "collapse all but the first with content" default; an array = the author's saved choice.
  sceneCollapsed: string[] | null // scene rail — folder relPaths
  worldCollapsed: string[] | null // world rail — category keys
  setSceneCollapsed: (rels: string[]) => void
  setWorldCollapsed: (keys: string[]) => void
}

const emptyPage = {
  openTabs: [] as PageRef[],
  activePage: null,
  frontmatter: {},
  body: '',
  raw: '',
  viewMode: 'write' as ViewMode,
  sceneDirty: false
}

/** Merge a patch into one session (stamps updatedAt), leaving others untouched. */
function patchSession(sessions: ChatSession[], id: string, patch: Partial<ChatSession>): ChatSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s))
}
/** The active page → the run's context hint (so "this page/character" requests resolve). */
function toChatContext(page: PageRef | null, attached: PageRef[]): ChatContext | null {
  const ref = (p: PageRef): ChatRef => ({ kind: p.kind === 'scene' ? 'scene' : 'world', path: p.path, title: p.title })
  if (!page && attached.length === 0) return null
  return { active: page ? ref(page) : null, attached: attached.map(ref) }
}
/** De-duplicate a session title against existing ones by appending " (n)". */
function uniqueTitle(base: string, sessions: ChatSession[]): string {
  const titles = new Set(sessions.map((s) => s.title))
  if (!titles.has(base)) return base
  let n = 1
  while (titles.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}
/** Replace a session's body (history+events) from a lazy load — WITHOUT stamping updatedAt (not a mutation). */
function setBody(sessions: ChatSession[], id: string, body: ChatSession): ChatSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, history: body.history, events: body.events } : s))
}
/**
 * Persist the ACTIVE session's body + the active pointer to the open work (per-session files under .nvs/chat/).
 * Safe ONLY when the active session's body is fully in memory (right after a local mutation) — switchChat and
 * deleteChat persist via their own calls, because a freshly-active session's body may still be disk-only
 * (lazy-loaded) and writing it here would clobber it with an empty body. No-op if no work is open.
 */
function persistChat(get: () => WorkspaceState): void {
  const s = get()
  if (!s.project) return
  const active = s.chatSessions.find((x) => x.id === s.chatActiveId)
  if (active) void window.nvs.writeChatSession(active)
  void window.nvs.setActiveChatSession(s.chatActiveId)
}

// Timeline undo/redo — a subscription (below) records every `trees` change here, so undo/redo covers the whole
// timeline (graph + canvas) without wiring each mutation. `suppressTreesHistory` gates the undo/redo re-applies +
// the open-time load out of the record path. See lib/treesHistory.ts for the coalescing + cap.
const treesHistory = new TreesHistory()
let suppressTreesHistory = false
// True while loadProject is replaying the saved tab session, so the persist-subscription doesn't write a
// half-open state back over the file it's still reading from.
let restoringSession = false

// Live-refresh throttle for an ACTIVE analysis run: the derived rails otherwise only refetch when the run
// FINISHES, so threads/arcs appeared all at once at the end instead of accreting scene by scene. We refetch
// the thread-rail data (threads + the timeline-graph overlay it draws on) as the run progresses, but at most
// once per LIVE_REFRESH_MS so a 120-scene run doesn't fire hundreds of full reloads. Module-scoped so the
// throttle survives across the many progress broadcasts of one run.
const LIVE_REFRESH_MS = 1500
let lastLiveRefresh = 0

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  works: [],
  recents: [],
  detailWork: null,
  setDetailWork: (work) => set({ detailWork: work }),
  project: null,
  projectInfo: null,
  workspace: 'threads',
  threads: null,
  coherence: null,
  characterArc: null,
  entityTracks: null,
  entityArcs: null,
  loreView: null,
  custodyTopics: [],
  selectedLoreId: null,
  dockOpen: false,
  showMood: initialShowMood(),
  showTiming: initialShowTiming(),
  editableSource: initialEditableSource(),
  aiEnabled: initialAiEnabled(),
  uiLocale: initialUiLocale(),
  updateDismissed: initialUpdateDismissed(),
  updateLatest: null,
  settingsOpen: false,
  floatDockOpen: initialFloatDock(),
  theme: initialTheme(),
  composing: false,
  dockTab: 'ingest',
  freshnessVersion: 0,
  notifications: [],
  ingestProgress: null,
  ingestSessions: [],
  aiState: null,
  timelineConfirm: null,
  timelineSelection: [],
  currentVersion: null,
  viewingVersion: null,
  // irony defaults OFF — the relationship rail is crowded; the layer is summoned, not ambient
  ganttLayers: { chapters: true, pov: false, silent: true, presence: true, warmth: false, events: true, observed: true, irony: false, empty: true, mutual: false },
  selectedThreadId: null,
  threadFocus: null,
  threadsTab: 'thread',
  timelineTab: 'canvas',
  selectedArcId: null,
  selectedEntityId: null,
  entityFocus: null,
  arcChapter: null,
  selectedFindingId: null,
  coherenceKind: null,
  arcFacet: null,
  entityFacet: null,
  nodeColor: {},
  paletteLabels: {},
  sceneCollapsed: null,
  worldCollapsed: null,

  scenes: [],
  storyTree: [],
  timeline: emptyTimeline, trees: emptyTrees,
  timelineGraph: emptyGraph,
  notice: null,
  chatSessions: [],
  chatActiveId: null,
  chatBusy: false,
  chatError: null,
  chatOpen: false,
  chatDraft: null,
  agentTab: 'chat',
  agentComposerOpen: false,
  agentComposerAnchor: null,
  prompts: [],
  promptsOpen: false,
  tasks: [],
  pendingApply: null,
  applyBatch: null,
  castExcluded: [],
  worldPages: [],
  structure: EMPTY_STRUCTURE,
  structureDialogOpen: false,
  setStructureDialogOpen: (open) => set({ structureDialogOpen: open }),
  jobsOpen: false,
  setJobsOpen: (open) => set({ jobsOpen: open }),
  pro: false,
  refreshPro: async () => {
    try {
      set({ pro: (await window.nvs.getEntitlement()).pro })
    } catch {
      /* entitlement unavailable → stay free */
    }
  },
  setProDev: async (pro) => {
    const e = await window.nvs.setProDev(pro)
    set({ pro: e.pro })
  },
  detailsDialogOpen: false,
  setDetailsDialogOpen: (open) => set({ detailsDialogOpen: open }),
  shareDialogOpen: false,
  setShareDialogOpen: (open) => set({ shareDialogOpen: open }),
  discoverOpen: null,
  setDiscoverOpen: (tab) => set({ discoverOpen: tab }),
  extensionRunOpen: false,
  setExtensionRunOpen: (open) => set({ extensionRunOpen: open }),
  extensionRuns: {},
  setExtensionRun: (id, name, status) => set((s) => ({ extensionRuns: { ...s.extensionRuns, [id]: { name, status, dismissed: s.extensionRuns[id]?.dismissed } } })),
  dismissExtensionRun: (id) => set((s) => ({ extensionRuns: { ...s.extensionRuns, [id]: { ...s.extensionRuns[id], dismissed: true } } })),
  paneHelpOpen: false,
  setPaneHelpOpen: (open) => set({ paneHelpOpen: open }),
  custodySelection: null,
  setCustodySelection: (sel) => set({ custodySelection: sel }),
  custodyTick: 0,
  bumpCustody: () => set((s) => ({ custodyTick: s.custodyTick + 1 })),
  custodyAiRequest: null,
  setCustodyAiRequest: (req) => set({ custodyAiRequest: req }),
  appliedTasks: [],
  markTaskApplied: (taskId, on) =>
    set((s) => ({ appliedTasks: on ? [...s.appliedTasks.filter((x) => x !== taskId), taskId] : s.appliedTasks.filter((x) => x !== taskId) })),
  pageHistory: {},
  pushPageHistory: (path, body, label, taskId, redoBody) =>
    set((s) => {
      const h = s.pageHistory[path] ?? { past: [], future: [] }
      return { pageHistory: { ...s.pageHistory, [path]: { past: [...h.past.slice(-9), { body, label, taskId, redoBody }], future: [] } } }
    }),
  undoPageWrite: async (path) => {
    const h = get().pageHistory[path]
    const prev = h?.past[h.past.length - 1]
    if (!prev) return
    const doc = await window.nvs.readScene(path)
    const isActive = get().activePage?.path === path
    const curBody = isActive ? get().body : (doc?.body ?? '')
    const ok = await window.nvs.writeScene(path, doc?.frontmatter ?? {}, prev.body)
    if (!ok) return
    set((s) => ({
      pageHistory: {
        ...s.pageHistory,
        // Redo target = this write's STORED post-body (deterministic — survives the editor's own Ctrl+Z, which
        // would otherwise leave curBody reverted so redo re-does nothing). Fall back to the live buffer only for
        // legacy entries with no stored redoBody. The future entry's redoBody = the pre-body we just restored.
        [path]: { past: h.past.slice(0, -1), future: [...h.future.slice(-9), { body: prev.redoBody ?? curBody, label: prev.label, taskId: prev.taskId, redoBody: prev.body }] }
      }
    }))
    if (isActive) await get().reloadActiveBuffer()
    if (prev.taskId) get().markTaskApplied(prev.taskId, false)
    get().bumpCustody()
    get().setNotice(`Rolled back: ${prev.label}`)
  },
  redoPageWrite: async (path) => {
    const h = get().pageHistory[path]
    const next = h?.future[h.future.length - 1]
    if (!next) return
    const doc = await window.nvs.readScene(path)
    const isActive = get().activePage?.path === path
    const curBody = isActive ? get().body : (doc?.body ?? '')
    const ok = await window.nvs.writeScene(path, doc?.frontmatter ?? {}, next.body)
    if (!ok) return
    set((s) => ({
      pageHistory: {
        ...s.pageHistory,
        // Undo target = this write's STORED pre-body (deterministic), not the live buffer. Its redoBody = the
        // post-body we just restored, so a following undo→redo round-trips correctly.
        [path]: { past: [...h.past.slice(-9), { body: next.redoBody ?? curBody, label: next.label, taskId: next.taskId, redoBody: next.body }], future: h.future.slice(0, -1) }
      }
    }))
    if (isActive) await get().reloadActiveBuffer()
    if (next.taskId) get().markTaskApplied(next.taskId, true)
    get().bumpCustody()
    get().setNotice(`Re-applied: ${next.label}`)
  },
  // Re-read the ACTIVE page's file into the buffer + bump the epoch so keyed editors (TipTap/CM)
  // remount with the new text — a store-body change alone never re-renders an editor's document.
  bufferEpoch: 0,
  reloadActiveBuffer: async () => {
    const ref = get().activePage
    if (!ref) return
    const fresh = await window.nvs.readScene(ref.path)
    set((s) => ({ frontmatter: fresh?.frontmatter ?? {}, body: fresh?.body ?? '', raw: fresh?.raw ?? '', sceneDirty: false, bufferEpoch: s.bufferEpoch + 1 }))
  },
  tourStep: null,
  setTourStep: (step) => set({ tourStep: step }),
  helpDialogOpen: false,
  setHelpDialogOpen: (open) => set({ helpDialogOpen: open }),
  relA: null,
  relB: null,
  setRelA: (id) => set({ relA: id }),
  setRelB: (id) => set({ relB: id }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  pendingExit: null,
  requestReturnToLibrary: () => {
    const s = get()
    if (!s.project) return s.closeWork() // already in the library — nothing to guard
    set({ pendingExit: { kind: 'library' } }) // ALWAYS confirm — guard against a stray click dropping your project
  },
  requestCloseTab: (path) => {
    const s = get()
    // Only the active tab has an editor buffer, so only it can be unsaved.
    if (s.sceneDirty && s.activePage?.path === path) set({ pendingExit: { kind: 'tab', path } })
    else s.closeTab(path)
  },
  requestCloseApp: () => {
    const s = get()
    if (s.sceneDirty || anyDirty() || s.ingestProgress?.active) set({ pendingExit: { kind: 'app' } }) // unsaved surface OR a running job to remind about
    else void window.nvs.confirmClose() // truly clean, nothing running → let the window close
  },
  // Dirty-aware in-app navigation: if the current page (scene OR any registered surface, e.g. custody records)
  // has unsaved edits, hold the move behind the Save/Don't Save/Cancel prompt; otherwise run it now. One guard
  // for page-switch, custody tab-switch, and custody topic-switch — so every surface walks away the same way.
  requestNav: (proceed) => {
    if (get().sceneDirty || anyDirty()) set({ pendingExit: { kind: 'nav', then: proceed } })
    else proceed()
  },
  resolvePendingExit: async (choice) => {
    const pending = get().pendingExit
    if (!pending || choice === 'cancel') return set({ pendingExit: null })
    // Save flushes the scene buffer AND any other dirty surface (custody records) — matches what ⌘S would do.
    if (choice === 'save') { if (get().sceneDirty) await get().saveScene(); saveAllDirty() }
    else set({ sceneDirty: false }) // discard: drop the scene buffer; custody edits drop when its form unmounts
    set({ pendingExit: null })
    // A held in-app navigation just runs — no analysis pause, no window close.
    if (pending.kind === 'nav') return pending.then()
    // Leaving the project or app PAUSES any running analysis (resumable — the frontier remembers where it left
    // off). This is also what keeps a run from writing to the wrong project after a switch.
    if ((pending.kind === 'library' || pending.kind === 'app') && get().ingestProgress?.active) void window.nvs.cancelIngestRun()
    if (pending.kind === 'library') get().closeWork()
    else if (pending.kind === 'tab') get().closeTab(pending.path)
    else void window.nvs.confirmClose()
  },
  characters: [],
  ...emptyPage,

  loadWorks: async () => {
    try {
      set({ works: await window.nvs.listWorks(), recents: (await window.nvs.listRecents?.()) ?? [] })
    } catch (e) {
      console.error('[nvs] loadWorks failed (keeping previous grid)', e)
    }
  },
  renameWork: async (path, newName) => {
    try {
      const card = await window.nvs.renameWork(path, newName)
      if (!card) return false // open project, name collision, or fs failure
      await get().loadWorks()
      return true
    } catch (e) {
      console.error('[nvs] renameWork failed', e)
      return false
    }
  },

  openWork: async (path) => {
    const project = await window.nvs.openWork(path)
    if (!project) return
    // Gate EVERY ui-state write for the whole load. The reset below empties nodeColor / collapse / tabs, and a
    // persist firing mid-load — the debounced session-persist, or a rail seeding its collapse default — would
    // clobber .nvs/ui-state.json BEFORE readUiState restores it (the "cast colors lost on reopen" bug: on a big
    // project the awaits before the restore outrun the 400ms debounce). Cleared in the finally after the restore.
    restoringSession = true
    // Reset per-work state immediately so the previous project can't bleed in — incl. the analysis run
    // (the live "Last run" queue + session history are per-work and must not carry across a switch).
    // workspace: 'editor' — every project ENTERS on the scene workspace (the writing surface), never carrying
    // over whatever rail you were last on in a DIFFERENT project. The first scene auto-opens below once scenes load.
    set({ project, workspace: 'editor', threads: null, coherence: null, characterArc: null, entityTracks: null, entityArcs: null, custodyTopics: [], loreView: null, selectedThreadId: null, selectedFindingId: null, scenes: [], storyTree: [], timeline: emptyTimeline, trees: emptyTrees, timelineGraph: emptyGraph, castExcluded: [], nodeColor: {}, paletteLabels: {}, sceneCollapsed: null, worldCollapsed: null, worldPages: [], characters: [], chatSessions: [], chatActiveId: null, chatBusy: false, chatError: null, ingestProgress: null, ingestSessions: [], currentVersion: null, viewingVersion: null, ...emptyPage })
    void window.nvs.setViewingVersion?.(null) // clear any leftover timetravel (guarded: tolerate a stale preload)
    // Re-sync T1 on open — incremental (a no-op when nothing changed), but it picks up external edits AND a
    // bumped PARSER_VERSION, so converted/Fountain scenes re-parse their dialogue without editing each one.
    try {
      await window.nvs.ingestWork()
    } catch (e) {
      console.error('[nvs] open-time ingest failed', e)
    }
    void get().loadIngestSessions() // this work's own run history (Recent updates)
    void get().loadProjectInfo() // authored title/author/cover (.nvs/project.json)
    void get().loadStructure() // world/entity categories (.nvs/structure.json)
    void get().refreshAiState() // the active connection — drives the status-bar provider chip
    try {
      // Restore this work's chat sessions — METAS only (fast, no bodies); the active session's body loads on
      // demand below and each other session's when it's first opened (per-session files under .nvs/chat/).
      const { sessions, activeId } = await window.nvs.listChatSessions()
      set({ chatSessions: sessions, chatActiveId: activeId })
      if (activeId) {
        const body = await window.nvs.readChatSession(activeId)
        if (body) set({ chatSessions: setBody(get().chatSessions, activeId, body) })
      }
    } catch (e) {
      console.error('[nvs] listChatSessions failed', e)
    }
    try {
      set({ threads: await window.nvs.listThreads() })
    } catch (e) {
      console.error('[nvs] listThreads failed', e)
    }
    try {
      set({ coherence: await window.nvs.listCoherenceFindings() })
    } catch (e) {
      console.error('[nvs] listCoherenceFindings failed', e)
    }
    try {
      set({ characterArc: await window.nvs.listCharacterArcs() })
    } catch (e) {
      console.error('[nvs] characterArc failed', e)
    }
    try {
      set({ entityTracks: (await window.nvs.listEntityTracks?.()) ?? [] })
    } catch (e) {
      console.error('[nvs] listEntityTracks failed', e)
      set({ entityTracks: [] }) // degrade to the empty state, never wedge at "Reading…"
    }
    try {
      set({ entityArcs: (await window.nvs.listEntityArcs?.()) ?? [] })
    } catch (e) {
      console.error('[nvs] listEntityArcs failed', e)
      set({ entityArcs: [] })
    }
    try {
      set({ loreView: (await window.nvs.listLoreView?.()) ?? { topics: [], clock: [] } })
    } catch (e) {
      console.error('[nvs] listLoreView failed', e)
      set({ loreView: { topics: [], clock: [] } })
    }
    try {
      set({ custodyTopics: (await window.nvs.listCustodyTopics?.()) ?? [] })
    } catch (e) {
      console.error('[nvs] listCustodyTopics failed', e)
      set({ custodyTopics: [] })
    }
    // Last session's tabs + rail (restored at the END of load, once every page list exists to validate against).
    let savedSession: { openTabs?: PageRef[]; activePath?: string; workspace?: string; viewMode?: string } = {}
    try {
      // Per-work UI choices (graph tags + Cast roster filter + rail collapse) — restored from .nvs/ui-state.json.
      const ui = await window.nvs.readUiState()
      set({
        castExcluded: ui.castExcluded,
        nodeColor: ui.nodeColor,
        paletteLabels: ui.paletteLabels,
        sceneCollapsed: ui.sceneCollapsed ?? null, // undefined (never saved) → null → the rail seeds its default
        worldCollapsed: ui.worldCollapsed ?? null
      })
      savedSession = { openTabs: ui.openTabs, activePath: ui.activePath, workspace: ui.workspace, viewMode: ui.viewMode }
    } catch (e) {
      console.error('[nvs] readUiState failed', e)
    }
    try {
      set({ scenes: await window.nvs.listScenes() }) // landing in a page happens in the session-restore step below
    } catch (e) {
      console.error('[nvs] listScenes failed', e)
    }
    try {
      set({ storyTree: await window.nvs.listStoryTree() })
    } catch (e) {
      console.error('[nvs] listStoryTree failed', e)
    }
    try {
      set({ timeline: await window.nvs.readTimeline() }) // project-wide view/layers only
      set({ trees: await window.nvs.trees() }) // every variant's canvas + graph (engine heals orphan/renamed folders)
      set({ timelineGraph: await window.nvs.timelineGraph() })
    } catch (e) {
      console.error('[nvs] readTimeline failed', e)
    }
    try {
      const worldPages = await window.nvs.listWorldPages()
      set({ worldPages, characters: worldPages.filter((p) => p.kind === 'character') })
    } catch (e) {
      console.error('[nvs] listWorldPages failed', e)
    }
    // ── Session restore ── Reopen last session's tabs that still exist, reactivate the focused one (loads its
    // content), and land on the saved rail/view. Falls back to the first scene (fresh project / older ui-state,
    // where an empty editor reads as broken). restoringSession (set at the top of openWork) keeps these sets from
    // persisting a half-open state. Runs last, so scenes+world+custody page lists exist to validate paths.
    try {
      const known = new Set([
        ...get().scenes.map((s) => s.path),
        ...get().worldPages.map((p) => p.path),
        ...get().custodyTopics.map((t) => t.path)
      ])
      const tabs = (savedSession.openTabs ?? []).filter((t) => known.has(t.path))
      if (tabs.length) {
        set({ openTabs: tabs })
        const active = tabs.find((t) => t.path === savedSession.activePath) ?? tabs[tabs.length - 1]
        await get().openPage(active, true) // force: skip the unsaved guard — nothing is dirty on a fresh load
        // openPage forces the page's own rail + viewMode:'write'; re-apply the SAVED rail/mode over the top.
        set({
          ...(savedSession.workspace ? { workspace: savedSession.workspace as WorkspaceId } : {}),
          ...(savedSession.viewMode ? { viewMode: savedSession.viewMode as ViewMode } : {})
        })
      } else {
        const first = get().scenes[0]
        if (first) await get().openPage({ path: first.path, title: first.title, kind: 'scene' }, true)
      }
    } catch (e) {
      console.error('[nvs] session restore failed', e)
    } finally {
      restoringSession = false
    }
  },

  openExternal: async () => {
    const path = await window.nvs.openExternal()
    if (path) await get().openWork(path)
  },
  saveToLibrary: async () => {
    try {
      const res = await window.nvs.saveToLibrary()
      if (!res?.path) return false
      await get().openWork(res.path) // rebind everything (tabs, watcher, analysis) to the library copy
      await get().loadWorks()
      return true
    } catch (e) {
      console.error('[nvs] saveToLibrary failed', e)
      return false
    }
  },

  createWork: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    try {
      const card = await window.nvs.createWork(trimmed)
      if (!card) return false // name collision in the library
      await get().loadWorks()
      await get().openWork(card.path)
      return true
    } catch (e) {
      console.error('[nvs] createWork failed', e)
      return false
    }
  },
  importProject: async () => {
    try {
      const res = await window.nvs.importProject()
      if (!res.ok) {
        if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'import', kind: 'warning', title: 'Import failed', body: res.error })
        return false
      }
      await get().loadWorks()
      if (res.path) await get().openWork(res.path) // jump straight into the imported project
      return true
    } catch (e) {
      console.error('[nvs] importProject failed', e)
      return false
    }
  },
  forkWork: async (sourcePath) => {
    try {
      const res = await window.nvs.forkWork(sourcePath)
      if (!res.ok) {
        if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'fork', kind: 'warning', title: 'Fork failed', body: res.error })
        return false
      }
      await get().loadWorks()
      if (res.path) await get().openWork(res.path) // open the new fork
      return true
    } catch (e) {
      console.error('[nvs] forkWork failed', e)
      return false
    }
  },
  deleteWork: async (path) => {
    try {
      const res = await window.nvs.deleteWork(path)
      if (!res.ok) {
        if (res.error) get().pushNotification({ id: 'delete', kind: 'warning', title: 'Delete failed', body: res.error })
        return false
      }
      await get().loadWorks()
      return true
    } catch (e) {
      console.error('[nvs] deleteWork failed', e)
      return false
    }
  },
  exportProject: async () => {
    try {
      const res = await window.nvs.exportProject()
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: 'Project exported', body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] exportProject failed', e)
      return false
    }
  },
  exportStructured: async (format) => {
    try {
      const res = await window.nvs.exportStructured(format)
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: `Exported ${format.toUpperCase()}`, body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] exportStructured failed', e)
      return false
    }
  },
  exportSceneStructured: async (scenePath, format) => {
    try {
      const res = await window.nvs.exportSceneStructured(scenePath, format)
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: `Scene exported as ${format.toUpperCase()}`, body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] exportSceneStructured failed', e)
      return false
    }
  },
  importStructured: async () => {
    try {
      const res = await window.nvs.importStructured()
      if (!res.ok) {
        if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'import', kind: 'warning', title: 'Import failed', body: res.error })
        return false
      }
      await get().loadWorks()
      if (res.path) await get().openWork(res.path) // jump into the imported project
      return true
    } catch (e) {
      console.error('[nvs] importStructured failed', e)
      return false
    }
  },
  exportManuscript: async () => {
    try {
      const res = await window.nvs.exportManuscript()
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: 'Manuscript exported', body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] exportManuscript failed', e)
      return false
    }
  },
  exportScene: async (scenePath) => {
    try {
      const res = await window.nvs.exportScene(scenePath)
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: 'Scene exported', body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] exportScene failed', e)
      return false
    }
  },
  saveImage: async (suggestedName, dataUrl) => {
    try {
      const res = await window.nvs.saveImage(suggestedName, dataUrl)
      if (res.ok) get().pushNotification({ id: 'export', kind: 'success', title: 'Image exported', body: res.file })
      else if (res.error && res.error !== 'cancelled') get().pushNotification({ id: 'export', kind: 'warning', title: 'Export failed', body: res.error })
      return res.ok
    } catch (e) {
      console.error('[nvs] saveImage failed', e)
      return false
    }
  },
  loadProjectInfo: async () => {
    try {
      set({ projectInfo: await window.nvs.readProjectInfo() })
    } catch (e) {
      console.error('[nvs] readProjectInfo failed', e)
    }
  },
  loadStructure: async () => {
    try {
      set({ structure: await window.nvs.readStructure() })
    } catch (e) {
      console.error('[nvs] readStructure failed', e)
    }
  },
  applyStructure: async (worldKeys, sceneKeys) => {
    try {
      set({ structure: await window.nvs.writeStructure(worldKeys, sceneKeys) })
      get().pushNotification({ id: 'structure', kind: 'success', title: 'Structure updated', body: 'Your project categories were saved.' })
    } catch (e) {
      console.error('[nvs] writeStructure failed', e)
    }
  },
  saveProjectInfo: async (patch) => {
    try {
      set({ projectInfo: await window.nvs.writeProjectInfo(patch) })
      await get().loadWorks() // the welcome grid reads title/cover from project.json
    } catch (e) {
      console.error('[nvs] writeProjectInfo failed', e)
    }
  },
  pickCover: async () => {
    try {
      const path = await window.nvs.pickCover()
      if (path) await get().saveProjectInfo({ cover: path })
    } catch (e) {
      console.error('[nvs] pickCover failed', e)
    }
  },
  pickCoverFromPath: async (path) => {
    try {
      const cover = await window.nvs.pickCoverFromPath(path)
      if (cover) await get().saveProjectInfo({ cover })
    } catch (e) {
      console.error('[nvs] pickCoverFromPath failed', e)
    }
  },

  closeWork: () => {
    void window.nvs.closeWork() // clear the engine's open-work state so the library (rename guard) sees no project
    set({ project: null, projectInfo: null, threads: null, coherence: null, characterArc: null, entityTracks: null, entityArcs: null, custodyTopics: [], loreView: null, selectedThreadId: null, selectedFindingId: null, scenes: [], storyTree: [], timeline: emptyTimeline, trees: emptyTrees, timelineGraph: emptyGraph, castExcluded: [], nodeColor: {}, paletteLabels: {}, sceneCollapsed: null, worldCollapsed: null, worldPages: [], characters: [], chatSessions: [], chatActiveId: null, chatBusy: false, chatError: null, ...emptyPage })
  },

  setWorkspace: (workspace) => set({ workspace, discoverOpen: null, paneHelpOpen: false }), // exit Store + drop any carried-over help

  openPage: async (ref, force = false) => {
    // Switching AWAY from an unsaved page (scene buffer OR any registered surface, e.g. custody records) prompts
    // Save / Don't Save / Cancel instead of silently saving — the guard runs the switch again with force once the
    // user chooses. `force` (set by that continuation) skips the guard so we don't re-prompt in a loop.
    const cur = get()
    if (!force && (cur.sceneDirty || anyDirty()) && cur.activePage?.path !== ref.path) {
      return cur.requestNav(() => void get().openPage(ref, true))
    }
    // Add to tab list if not already open
    const tabs = get().openTabs
    if (!tabs.some((t) => t.path === ref.path)) {
      set({ openTabs: [...tabs, ref] })
    }
    try {
      const doc = await window.nvs.readScene(ref.path)
      set({
        activePage: ref,
        // Navigate to the page's workspace so the open is visible even from another rail (e.g. a link in Threads).
        workspace: ref.kind === 'scene' ? 'editor' : ref.kind === 'custody' ? 'custody' : 'world',
        frontmatter: doc?.frontmatter ?? {},
        body: doc?.body ?? '',
        raw: doc?.raw ?? '',
        viewMode: 'write',
        sceneDirty: false
      })
      // custody tabs land on the CustodyPane with their topic selected (file id = basename)
      if (ref.kind === 'custody') {
        const id = ref.path.split('/').pop()!.replace(/\.md$/, '')
        set({ custodySelection: { kind: 'topic', id } })
      }
    } catch (e) {
      console.error('[nvs] openPage failed', ref.path, e)
    }
  },

  // Open a page from a chat link or a tool-log path. `ref` may be a bare path/id or "scene:…"/"page:…";
  // resolution is fuzzy (analysis tools cite scenes by assorted ids/codes/paths) — match across both
  // scenes and world pages by id, exact path, path-substring, then title.
  openLinkedPage: (ref) => {
    const i = ref.indexOf(':')
    const id = decodeURIComponent(i >= 0 && i <= 5 ? ref.slice(i + 1) : ref).trim() // strip a short scheme prefix only
    if (!id) return
    const lc = id.toLowerCase()
    const sc = get().scenes.find((s) => s.sceneId === id || s.path === id || s.path.includes(id) || s.title.toLowerCase() === lc)
    if (sc) return void get().openPage({ path: sc.path, title: sc.title, kind: 'scene' })
    const wp = get().worldPages.find((p) => p.id === id || p.path === id || p.path.includes(id) || p.name.toLowerCase() === lc)
    if (wp) return void get().openPage({ path: wp.path, title: wp.name, kind: wp.kind })
    get().setNotice(`Couldn’t open “${id}”.`)
  },

  closeTab: (path) => {
    const allTabs = get().openTabs
    const idx = allTabs.findIndex((t) => t.path === path)
    const tabs = allTabs.filter((t) => t.path !== path)
    const active = get().activePage
    set({ openTabs: tabs })
    if (active?.path === path) {
      const next = tabs[idx - 1] ?? tabs[idx] ?? null
      if (next) void get().openPage(next)
      else set({ activePage: null, frontmatter: {}, body: '', raw: '', sceneDirty: false })
    }
  },

  reorderTabs: (from, to) => {
    const tabs = [...get().openTabs]
    const [moved] = tabs.splice(from, 1)
    tabs.splice(to, 0, moved)
    set({ openTabs: tabs })
  },

  setBody: (body) => set({ body, sceneDirty: true }),

  setFrontmatter: (frontmatter) => set({ frontmatter, sceneDirty: true }),

  setViewMode: async (mode) => {
    if (mode === 'source') {
      const { frontmatter, body } = get()
      try {
        set({ raw: await window.nvs.stringifyScene(frontmatter, body) })
      } catch (e) {
        console.error('[nvs] stringifyScene failed', e)
      }
    }
    set({ viewMode: mode })
  },

  refreshWorldPages: async () => {
    try {
      const worldPages = await window.nvs.listWorldPages()
      set({ worldPages, characters: worldPages.filter((p) => p.kind === 'character') })
    } catch (e) {
      console.error('[nvs] refreshWorldPages failed', e)
    }
  },

  createWorldPage: async (kind, name) => {
    const id = slugify(name)
    if (!id) return null
    if (typeof window.nvs.createWorldPage !== 'function') {
      // The IPC isn't on the bridge — almost always a stale main/preload bundle.
      console.error('[nvs] createWorldPage missing from bridge — restart the app (main/preload changed)')
      return null
    }
    try {
      const page = await window.nvs.createWorldPage(
        kind,
        id,
        defaultFrontmatter(id, name.trim()),
        defaultBody(kind)
      )
      if (!page) return null // id collision — caller surfaces it
      await get().refreshWorldPages()
      // A NEW character page joins the speaker map (nameToEid), so dialogue cues that previously resolved to
      // nobody now have a home. Re-ingest (ingest step 4.5 re-attributes existing scenes) + refresh the derived
      // overlay so the cast/relationship volume counts reflect it immediately — not only after an app restart.
      if (kind === 'character') {
        try {
          await window.nvs.ingestWork()
          set({ timelineGraph: await window.nvs.timelineGraph() })
          get().bumpFreshness()
        } catch (e) {
          console.error('[nvs] post-create re-attribution failed', e)
        }
      }
      await get().openPage({ path: page.path, title: page.name, kind: page.kind })
      return page
    } catch (e) {
      console.error('[nvs] createWorldPage failed', e)
      return null
    }
  },

  refreshScenes: async () => {
    try {
      set({ scenes: await window.nvs.listScenes() })
    } catch (e) {
      console.error('[nvs] refreshScenes failed', e)
    }
  },

  deletePage: async (path) => {
    if (typeof window.nvs.deletePage !== 'function') {
      console.error('[nvs] deletePage missing from bridge — restart the app (main/preload changed)')
      return false
    }
    try {
      const ok = await window.nvs.deletePage(path)
      if (ok) {
        get().closeTab(path) // no-op if not open; also reassigns active page
        await get().refreshScenes()
        await get().refreshWorldPages()
      }
      return ok
    } catch (e) {
      console.error('[nvs] deletePage failed', e)
      return false
    }
  },

  createScene: async (chapter, name) => {
    const id = slugify(name)
    const chapterSlug = slugify(chapter) || 'chapter-01'
    if (!id) return null
    if (typeof window.nvs.createScene !== 'function') {
      console.error('[nvs] createScene missing from bridge — restart the app (main/preload changed)')
      return null
    }
    try {
      const fm = {
        scene_id: id,
        title: name.trim(),
        format: 'nvs-fountain-1',
        phase: 'draft',
        chapter: chapter.trim() || chapterSlug,
        characters_present: [] as string[]
      }
      const scene = await window.nvs.createScene(chapterSlug, id, fm, '')
      if (!scene) return null // id collision — caller surfaces it
      await get().refreshScenes()
      await get().openPage({ path: scene.path, title: scene.title, kind: 'scene' })
      return scene
    } catch (e) {
      console.error('[nvs] createScene failed', e)
      return null
    }
  },

  saveScene: async () => {
    const { activePage, frontmatter, body } = get()
    if (!activePage) return
    await window.nvs.writeScene(activePage.path, frontmatter, body)
    set({ sceneDirty: false })
    // T1 ingest after scene saves so QuestLog stays in sync with edits.
    // World-page saves don't trigger ingest (no dialog_nodes to update).
    if (activePage.kind === 'scene') {
      try {
        await window.nvs.ingestWork()
        set({ threads: await window.nvs.listThreads() })
        get().bumpFreshness() // a scene changed → its analysis may now be Outdated; refresh the rail badges
      } catch (e) {
        console.error('[nvs] post-save ingest failed', e)
      }
      // refreshStoryTree updates BOTH the tree (timeline reads phase/title/cover here) and scenes.
      await get().refreshStoryTree()
    } else {
      // Reflect title/phase/etc. edits in the World navigator (incl. archiving).
      await get().refreshWorldPages()
      // A character page's name/aliases feed the speaker map (nameToEid) — editing them re-homes dialogue cues.
      // Re-ingest (ingest step 4.5 re-attributes existing scenes) + refresh the overlay so cast/relationship
      // volume reflects an added/removed alias immediately. (Only 'character' pages feed the speaker map.)
      if (activePage.kind === 'character') {
        try {
          await window.nvs.ingestWork()
          set({ timelineGraph: await window.nvs.timelineGraph() })
        } catch (e) {
          console.error('[nvs] post-save re-attribution failed', e)
        }
      }
      // A world page is a character's DECLARED profile — coherence diffs it against the prose. Editing it
      // restales that character's coherence (the hash already includes the page bytes); bump freshness so the
      // dock's "Check coherence (N)" re-reads and flags it. (The cheap half of OP1: world-page → coherence.)
      get().bumpFreshness()
    }
  },

  setPagePhase: async (path, phase) => {
    try {
      const doc = await window.nvs.readScene(path)
      const fm = { ...doc.frontmatter, phase }
      await window.nvs.writeScene(path, fm, doc.body)
      if (get().activePage?.path === path) set({ frontmatter: fm })
      // Re-ingest so the canon gate takes effect (the DB's phase + the dock's fresh/stale/canon badges).
      // Safe: T1 ingests every scene regardless of phase, so this is a frontmatter re-parse, not a unit add/remove.
      await window.nvs.ingestWork()
      get().bumpFreshness()
      await get().refreshStoryTree() // tree feeds the timeline + the sidebar phase border; also refreshes scenes
      await get().refreshWorldPages()
    } catch (e) {
      console.error('[nvs] setPagePhase failed', e)
    }
  },

  // BULK phase — the 1000-scene answer (right-click a folder / world category → Phase). Same write as
  // setPagePhase per file, but the expensive tail (re-ingest + refreshes) is paid ONCE for the batch.
  setPagePhaseBulk: async (paths, phase) => {
    if (!paths.length) return
    let done = 0
    try {
      for (const path of paths) {
        const doc = await window.nvs.readScene(path)
        const fm = { ...doc.frontmatter, phase }
        await window.nvs.writeScene(path, fm, doc.body)
        if (get().activePage?.path === path) set({ frontmatter: fm })
        done++
      }
    } catch (e) {
      console.error('[nvs] setPagePhaseBulk failed after', done, e)
    } finally {
      await window.nvs.ingestWork()
      get().bumpFreshness()
      await get().refreshStoryTree()
      await get().refreshWorldPages()
      get().setNotice(`${done} page${done === 1 ? '' : 's'} → ${phase}`)
    }
  },

  // Rename a world page = edit its `name` frontmatter (the id/slug anchor never changes). Mirrors setPagePhase.
  //
  // Cast-link safety: dialogue cues in prose resolve to a character by name/alias (not id — see
  // engine/ingest.ts), so renaming a CHARACTER would orphan cues that still use the old name. We fold the old
  // name into THIS page's own `aliases` so those cues keep resolving — no scene edits, no new table (the
  // engine already reads aliases at ingest). Skipped when the old name is empty/unchanged, or already claimed
  // by another character (adding it would just feed an ambiguous cue — the unique id stays the real anchor).
  renameWorldPage: async (path, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const doc = await window.nvs.readScene(path)
      const oldName = String(doc.frontmatter.name ?? '').trim()
      const fm: Record<string, unknown> = { ...doc.frontmatter, name: trimmed }

      const page = get().worldPages.find((p) => p.path === path)
      let collisionNote: string | null = null
      if (page?.kind === 'character' && oldName && oldName.toLowerCase() !== trimmed.toLowerCase()) {
        // Names/ids already claimed by OTHER characters — folding the old name in here would be ambiguous.
        const claimed = new Set<string>()
        for (const c of get().worldPages) {
          if (c.kind !== 'character' || c.path === path) continue
          claimed.add(c.name.toLowerCase())
          claimed.add(c.id.toLowerCase())
        }
        if (claimed.has(oldName.toLowerCase())) {
          collisionNote = `Renamed, but didn't alias “${oldName}” — another character already uses that name, so dialogue cues for it stay ambiguous. The id is still the unique anchor.`
        } else {
          const existing = Array.isArray(doc.frontmatter.aliases)
            ? doc.frontmatter.aliases.map(String)
            : typeof doc.frontmatter.aliases === 'string' && doc.frontmatter.aliases.trim()
            ? [String(doc.frontmatter.aliases)]
            : []
          if (!existing.some((a) => a.toLowerCase() === oldName.toLowerCase())) fm.aliases = [...existing, oldName]
        }
      }

      await window.nvs.writeScene(path, fm, doc.body)
      const active = get().activePage
      if (active?.path === path) set({ frontmatter: fm, activePage: { ...active, title: trimmed } })
      await window.nvs.ingestWork()
      get().bumpFreshness()
      await get().refreshWorldPages()
      if (collisionNote) {
        get().pushNotification({ id: `rename-collision:${path}`, kind: 'warning', title: 'Name already in use', body: collisionNote })
      }
    } catch (e) {
      console.error('[nvs] renameWorldPage failed', e)
    }
  },

  // ── story tree ──────────────────────────────────────────────────────────────

  refreshStoryTree: async () => {
    try {
      set({ storyTree: await window.nvs.listStoryTree() })
      set({ scenes: await window.nvs.listScenes() })
    } catch (e) {
      console.error('[nvs] refreshStoryTree failed', e)
    }
  },

  // Re-read .nvs/trees.json into the store — needed after the AGENT wires the graph in the MAIN process (its writes
  // bypass the store; without this the canvas stays stale AND the next store save would clobber the agent's edits).
  // Skips when disk == store (no spurious undo entry); when it differs, the change lands as ONE undoable step.
  refreshTrees: async () => {
    try {
      const disk = await window.nvs.trees()
      if (JSON.stringify(disk) === JSON.stringify(get().trees)) return
      set({ trees: disk })
    } catch (e) {
      console.error('[nvs] refreshTrees failed', e)
    }
  },

  // Place every scene referenced by the active variant's CONNECTIONS onto its canvas (if not already placed). Fixes
  // the "wired but empty canvas" case: an agent (or born-by-copy) variant can have a full graph and zero placed
  // scenes → the canvas draws nothing. This makes the graph visible. Cascade positions; the Cell view auto-arranges.
  populateCanvasFromGraph: async () => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const ids = new Set<string>()
    for (const [from, tos] of Object.entries(v.adjacency)) { ids.add(from); for (const t of tos) ids.add(t) }
    const already = canvasSceneIds(v.nodes ?? [], get().storyTree) // placed standalone OR under a placed folder
    const toAdd = [...ids].filter((id) => !already.has(id))
    if (!toAdd.length) return
    const nodes = [...(v.nodes ?? [])]
    let i = nodes.length
    for (const id of toAdd) { nodes.push({ kind: 'scene', sceneId: id, x: (i % 8) * 200, y: Math.floor(i / 8) * 130 }); i++ }
    const next = withVariant(trees, v.id, { nodes })
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] populateCanvasFromGraph failed', e) }
    get().setNotice(`Placed ${toAdd.length} connected scene${toAdd.length === 1 ? '' : 's'} on the canvas.`)
  },

  // The Reload button: pull the latest trees.json from disk (picks up agent writes made outside the store), and if
  // the active variant is wired but its canvas is empty, place the connected scenes so the graph actually shows.
  reloadTimeline: async () => {
    await get().refreshTrees()
    const v = activeVariant(get().trees)
    const hasEdges = v ? Object.keys(v.adjacency).length > 0 : false
    const emptyCanvas = v ? (v.nodes?.length ?? 0) === 0 : false
    if (hasEdges && emptyCanvas) { await get().populateCanvasFromGraph(); return }
    get().setNotice('Timeline reloaded from disk.')
  },

  createFolder: async (parentRel, name, type) => {
    if (typeof window.nvs.createFolder !== 'function') {
      console.error('[nvs] createFolder missing from bridge — restart the app')
      return false
    }
    try {
      const rel = await window.nvs.createFolder(parentRel, name, type)
      if (rel) await get().refreshStoryTree()
      return rel != null
    } catch (e) {
      console.error('[nvs] createFolder failed', e)
      return false
    }
  },
  setFolderType: async (folderRel, type) => {
    try {
      if (await window.nvs.setFolderType?.(folderRel, type)) await get().refreshStoryTree()
    } catch (e) {
      console.error('[nvs] setFolderType failed', e)
    }
  },

  createSceneInFolder: async (folderRel, name) => {
    const id = slugify(name)
    if (!id || typeof window.nvs.createSceneInFolder !== 'function') return false
    try {
      const fm = {
        scene_id: id,
        title: name.trim(),
        format: 'nvs-fountain-1',
        phase: 'draft',
        characters_present: [] as string[]
      }
      const rel = await window.nvs.createSceneInFolder(folderRel, id, fm, '')
      if (!rel) return false
      await get().refreshStoryTree()
      const node = findNode(get().storyTree, rel)
      if (node) await get().openPage({ path: node.path, title: name.trim(), kind: 'scene' })
      return true
    } catch (e) {
      console.error('[nvs] createSceneInFolder failed', e)
      return false
    }
  },

  renamePath: async (fromRel, toRel) => {
    try {
      const ok = await window.nvs.renamePath(fromRel, toRel)
      if (!ok) return false
      // Keep timeline folder placements pointing at the renamed folder (no "missing" card). A folder
      // rename is a project-wide fact, so rewire EVERY variant's canvas — not just the active one.
      // Scenes are referenced by scene_id (path-independent), so only folderRel needs rewiring.
      const repath = (rel: string): string =>
        rel === fromRel || rel.startsWith(fromRel + '/') ? toRel + rel.slice(fromRel.length) : rel
      const trees = get().trees
      let changed = false
      const variants = trees.variants.map((v) => {
        const nodes = (v.nodes ?? []).map((n) => (n.kind === 'folder' ? { ...n, folderRel: repath(n.folderRel) } : n))
        const collapsed = (v.collapsed ?? []).map(repath)
        const vChanged =
          nodes.some((n, i) => n !== (v.nodes ?? [])[i]) || collapsed.some((r, i) => r !== (v.collapsed ?? [])[i])
        if (!vChanged) return v
        changed = true
        return { ...v, nodes, collapsed }
      })
      if (changed) {
        const next: TreesFile = { ...trees, variants }
        set({ trees: next })
        try {
          await window.nvs.saveTrees(next)
        } catch (e) {
          console.error('[nvs] renamePath: canvas rewire failed', e)
        }
      }
      await get().refreshStoryTree()
      return ok
    } catch (e) {
      console.error('[nvs] renamePath failed', e)
      return false
    }
  },

  deleteStoryPath: async (rel) => {
    try {
      const ok = await window.nvs.deletePath(rel)
      if (ok) {
        await get().refreshStoryTree()
        await get().refreshScenes()
        // Close any open tab the delete orphaned — the deleted scene, or every scene under a deleted folder (they're
        // gone from disk now, so their file no longer appears in the refreshed scene list). closeTab also reassigns
        // the active page. deletePage does this for world pages; the story-tree delete must too.
        const live = new Set(get().scenes.map((s) => s.path))
        for (const tab of get().openTabs.filter((t) => t.kind === 'scene' && !live.has(t.path))) get().closeTab(tab.path)
      }
      return ok
    } catch (e) {
      console.error('[nvs] deletePath failed', e)
      return false
    }
  },

  // Rename a scene = retitle it (keeps scene_id + filename stable so links don't break).
  retitleScene: async (path, title) => {
    const t = title.trim()
    try {
      const doc = await window.nvs.readScene(path)
      const fm = { ...doc.frontmatter, title: t }
      await window.nvs.writeScene(path, fm, doc.body)
      // Keep open tabs + the active page label in sync with the new title.
      const active = get().activePage
      set({
        openTabs: get().openTabs.map((tab) => (tab.path === path ? { ...tab, title: t } : tab)),
        ...(active?.path === path ? { activePage: { ...active, title: t }, frontmatter: fm } : {})
      })
      await get().refreshStoryTree()
    } catch (e) {
      console.error('[nvs] retitleScene failed', e)
    }
  },

  reorder: async (folderRel, names) => {
    try {
      await window.nvs.setOrder(folderRel, names)
      await get().refreshStoryTree()
    } catch (e) {
      console.error('[nvs] reorder failed', e)
    }
  },

  // ── timeline canvas (layout only; persists to .nvs/timeline.json) ───
  setTimelineTab: (t) => set({ timelineTab: t }),
  // Chart sequences are now RE-HOMED onto the active tree variant (variant.sequences / activeSequenceId, in
  // trees.json) — the custom linear axes for that variant. (The standalone timeline.chartSequences is retired.)
  saveChartSequence: async (seq) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const existing = v.sequences ?? []
    if (!existing.some((s) => s.id === seq.id) && existing.length >= 20) return // cap at 20
    const sequences = [...existing.filter((s) => s.id !== seq.id), { id: seq.id, name: seq.name, path: seq.path }]
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, sequences, activeSequenceId: seq.id } : x)) }
    set({ trees: next }) // charts re-axis via useSceneAxis (on SAVE); then persist
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] saveChartSequence failed', e) }
  },
  deleteChartSequence: async (id) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const sequences = (v.sequences ?? []).filter((s) => s.id !== id)
    const activeSequenceId = v.activeSequenceId === id ? undefined : v.activeSequenceId
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, sequences, activeSequenceId } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] deleteChartSequence failed', e) }
  },
  renameChartSequence: async (id, name) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const sequences = (v.sequences ?? []).map((s) => (s.id === id ? { ...s, name } : s))
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, sequences } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] renameChartSequence failed', e) }
  },
  setActiveChartSequence: async (id) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, activeSequenceId: id } : x)) }
    set({ trees: next })
    // First deliberate switch to a custom axis (not Auto) — teach what it is, once.
    if (id && firstTime('loadout-intro')) {
      get().pushNotification({
        id: 'loadout-intro',
        kind: 'info',
        title: 'Custom axis — one linear reading',
        body: 'A saved axis lays the scenes out in a specific order for the charts. “Auto” follows the tree variant’s own reading order. It’s a display choice — the analysis always walks the whole variant.'
      })
    }
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] setActiveChartSequence failed', e) }
  },
  // ── canvas node/collapse ops — per-variant (each tree variant owns its OWN canvas layout) ──────────────
  // These read/write the ACTIVE variant's nodes/collapsed (via saveTrees), NOT the project-wide timeline.json
  // (which now holds only project-wide layers/view). Switching variants therefore switches the whole canvas.

  placeOnTimeline: async (sceneId, x, y) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const nodes = v.nodes ?? []
    if (nodes.some((n) => n.kind === 'scene' && n.sceneId === sceneId)) return // already a standalone node
    // Already represented by a placed folder that owns it — adding a standalone copy would
    // outlive the folder (the bug). The scene is "on the timeline" via its folder; reject.
    const tree = get().storyTree
    if (nodes.some((n) => n.kind === 'folder' && folderSceneIds(tree, n.folderRel).has(sceneId))) {
      console.warn('[nvs] scene already on the timeline via its folder — skipped', sceneId)
      return
    }
    const next = withVariant(trees, v.id, { nodes: [...nodes, { kind: 'scene', sceneId, x, y }] })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] placeOnTimeline failed', e)
    }
  },

  moveTimelineNode: async (sceneId, x, y) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const next = withVariant(trees, v.id, {
      nodes: (v.nodes ?? []).map((n) => (n.kind === 'scene' && n.sceneId === sceneId ? { ...n, x, y } : n))
    })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] moveTimelineNode failed', e)
    }
  },

  // Group move: apply EVERY dragged node's new position in one pass + a single saveTrees, so multi-select drag
  // persists all of them (not just the primary — the single-node path would race N saveTrees, last-write-wins).
  moveTimelineNodes: async (moves) => {
    if (!moves.length) return
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const sceneAt = new Map(moves.filter((m) => m.kind === 'scene').map((m) => [m.ref, m]))
    const folderAt = new Map(moves.filter((m) => m.kind === 'folder').map((m) => [m.ref, m]))
    const next = withVariant(trees, v.id, {
      nodes: (v.nodes ?? []).map((n) => {
        const m = n.kind === 'scene' ? sceneAt.get(n.sceneId) : n.kind === 'folder' ? folderAt.get(n.folderRel) : undefined
        return m ? { ...n, x: m.x, y: m.y } : n
      })
    })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] moveTimelineNodes failed', e)
    }
  },

  removeTimelineNode: async (sceneId) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const next = withVariant(trees, v.id, {
      nodes: (v.nodes ?? []).filter((n) => !(n.kind === 'scene' && n.sceneId === sceneId))
    })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] removeTimelineNode failed', e)
    }
  },

  // ── timeline folder group nodes ───────────────────────────────────────────
  // Persist a layout change to state + disk (the common tail for every mutation).
  // (defined inline per-action below to keep them self-contained)

  placeFolderOnTimeline: async (folderRel, x, y) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const nodes = v.nodes ?? []
    // Reject overlap: a folder can't be placed if it, an ancestor, or a descendant is already placed
    // (overlapping regions are incoherent — one folder owns each scene).
    if (
      nodes.some(
        (n) => n.kind === 'folder' && (coversPath(n.folderRel, folderRel) || coversPath(folderRel, n.folderRel))
      )
    ) {
      console.warn('[nvs] folder overlaps an already-placed folder — skipped', folderRel)
      return
    }
    // The folder now owns its scenes — drop any standalone scene nodes it absorbs (avoids ghost duplicates).
    const owned = folderSceneIds(get().storyTree, folderRel)
    const kept = nodes.filter((n) => !(n.kind === 'scene' && owned.has(n.sceneId)))
    // Collapse-by-default — the scale lever: a dropped folder is one card until expanded.
    const collapsed = Array.from(new Set([...(v.collapsed ?? []), folderRel]))
    const folderId = findNode(get().storyTree, folderRel)?.folderId // stable id → placement survives rename/move
    const next = withVariant(trees, v.id, { nodes: [...kept, { kind: 'folder', folderRel, ...(folderId ? { folderId } : {}), x, y }], collapsed })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] placeFolderOnTimeline failed', e)
    }
  },

  moveTimelineFolder: async (folderRel, x, y) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const next = withVariant(trees, v.id, {
      nodes: (v.nodes ?? []).map((n) => (n.kind === 'folder' && n.folderRel === folderRel ? { ...n, x, y } : n))
    })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] moveTimelineFolder failed', e)
    }
  },

  toggleFolderCollapse: async (folderRel) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const set0 = new Set(v.collapsed ?? [])
    if (set0.has(folderRel)) set0.delete(folderRel)
    else set0.add(folderRel)
    const next = withVariant(trees, v.id, { collapsed: [...set0] })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] toggleFolderCollapse failed', e)
    }
  },

  collapseToDepth: async (depth) => {
    // Render-depth bound for a deep hierarchy: collapse every folder whose tree depth ≥ `depth`, so folders
    // shallower stay open and everything at/below the chosen level renders as a header box. Infinity = expand all.
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const rels: string[] = []
    const walk = (nodes: StoryNode[]): void => {
      for (const n of nodes) {
        if (n.type !== 'folder') continue
        const d = n.relPath ? n.relPath.split('/').filter(Boolean).length : 0
        if (d >= depth) rels.push(n.relPath)
        walk(n.children ?? [])
      }
    }
    walk(get().storyTree)
    const next = withVariant(trees, v.id, { collapsed: rels })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] collapseToDepth failed', e)
    }
  },

  removeTimelineFolder: async (folderRel) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const next = withVariant(trees, v.id, {
      nodes: (v.nodes ?? []).filter((n) => !(n.kind === 'folder' && n.folderRel === folderRel)),
      // Tidy collapse-set: drop this folder and anything beneath it.
      collapsed: (v.collapsed ?? []).filter((r) => r !== folderRel && !r.startsWith(folderRel + '/'))
    })
    set({ trees: next })
    try {
      await window.nvs.saveTrees(next)
    } catch (e) {
      console.error('[nvs] removeTimelineFolder failed', e)
    }
  },

  linkScenes: async (fromSceneId, toSceneId) => {
    if (fromSceneId === toSceneId) {
      get().setNotice("A scene can't lead to itself.")
      return
    }
    const index = sceneIndex(get().storyTree)
    const from = index.get(fromSceneId)
    const to = index.get(toSceneId)
    if (!from || !to) return
    const label = (n: StoryNode): string => n.title ?? n.name

    // The edge belongs to the ACTIVE TREE VARIANT (.nvs/trees.json), NOT frontmatter (tree-variant model,
    // internal/timeline-model.md). Every project has a mirrored default variant after openWork.
    const trees = get().trees
    const variant = activeVariant(trees)
    if (!variant) { get().setNotice('No tree variant yet — reopen the project.'); return }
    const adj = variant.adjacency
    if (adjacencyHas(adj, fromSceneId, toSceneId)) {
      get().setNotice(`"${label(from)}" already leads to "${label(to)}" in "${variant.name}".`)
      return
    }
    if (adjacencyReaches(adj, toSceneId, fromSceneId)) {
      get().setNotice(`Can't connect: "${label(to)}" already leads back to "${label(from)}" — that would create a cycle.`)
      return
    }
    const nextVariant = { ...variant, adjacency: addAdjacency(adj, fromSceneId, toSceneId) }
    const next: TreesFile = { ...trees, variants: trees.variants.map((v) => (v.id === variant.id ? nextVariant : v)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] linkScenes failed', e) }
  },

  unlinkScenes: async (fromSceneId, toSceneId) => {
    const index = sceneIndex(get().storyTree)
    const from = index.get(fromSceneId)
    if (!from) return

    // Remove the edge from the ACTIVE TREE VARIANT (mirrors linkScenes).
    const trees = get().trees
    const variant = activeVariant(trees)
    if (!variant) return
    const nextVariant = { ...variant, adjacency: removeAdjacency(variant.adjacency, fromSceneId, toSceneId) }
    const next: TreesFile = { ...trees, variants: trees.variants.map((v) => (v.id === variant.id ? nextVariant : v)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] unlinkScenes failed', e) }
  },

  createVariant: async () => {
    const trees = get().trees
    if (trees.variants.length >= MAX_TIMELINE_VARIANTS) { get().setNotice(`Max ${MAX_TIMELINE_VARIANTS} timeline variants — delete one to add another.`); return }
    const base = activeVariant(trees)
    const id = crypto.randomUUID()
    // Born by copying the active variant's graph AND canvas (deep copy), then it diverges as you edit — so a
    // new variant opens on the same layout you were looking at, not a blank canvas.
    const adjacency = base ? Object.fromEntries(Object.entries(base.adjacency).map(([k, v]) => [k, [...v]])) : {}
    const nodes = base?.nodes ? base.nodes.map((n) => ({ ...n })) : []
    const collapsed = base?.collapsed ? [...base.collapsed] : []
    const variant: TreeVariant = { id, name: `Timeline ${trees.variants.length + 1}`, adjacency, nodes, collapsed }
    const next: TreesFile = { ...trees, variants: [...trees.variants, variant], activeId: id }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] createVariant failed', e) }
  },
  renameVariant: async (id, name) => {
    const trees = get().trees
    const next: TreesFile = { ...trees, variants: trees.variants.map((v) => (v.id === id ? { ...v, name } : v)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] renameVariant failed', e) }
  },
  deleteVariant: async (id) => {
    const trees = get().trees
    if (trees.variants.length <= 1) { get().setNotice('A project needs at least one tree variant.'); return }
    const variants = trees.variants.filter((v) => v.id !== id)
    const activeId = trees.activeId === id ? variants[0]?.id : trees.activeId
    const next: TreesFile = { ...trees, variants, activeId }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] deleteVariant failed', e) }
  },
  setActiveVariant: async (id) => {
    const trees = get().trees
    const next: TreesFile = { ...trees, activeId: id }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] setActiveVariant failed', e) }
    // Analysis is now per-variant (thread events keyed by ancestry). The active variant is on disk after saveTrees,
    // so re-pull the analysis views — the gantt/roster now read THIS variant's threads (per-variant-analysis.md).
    await get().refreshAnalysisViews()
  },

  setTimelineLayer: async (layer, on) => {
    const cur = get().timeline
    const view = cur.view ?? DEFAULT_TIMELINE_VIEW
    const next: TimelineLayout = { ...cur, view: { ...view, layers: { ...view.layers, [layer]: on } } }
    set({ timeline: next })
    try {
      await window.nvs.writeTimeline(next)
    } catch (e) {
      console.error('[nvs] setTimelineLayer failed', e)
    }
  },

  // Bulk connector ops edit the ACTIVE variant's adjacency (.nvs/trees.json), SCOPED to the scenes on the canvas
  // (placed folders/scenes) — so at volume you work one region at a time. Empty canvas → the whole variant.
  resetConnectors: async () => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const canvas = canvasSceneIds(v.nodes ?? [], get().storyTree)
    // Clear edges FROM the canvas scenes (their outgoing links); empty canvas → clear the whole variant.
    const adjacency = canvas.size
      ? Object.fromEntries(Object.entries(v.adjacency).filter(([from]) => !canvas.has(from)))
      : {}
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, adjacency } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] resetConnectors failed', e) }
    get().setNotice(`Cleared connectors on “${v.name}”${canvas.size ? ' (canvas scenes)' : ''}.`)
  },

  quickConnectSorted: async () => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const canvas = canvasSceneIds(v.nodes ?? [], get().storyTree)
    const ordered = orderedScenes(get().storyTree)
    // Quick connect ONLY chains scenes already on the timeline (placed standalone or under a placed folder), in
    // reading order — never scenes that aren't on the canvas. With nothing placed there's nothing to wire.
    const scenes = ordered.filter((s) => canvas.has(s.sceneId ?? s.name))
    if (scenes.length < 2) {
      get().setNotice('Add scenes to the timeline first — Quick connect chains the scenes already on the canvas.')
      return
    }
    // Chain these in reading order, MERGED into the variant (so quick-connecting one region keeps the others' edges).
    const adjacency = { ...v.adjacency }
    for (let i = 0; i < scenes.length - 1; i++) {
      adjacency[scenes[i].sceneId ?? scenes[i].name] = [scenes[i + 1].sceneId ?? scenes[i + 1].name]
    }
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, adjacency } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] quickConnectSorted failed', e) }
    get().setNotice(`Connected ${scenes.length} scene${scenes.length === 1 ? '' : 's'} in reading order on “${v.name}”${canvas.size ? ' (canvas)' : ''}.`)
  },

  setTimelineConfirm: (v) => set({ timelineConfirm: v }),
  setTimelineSelection: (ids) => set({ timelineSelection: ids }),

  // Selection-scoped routing — driven by the marquee selection mirrored from React Flow (timelineSelection),
  // so the global keydown can run them without reaching into the canvas component.
  connectSelectedScenes: async () => {
    const overlay = get().timelineGraph
    const sel = [...get().timelineSelection].sort(
      (a, b) => (overlay.scenes[a]?.linearPos ?? 1e9) - (overlay.scenes[b]?.linearPos ?? 1e9)
    )
    if (sel.length < 2) { get().setNotice('Select 2+ scenes first — Shift-drag a box over the scenes to connect.'); return }
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) { get().setNotice('No tree variant yet — reopen the project.'); return }
    // Batch: build the whole chain into the adjacency in ONE pass, then a SINGLE saveTrees — not N sequential
    // link calls each rewriting trees.json. Cycle-safe against the ACCUMULATING graph (skip an edge that would loop).
    let adj = v.adjacency
    let added = 0
    for (let i = 0; i < sel.length - 1; i++) {
      const from = sel[i]
      const to = sel[i + 1]
      if (from === to || adjacencyHas(adj, from, to) || adjacencyReaches(adj, to, from)) continue
      adj = addAdjacency(adj, from, to)
      added++
    }
    if (!added) { get().setNotice('Those scenes are already connected in reading order.'); return }
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, adjacency: adj } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] connectSelectedScenes failed', e) }
    get().setNotice(`Connected ${sel.length} scenes in reading order.`)
  },
  disconnectSelectedScenes: async () => {
    const sel = new Set(get().timelineSelection)
    if (sel.size < 1) { get().setNotice('Select scenes first — Shift-drag a box over the scenes to disconnect.'); return }
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    // Batch: fully ISOLATE the selection (cut every edge with EITHER endpoint selected) in one filtered rebuild +
    // a SINGLE saveTrees — not N sequential unlink calls.
    let cut = 0
    const adj: Record<string, string[]> = {}
    for (const [from, tos] of Object.entries(v.adjacency ?? {})) {
      const kept: string[] = []
      for (const to of tos ?? []) {
        if (sel.has(from) || sel.has(to)) cut++
        else kept.push(to)
      }
      if (kept.length) adj[from] = kept
    }
    if (!cut) { get().setNotice('No connectors touch the selection.'); return }
    const next: TreesFile = { ...trees, variants: trees.variants.map((x) => (x.id === v.id ? { ...x, adjacency: adj } : x)) }
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] disconnectSelectedScenes failed', e) }
    get().setNotice(`Cut ${cut} connector${cut === 1 ? '' : 's'} touching the selection.`)
  },

  // Cell view (view-only) route painting: set (or clear, color=null) the color on every scene of a route. Stored on
  // the variant's cellColors map so it survives; the default longest-route tint is computed at render, not stored.
  setRouteColor: async (sceneIds, color) => {
    const trees = get().trees
    const v = activeVariant(trees)
    if (!v) return
    const cellColors = { ...(v.cellColors ?? {}) }
    for (const id of sceneIds) { if (color) cellColors[id] = color; else delete cellColors[id] }
    const next = withVariant(trees, v.id, { cellColors })
    set({ trees: next })
    try { await window.nvs.saveTrees(next) } catch (e) { console.error('[nvs] setRouteColor failed', e) }
  },

  // Timeline undo/redo (registered as the page-level history on the timeline workspace). Re-applies a snapshot
  // with recording suppressed, then persists it. Covers graph + canvas of every variant via the subscription.
  undoTrees: () => {
    const prev = treesHistory.popUndo(get().trees)
    if (!prev) return
    suppressTreesHistory = true
    set({ trees: prev })
    suppressTreesHistory = false
    void window.nvs.saveTrees(prev).catch((e) => console.error('[nvs] undo save failed', e))
    get().setNotice('Undo')
  },
  redoTrees: () => {
    const next = treesHistory.popRedo(get().trees)
    if (!next) return
    suppressTreesHistory = true
    set({ trees: next })
    suppressTreesHistory = false
    void window.nvs.saveTrees(next).catch((e) => console.error('[nvs] redo save failed', e))
    get().setNotice('Redo')
  },

  setNotice: (text) => set({ notice: text }),

  setChatOpen: (chatOpen) => set({ chatOpen }),
  setChatDraft: (chatDraft) => set({ chatDraft }),

  newChat: () => {
    const now = new Date().toISOString()
    const s: ChatSession = { id: crypto.randomUUID(), title: uniqueTitle('New chat', get().chatSessions), createdAt: now, updatedAt: now, history: [], events: [] }
    set({ chatSessions: [s, ...get().chatSessions], chatActiveId: s.id, chatError: null })
    persistChat(get)
  },
  switchChat: (id) => {
    set({ chatActiveId: id, chatError: null })
    void window.nvs.setActiveChatSession(id)
    // Lazy-load this session's body the first time it becomes active (the picker holds metas only). Guard the
    // apply on `chatActiveId === id` so a fast re-switch can't drop a stale body onto the wrong session.
    const cur = get().chatSessions.find((s) => s.id === id)
    if (cur && !cur.history.length && !cur.events.length) {
      void window.nvs.readChatSession(id).then((body) => {
        if (body && (body.history.length || body.events.length) && get().chatActiveId === id) set({ chatSessions: setBody(get().chatSessions, id, body) })
      })
    }
  },
  deleteChat: (id) => {
    const rest = get().chatSessions.filter((s) => s.id !== id)
    const activeId = get().chatActiveId === id ? (rest[0]?.id ?? null) : get().chatActiveId
    set({ chatSessions: rest, chatActiveId: activeId })
    void window.nvs.deleteChatSession(id) // drop the file + index meta
    void window.nvs.setActiveChatSession(activeId)
    // If we moved onto a different session, make sure its body is loaded (it may have been metas-only).
    const cur = activeId ? get().chatSessions.find((s) => s.id === activeId) : null
    if (cur && activeId && !cur.history.length && !cur.events.length) {
      void window.nvs.readChatSession(activeId).then((body) => {
        if (body && (body.history.length || body.events.length) && get().chatActiveId === activeId) set({ chatSessions: setBody(get().chatSessions, activeId, body) })
      })
    }
  },

  sendChat: async (text, attached = []) => {
    const t = text.trim()
    if (!t || get().chatBusy) return
    const activeVariantBefore = get().trees.activeId // agent tools (createVariant) may switch this mid-turn
    // Ensure an active session (auto-create + title from the first prompt).
    let id = get().chatActiveId
    if (!id || !get().chatSessions.some((s) => s.id === id)) {
      const now = new Date().toISOString()
      const s: ChatSession = { id: crypto.randomUUID(), title: t.slice(0, 40), createdAt: now, updatedAt: now, history: [], events: [] }
      set({ chatSessions: [s, ...get().chatSessions], chatActiveId: s.id })
      id = s.id
    }
    const cur = get().chatSessions.find((s) => s.id === id)!
    const history = [...cur.history, { role: 'user' as const, text: t }]
    set({
      chatSessions: patchSession(get().chatSessions, id, {
        history,
        events: [...cur.events, { type: 'user', text: t, attached: attached.length ? attached.map((p) => ({ kind: p.kind === 'scene' ? 'scene' : 'world', path: p.path, title: p.title })) : undefined }],
        title: cur.history.length === 0 ? uniqueTitle(t.slice(0, 40), get().chatSessions.filter((s) => s.id !== id)) : cur.title
      }),
      chatBusy: true,
      chatError: null
    })
    try {
      const res = await window.nvs.runAgent(history, toChatContext(get().activePage, attached))
      const fail = res.ok ? null : (res.error ?? 'request failed')
      const s = get().chatSessions.find((x) => x.id === id)
      if (s) {
        set({
          chatSessions: patchSession(get().chatSessions, id, {
            history: res.reply ? [...s.history, { role: 'assistant', text: res.reply }] : s.history,
            events: fail ? [...s.events, { type: 'error', message: fail }] : s.events
          }),
          chatError: fail
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const s = get().chatSessions.find((x) => x.id === id)
      if (s) set({ chatSessions: patchSession(get().chatSessions, id, { events: [...s.events, { type: 'error', message: msg }] }), chatError: msg })
    } finally {
      set({ chatBusy: false })
      persistChat(get)
      // The agent may have WRITTEN via its tools (connectScenes, createScene, page edits) — those land in the main
      // process, bypassing the store. Re-read the surfaces it can touch so the UI reflects them (and the fresh trees
      // can't be clobbered by a later stale save). Cheap reads; skip-if-unchanged inside each.
      if (get().project) {
        await get().refreshTrees()
        await get().refreshStoryTree()
        // If the agent switched the active variant (e.g. created a new timeline), the analysis views + canvas
        // still point at the old one — re-sync them the way setActiveVariant would (reloadTimeline populates the
        // new variant's canvas if it's wired-but-empty).
        if (get().trees.activeId !== activeVariantBefore) {
          await get().reloadTimeline()
          await get().refreshAnalysisViews()
        }
        try {
          const worldPages = await window.nvs.listWorldPages()
          set({ worldPages, characters: worldPages.filter((p) => p.kind === 'character') })
        } catch (e) {
          console.error('[nvs] post-agent worldPages refresh failed', e)
        }
      }
    }
  },
  stopChat: () => void window.nvs.cancelAgent(),
  appendChatEvent: (event) => {
    const id = get().chatActiveId
    const s = id ? get().chatSessions.find((x) => x.id === id) : null
    if (!id || !s) return
    // Streamed chunks merge into the trailing assistant bubble (a tool/result/user in between starts a fresh one),
    // so a turn renders as one growing bubble and nothing extra is persisted.
    if (event.type === 'text_delta') {
      const last = s.events[s.events.length - 1]
      const events =
        last && last.type === 'text'
          ? [...s.events.slice(0, -1), { type: 'text' as const, text: last.text + event.text }]
          : [...s.events, { type: 'text' as const, text: event.text }]
      set({ chatSessions: patchSession(get().chatSessions, id, { events }) })
      return
    }
    set({ chatSessions: patchSession(get().chatSessions, id, { events: [...s.events, event] }) })
  },
  resetChat: () => {
    const id = get().chatActiveId
    if (!id) return
    set({ chatSessions: patchSession(get().chatSessions, id, { history: [], events: [] }), chatError: null })
    persistChat(get)
  },

  setAgentTab: (agentTab) => set({ agentTab }),
  // Chokepoint: with AI off, the /agent composer can't open from ANY trigger (block-editor slash, world slash…).
  setAgentComposerOpen: (agentComposerOpen, anchor) => {
    if (agentComposerOpen && !get().aiEnabled) return
    set({ agentComposerOpen, agentComposerAnchor: agentComposerOpen ? (anchor ?? null) : null })
  },
  setPromptsOpen: (promptsOpen) => set({ promptsOpen }),
  loadPrompts: async () => set({ prompts: await window.nvs.listPrompts() }),
  savePrompt: async (p) => set({ prompts: await window.nvs.savePrompt(p) }),
  deletePrompt: async (id) => set({ prompts: await window.nvs.deletePrompt(id) }),
  setTasks: (tasks) => {
    // Fire a one-shot completion toast when a task crosses into `done` (don't nag on every push).
    const prev = get().tasks
    const justDone = tasks.find((t) => t.status === 'done' && prev.find((p) => p.id === t.id)?.status !== 'done')
    set({ tasks })
    if (justDone) get().setNotice(`Task ready to review: ${justDone.pageTitle}`)
  },
  enqueueTask: async (input) => {
    const id = await window.nvs.enqueueTask(input)
    // Surface the inbox so the run is visible (it's non-blocking — the author keeps writing).
    set({ chatOpen: true, agentTab: 'tasks' })
    return id
  },
  applyTask: async (id) => {
    const t = get().tasks.find((x) => x.id === id)
    if (!t || t.status !== 'done') return
    // CUSTODY pages have no editor buffer — pendingApply would stage forever (the pane never consumes
    // it; that was the silent no-op). Apply writes the file directly, frontmatter preserved, with the
    // same staleness guard; Undo lives in the topic's Ask AI pane (baseText stays on the task).
    if (t.pageKind === 'custody') {
      if (!t.result) return
      // Grammar gate: a draft whose ```custody block doesn't parse would break the chart — never write it.
      const check = await window.nvs.parseCustodyBlock(t.result)
      if (check.errors.length > 0) {
        get().setNotice(`Draft for “${t.pageTitle}” has ${check.errors.length} grammar error${check.errors.length === 1 ? '' : 's'} — review it in the topic's Ask AI pane (re-run usually fixes it).`)
        return
      }
      const doc = await window.nvs.readScene(t.pagePath)
      if ((doc?.body ?? '') !== t.baseText) {
        get().setNotice(`“${t.pageTitle}” changed since the job ran — re-run it instead of applying a stale draft.`)
        return
      }
      get().pushPageHistory(t.pagePath, doc?.body ?? '', `AI apply — ${t.pageTitle}`, t.id, check.canonical) // redo target = the exact bytes written
      const ok = await window.nvs.writeScene(t.pagePath, doc.frontmatter, check.canonical)
      if (ok) {
        get().markTaskApplied(t.id, true)
        get().bumpCustody()
        get().setNotice(`Applied to “${t.pageTitle}” — Undo lives on the task row.`)
      }
      return
    }
    // The edit applies through the open editor (one transaction = one undo). Re-open the page if needed.
    if (get().activePage?.path !== t.pagePath) {
      await get().openPage({ path: t.pagePath, title: t.pageTitle, kind: t.pageKind })
    }
    // Fold the AI-provenance note into the text the editor will insert (generation edits only) — it precedes
    // the appended block / heads a rewrite, and rides the same undoable transaction. The stored task stays raw.
    const staged = t.stamp && t.result ? { ...t, result: `${provenanceNote(t.mode)}\n\n${t.result}` } : t
    set({ pendingApply: staged })
  },
  applyGroup: async (ids) => {
    const done = ids.filter((id) => get().tasks.find((t) => t.id === id)?.status === 'done')
    if (!done.length) return
    set({ applyBatch: done })
    await get().applyTask(done[0]) // the editor applies it (force, no confirm) → finishApply advances the batch
  },
  finishApply: () => {
    const batch = get().applyBatch
    set({ pendingApply: null })
    if (batch && batch.length > 1) {
      const rest = batch.slice(1)
      set({ applyBatch: rest })
      void get().applyTask(rest[0])
    } else if (batch) {
      set({ applyBatch: null })
    }
  },

  setDockOpen: (open) => set({ dockOpen: open }),
  setShowMood: (v) => {
    try { localStorage.setItem(SHOW_MOOD_KEY, v ? 'on' : 'off') } catch { /* ignore */ }
    set({ showMood: v })
  },
  setShowTiming: (v) => {
    try { localStorage.setItem(SHOW_TIMING_KEY, v ? 'on' : 'off') } catch { /* ignore */ }
    set({ showTiming: v })
  },
  setEditableSource: (v) => {
    try { localStorage.setItem(EDITABLE_SOURCE_KEY, v ? 'on' : 'off') } catch { /* ignore */ }
    set({ editableSource: v })
  },
  setAiEnabled: (v) => {
    try { localStorage.setItem(AI_ENABLED_KEY, v ? 'on' : 'off') } catch { /* ignore */ }
    // Turning AI off while its panels are open: close them so nothing AI lingers on screen — assistant, prompt
    // library, Jobs dashboard, AND the bottom console dock (its Ingest/Agent tabs are analysis-running + AI output).
    set(v ? { aiEnabled: v } : { aiEnabled: v, chatOpen: false, promptsOpen: false, jobsOpen: false, dockOpen: false })
  },
  setUiLocale: (l) => {
    try { localStorage.setItem(UI_LOCALE_KEY, l) } catch { /* ignore */ }
    applyLocale(l) // switch the live i18next language (resolves `system` via navigator.language)
    set({ uiLocale: l })
  },
  runUpdateCheck: async (opts) => {
    const res = await window.nvs.checkForUpdate?.().catch(() => null)
    if (!res) return null
    // Only nudge for a genuinely newer release the user hasn't already waved off (force = manual "check now").
    if (res.isNewer && res.latest && (opts?.force || res.latest !== get().updateDismissed)) {
      set({ updateLatest: res.latest })
      get().pushNotification({
        id: 'update',
        kind: 'info',
        title: i18n.t('notifications:update.title', { version: res.latest }),
        body: i18n.t('notifications:update.body', { current: res.current }),
        href: res.url,
        actionLabel: i18n.t('notifications:update.action'),
      })
    }
    return res
  },
  // Commit a verbatim Source edit: write the bytes as-typed, then RE-READ the file so the split frontmatter/body
  // buffer (and the derived views) re-sync from what actually landed on disk. Mirrors saveScene's post-save
  // side-effects (ingest + freshness for scenes; world-page refresh + freshness otherwise), since a raw edit can
  // change anything a structured save could — scene_id, phase, cast, prose.
  saveSceneRaw: async (text) => {
    const { activePage } = get()
    if (!activePage) return
    await window.nvs.writeSceneRaw(activePage.path, text)
    const doc = await window.nvs.readScene(activePage.path)
    set((s) => ({
      frontmatter: doc?.frontmatter ?? {},
      body: doc?.body ?? '',
      raw: doc?.raw ?? text,
      sceneDirty: false,
      bufferEpoch: s.bufferEpoch + 1 // remount the editors so they reseed from the re-read buffer
    }))
    if (activePage.kind === 'scene') {
      try {
        await window.nvs.ingestWork()
        set({ threads: await window.nvs.listThreads() })
        get().bumpFreshness()
      } catch (e) {
        console.error('[nvs] post-rawsave ingest failed', e)
      }
      await get().refreshStoryTree()
    } else {
      await get().refreshWorldPages()
      get().bumpFreshness()
    }
  },
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setFloatDockOpen: (v) => {
    try { localStorage.setItem(FLOAT_DOCK_KEY, v ? 'on' : 'off') } catch { /* ignore */ }
    set({ floatDockOpen: v })
  },
  setTheme: (t) => {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* ignore */ }
    applyTheme(t) // flip <html>.dark now; the DESIGN.md token vars do the rest
    set({ theme: t })
  },
  setComposing: (v) => set({ composing: v }),
  setDockTab: (tab) => set({ dockTab: tab }),
  openDockTab: (tab) => set({ dockOpen: true, dockTab: tab }),
  bumpFreshness: () => set((s) => ({ freshnessVersion: s.freshnessVersion + 1 })),
  pushNotification: (n) =>
    set((s) => ({
      // same id replaces in place (a source keeps one card, not a pile); else prepend (newest first).
      notifications: [
        { ...n, ts: Date.now(), read: false },
        ...s.notifications.filter((x) => x.id !== n.id)
      ]
    })),
  dismissNotification: (id) => set((s) => {
    // Dismissing the update nudge remembers the version, so it won't re-nag until a newer release ships.
    if (id === 'update' && s.updateLatest) {
      try { localStorage.setItem(UPDATE_DISMISSED_KEY, s.updateLatest) } catch { /* ignore */ }
      return { notifications: s.notifications.filter((x) => x.id !== id), updateDismissed: s.updateLatest }
    }
    return { notifications: s.notifications.filter((x) => x.id !== id) }
  }),
  markNotificationsRead: () => set((s) => ({ notifications: s.notifications.map((x) => ({ ...x, read: true })) })),
  clearNotifications: () => set({ notifications: [] }),

  applyIngestProgress: (p) => {
    const prev = get().ingestProgress
    set({ ingestProgress: p })
    // WHILE the run is active: refetch the thread-rail data (threads + the graph overlay it renders) so threads
    // accrete live as scenes are read, instead of appearing all at once at the end. Throttled so a long run
    // doesn't fire a reload per broadcast. Only the cheap thread views — coherence/arcs/lore refresh on finish.
    if (p?.active) {
      const now = Date.now()
      if (now - lastLiveRefresh >= LIVE_REFRESH_MS) {
        lastLiveRefresh = now
        void Promise.all([window.nvs.listThreads(), window.nvs.timelineGraph()])
          .then(([threads, timelineGraph]) => set({ threads, timelineGraph }))
          .catch(() => {}) // a mid-run read racing a write is fine — the next tick (or the finish refresh) catches up
      }
    }
    // On the active→finished transition, refresh freshness + history and drop a mailbox confirmation.
    if (prev?.active && p && !p.active) {
      lastLiveRefresh = 0 // reset the throttle so the NEXT run starts refreshing immediately
      get().bumpFreshness()
      void get().loadIngestSessions()
      // Refresh the analysis-derived views so the rails AND the thread map reflect the new run — otherwise
      // they keep showing the stale openWork snapshot (e.g. a multi-beat thread renders as a single marker).
      void Promise.all([window.nvs.listThreads(), window.nvs.listCoherenceFindings(), window.nvs.listCharacterArcs(), Promise.resolve(window.nvs.listEntityTracks?.() ?? []).catch(() => []), Promise.resolve(window.nvs.listEntityArcs?.() ?? []).catch(() => []), Promise.resolve(window.nvs.listLoreView?.() ?? { topics: [], clock: [] }).catch(() => ({ topics: [], clock: [] })), window.nvs.timelineGraph()])
        .then(([threads, coherence, characterArc, entityTracks, entityArcs, loreView, timelineGraph]) => set({ threads, coherence, characterArc, entityTracks, entityArcs, loreView, timelineGraph }))
        .catch((e) => console.error('[nvs] post-run analysis refresh failed', e))
      const done = p.steps.filter((s) => s.status === 'done').length
      const failed = p.steps.filter((s) => s.status === 'failed').length
      const skipped = p.steps.filter((s) => s.status === 'skipped').length
      // A coherence run is one 'coherence' step — notify in its own words, not "Analysis updated".
      const isCoherence = p.steps.length > 0 && p.steps.every((s) => s.kind === 'coherence')
      if (p.error) {
        // A fatal connection wall (credits / auth / session / persistent rate limit) — the run paused itself.
        const remaining = p.steps.filter((s) => s.status === 'pending').length
        get().pushNotification({
          id: 'ingest-run',
          kind: 'warning',
          title: isCoherence ? 'Coherence check paused' : 'Analysis paused',
          body: `${p.error.message} (${done} done${remaining ? `, ${remaining} remaining` : ''}) — fix it and run again to continue.`
        })
      } else if (isCoherence) {
        // done → it re-diffed (note carries "N characters · M findings"); skipped → already up to date.
        const note = p.steps[0]?.note
        get().pushNotification({
          id: 'ingest-run',
          kind: failed ? 'warning' : 'info',
          title: done > 0 ? 'Coherence checked' : 'Coherence up to date',
          body: done > 0 ? (note ?? 'Re-checked.') : 'Nothing changed since the last check.'
        })
      } else {
        get().pushNotification({
          id: 'ingest-run',
          kind: failed ? 'warning' : 'success',
          title: failed ? 'Analysis update had errors' : 'Analysis updated',
          body: `${done} updated${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`
        })
      }
    }
  },
  startIngestRun: async (forceScenes, depth) => {
    set({ dockOpen: true, dockTab: 'ingest' }) // surface the live queue
    await window.nvs.startIngestRun(forceScenes, depth)
  },
  resetAnalysis: async () => {
    const res = await window.nvs.resetAnalysis()
    if (!res.ok) {
      get().pushNotification({ id: 'reset-analysis', kind: 'warning', title: 'Reset failed', body: res.error ?? 'Could not rebuild the analysis.' })
      return
    }
    // DB rebuilt from files: T1 is fresh, T2/T3 (AI) is gone until re-run. Leave any timetravel + re-pull.
    await window.nvs.setViewingVersion(null)
    set({ viewingVersion: null, selectedThreadId: null, selectedFindingId: null, selectedArcId: null })
    await get().refreshAnalysisViews()
    await get().loadIngestSessions()
    try {
      set({ scenes: await window.nvs.listScenes(), storyTree: await window.nvs.listStoryTree() })
    } catch (e) {
      console.error('[nvs] post-reset reload failed', e)
    }
    get().bumpFreshness()
    const backup = res.backupDir ? res.backupDir.split(/[/\\]/).pop() : null
    get().pushNotification({
      id: 'reset-analysis',
      kind: 'info',
      title: 'Analysis rebuilt from your files',
      body: backup ? `Your writing is untouched. Old analysis backed up to ${backup}. Re-run the AI passes when ready.` : 'Your writing is untouched. Re-run the AI passes when ready.'
    })
  },
  checkCoherence: async (opts) => {
    set({ dockOpen: true, dockTab: 'ingest' }) // same dock — the coherence run shares the queue + history
    await window.nvs.startCoherenceRun(opts)
  },
  setAiState: (s) => set({ aiState: s }),
  refreshAiState: async () => {
    try {
      set({ aiState: await window.nvs.aiConnections() })
    } catch (e) {
      console.error('[nvs] refreshAiState failed', e)
    }
  },
  loadIngestSessions: async () => {
    const { sessions, current } = await window.nvs.listIngestSessions()
    set({ ingestSessions: sessions, currentVersion: current })
  },
  revertIngestSession: async (id) => {
    const ok = await window.nvs.revertIngestSession(id)
    if (ok) {
      await window.nvs.setViewingVersion(null) // restoring makes that version the live current — leave view mode
      get().bumpFreshness()
      get().pushNotification({ id: 'ingest-revert', kind: 'info', title: 'Restored', body: 'This version is now your current analysis.' })
    } else {
      get().pushNotification({ id: 'ingest-revert', kind: 'warning', title: 'Restore failed', body: 'That version’s snapshot is no longer available.' })
    }
    set({ viewingVersion: null })
    await get().loadIngestSessions()
    await get().refreshAnalysisViews()
  },
  /** Enter (sessionId) or leave (null) read-only timetravel — point the reads at that version's snapshot. */
  viewVersion: async (sessionId) => {
    const snapshotId = sessionId ? (get().ingestSessions.find((s) => s.id === sessionId)?.snapshotId ?? null) : null
    if (sessionId && !snapshotId) return // nothing to view (snapshot pruned)
    const ok = await window.nvs.setViewingVersion(snapshotId)
    if (sessionId && !ok) {
      // The snapshot file is gone (older versions are pruned). Stay live — never silently paint current data
      // under a "viewing past version" banner — and tell the author why.
      set({ viewingVersion: null })
      get().pushNotification({ id: 'view-version', kind: 'warning', title: 'Version unavailable', body: 'This version’s snapshot is no longer on disk — only the most recent versions are kept for preview.' })
      await get().refreshAnalysisViews()
      return
    }
    set({ viewingVersion: sessionId })
    await get().refreshAnalysisViews()
  },
  /** Re-pull the analysis-derived views (threads/coherence/arcs/map) from whatever the reads now point at. */
  refreshAnalysisViews: async () => {
    // Each read is isolated: a single failing query (e.g. timetravel onto a snapshot the engine couldn't
    // migrate, or a stale preload) degrades ONLY its own view and keeps the last-good value, instead of one
    // rejection sinking the whole Promise.all and blanking every panel. `ok` is tallied for a degrade toast.
    const prev = get()
    let failed = 0
    const safe = async <T>(read: Promise<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await read
      } catch (e) {
        console.error(`[nvs] ${label} failed`, e)
        failed++
        return fallback
      }
    }
    const [threads, coherence, characterArc, entityTracks, entityArcs, loreView, timelineGraph] = await Promise.all([
      safe(window.nvs.listThreads(), prev.threads ?? [], 'listThreads'),
      safe(window.nvs.listCoherenceFindings(), prev.coherence ?? [], 'listCoherenceFindings'),
      safe(window.nvs.listCharacterArcs(), prev.characterArc ?? [], 'listCharacterArcs'),
      // Also tolerate a stale preload/main bundle (method missing or handler unregistered).
      safe(Promise.resolve(window.nvs.listEntityTracks?.() ?? []), prev.entityTracks ?? [], 'listEntityTracks'),
      safe(Promise.resolve(window.nvs.listEntityArcs?.() ?? []), prev.entityArcs ?? [], 'listEntityArcs'),
      safe(Promise.resolve(window.nvs.listLoreView?.() ?? { topics: [], clock: [] }), prev.loreView ?? { topics: [], clock: [] }, 'listLoreView'),
      safe(window.nvs.timelineGraph(), prev.timelineGraph ?? emptyGraph, 'timelineGraph')
    ])
    set({ threads, coherence, characterArc, entityTracks, entityArcs, loreView, timelineGraph })
    if (failed > 0) {
      get().pushNotification({
        id: 'analysis-view-degraded',
        kind: 'warning',
        title: 'Some views couldn’t load',
        body: get().viewingVersion
          ? 'This version predates the current analysis format — some panels may be incomplete.'
          : 'Some analysis panels failed to refresh; see the developer console for details.'
      })
    }
  },
  refreshProject: async (change) => {
    // An out-of-band write (agent createPage/setPhase) changed files on disk → re-pull the file-derived
    // views so the new page shows in the tree/scenes/world, then the analysis that hangs off them.
    try {
      const [storyTree, scenes, worldPages] = await Promise.all([window.nvs.listStoryTree(), window.nvs.listScenes(), window.nvs.listWorldPages()])
      set({ storyTree, scenes, worldPages, characters: worldPages.filter((p) => p.kind === 'character') })
    } catch (e) {
      console.error('[nvs] refreshProject failed', e)
    }
    await get().refreshAnalysisViews()
    void get().loadIngestSessions()
    get().bumpFreshness()
    // Toast what the agent did so the author knows where to look (no auto-open — they find it in the tree).
    // Per-PATH id so a burst of creates STACKS in the bell (dedupe is by id) instead of collapsing into one.
    if (change?.action === 'create') {
      get().pushNotification({ id: `agent-create:${change.path}`, kind: 'success', title: 'Page created by AI', body: `“${change.title ?? change.path}” — find it in the tree; it's tagged AI-generated, set its status when ready.` })
    } else if (change?.action === 'setPhase') {
      get().pushNotification({ id: `agent-setphase:${change.path}`, kind: 'info', title: 'Status updated by AI', body: `“${change.title ?? change.path}” → ${change.phase}.` })
    }
  },

  setGanttLayer: (key, on) => set((s) => ({ ganttLayers: { ...s.ganttLayers, [key]: on } })),

  setSelectedThread: (id, focus) => set({ selectedThreadId: id, threadFocus: focus ?? null }),

  setThreadsTab: (t) => set({ threadsTab: t, selectedThreadId: null, selectedArcId: null, arcChapter: null, selectedEntityId: null, selectedLoreId: null }),
  setSelectedArc: (id, chapter) => set({ selectedArcId: id, arcChapter: chapter ?? null }), // opening an arc resets scope unless one is passed
  setSelectedEntity: (id, focus) => set({ selectedEntityId: id, entityFocus: focus ?? null }),
  setSelectedLore: (id) => set({ selectedLoreId: id }),
  setArcChapter: (chapter) => set({ arcChapter: chapter }),
  setCoherenceKind: (k) => set({ coherenceKind: k }),
  setArcFacet: (f) => set({ arcFacet: f }),
  setEntityFacet: (f) => set({ entityFacet: f }),
  setCoherenceRuling: async (entityId, trait, intentional) => {
    try {
      set({ coherence: await window.nvs.setCoherenceRuling(entityId, trait, intentional) })
    } catch (e) {
      console.error('[nvs] setCoherenceRuling failed', e)
    }
  },
  mergeEntities: async (ids) => {
    const res = await window.nvs.mergeEntities(ids)
    if (res.ok) {
      // The merge touched presence/arcs/findings — re-pull the entity views (and clear a dangling selection).
      const [entityTracks, entityArcs, coherence] = await Promise.all([
        Promise.resolve(window.nvs.listEntityTracks?.() ?? []).catch(() => [] as EntityTrack[]),
        Promise.resolve(window.nvs.listEntityArcs?.() ?? []).catch(() => [] as CharacterArc[]),
        window.nvs.listCoherenceFindings()
      ])
      set({ entityTracks, entityArcs, coherence, selectedEntityId: null })
    }
    return res
  },

  setSelectedFinding: (id) => set({ selectedFindingId: id }),

  setNodeColor: (id, idx) => {
    set((s) => {
      const next = { ...s.nodeColor }
      if (idx == null) delete next[id]
      else next[id] = idx
      return { nodeColor: next }
    })
    persistUi(get())
  },
  setPaletteLabel: (idx, label) => {
    set((s) => ({ paletteLabels: { ...s.paletteLabels, [idx]: label } }))
    persistUi(get())
  },

  toggleCastChar: (id) => {
    const cur = get().castExcluded
    set({ castExcluded: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    persistUi(get())
  },
  setCastExcluded: (ids) => {
    set({ castExcluded: ids })
    persistUi(get())
  },
  setSceneCollapsed: (rels) => {
    set({ sceneCollapsed: rels })
    persistUi(get())
  },
  setWorldCollapsed: (keys) => {
    set({ worldCollapsed: keys })
    persistUi(get())
  }
}))

// Record every `trees` change into the undo history — one subscription instead of wiring 20+ mutation sites.
// Skipped while re-applying an undo/redo (suppressed). A change to/from empty variants = an open/close, which
// resets the history rather than being an undoable step.
useWorkspace.subscribe((state, prev) => {
  if (state.trees === prev.trees || suppressTreesHistory) return
  if (prev.trees.variants.length === 0 || state.trees.variants.length === 0) { treesHistory.reset(); return }
  treesHistory.record(prev.trees, state.trees)
})

// Persist the last-session tabs + rail (like the collapse memory) whenever they change — one subscription
// instead of threading persistUi through openPage/closeTab/reorderTabs/setWorkspace/setViewMode. Skipped with
// no project open, and while loadProject is replaying the saved session (restoringSession). Debounced so a
// burst of tab clicks writes once.
let sessionPersistTimer: ReturnType<typeof setTimeout> | null = null
useWorkspace.subscribe((state, prev) => {
  if (restoringSession || !state.project) return
  if (state.openTabs === prev.openTabs && state.activePage === prev.activePage && state.workspace === prev.workspace && state.viewMode === prev.viewMode) return
  if (sessionPersistTimer) clearTimeout(sessionPersistTimer)
  sessionPersistTimer = setTimeout(() => { if (useWorkspace.getState().project) persistUi(useWorkspace.getState()) }, 400)
})

/** Persist the per-work UI choices to .nvs/ui-state.json (fire-and-forget). Collapse sets are written only
 *  once set (null → omit) so a fresh project keeps seeding its default instead of saving an empty set. */
function persistUi(s: WorkspaceState): void {
  if (restoringSession) return // never write a half-open/reset state mid-load — it would clobber saved colors/tabs
  void window.nvs.writeUiState({
    castExcluded: s.castExcluded,
    nodeColor: s.nodeColor,
    paletteLabels: s.paletteLabels,
    sceneCollapsed: s.sceneCollapsed ?? undefined,
    worldCollapsed: s.worldCollapsed ?? undefined,
    // Last-session restore — the open tab strip, which was focused, the active rail, and its view mode.
    openTabs: s.openTabs,
    activePath: s.activePage?.path,
    workspace: s.workspace,
    viewMode: s.viewMode
  })
}
