/**
 * Engine facade (main process) — the surface the IPC handlers call.
 *
 * Holds the "currently open work" and routes reads to the query layer. The
 * library (scan/create) and the queries (listThreads) live in their own modules;
 * this just composes them and keeps the open-work state.
 */
import { basename, join, resolve, sep } from 'node:path'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import * as library from '@engine/io/library'
import { loadProjectInfo } from '@engine/content/projectInfo'
import * as queries from '@engine/data/queries'
import * as coherence from '@engine/analysis/coherence'
import * as continuity from '@engine/analysis/continuity'
import * as scenes from '@engine/content/scenes'
import { searchAll as searchImpl } from '@engine/content/search'
import * as world from '@engine/content/world'
import * as storyTree from '@engine/content/storyTree'
import { mirrorFrontmatterToTrees, readTrees, writeTrees, connectScenes as treesConnectScenes, disconnectScenes as treesDisconnectScenes, connectScenesBatch as treesConnectScenesBatch, createVariant as treesCreateVariant } from '@engine/content/trees'
import { readCorkboard, writeCorkboard, boardsOverview, boardSkeleton, cardDetail } from '@engine/content/corkboard'
import type { CorkboardFile } from '@shared/ipc'
import { ingest } from '@engine/analysis/ingest'
import { snapshotViewPath } from '@engine/data/db'
import { RESET_DELETE_FILES, LEGACY_PURGE } from '@engine/io/nvsArtifacts'
import { serializeSession, parseSession, parseSessionMeta, normalizeLegacyChat } from '@engine/io/chatSerialize'
import { writeTier as writeTierImpl, tierInputHash as tierInputHashImpl, tierStatus as tierStatusImpl, runIngestBundle as runIngestBundleImpl, listIngestBundles as listIngestBundlesImpl, planIngestSteps as planIngestStepsImpl, applyEntry as applyEntryImpl, snapshotDb as snapshotDbImpl, restoreVersion as restoreVersionImpl, currentVersion as currentVersionImpl, listSessions as listSessionsImpl, recordSession as recordSessionImpl, pruneOrphanThreads as pruneOrphanThreadsImpl, sceneInputChanged as sceneInputChangedImpl, sceneWasSkim as sceneWasSkimImpl, markDownstreamStale as markDownstreamStaleImpl, type PlanItem } from '@engine/data/writeTier'
import { planExtractionBatches as planExtractionBatchesImpl, recordExtractionSample as recordExtractionSampleImpl } from '@engine/analysis/extractionBatches'
import { mergeThreads as mergeThreadsImpl } from '@engine/analysis/threadMerge'
import { mergeEntities as mergeEntitiesImpl } from '@engine/analysis/entityMerge'
import { relationshipEvidence as relationshipEvidenceImpl } from '@engine/analysis/relationship'
import { promptHash as promptHashImpl, getCached as getCachedImpl, putCached as putCachedImpl, evictCached as evictCachedImpl } from '@engine/data/llmCache'
import { digestInputs as digestInputsImpl, writeDigest as writeDigestImpl, digestFor as digestForImpl, storySoFar as storySoFarImpl, profileInputs as profileInputsImpl, writeProfile as writeProfileImpl, stampTimelineVersion as stampTimelineVersionImpl, timelineStatus as timelineStatusImpl, pruneOrphans, backfillThreadAncestry } from '@engine/analysis/rollups'
import { exportProject as exportProjectImpl, exportManuscriptZip as exportManuscriptZipImpl, exportSceneFile as exportSceneFileImpl, forkProject as forkProjectImpl, importProject as importProjectImpl } from '@engine/io/exportImport'
import { serializeStructured as serializeStructuredImpl, serializeSceneStructured as serializeSceneStructuredImpl, importStructured as importStructuredImpl } from '@engine/analysis/structured'
import { readStructure as readStructureImpl, writeStructure as writeStructureImpl } from '@engine/analysis/structure'
import { annotateFindings, setRuling as setRulingImpl } from '@engine/analysis/coherenceRulings'
import { checkIntegrity, type IntegrityIssue } from '@shared/integrity'
import { worldCategoriesFor, sceneCategoriesFor } from '@shared/config/worldCategories'
import { randomUUID } from 'node:crypto'
import type { ExportResult, ImportResult, IngestResult, IngestSession, MergeResult, ProjectInfo, ProjectMeta, ResetAnalysisResult, SceneDoc, SceneDialogueLine, SceneFile, StoryNode, Thread, TimelineLayout, TimelineNode, TimelineGraph, TimelineStatus, TreesFile, CoherenceFinding, CoherenceStatusRow, ThreadDetail, CharacterArc, ChatSession, ChatStore, ChatSessionMeta, AgentEvent, TierKind, TierWrite, TierWriteResult, TierStatusRow, UiState, WorldPage, StructureView, EntityTrack, DbTable, DbRows, RelationshipEvidence, LoreView } from '@shared/ipc'
import { TIMELINE_VERSION, DEFAULT_TIMELINE_VIEW } from '@shared/ipc'

export * as library from '@engine/io/library'
export * as recentsRegistry from '@engine/io/recents'
import * as recents from '@engine/io/recents'
export * as downloadsRegistry from '@engine/io/downloads'
import { collectDeclaredSecrets as collectDeclaredSecretsImpl, type RosterSecret } from '@engine/io/secrets'
import { listCustodyTopics as listCustodyTopicsImpl, createCustodyTopic as createCustodyTopicImpl, updateCustodyRecords as updateCustodyRecordsImpl, migrateCustodyPillar, parseCustodyMarkdown } from '@engine/content/custodyPages'
export { cacheStats } from '@engine/enumCache' // in-memory memo counters (the mcpStats debug tool)

let current: ProjectMeta | null = null

/** One-time rename of a project's legacy analysis folder `.novel-scribe/` → `.nvs/`. Idempotent: a no-op once
 *  `.nvs/` exists, so re-opening is cheap and a half-migrated project (both present) keeps `.nvs/`. */
function migrateSidecar(root: string): void {
  const next = join(root, '.nvs')
  const legacy = join(root, '.novel-scribe')
  if (!existsSync(next) && existsSync(legacy)) {
    try {
      renameSync(legacy, next)
    } catch {
      /* read-only / locked — the project just won't find its DB; non-fatal, surfaces as "no analysis yet" */
    }
  }
}

/** Migrate a project to the current `.nvs/` format by removing dead legacy artifacts (LEGACY_PURGE). Pre-ship we
 *  conform old projects rather than carry legacy; every purged file is a rebuildable cache, so nothing is lost.
 *  Idempotent (rmSync force) and best-effort — a locked file just lingers, harmless. */
function migrateLegacyArtifacts(root: string): void {
  const ns = join(root, '.nvs')
  if (!existsSync(ns)) return
  for (const f of LEGACY_PURGE) {
    try {
      rmSync(join(ns, f), { force: true })
    } catch {
      /* locked/read-only — harmless; the file is dead weight, not referenced by any current code */
    }
  }
}

