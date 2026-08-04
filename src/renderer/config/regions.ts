/**
 * Region registry — the single source of truth for the component-boundary system.
 *
 * Three consumers, one manifest:
 *   1. Debug overlay — `Ctrl/Cmd+Alt+D` toggles `html.debug-regions`, which draws a
 *      dashed box + label around every `[data-region]` (see styles/globals.css).
 *      Its finer companion `Ctrl/Cmd+Alt+P` (`html.debug-parts`) labels every
 *      `[data-part="…"]` sub-block — an ad-hoc, unregistered tag for pointing at
 *      an exact chunk to edit (used inside the Relationships pane).
 *   2. LLM-readable — this map is a machine-readable "what's on screen and what each
 *      part does"; pair it with a live `document.querySelectorAll('[data-region]')`.
 *   3. Future guided wizard — author a tour against `RegionId`s (type-checked), using
 *      `group`/`desc` to explain each step.
 *
 * A component tags its root by spreading `regionAttrs(id)`; dialogs pass `region={id}`
 * to the shared <Dialog>. `label` is the on-screen string (kept stable so the overlay
 * looks the same); `id` is the typed key everything references.
 */

export type RegionMeta = { label: string; group: RegionGroup; desc: string }
export type RegionGroup = 'chrome' | 'editor' | 'panel' | 'dialog' | 'float'