/** Open a work by path (from the library or "Open elsewhere…"). */
export function openWork(root: string): ProjectMeta | null {
  if (!library.isWork(root)) return null
  migrateSidecar(root) // rename a legacy .novel-scribe/ → .nvs/ BEFORE resolveWorkId reads the DB
  migrateLegacyArtifacts(root) // conform to the current format: drop dead legacy DBs/caches (novel-scribe.db, llm-cache.db)
  migrateCustodyPillar(root) // Stage-1 custody pages (content/world/custody/) → the content/custody/ pillar
  mirrorFrontmatterToTrees(root, storyTree.listStoryTree(root)) // T2: seed the default tree variant from frontmatter (once, non-destructive)
  backfillThreadAncestry(root) // per-variant analysis: stamp legacy universal thread_events with the active variant's ancestry (idempotent)
  const content = join(root, 'content')
  current = {
    root,
    workId: library.resolveWorkId(root),
    name: basename(root),
    insideLibrary: recents.isInsideLibrary(root),
    counts: {
      scenes: library.countMarkdown(join(content, 'story')),
      worldPages: library.countMarkdown(join(content, 'world'))
    }
  }
  recents.recordRecent(root)
  return current
}

export function currentProject(): ProjectMeta | null {
  return current
}

/** Project-wide declared-secrets roster (authored `## Secrets` entries with stable ids) — the citation set
 *  for the window + coherence passes, and the CustodyRail's Information sidebar. */
export function collectDeclaredSecrets(): RosterSecret[] {
  return current ? collectDeclaredSecretsImpl(current.root) : []
}

/** All secret-category arc events with their knowledge fields — the who-knows fold's raw input
 *  (internal/secret-lifecycle.md: gain = owner learned; expose + target = who it reached). */
export function listSecretEvents(): Array<{ entityId: string; sceneId: string; change: string; value: string; target: string | null; secret: string | null; description: string }> {
  return current ? queries.listSecretEvents(current.root) : []
}

/** Authored custody topic pages, parsed — the CustodyRail's AUTHORED chart source (v2: pages, not tables). */
export function listCustodyTopics(): import('@shared/ipc').CustodyTopic[] {
  return current ? listCustodyTopicsImpl(current.root) : []
}

/** Parse a ```custody block out of arbitrary markdown (a job DRAFT) — grammar check without writing,
 *  plus the CANONICAL rewrite (normalized fence) that apply paths should write instead of the raw draft. */
export function parseCustodyBlock(markdown: string): { records: import('@shared/ipc').CustodyRecord[]; errors: string[]; canonical: string } {
  return parseCustodyMarkdown(markdown)
}

/** Create a topic page in the content/custody pillar (anchored creation + the /ag conversion land here). */
export function createCustodyTopic(
  meta: { id: string; name: string; topic: 'item' | 'information'; subject?: string | null },
  records: import('@shared/ipc').CustodyRecord[]
): import('@shared/ipc').CustodyTopic | null {
  return current ? createCustodyTopicImpl(current.root, meta, records) : null
}

/** Replace a topic page's records block (the form's save path); prose preserved. */
export function updateCustodyRecords(pageId: string, records: import('@shared/ipc').CustodyRecord[]): import('@shared/ipc').CustodyTopic | null {
  return current ? updateCustodyRecordsImpl(current.root, pageId, records) : null
}

/** Custody-category arc events in reading order — the CustodyRail's item (baton) fold. */
export function listCustodyEvents(): Array<{ entityId: string; sceneId: string; change: string; value: string; target: string | null; secret: string | null; description: string }> {
  return current ? queries.listPossessionEvents(current.root, 'custody') : []
}

/** Arc-change events (all facets except secret/custody) in reading order — the SceneInspector's per-scene Arc/Entity fold. */
export function listArcEvents(): Array<{ entityId: string; sceneId: string; category: string; change: string; value: string; description: string }> {
  return current ? queries.listArcEvents(current.root) : []
}

/**
 * Copy the open EXTERNAL work into the library and hand back the new location. The caller reopens from
 * `path` through the normal openWork flow so tabs/watchers/analysis all rebind cleanly. The external
 * original stays on disk (copy, not move) but leaves recents — the library copy is canonical now.
 */
export function saveCurrentToLibrary(): { path: string } | null {
  if (!current || current.insideLibrary) return null
  const card = library.saveExternalWork(current.root)
  if (!card) return null
  recents.removeRecent(current.root)
  return { path: card.path }
}

/** Clear the open-work state (returning to the library) — so engine ops + the rename guard see "no project open". */
export function closeWork(): void {
  current = null
}

/** QuestLog view for the open work (empty if nothing open or no analysis yet). */
export function listThreads(): Thread[] {
  if (!current) return []
  return queries.listThreads(current.root)
}

/** A scene's ordered dialogue — the scene-read pass's model input (Phase 3 producer). */
export function sceneDialogue(unitId: string): SceneDialogueLine[] {
  return current ? queries.sceneDialogue(current.root, unitId) : []
}

/** A scene's current thread beats — fed back into a re-read so the model reuses the same handles (anti-drift). */
export function scenePriorThreads(unitId: string): { threadId: string; action: string; description: string | null }[] {
  return current ? queries.scenePriorThreads(current.root, unitId) : []
}

/** Threads open entering a scene, with last-activity position (drives the hot/dormant working-set split). */
export function openThreadsAsOf(unitId: string): { id: string; description: string; title: string | null; resolutionCondition: string | null; lastPos: number }[] {
  return current ? queries.openThreadsAsOf(current.root, unitId) : []
}

/** One scene's dramatic purpose (goals + conflicts) — the Scene Inspector's Purpose section. */
export function sceneAnalysis(unitId: string): import('@engine/data/queries').SceneAnalysis | null {
  return current ? queries.sceneAnalysis(current.root, unitId) : null
}

/** Full-text content search over the prose of every content/ page — the command palette's "by content" mode. */
export function searchContent(query: string, limit?: number): import('@shared/ipc').ContentMatch[] {
  return current ? scenes.searchContent(current.root, query, limit) : []
}

/** General top-k search — folders/scenes/world/custody by name + prose by content — the agent's `search` tool. */
export function searchAll(query: string, limit?: number): import('@shared/ipc').SearchResult {
  return current ? searchImpl(current.root, query, limit) : { hits: [], total: 0, truncated: false }
}

/** A chapter's scenes + extracted evidence — the window/arc pass's input (rolls up T2, not raw dialogue). */
export function chapterEvidence(chapterId: string): import('@engine/data/queries').SceneEvidence[] {
  return current ? queries.chapterEvidence(current.root, chapterId) : []
}

/** The tracked non-character things present in a chapter — the entity window pass's cast list. */
export function chapterEntities(chapterId: string): Array<{ id: string; name: string; type: string }> {
  return current ? queries.chapterEntities(current.root, chapterId) : []
}

/** The non-character entities worth an arc (page OR ≥2 scenes OR major) — the entity window gate. */
export function arcWorthyEntityIds(): Set<string> {
  return current ? queries.arcWorthyEntityIds(current.root) : new Set()
}

/** Signature of a scene's current thread output — to detect when a re-read changed it. */
export function sceneThreadKey(unitId: string): string {
  return current ? queries.sceneThreadKey(current.root, unitId) : ''
}

/** A scene's DOWNSTREAM-relevant output (summary + thread opens/closes) — the M5 cascade gate. */
export function sceneContextKey(unitId: string): string {
  return current ? queries.sceneContextKey(current.root, unitId) : ''
}

/** Derived overlay data for the Timeline (presence/threads/revelations/summary). */
export function timelineGraph(): TimelineGraph {
  if (!current) return { scenes: {}, edges: [] }
  return queries.timelineGraph(current.root)
}

/**
 * Deterministic structural integrity of the open work — the "second reader" run engine-side (so it also works
 * headless on ingest, e.g. as a conformance gate for converted datasets). Same shared algorithm the Coherence
 * rail uses in-app: duplicate scene_id · dangling/self leads_to · missing id · orphan scene · orphan character page.
 */
export function listIntegrityIssues(): IntegrityIssue[] {
  if (!current) return []
  return checkIntegrity(listStoryTree(), { graph: timelineGraph(), worldPages: listWorldPages() })
}

/** Coherence findings for the open work (empty if nothing open / no analysis), with the author's
 *  intentional-rulings overlaid (the ledger survives re-runs — see coherenceRulings.ts). */
export function listCoherenceFindings(): CoherenceFinding[] {
  if (!current) return []
  return annotateFindings(current.root, queries.listCoherenceFindings(current.root))
}

/** Rule a finding intentional (or withdraw it) → the refreshed annotated findings. */
export function setCoherenceRuling(entityId: string, trait: string, intentional: boolean): CoherenceFinding[] {
  if (!current) return []
  setRulingImpl(current.root, entityId, trait, intentional)
  return listCoherenceFindings()
}

/** One thread's full development (umbrella + strands + enriched beats). */
export function threadDetail(threadId: string): ThreadDetail {
  if (!current) return { thread: { id: threadId, slug: threadId, title: null, description: '', type: 'thread', status: 'open', openedAt: null, closedAt: null, beats: 0, builtBy: null, resolutionCondition: null, succeeds: null }, strands: [], beats: [] }
  return queries.threadDetail(current.root, threadId)
}

/** Every character's windowed arc (empty if nothing open / no analysis). */
export function listCharacterArcs(): CharacterArc[] {
  if (!current) return []
  return queries.listCharacterArcs(current.root)
}

/** Console DB inspector — the co-located DB's tables + row counts. */
export function inspectTables(): DbTable[] {
  return current ? queries.inspectTables(current.root) : []
}

/** Console DB inspector — a bounded page of raw rows from one table. */
export function inspectRows(table: string, limit: number, offset: number): DbRows {
  return current ? queries.inspectRows(current.root, table, limit, offset) : { columns: [], rows: [] }
}

/** Every tracked non-character thing's windowed arc — the Entity pivot's journey lens. */
export function listEntityArcs(): CharacterArc[] {
  if (!current) return []
  return queries.listEntityArcs(current.root)
}

/** Known non-character things (items/factions) — fed back into the scene pass as canonical-name grounding.
 *  Pass `cutoffPos` (the hot-window start) to get the WORKING-SET view: recent ∪ top-N most-present (M4). */
export function listTrackedThings(cutoffPos?: number): Array<{ name: string; type: string }> {
  return current ? queries.listTrackedThings(current.root, cutoffPos) : []
}

/** The Entity pivot — tracked non-character entities + presence trails. */
export function listEntityTracks(): EntityTrack[] {
  return current ? queries.listEntityTracks(current.root) : []
}
/** The cast by occurrence — characters + how many scenes each appears in (the agent's T1 tally tool). */
export function listCast(): ReturnType<typeof queries.listCast> {
  return current ? queries.listCast(current.root) : []
}
/** Agent read-only SQL over the analysis DB (SELECT/WITH, single statement, capped; thread_events pre-scoped). */
export function queryDb(sql: string): ReturnType<typeof queries.queryDb> {
  return current ? queries.queryDb(current.root, sql) : { error: 'no open work' }
}

/** The significant cast (entity ids) — the scale cap for arcs/coherence (cumulative appearances + hard cap). */
export function significantEntityIds(): Set<string> {
  return current ? queries.significantEntityIds(current.root) : new Set()
}

/** The coherence pass's two sides per character (declared page vs observed arc) — the reader's input. */
export function coherenceInputs(): coherence.CoherenceInput[] {
  return current ? coherence.coherenceInputs(current.root) : []
}

/** Paged items/factions with arcs — the entity side of the coherence diff. */
export function entityCoherenceInputs(): coherence.CoherenceInput[] {
  return current ? coherence.entityCoherenceInputs(current.root) : []
}

/** The single checkpoint the coherence pass hangs off (chapter of the last scene); null if no scenes. */
export function coherenceCheckpoint(): string | null {
  return current ? coherence.coherenceCheckpoint(current.root) : null
}

/** Per-character coherence freshness — drives the "Check coherence (N)" count. */
export function coherenceStatus(): CoherenceStatusRow[] {
  return current ? coherence.coherenceStatus(current.root) : []
}

// ── Continuity (plot-holes): the story vs itself + its premise (internal/continuity-coherence.md) ──
/** The continuity pass's whole-story inputs (declared rules+premise vs the fact timeline), or null. */
export function continuityInputs(): continuity.ContinuityInputs | null {
  return current ? continuity.continuityInputs(current.root) : null
}
/** The whole-story continuity input hash — the reader stamps this as the run's input_hash. */
export function continuityInputHash(inputs: continuity.ContinuityInputs): string {
  return continuity.continuityInputHash(inputs)
}
/** Whole-story continuity freshness: pending | stale | fresh. */
export function continuityStatus(): 'pending' | 'stale' | 'fresh' {
  return current ? continuity.continuityStatus(current.root) : 'fresh'
}
/** name → canonical entity id resolver (the continuity reader's FK-validation for model-supplied entity_ids). */
export function entityIdResolver(): (raw: string) => string | null {
  return current ? continuity.entityIdResolver(current.root) : () => null
}