export const REGIONS = {
  // ── chrome / layout ──────────────────────────────────────────────────────────
  titleBar: { label: 'TitleBar', group: 'chrome', desc: 'Custom window title bar — File/Project/View/Help menus + window controls' },
  rail: { label: 'Rail', group: 'chrome', desc: 'Activity rail — Library + workspace switch' },
  sidebar: { label: 'Sidebar', group: 'chrome', desc: 'Left sidebar — the contextual navigator for the active workspace' },
  mainContent: { label: 'MainContent', group: 'chrome', desc: 'Main area — editor / analysis panel for the active workspace' },
  rightRail: { label: 'RightRail', group: 'chrome', desc: 'Right rail — detail floats + assistant launch' },
  storeView: { label: 'StoreView', group: 'chrome', desc: 'Store — full-page community works + extensions browser (a place, sibling of the library)' },
  statusBar: { label: 'StatusBar', group: 'chrome', desc: 'Bottom status bar — version, connection, dock toggle' },
  consoleDock: { label: 'Console dock', group: 'chrome', desc: 'Collapsible bottom dock — analysis run queue + coherence' },
  tabBar: { label: 'TabBar', group: 'chrome', desc: 'Editor tab strip — open pages + unsaved dots' },
  commandPalette: { label: 'CommandPalette', group: 'chrome', desc: 'Global quick-open — search scenes / world / threads / entities' },

  // ── editor ───────────────────────────────────────────────────────────────────
  sceneEditor: { label: 'SceneEditor', group: 'editor', desc: 'Scene/page editor surface' },
  sceneInspector: { label: 'SceneInspector', group: 'editor', desc: 'Scene aside — derived summary, threads, flags, reveals for the open scene' },
  sceneNavigator: { label: 'SceneNavigator', group: 'editor', desc: 'Story tree — chapters + scenes' },
  scenePalette: { label: 'ScenePalette', group: 'editor', desc: 'Scene quick-open palette' },
  worldNavigator: { label: 'WorldNavigator', group: 'editor', desc: 'World pages — characters + entities by category' },
  editorFab: { label: 'EditorFab', group: 'editor', desc: 'Editor floating action button' },
  fab: { label: 'Fab', group: 'editor', desc: 'Generic floating action button' },

  // ── analysis panels ──────────────────────────────────────────────────────────
  threadsPanel: { label: 'ThreadsPanel', group: 'panel', desc: 'Threads (questlog) — what is open vs paid off' },
  threadSidebar: { label: 'ThreadSidebar', group: 'panel', desc: 'Threads sidebar — thread list' },
  castPanel: { label: 'CastPanel', group: 'panel', desc: 'Cast — presence / co-presence / relationship graph' },
  castSidebar: { label: 'CastSidebar', group: 'panel', desc: 'Cast sidebar — character roster' },
  characterArcPanel: { label: 'CharacterArcPanel', group: 'panel', desc: 'Character arc — per-window change (alignment/knowledge/…)' },
  relationshipsPanel: { label: 'RelationshipsPanel', group: 'panel', desc: 'Relationships rail — pick two characters (mirrored rosters) → the matchup metrics' },
  entityPanel: { label: 'EntityPanel', group: 'panel', desc: 'Entity journey — non-character entity presence + per-window change' },
  coherencePanel: { label: 'CoherencePanel', group: 'panel', desc: 'Coherence — drift / contradiction / gap findings' },
  lorePanel: { label: 'LorePanel', group: 'panel', desc: 'Lore — each world-fact’s revelation pacing (planted / reinforced / retcon) over the scene axis' },
  custodyPanel: { label: 'CustodyPanel', group: 'panel', desc: 'Custody — who HOLDS each item (baton path) and who KNOWS each secret (contagion lanes) over the scene axis' },
  custodySidebar: { label: 'CustodySidebar', group: 'panel', desc: 'Custody — Item / Information roster, event counts, min-appearance filter' },
  coherenceSidebar: { label: 'CoherenceSidebar', group: 'panel', desc: 'Coherence sidebar' },
  timelinePanel: { label: 'TimelinePanel', group: 'panel', desc: 'Timeline canvas — scene graph' },
  cellView: { label: 'CellView', group: 'panel', desc: 'Cell flow — the VN-flowchart reading of the active timeline variant (view-only, route-colored)' },
  corkboardPanel: { label: 'CorkboardPanel', group: 'panel', desc: 'Corkboard — freeform planning canvas: cards + hand-drawn connections, scenes/pages pinned as refs' },
  chatPanel: { label: 'ChatPanel', group: 'panel', desc: 'Assistant chat panel' },
  tasksPanel: { label: 'TasksPanel', group: 'panel', desc: 'Agent tasks inbox' },
  promptLibraryPanel: { label: 'PromptLibraryPanel', group: 'panel', desc: 'Reusable prompt library' },

  // ── dialogs ──────────────────────────────────────────────────────────────────
  projectStructureDialog: { label: 'ProjectStructureDialog', group: 'dialog', desc: 'Project structure / taxonomy editor' },
  projectDetailsDialog: { label: 'ProjectDetailsDialog', group: 'dialog', desc: 'Project info — title / author / cover' },
  shareDialog: { label: 'ShareDialog', group: 'dialog', desc: 'Share / export a project bundle' },
  helpDialog: { label: 'HelpDialog', group: 'dialog', desc: 'Help & reference' },
  supportDialog: { label: 'SupportDialog', group: 'dialog', desc: 'Support & community — creator socials' },
  proDialog: { label: 'ProDialog', group: 'dialog', desc: 'NVS Pro — status / coming-soon + share-to-support' },
  workDetailDialog: { label: 'WorkDetailDialog', group: 'dialog', desc: 'Library work detail preview' },
  unsavedExitDialog: { label: 'UnsavedExitDialog', group: 'dialog', desc: 'Unsaved-changes guard (tab close / library / quit)' },
  jobsDialog: { label: 'JobsDialog', group: 'dialog', desc: 'Jobs dashboard — analysis run tracking + controls (RightRail JobRail)' },
  scenePropertyDialog: { label: 'ScenePropertyDialog', group: 'dialog', desc: 'Scene frontmatter / property editor' },
  printPreviewDialog: { label: 'PrintPreviewDialog', group: 'dialog', desc: 'Paper/print preview of a page (isolated iframe) → native Save-as-PDF' },
  pageReadDialog: { label: 'PageReadDialog', group: 'dialog', desc: 'Quick-read modal for a scene / world page' },
  agentCommandDialog: { label: 'AgentCommandDialog', group: 'dialog', desc: 'Ask-AI command palette / popover' },
  confirmDialog: { label: 'ConfirmDialog', group: 'dialog', desc: 'Generic confirm / destructive-action guard' },

  // ── floating surfaces ────────────────────────────────────────────────────────
  agentFloat: { label: 'AgentFloat', group: 'float', desc: 'Draggable assistant window' },
  promptLibraryFloat: { label: 'PromptLibraryFloat', group: 'float', desc: 'Draggable prompt library window' },
  threadDetailFloat: { label: 'Float:thread:detail', group: 'float', desc: 'Thread detail float' },
  arcDetailFloat: { label: 'Float:arc:detail', group: 'float', desc: 'Character arc detail float' },
  characterDynamicFloat: { label: 'Float:relationship:dynamic', group: 'float', desc: 'Relationship dynamic — one scene’s shifts between the pair (both owners’ moves)' },
  entityDetailFloat: { label: 'Float:entity:detail', group: 'float', desc: 'Entity (item/faction) journey float' },
  coherenceDetailFloat: { label: 'Float:coherence:detail', group: 'float', desc: 'Coherence detail float' },
  loreDetailFloat: { label: 'Float:lore:detail', group: 'float', desc: 'Lore topic detail — the reveal progression + merge members' }
} as const satisfies Record<string, RegionMeta>

export type RegionId = keyof typeof REGIONS

/** Spread on a component's root element so the debug overlay + wizard can find it. */
export function regionAttrs(id: RegionId): { 'data-region': string } {
  return { 'data-region': REGIONS[id].label }
}

/** CSS attribute selector for a region — `document.querySelector(regionSelector('sceneEditor'))`. */
export function regionSelector(id: RegionId): string {
  return `[data-region="${REGIONS[id].label}"]`
}