/** Per-work UI state (graph tags + Cast roster filter), stored in .nvs/ui-state.json. */
export function readUiState(): UiState {
  const empty: UiState = { castExcluded: [], nodeColor: {}, paletteLabels: {} }
  if (!current) return empty
  const path = join(current.root, '.nvs', 'ui-state.json')
  if (!existsSync(path)) return empty
  try {
    const d = JSON.parse(readFileSync(path, 'utf8')) as Partial<UiState>
    return {
      castExcluded: Array.isArray(d.castExcluded) ? d.castExcluded : [],
      nodeColor: d.nodeColor && typeof d.nodeColor === 'object' ? d.nodeColor : {},
      paletteLabels: d.paletteLabels && typeof d.paletteLabels === 'object' ? d.paletteLabels : {},
      // Kept as undefined when absent (NOT defaulted to []) so the rail can tell "never set" (→ seed default)
      // from "saved empty" (→ everything expanded).
      sceneCollapsed: Array.isArray(d.sceneCollapsed) ? d.sceneCollapsed : undefined,
      worldCollapsed: Array.isArray(d.worldCollapsed) ? d.worldCollapsed : undefined,
      // Last-session restore (paths re-validated against existing pages by the store on load).
      openTabs: Array.isArray(d.openTabs) ? d.openTabs : undefined,
      activePath: typeof d.activePath === 'string' ? d.activePath : undefined,
      workspace: typeof d.workspace === 'string' ? d.workspace : undefined,
      viewMode: typeof d.viewMode === 'string' ? d.viewMode : undefined
    }
  } catch {
    return empty
  }
}

export function writeUiState(state: UiState): boolean {
  if (!current) return false
  try {
    const dir = join(current.root, '.nvs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ui-state.json'), JSON.stringify(state, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

// ── Chat store: per-session files under .nvs/chat/ ───────────────────────────
// `index.json` = { activeId, sessions: [meta] } — small, read for the picker. `sessions/<id>.jsonl` = one
// session's body: a `meta` line, then `msg` lines (history), then `event` lines. Per-session files mean a large
// chat no longer loads or rewrites as one monolith — the picker reads only index.json, a body loads on demand,
// and a mutation rewrites only that session's small file. A legacy `.nvs/chat.json` migrates on first list.
interface ChatIndex {
  activeId: string | null
  sessions: ChatSessionMeta[]
}
function chatDir(): string {
  return join(current!.root, '.nvs', 'chat')
}
function chatIndexPath(): string {
  return join(chatDir(), 'index.json')
}
function chatSessionPath(id: string): string {
  return join(chatDir(), 'sessions', `${id}.jsonl`)
}
function toMeta(s: ChatSession): ChatSessionMeta {
  return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }
}
function readChatIndex(): ChatIndex {
  const p = chatIndexPath()
  if (existsSync(p)) {
    try {
      const d = JSON.parse(readFileSync(p, 'utf8'))
      return { activeId: typeof d.activeId === 'string' ? d.activeId : null, sessions: Array.isArray(d.sessions) ? (d.sessions as ChatSessionMeta[]) : [] }
    } catch {
      /* corrupt index — fall through and rebuild from the session files */
    }
  }
  // No (or corrupt) index but session files present → rebuild metas from each file's `meta` line.
  const dir = join(chatDir(), 'sessions')
  if (!existsSync(dir)) return { activeId: null, sessions: [] }
  const sessions: ChatSessionMeta[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    try {
      const m = parseSessionMeta(readFileSync(join(dir, f), 'utf8'))
      if (m) sessions.push(m)
    } catch {
      /* skip an unreadable session file */
    }
  }
  sessions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest first
  return { activeId: sessions[0]?.id ?? null, sessions }
}
function writeChatIndex(idx: ChatIndex): void {
  mkdirSync(chatDir(), { recursive: true })
  writeFileSync(chatIndexPath(), JSON.stringify(idx), 'utf8')
}
/** Upsert a session's meta in the index — update in place, or prepend a new one (newest first). */
function upsertIndexMeta(meta: ChatSessionMeta): void {
  const idx = readChatIndex()
  const sessions = idx.sessions.some((s) => s.id === meta.id) ? idx.sessions.map((s) => (s.id === meta.id ? meta : s)) : [meta, ...idx.sessions]
  writeChatIndex({ activeId: idx.activeId, sessions })
}
/** Serialize a session to its `.jsonl` (meta + history + slimmed, count-capped events). */
function writeSessionFile(session: ChatSession): void {
  mkdirSync(join(chatDir(), 'sessions'), { recursive: true })
  const capped: ChatSession = { ...session, events: session.events.slice(-300).map(slimEvent) } // same count + payload cap the monolith used
  writeFileSync(chatSessionPath(session.id), serializeSession(capped).join('\n') + '\n', 'utf8')
}
/** One-time: migrate a legacy monolithic `.nvs/chat.json` into per-session files, then delete it. */
function migrateChatStore(): void {
  if (!current || existsSync(chatIndexPath())) return // already on the new layout
  const legacy = join(current.root, '.nvs', 'chat.json')
  if (!existsSync(legacy)) return
  try {
    const { sessions, activeId } = normalizeLegacyChat(JSON.parse(readFileSync(legacy, 'utf8')), randomUUID, new Date().toISOString())
    for (const s of sessions) writeSessionFile(s)
    writeChatIndex({ activeId, sessions: sessions.map(toMeta) })
    rmSync(legacy, { force: true }) // fully represented by the per-session files now
  } catch {
    /* leave the legacy file untouched on any error — no data loss */
  }
}

/** The picker's data: session metas (empty bodies) + the active id. Runs the one-time legacy migration first. */
export function listChatSessions(): ChatStore {
  if (!current) return { sessions: [], activeId: null }
  migrateChatStore()
  const idx = readChatIndex()
  return { sessions: idx.sessions.map((m) => ({ ...m, history: [], events: [] })), activeId: idx.activeId }
}

/** One session's full body (history + events), or null if its file is gone (pruned/deleted). */
export function readChatSession(id: string): ChatSession | null {
  if (!current || !existsSync(chatSessionPath(id))) return null
  try {
    return parseSession(readFileSync(chatSessionPath(id), 'utf8'))
  } catch {
    return null
  }
}

/** Chars kept from a non-status tool result / big tool input when persisting an event (a preview for the trace). */
const MAX_EVENT_CHARS = 2000

/**
 * Slim an event for PERSISTENCE. Tool results are stored verbatim, but a single `listStoryTree` result is ~240KB
 * and the transcript UI reads only `{ ok, written, error }` from it (ChatPanel) — so a heavy agent run bloated
 * chat.json to 4.4MB (73 fat tool_result payloads). Keep just the fields the UI shows; for a non-status result
 * (a read tool's data) keep a short preview. The full payload was only ever needed in the model's turn context.
 */
function slimEvent(e: AgentEvent): AgentEvent {
  if (e.type === 'tool_result') {
    const r = e.result
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const src = r as Record<string, unknown>
      const keep: Record<string, unknown> = {}
      for (const k of ['ok', 'written', 'rebuilt', 'error', 'taskId', 'path']) if (k in src) keep[k] = src[k]
      if (Object.keys(keep).length > 0) return { ...e, result: keep }
    }
    const s = typeof r === 'string' ? r : JSON.stringify(r ?? null)
    return s.length > MAX_EVENT_CHARS ? { ...e, result: s.slice(0, MAX_EVENT_CHARS) + `…[${s.length - MAX_EVENT_CHARS} chars truncated on save]` } : e
  }
  if (e.type === 'tool') {
    const s = JSON.stringify(e.input ?? null)
    if (s.length > MAX_EVENT_CHARS) return { ...e, input: s.slice(0, MAX_EVENT_CHARS) + '…[truncated on save]' }
  }
  return e
}

/** Persist ONE session — its `.jsonl` body (count + payload capped) plus its meta in the index. */
export function writeChatSession(session: ChatSession): boolean {
  if (!current) return false
  try {
    writeSessionFile(session)
    upsertIndexMeta(toMeta(session))
    return true
  } catch {
    return false
  }
}

/** Point the active session (index only — no body write). */
export function setActiveChatSession(id: string | null): boolean {
  if (!current) return false
  try {
    writeChatIndex({ ...readChatIndex(), activeId: id })
    return true
  } catch {
    return false
  }
}

/** Delete ONE session (its file + index meta); re-point active to the newest survivor if it was the active one. */
export function deleteChatSession(id: string): boolean {
  if (!current) return false
  try {
    rmSync(chatSessionPath(id), { force: true })
    const idx = readChatIndex()
    const sessions = idx.sessions.filter((s) => s.id !== id)
    writeChatIndex({ activeId: idx.activeId === id ? (sessions[0]?.id ?? null) : idx.activeId, sessions })
    return true
  } catch {
    return false
  }
}

/** Does a path look like an NVS work? (used by the openWork IPC validation) */
export function isWork(root: string): boolean {
  return existsSync(root) && library.isWork(root)
}

// ── Editor: scene files ──────────────────────────────────────────────────────

/** A path is in-bounds only if it resolves inside the open work's folder. */
function withinWork(path: string): boolean {
  if (!current) return false
  const root = resolve(current.root)
  const p = resolve(path)
  return p === root || p.startsWith(root + sep)
}

export function listScenes(): SceneFile[] {
  return current ? scenes.listScenes(current.root) : []
}

export function readScene(path: string): SceneDoc {
  if (!withinWork(path)) throw new Error('refused: path outside the open work')
  return scenes.readScene(path)
}

export function writeScene(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): boolean {
  if (!withinWork(path)) throw new Error('refused: path outside the open work')
  scenes.writeScene(path, frontmatter, body)
  return true
}

export function stringifyScene(frontmatter: Record<string, unknown>, body: string): string {
  return scenes.stringifyScene(frontmatter, body)
}

export function writeSceneRaw(path: string, text: string): boolean {
  if (!withinWork(path)) throw new Error('refused: path outside the open work')
  scenes.writeSceneRaw(path, text)
  return true
}

export function createScene(
  chapterSlug: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): SceneFile | null {
  if (!current) return null
  return scenes.createScene(current.root, chapterSlug, id, frontmatter, body)
}

export function listWorldPages(): WorldPage[] {
  return current ? world.listWorldPages(current.root) : []
}

/** World pages whose body links to `pageId` (the "Mentioned by" backlinks). */
export function worldBacklinks(pageId: string): WorldPage[] {
  return current ? world.worldBacklinks(current.root, pageId) : []
}

// ── Story tree (free-form folders under content/story) ────────────────────────

export function listStoryTree(): StoryNode[] {
  return current ? storyTree.listStoryTree(current.root) : []
}
export function setFolderType(folderRel: string, type: string | null): boolean {
  return current ? storyTree.setFolderType(current.root, folderRel, type) : false
}

export function createFolder(parentRel: string, name: string, type?: string): string | null {
  return current ? storyTree.createFolder(current.root, parentRel, name, type) : null
}
export function renamePath(fromRel: string, toRel: string): boolean {
  return current ? storyTree.renamePath(current.root, fromRel, toRel) : false
}
export function deletePath(rel: string): boolean {
  if (!current) return false
  const ok = storyTree.deletePath(current.root, rel)
  if (ok) {
    // T5 delete GC: drop the now-deleted scene_ids from every tree variant + GC their analysis rows (`live` = the
    // scenes still on disk; an archived scene is still on disk, so it survives and keeps bridging).
    const live = new Set<string>()
    const walk = (ns: StoryNode[]): void => { for (const n of ns) { if (n.type === 'scene') live.add(n.sceneId ?? n.name); else if (n.children) walk(n.children) } }
    walk(storyTree.listStoryTree(current.root))
    pruneOrphans(current.root, live)
  }
  return ok
}
export function setOrder(folderRel: string, names: string[]): boolean {
  return current ? storyTree.setOrder(current.root, folderRel, names) : false
}
export function createSceneInFolder(
  folderRel: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): string | null {
  return current ? storyTree.createSceneInFolder(current.root, folderRel, id, frontmatter, body) : null
}

// ── Timeline layout (.nvs/timeline.json) ─────────────────────────────
// Since T11 this file holds ONLY the project-wide view (overlay-layer toggles). The CANVAS — placed nodes +
// collapse — lives per tree variant in `.nvs/trees.json`, so each variant owns its own layout. Old projects were
// converted on disk by `npm run migrate:canvas` (2026-07-17); no in-app back-compat is carried.

const EMPTY_TIMELINE: TimelineLayout = { version: TIMELINE_VERSION, view: DEFAULT_TIMELINE_VIEW }

export function readTimeline(): TimelineLayout {
  if (!current) return EMPTY_TIMELINE
  const p = join(current.root, '.nvs', 'timeline.json')
  if (!existsSync(p)) return EMPTY_TIMELINE
  try {
    const blob = (JSON.parse(readFileSync(p, 'utf8')) ?? {}) as Partial<TimelineLayout>
    return { version: TIMELINE_VERSION, view: blob.view ?? DEFAULT_TIMELINE_VIEW }
  } catch {
    return EMPTY_TIMELINE
  }
}

export function writeTimeline(layout: TimelineLayout): boolean {
  if (!current) return false
  const dir = join(current.root, '.nvs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(layout, null, 2), 'utf8')
  return true
}

/**
 * Heal EVERY variant's canvas against the current story tree: the stable `folderId` wins over the (possibly
 * renamed/moved) path — a renamed folder keeps its placement instead of orphaning. Legacy nodes get their id
 * stamped; nodes whose folder is gone are dropped (no broken cards); collapse entries for dead rels are pruned.
 * Persists when anything changed, so the heal sticks. (Was `healTimeline` over the old project-wide canvas —
 * moved here with the canvas itself in T11, and now covers ALL variants, not just the one you're looking at.)
 */
function healTrees(t: TreesFile): TreesFile {
  if (!current) return t
  const byId = new Map<string, string>() // folderId → current relPath
  const byRel = new Map<string, string>() // current relPath → folderId
  const index = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue
      if (n.folderId) {
        byId.set(n.folderId, n.relPath)
        byRel.set(n.relPath, n.folderId)
      }
      index(n.children ?? [])
    }
  }
  index(storyTree.listStoryTree(current.root))

  let changed = false
  const variants = t.variants.map((v) => {
    if (!v.nodes && !v.collapsed) return v
    const nodes = (v.nodes ?? []).flatMap((n): TimelineNode[] => {
      if (n.kind !== 'folder') return [n]
      const liveRel = n.folderId ? byId.get(n.folderId) : undefined
      if (liveRel != null) {
        if (liveRel === n.folderRel) return [n]
        changed = true
        return [{ ...n, folderRel: liveRel }] // renamed/moved → follow the id
      }
      const id = byRel.get(n.folderRel)
      if (id) {
        changed = true
        return [{ ...n, folderId: id }] // legacy node → stamp its id
      }
      changed = true
      return [] // folder is gone → drop the orphan card
    })
    const collapsed = (v.collapsed ?? []).filter((r) => byRel.has(r))
    if (collapsed.length !== (v.collapsed ?? []).length) changed = true
    return { ...v, nodes, collapsed }
  })
  if (!changed) return t
  const healed = { ...t, variants }
  writeTrees(current.root, healed)
  return healed
}

export function trees(): TreesFile {
  return current ? healTrees(readTrees(current.root)) : { version: 1, activeId: undefined, variants: [] }
}

export function saveTrees(t: TreesFile): boolean {
  if (!current) return false
  writeTrees(current.root, t)
  return true
}

export function corkboard(): CorkboardFile {
  return current ? readCorkboard(current.root) : { version: 1, activeId: undefined, boards: [] }
}

export function saveCorkboard(file: CorkboardFile): boolean {
  if (!current) return false
  writeCorkboard(current.root, file)
  return true
}

// Agent read-access to the corkboard (skim → drill; read-only — the board is the author's private sketch).
export function listBoards(): unknown {
  return boardsOverview(corkboard())
}
export function readBoard(boardId: string): unknown {
  return boardSkeleton(corkboard(), boardId)
}
export function readCard(boardId: string, cardId: string): unknown {
  return cardDetail(corkboard(), boardId, cardId)
}

/** Agent/host semantic edits of the story graph — connect/disconnect scenes in a tree variant (active by default). */
export function connectScenes(from: string, to: string, variantId?: string): { ok: boolean; error?: string } {
  return current ? treesConnectScenes(current.root, from, to, variantId) : { ok: false, error: 'no open work' }
}
export function disconnectScenes(from: string, to: string, variantId?: string): { ok: boolean; error?: string } {
  return current ? treesDisconnectScenes(current.root, from, to, variantId) : { ok: false, error: 'no open work' }
}
/** Wire MANY edges (a whole route) into a variant in one call, auto-placing the scenes so the result is visible. */
export function connectScenesBatch(
  edges: ReadonlyArray<{ from: string; to: string }>,
  opts?: { variantId?: string; place?: boolean }
): { added: number; skipped: Array<{ from: string; to: string; error: string }>; placed: number } {
  if (!current) return { added: 0, skipped: [], placed: 0 }
  return treesConnectScenesBatch(current.root, edges, opts?.variantId, opts?.place ?? true, storyTree.listStoryTree(current.root))
}

/** Add a new tree variant (alternate timeline) — blank by default, or cloned from the active one. */
export function createVariant(opts?: { name?: string; from?: 'active' | 'empty'; activate?: boolean }): {
  ok: boolean
  id?: string
  name?: string
  activated?: boolean
  error?: string
} {
  return current ? treesCreateVariant(current.root, opts) : { ok: false, error: 'no open work' }
}

/** Delete a scene or world page (`.md`) by path. Guarded to stay inside the open work. */
export function deletePage(path: string): boolean {
  if (!withinWork(path)) throw new Error('refused: path outside the open work')
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

export function createWorldPage(
  kind: WorldPage['kind'],
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): WorldPage | null {
  if (!current) return null
  return world.createWorldPage(current.root, kind, id, frontmatter, body)
}

/** T1 ingest: re-parse changed scene files → update the co-located DB. */
export function ingestWork(): IngestResult {
  if (!current) return { chapters: 0, scenes: 0, dialogNodes: 0, changed: 0, skipped: 0 }
  const result = ingest(current.root, current.workId, current.name)
  pruneOrphanThreadsImpl(current.root) // self-heal beat-less umbrellas left by an earlier re-read (cheap, idempotent)
  return result
}

/** T2/T3 producer write — the keystone (internal/write-tier.md). */
export function writeTier(p: TierWrite): TierWriteResult {
  if (!current) return { ok: false, runId: '', written: {}, rebuilt: [], error: 'no work open' }
  return writeTierImpl(current.root, current.workId, p)
}

/** Fold duplicate threads into one (the earliest opener wins) — repoints events/refs in a single transaction. */
export function mergeThreads(threadIds: string[]): MergeResult {
  if (!current) return { ok: false, error: 'no work open' }
  return mergeThreadsImpl(current.root, threadIds)
}

/** The digest reduce inputs for one reducible unit (working-set M2) — the reader's payload + its hash. */
export function digestInputs(unitId: string): { title: string; parts: { title: string; text: string }[]; inputHash: string } {
  if (!current) return { title: unitId, parts: [], inputHash: '' }
  return digestInputsImpl(current.root, unitId)
}

/** Persist one reduced digest (records the hash the reduce consumed — the staleness ledger for rollups). */
export function applyDigest(unitId: string, body: string, model: string | null, inputHash: string): void {
  if (current) writeDigestImpl(current.root, unitId, body, model, inputHash)
}

/** One profile chain link's reduce inputs (working-set M3). */
export function profileInputs(entityId: string, chapterId: string): { name: string; chapterTitle: string; prevProfile: string; increment: string; inputHash: string } {
  if (!current) return { name: entityId, chapterTitle: chapterId, prevProfile: '', increment: '', inputHash: '' }
  return profileInputsImpl(current.root, entityId, chapterId)
}

/** Persist one profile link (records the hash the reduce consumed). */
export function applyProfile(entityId: string, chapterId: string, body: string, model: string | null, inputHash: string): void {
  if (current) writeProfileImpl(current.root, entityId, chapterId, body, model, inputHash)
}

/** The scene pass's STORY SO FAR: hierarchical digest blocks before this scene + the hot-window cutoff. */
export function storySoFar(sceneId: string): { blocks: { title: string; text: string }[]; hotCutoffPos: number } {
  return current ? storySoFarImpl(current.root, sceneId) : { blocks: [], hotCutoffPos: 0 }
}

/** A unit's current story-so-far digest (stored reduction, or the free leaf concat). */
export function digestFor(unitId: string): string {
  return current ? digestForImpl(current.root, unitId) : ''
}

/** LLM build cache (working-set): memoize completions by prompt hash → deterministic-by-cache replay.
 *  Get returns the cached response for (system,user,model), or null on a miss. */
export function llmCacheGet(system: string, user: string, model: string): string | null {
  if (!current) return null
  return getCachedImpl(current.root, promptHashImpl(system, user, model))
}
export function llmCachePut(system: string, user: string, model: string, response: string): void {
  if (current) putCachedImpl(current.root, promptHashImpl(system, user, model), model, response)
}
/** Drop a poisoned cache entry (a reply that no longer validates) so the next call re-fetches. */
export function llmCacheEvict(system: string, user: string, model: string): void {
  if (current) evictCachedImpl(current.root, promptHashImpl(system, user, model))
}

/** The Lore pivot's payload — per-topic disclosure ledgers + the story clock. */
export function listLoreView(): LoreView {
  return current ? queries.listLoreView(current.root) : { topics: [], clock: [] }
}

/** Existing lore topics (working-set capped) — the scene reader's anti-dupe grounding for lore extraction. */
export function listKnownLore(cutoffPos?: number): Array<{ loreId: string; summary: string }> {
  return current ? queries.listKnownLore(current.root, cutoffPos) : []
}


/** All scene-anchored evidence for one cast-graph edge (the range-aware relationship dialog). */
export function relationshipEvidence(aId: string, bId: string): RelationshipEvidence {
  if (!current) return { a: { id: aId, name: aId }, b: { id: bId, name: bId }, declared: { a: [], b: [] }, coScenes: [], events: [] }
  return relationshipEvidenceImpl(current.root, aId, bId)
}

/** Fold duplicate entities into one — the Entity roster's merge action (semantic dupes are the author's call). */
export function mergeEntities(entityIds: string[]): MergeResult {
  if (!current) return { ok: false, error: 'no work open' }
  return mergeEntitiesImpl(current.root, entityIds)
}

/** Export the open project to a `.nvsproj` bundle (main supplies the chosen path + app version). */
export function exportProject(outFile: string, appVersion: string): ExportResult {
  if (!current) return { ok: false, error: 'no work open' }
  return exportProjectImpl(current.root, outFile, appVersion)
}

/** Export the open project's manuscript (content/) to a plain `.zip` (main supplies the chosen path). */
export function exportManuscriptZip(outFile: string): ExportResult {
  if (!current) return { ok: false, error: 'no work open' }
  return exportManuscriptZipImpl(current.root, outFile)
}

/** Export one scene's `.md` to a chosen path (guarded to the open project). */
export function exportSceneFile(scenePath: string, outFile: string): ExportResult {
  if (!current) return { ok: false, error: 'no work open' }
  return exportSceneFileImpl(current.root, scenePath, outFile)
}

/** Fork a (closed) project — an independent library copy that records its parent. */
export function forkProject(sourcePath: string): ImportResult {
  return forkProjectImpl(sourcePath)
}

/** Import a `.nvsproj` as a new project in the library. */
export function importProject(bundleFile: string): ImportResult {
  return importProjectImpl(bundleFile)
}

/** Serialize the OPEN project's prose to the structured interchange TEXT (json/csv) — matches nvs-parser. */
export function serializeStructured(format: 'json' | 'csv'): string {
  if (!current) throw new Error('no project open')
  return serializeStructuredImpl(current.root, format)
}

/** Serialize ONE scene of the open project (json/csv = same envelope, scoped · md = the file verbatim). */
export function serializeSceneStructured(scenePath: string, format: 'json' | 'csv' | 'md' | 'srt'): string {
  if (!current) throw new Error('no project open')
  return serializeSceneStructuredImpl(current.root, scenePath, format)
}

/** Import an nvs-parser structured JSON as a new library project. */
export function importStructured(jsonText: string, title: string): ImportResult {
  return importStructuredImpl(jsonText, title)
}

/** The open project's authored metadata (.nvs/project.json, root fallback); {} if none yet. Normalized: scalar
 *  array-fields (e.g. a drifted `inLanguage: "en"`) are coerced to arrays so consumers can trust the contract. */
export function readProjectInfo(): ProjectInfo {
  return current ? loadProjectInfo(current.root) : {}
}

/** The open project's structure (world + scene); world annotated with live entity counts — Project Config / rails. */
export function readStructure(): StructureView {
  if (!current) return { world: [], scene: [] }
  const s = readStructureImpl(current.root)
  const counts = queries.entityCountsByType(current.root)
  return {
    world: s.world.map((c) => ({ ...c, count: counts.get(c.key) ?? 0 })),
    scene: s.scene.map((c) => ({ key: c.key, label: c.label, description: c.description }))
  }
}

/** Apply an edited structure (world + scene category keys, e.g. from a template) → persist + return it. */
export function writeStructure(worldKeys: string[], sceneKeys: string[]): StructureView {
  if (!current) return { world: [], scene: [] }
  writeStructureImpl(current.root, worldCategoriesFor(worldKeys), sceneCategoriesFor(sceneKeys))
  return readStructure()
}

/** Any project's authored metadata by folder path (for the library preview — no need to open the work). Normalized
 *  + root-fallback, same as readProjectInfo. {} if none. */
export function readProjectInfoAt(root: string): ProjectInfo {
  return loadProjectInfo(root)
}

/** Merge a patch into the open project's metadata, stamp updatedAt, persist; returns the merged result. */
export function writeProjectInfo(patch: Partial<ProjectInfo>): ProjectInfo {
  if (!current) return {}
  const next: ProjectInfo = { ...readProjectInfo(), ...patch, updatedAt: new Date().toISOString() }
  try {
    const dir = join(current.root, '.nvs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'project.json'), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* read-only — in-memory only */
  }
  return next
}

/** The engine-owned input hash for a tier target (shared by writer + staleness detector). */
export function tierInputHash(kind: TierKind, targetId: string, asOf: string | null): string {
  if (!current) return ''
  return tierInputHashImpl(current.root, kind, targetId, asOf)
}

/** The Ingest dock tracer: every scene's fresh/stale/pending status. */
export function listTierStatus(): TierStatusRow[] {
  if (!current) return []
  return tierStatusImpl(current.root)
}

/** Apply an ingestion bundle (.nvs/ingest/<name>.json) through writeTier. */
export function runIngestBundle(name: string): TierWriteResult[] {
  if (!current) return [{ ok: false, runId: '', written: {}, rebuilt: [], error: 'no work open' }]
  return runIngestBundleImpl(current.root, current.workId, name)
}

/** List available ingestion bundles. */
export function listIngestBundles(): string[] {
  if (!current) return []
  return listIngestBundlesImpl(current.root)
}

// ── Ingest run primitives (the main-process runner orchestrates these; see main/ai/ingestRunner.ts) ──

/** Plan the next run's steps (+ the entry that fulfils each, main-side only). `forceScenes` re-reads chosen
 *  fresh scenes too (the manual re-analyze path). */
export function planIngestSteps(forceScenes?: string[], depth: 'skim' | 'full' = 'full'): PlanItem[] {
  return current ? planIngestStepsImpl(current.root, forceScenes, depth) : []
}

/** Pack a scene frontier into output-bounded batches for the batched-extraction reader (the scene phase).
 *  `targetOutTokens` = the backend-adaptive per-batch output budget (batchOutBudget) — small on the slow
 *  plan host so a batch fits the turn watchdog, cap-bound on fast APIs. */
export function planExtractionBatches(sceneIds: string[], targetOutTokens?: number, depth: 'skim' | 'full' = 'full'): ReturnType<typeof planExtractionBatchesImpl> {
  return current ? planExtractionBatchesImpl(current.root, sceneIds, targetOutTokens != null ? { targetOutTokens } : {}, depth) : []
}

/** Record one batch's realized output volume vs its dialogue volume, so the packer learns THIS project's k. */
export function recordExtractionSample(depth: 'skim' | 'full', dialogueChars: number, outChars: number): void {
  if (current) recordExtractionSampleImpl(current.root, depth, dialogueChars, outChars)
}

/** Apply one planned entry (one writeTier txn). */
export function applyEntry(entry: PlanItem['entry']): TierWriteResult {
  if (!current) return { ok: false, runId: '', written: {}, rebuilt: [], error: 'no work open' }
  if (!entry) return { ok: false, runId: '', written: {}, rebuilt: [], error: 'no entry to apply' }
  return applyEntryImpl(current.root, current.workId, entry)
}

/**
 * Reset the DERIVED analysis to a clean slate, rebuilt from the manuscript — the safe escape hatch when
 * the ledger drifts from the files (e.g. a re-coded scene_id leaves dangling refs). Non-destructive:
 *   1. back up the whole `.nvs/` to `.nvs.bak-<ts>/` (nothing is ever lost),
 *   2. remove only the LIVE derived DB (+ WAL sidecars) — KEEPING user-authored state (ui-state / chat /
 *      timeline layout JSON, ingest bundles) AND the version snapshots in place,
 *   3. re-ingest T1 from the current files (recreates a fresh DB). T2/T3 (AI) is re-run later by the author.
 * The manuscript (content/*) is never touched — it's the source of truth; the ledger is fully derived.
 *
 * Snapshots are NOT deleted: they're independent, frozen, read-only copies of past analysis (expensive AI
 * work, NOT re-derivable), and each session in `ingest-runs.json` references one by id. Wiping `snapshots/`
 * while leaving the ledger orphaned every past version ("can't view any previous version"). A drifted
 * snapshot can't hurt the rebuilt live DB — it's only ever read read-only (timetravel) or a deliberate restore.
 */
export function resetAnalysis(): ResetAnalysisResult {
  if (!current) return { ok: false, backupDir: null, ingest: null, error: 'no work open' }
  const nsDir = join(current.root, '.nvs')
  let backupDir: string | null = null
  try {
    if (existsSync(nsDir)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
      backupDir = join(current.root, `.nvs.bak-${stamp}`)
      cpSync(nsDir, backupDir, { recursive: true }) // full, recoverable backup BEFORE we remove anything
      for (const f of RESET_DELETE_FILES) {
        rmSync(join(nsDir, f), { force: true })
      }
      // Everything else in .nvs/ is KEPT — authored sidecars + local snapshots (version history the ledger
      // references, not rederivable). The keep/delete line is declared ONCE in nvsArtifacts.ts, not here.
    }
    const ingestResult = ingestWork() // recreates the DB + T1 from the current manuscript
    return { ok: true, backupDir, ingest: ingestResult }
  } catch (e) {
    return { ok: false, backupDir, ingest: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Snapshot the co-located DB before a run; returns the snapshot id (or null if no DB yet). */
export function snapshotDb(label: string): string | null {
  return current ? snapshotDbImpl(current.root, label) : null
}

/** Restore the live DB to a past version + move the current pointer to it (reversible). */
export function restoreVersion(sessionId: string): boolean {
  return current ? restoreVersionImpl(current.root, sessionId) : false
}

/** The run history (newest first). */
export function listSessions(): IngestSession[] {
  return current ? listSessionsImpl(current.root) : []
}

/** Sessions for an ARBITRARY work root (not the open one) — the universal Jobs history aggregates every
 *  library work's ledger without opening each. Read-only JSON, safe on any path. */
export function sessionsFor(workRoot: string): IngestSession[] {
  try {
    return listSessionsImpl(workRoot)
  } catch {
    return []
  }
}

/** The version the live DB currently reflects (the "you are here" pointer). */
export function currentVersion(): string | null {
  return current ? currentVersionImpl(current.root) : null
}

/**
 * Timetravel: point the analysis READ queries at a version's snapshot (read-only), or null for live.
 * Resolves the snapshot to a head-migrated readable path so today's read SQL doesn't hit a stale schema;
 * returns false when the version can't be viewed (snapshot pruned) so the caller can stay live + tell the user.
 */
export function setViewingVersion(snapshotId: string | null): boolean {
  if (!snapshotId || !current) {
    queries.setViewSnapshot(null)
    return true
  }
  const path = snapshotViewPath(current.root, snapshotId)
  queries.setViewSnapshot(path) // null → reads fall back to live; the false return tells the caller
  return path != null
}

/** Append a finished run to the history log. */
export function recordSession(s: IngestSession): void {
  if (current) recordSessionImpl(current.root, s)
}

/** Drop thread umbrellas left beat-less by a re-read (run once at end of a pass). Returns rows removed. */
export function pruneOrphanThreads(): number {
  return current ? pruneOrphanThreadsImpl(current.root) : 0
}

/** Stamp the analysis with the current `leads_to` graph version (run once at end of a pass, before snapshot).
 *  Returns the version id. */
export function stampTimelineVersion(): string {
  return current ? stampTimelineVersionImpl(current.root) : ''
}

/** Is the on-disk analysis for the current `leads_to` graph, or stale? (+ cycle) — drives the loadout picker. */
export function timelineStatus(): TimelineStatus {
  return current ? timelineStatusImpl(current.root) : { currentVersion: '', ranVersion: null, stale: false, hasAnalysis: false, cycle: null }
}

/** Did this scene's dialogue actually change since its last analysis? (cascade only on real edits). */
export function sceneInputChanged(unitId: string): boolean {
  return current ? sceneInputChangedImpl(current.root, unitId) : false
}

/** Is the scene's current (pre-apply) extraction a skim read? → a full re-read is a skim→full upgrade. */
export function sceneWasSkim(unitId: string): boolean {
  return current ? sceneWasSkimImpl(current.root, unitId) : false
}

/** Flag every scene after `unitId` Outdated (an edited scene can shift the downstream story-so-far). */
export function markDownstreamStale(unitId: string): number {
  return current ? markDownstreamStaleImpl(current.root, unitId) : 0
}
