/**
 * The AI capability catalog — the ONE declarative source the agent adapters consume.
 *
 * Both the in-app agent runner (host/BYO-key) and the MCP server (connect-an-agent) build their
 * tool lists from this; the engine binding lives once in src/main/ai/dispatch.ts. Adding/changing
 * a tool or the prompt happens here, not in either adapter — the "standardize from config" rule.
 *
 * Pure data (zod input shapes + strings); no engine imports, so it stays portable/inspectable.
 */
import { z } from 'zod'

/** A tool the AI may call. `input` is a zod raw shape (MCP uses it directly; the agent converts to JSON Schema). */
export interface ToolDef {
  name: string
  description: string // ONE sentence + contract + defaults (tool-surface.md diet) — routing lives in the ladder + the two fields below
  input: z.ZodRawShape
  write?: boolean // true = mutates the work/DB (for UI badging + future capability gating)
  argsFrom?: string // which tool(s) hand you this tool's args — the discover→act closure, stated per tool
  verifyWith?: string // the oracle to run after this act — the act→verify closure
}

/** The description as sent over the wire — the dieted sentence plus the two routing facts, rendered
 *  uniformly so every adapter (chat schemas, MCP registration, plan host) teaches the same closure. */
export function wireDesc(t: ToolDef): string {
  return [t.description, t.argsFrom ? `Args from: ${t.argsFrom}.` : '', t.verifyWith ? `Verify with: ${t.verifyWith}.` : ''].filter(Boolean).join(' ')
}

/** The per-kind row shapes for writeTier — documented for the model since `rows` is free-form. */
export const TIER_SHAPES_DOC = [
  'writeTier rows by kind:',
  '• scene (tier t2, targetId = scene unit_id): { extracted: { summary, premise(why it starts — the setup/hook, 1 sentence), conclusion(how it ends — outcome or cliffhanger, 1 sentence), pov(entity_id|null), characters[], locations[], plotTimes[], goals[{actor,goal,status}], conflicts[{between[],over,kind}], enters[{entity,kind}], exits[{entity,kind,reversible?}], sceneContexts[] }, threads: [{ threadId, subject|null, action(open|advance|resolve|reopen|supersede), sortPos|null, evidence|null, confidence|null, description|null, umbrella?{description,threadType?,builtBy?,resolutionCondition?,succeeds?} }], lore: [{ loreId, summary, magnitude?, builtBy? }] }',
  '• window (t2, targetId = entity_id, asOfUnitId = chapter unit_id): { window: { summary }, arcEvents: [{ category, change(gain|loss|expose), value, description, sceneId }] }',
  '• coherence (t3, targetId = entity_id, asOfUnitId = checkpoint unit_id): { findings: [{ trait, declared, observed, kind(drift|gap|contradiction|confirmation), severity(low|medium|high), suggestion, evidence[], why? }] }'
].join('\n')

export const SYSTEM_PROMPT = [
  'You are the in-house story editor inside Novel Visual Studio, a writing IDE for dialogue-driven fiction —',
  'a sharp, warm collaborator who knows this manuscript intimately. Talk like a trusted editor, not a report',
  'generator: lead with the insight, have a point of view, be specific and a little human. Stay tight — earn',
  'every line — but never robotic. You can be encouraging and opinionated about what’s working and what isn’t.',
  'You act on the currently open work through tools — the same engine the app UI uses. The app stamps',
  'provenance + input hashes and validates every write; you only propose content.',
  '',
  'THE ROUTING LADDER — find → read → act → verify:',
  '1. FIND first. `search` locates anything by name or prose and is the ONLY authority on existence.',
  'Never conclude something is absent from a list/tree/SQL result — empty, truncated, or `partial` results',
  'are size artifacts, not proof.',
  '2. READ before acting. Fetch detail only for refs you will use, via the semantic tool whose name matches',
  'the noun: cast→listCast · lore→listLoreView · threads→listThreads · arcs→listCharacterArcs ·',
  'plot problems→listCoherenceFindings · the author’s plans→listBoards/readBoard.',
  '3. ACT only with refs you were handed. Tool results contain the exact ids/paths/titles the act tools',
  'accept — copy them, never invent or hand-build one. A bare name beats a constructed path (folders resolve',
  'forgivingly). Bulk edits are ONE call with `folder`, never a per-scene loop.',
  '4. VERIFY after acting, with the oracle each act tool names (`Verify with:`), and cite what you verified.',
  '5. On a tool ERROR, apply its correction verbatim — errors return `valid` (real alternatives) and `next`',
  '(the literal retry). Never re-guess what an error already corrected.',
  '',
  'PLAN BEFORE YOU CALL: when a request needs tools, state the plan in ONE line (which tools, what order),',
  'then call — and read each result before the next step.',
  'COMPLETION AUDIT: done is unproven until checked against the work — cite the scenes/rows/checks you',
  'actually read, and confirm a write landed before reporting it done. NEVER report acting on a different',
  'target than the author named: if a ref resolved to something else (the result’s `note` says so) or you',
  'substituted a target yourself, state the substitution explicitly and let the author confirm.',
  'BLOCKED AUDIT: say you are blocked only after the SAME blocker has failed three times — and then say',
  'plainly what blocks you. A partial, cited answer always beats another speculative read.',
  '',
  'PAGE WORK — pick by state: EDIT an existing page → queuePageEdit (background edits the author reviews;',
  'you orchestrate, you don’t write the prose). CREATE a new page → createPage (stamped AI-generated; never',
  'append a new page onto an unrelated existing one). AUTHORIAL JUDGMENTS — canon status (setPhase),',
  'coherence rulings (setRuling), dedup merges (mergeThreads/mergeEntities), and restructuring',
  '(moveStoryPaths then removeEmptyStoryFolders) — happen ONLY on the author’s explicit instruction, never',
  'on your own initiative; for restructuring, show the exact from→to plan and get confirmation first.',
  '',
  'NAMES — never make the author decode raw ids. Refer to scenes and pages by their human TITLE; resolve any',
  'unit_ids/codes (e.g. "S8", "od-c1-s3") to the matching scene first. If you can’t resolve a code to a',
  'title, say so plainly rather than printing the raw code.',
  '',
  'Answer greetings or simple/off-topic questions directly in one line — do NOT call tools unless the request is actually about the open work or its analysis.',
  '',
  TIER_SHAPES_DOC
].join('\n')

const empty: z.ZodRawShape = {}

/** The catalog. Read tools first, the write keystone last. */
export const TOOL_CATALOG: ToolDef[] = [
  { name: 'currentProject', description: 'The open work (root, id, counts), or null.', input: empty },
  { name: 'mcpStats', description: "DEBUG — the engine's in-memory read-cache counters (scenes / storyTree / worldPages / timelineGraph memos). Returns { slot: { hits, misses, lastBuildMs, primed } }: a HIT reused the cache, a MISS rebuilt it (a write or external edit changed the fingerprint). Call it before and after a burst of repeated reads to confirm the cache is serving them without re-parsing — hits should climb while misses stay flat.", input: empty },
  { name: 'projectInfo', description: "The author's DECLARED project metadata (domain fiction|nonfiction, medium, status, genre[], themes, languages, title/logline, keywords) — read this before inferring any of it from content.", input: empty },
  { name: 'listScenes', description: 'Every scene file in the open work (path + meta).', input: empty },
  { name: 'search', description: 'THE finder — locate anything by name or prose (folders, scenes, world pages, custody topics), fuzzy + Unicode/CJK-aware. Returns pointer hits { kind, ref, name, matchedOn, snippet? } best-first, capped at `limit` (default 25); act on a hit’s `ref`.', input: { query: z.string(), limit: z.number().optional() } },
  { name: 'readScene', description: 'Read one scene — frontmatter + body.', argsFrom: 'search (a hit’s ref: path · relPath · scene_id · title all resolve)', input: { path: z.string() } },
  { name: 'exportFormat', description: 'Serialize ONE scene to text: md (Fountain verbatim) · json/csv (structured beats) · srt (cues per TIMED beat; an untimed scene returns empty content + a note — pick md/json instead).', argsFrom: 'search / listScenes (path)', input: { path: z.string(), format: z.enum(['md', 'json', 'csv', 'srt']) } },
  { name: 'listBoards', description: "The author's corkboards — freeform canvases of planned INTENT (not derived analysis): every board as { id, name, cardCount, edgeCount } + activeId.", input: empty },
  { name: 'readBoard', description: "One corkboard's skeleton (≤100 cards, no note bodies): nodes { id, title, color, noteCount, refs, degree } + hand-drawn edges. A card with a written-scene ref = done; a connected card without one = unwritten intent.", argsFrom: 'listBoards (boardId)', input: { boardId: z.string() } },
  { name: 'readCard', description: 'One corkboard card in full — every note body, refs, neighbor titles (the only place note text is returned).', argsFrom: 'readBoard (boardId + cardId)', input: { boardId: z.string(), cardId: z.string() } },
  { name: 'checkPageFormat', description: 'DETERMINISTIC Fountain-format oracle for one scene — flags residual colon-dialogue, markdown headings/bullets, [[wiki]] links, orphan cues. Returns { clean, issues[{ line, kind, msg }] }; each msg is the exact fix to cite when re-queueing.', argsFrom: 'queuePageEdit (the edited page’s path)', input: { path: z.string() } },
  { name: 'listStoryTree', description: 'The story folder tree (reading order) — a structural overview; on a large project returns folder paths only, marked `partial`.', input: empty },
  { name: 'listWorldPages', description: 'World-bible pages (cast, lore, locations).', input: empty },
  { name: 'listCustodyTopics', description: 'Authored CUSTODY pages (the Custody pillar, content/custody/) — who holds each item / who knows each secret, one topic per page. A SEPARATE list from listWorldPages. Each has a name + pageId + path; deep-link one with captureAsset/showPage by its name or pageId.', input: empty },
  { name: 'listThreads', description: 'All narrative threads — umbrella + status (T2).', input: empty },
  { name: 'listCoherenceFindings', description: 'Coherence findings — drift/gap/contradiction/confirmation (T3).', input: empty },
  { name: 'listCharacterArcs', description: "Every character's windowed arc (T2 windows + events).", input: empty },
  { name: 'listCast', description: 'The cast by occurrence (T1): every character + scene counts (speaking + silently present), most-present first.', input: empty },
  { name: 'listStructuralIssues', description: 'The deterministic structural oracle: duplicate scene_ids, dangling/self leads_to, missing ids, orphan scenes/pages — each with severity + path.', input: empty },
  { name: 'listChapterLedgers', description: 'The folded story hierarchy (fractal consolidation) — every chapter/act/book node as { chapterId, title, depth, status }; depth 0 = the top (whole-book) node. Read a node with readChapterLedger for the plot compressed to a page.', input: empty },
  { name: 'readChapterLedger', description: "One folded unit's Ledger: { premise, conclusion, entries[{net(opened|advanced|resolved|opened-and-resolved|reopened), threadId, description}], openAtEnd[], flags[] } — the reconciled thread movements for that chapter/act/book, with long arcs closed at the level they resolve and openAtEnd = its still-dangling promises. Pass a unitId from listChapterLedgers (depth 0 = the whole book).", input: { unitId: z.string() } },
  {
    name: 'queryDb',
    description:
      'ESCAPE HATCH: read-only SQL (one SELECT/WITH, ≤200 rows) over the analysis DB, for tallies/joins no ' +
      'semantic tool covers — try the matching list tool first. No file paths live here; scene_id = unit_id. ' +
      'A bad column/table returns the live schema + nearest valid columns (`valid`) + the retry (`next`) — apply that correction, don’t re-guess.',
    input: { sql: z.string() }
  },
  { name: 'listLoreView', description: 'Every lore topic — each world-fact’s disclosure ledger + retcon flags (T2). Use before merging near-duplicate topics.', input: empty },
  { name: 'listTierStatus', description: 'Per-scene analysis status — fresh/stale/pending (the ingest tracer).', input: empty },
  {
    name: 'tierInputHash',
    description: 'The engine input hash for a tier target (the writer recomputes it anyway).',
    input: { kind: z.enum(['scene', 'window', 'coherence']), targetId: z.string(), asOf: z.string().nullable() }
  },
  {
    name: 'writeTier',
    description:
      'Persist one inferred-tier target. Provide tier (t2|t3), kind (scene|window|coherence), targetId, ' +
      'asOfUnitId (chapter/checkpoint for window/coherence), and rows (see the kind shapes in the system prompt). ' +
      'The app stamps model + input_hash; the engine validates shape/refs/enums. Returns { ok, runId, written, rebuilt, error }.',
    write: true,
    argsFrom: 'listTierStatus (targetId + what is stale)',
    verifyWith: 'listTierStatus',
    input: {
      tier: z.enum(['t2', 't3']),
      kind: z.enum(['scene', 'window', 'coherence']),
      targetId: z.string(),
      asOfUnitId: z.string().nullable().optional(),
      rows: z.object({}).passthrough()
    }
  },
  {
    name: 'queuePageEdit',
    description:
      'Queue a background edit the author reviews in the Tasks inbox (you never see the result). Pass `path` ' +
      '(one page) OR `folder` (the same instruction on every scene beneath, in ONE call — names resolve ' +
      'forgivingly, so a bare folder name beats a hand-built path), plus `instruction` and mode append | replace. ' +
      'Returns { ok, taskId } or { ok, queued, taskIds }.',
    write: true,
    argsFrom: 'search (a hit’s ref), or the folder name as the author said it',
    verifyWith: 'checkPageFormat (after a reformat)',
    input: { path: z.string().optional(), folder: z.string().optional(), instruction: z.string(), mode: z.enum(['append', 'replace']) }
  },
  {
    name: 'createPage',
    description:
      'Create a NEW page (kind: scene | character | location | item | lore; name = title; folder, scenes only, ' +
      'defaults to story root; body = initial Markdown). Stamped AI-generated for the author to review; there is ' +
      'no delete tool — removal is the author’s job. Returns { ok, path }.',
    write: true,
    argsFrom: 'listStoryTree (folder relPath, scenes only)',
    input: { kind: z.enum(['scene', 'character', 'location', 'item', 'lore']), name: z.string(), folder: z.string().optional(), body: z.string().optional() }
  },
  {
    name: 'setPhase',
    description:
      'Set the content PHASE (draft | developing | canon | archived) — the canon gate: analysis reads only canon ' +
      'pages. AUTHORIAL: only on explicit request. Exactly ONE target: path · folder (recursive) · category (a ' +
      'world kind) · allScenes: true. Returns { ok, count }.',
    write: true,
    argsFrom: 'search / listStoryTree / listWorldPages',
    input: {
      phase: z.enum(['draft', 'developing', 'canon', 'archived']),
      path: z.string().optional(),
      folder: z.string().optional(),
      category: z.string().optional(),
      allScenes: z.boolean().optional()
    }
  },
  {
    name: 'readTree',
    description:
      'The TREE VARIANTS — the branch/merge graphs (each: adjacency = sceneId → its out-edges) + which is active. ' +
      'Scene connections live HERE (.nvs/trees.json), NOT in frontmatter leads_to. Read this to see how scenes connect.',
    input: empty
  },
  {
    name: 'connectScenes',
    description:
      'Connect fromSceneId → toSceneId in a tree variant (active unless variantId given) — the story graph lives ' +
      'here, never in frontmatter. Refuses self-links, duplicates, cycles. Returns { ok, error? }.',
    write: true,
    argsFrom: 'readTree / search (scene_ids)',
    verifyWith: 'readTree',
    input: { fromSceneId: z.string(), toSceneId: z.string(), variantId: z.string().optional() }
  },
  {
    name: 'connectScenesBatch',
    description:
      'Wire MANY connections in one call (prefer over repeated connectScenes). `edges` = { from, to } scene_id ' +
      'pairs; self-links/duplicates/cycles are skipped and reported. Places every mentioned scene on the canvas ' +
      'unless place:false. Active variant unless variantId given. Returns { added, skipped, placed }.',
    write: true,
    argsFrom: 'readTree / search (scene_ids)',
    verifyWith: 'readTree',
    input: {
      edges: z.array(z.object({ from: z.string(), to: z.string() })).max(1000), // bound input size — a route is at most hundreds of edges
      variantId: z.string().optional(),
      place: z.boolean().optional()
    }
  },
  {
    name: 'createVariant',
    description:
      'Create a NEW timeline variant — build a new route with createVariant then connectScenesBatch (it targets ' +
      'the now-active variant). from: "empty" (default) or "active" (clone to diverge); activate defaults true. ' +
      'Returns { ok, id, name, activated, error? }.',
    write: true,
    verifyWith: 'readTree',
    input: {
      name: z.string().optional(),
      from: z.enum(['empty', 'active']).optional(),
      activate: z.boolean().optional()
    }
  },
  {
    name: 'disconnectScenes',
    description: 'Remove the fromSceneId → toSceneId connection in a tree variant (active unless variantId is given). Returns { ok }.',
    write: true,
    argsFrom: 'readTree (scene_ids)',
    verifyWith: 'readTree',
    input: { fromSceneId: z.string(), toSceneId: z.string(), variantId: z.string().optional() }
  },
  {
    name: 'mergeThreads',
    description:
      'Merge 2+ near-duplicate threads (dedup): earliest-opened is kept; events, succeeds links, and findings ' +
      'repoint to it. Confirm they are truly the same promise first. Reversible via analysis history. Returns ' +
      '{ ok, canonicalId, merged, repointed, error }.',
    write: true,
    argsFrom: 'listThreads (threadIds)',
    verifyWith: 'listThreads',
    input: { threadIds: z.array(z.string()).min(2).max(100) }
  },
  {
    name: 'mergeEntities',
    description:
      'Merge 2+ ids that are the SAME character/item/faction; presence, arc events, and windows repoint to the ' +
      'survivor. Confirm they are the same being first. Returns { ok, canonicalId, merged, repointed, error }.',
    write: true,
    argsFrom: 'listWorldPages / listCharacterArcs (entityIds)',
    verifyWith: 'listCast',
    input: { entityIds: z.array(z.string()).min(2).max(100) }
  },
  {
    name: 'runAnalysis',
    description:
      'Start the background analysis run on the stale/unanalysed frontier (fire-and-forget; no-op if already ' +
      'running; progress in the Jobs dashboard). Reads CANON scenes only — DRAFT scenes are skipped (promote ' +
      'them to canon first), and calling this on an all-draft project returns { ok:false } with the reason ' +
      'rather than a silent no-op. Optionally pass scenes (unit_ids) to force-read. Returns { ok, started, note }.',
    write: true,
    argsFrom: 'listTierStatus (unit_ids, optional)',
    verifyWith: 'listTierStatus',
    input: { scenes: z.array(z.string()).max(2000).optional() }
  },
  {
    name: 'setRuling',
    description:
      'Rule on a coherence finding: mark the declared-vs-observed divergence on a trait intentional (dismiss) or ' +
      'not (re-surface). AUTHORIAL: only on explicit request. Returns { ok }.',
    write: true,
    argsFrom: 'listCoherenceFindings (entityId + trait)',
    verifyWith: 'listCoherenceFindings',
    input: { entityId: z.string(), trait: z.string(), intentional: z.boolean() }
  },
  {
    name: 'moveStoryPaths',
    description:
      'Batch move/rename inside the story tree — the restructuring primitive. `moves` = [{from, to}] story-relative ' +
      'paths. Guarded: never overwrites, archive protected, prose bytes untouched, scene ids keep analysis keyed. ' +
      'AUTHORIAL: show the exact from→to plan and get confirmation first. One re-ingest after the batch. Returns ' +
      '{ moved, results }.',
    write: true,
    argsFrom: 'listStoryTree (relPaths)',
    verifyWith: 'listStructuralIssues',
    input: { moves: z.array(z.object({ from: z.string(), to: z.string() })).min(1).max(500) }
  },
  {
    name: 'removeEmptyStoryFolders',
    description:
      'Remove story folders containing NO scenes (any folder with a scene beneath is refused — content-safe by ' +
      'construction). AUTHORIAL: only on explicit request. Returns { removed, refused }.',
    write: true,
    argsFrom: 'moveStoryPaths (the folders it emptied)',
    verifyWith: 'listStoryTree',
    input: { folders: z.array(z.string()).min(1).max(500) }
  },
  // ── LIFECYCLE (trusted host adapter only — the standalone/headless MCP server, NOT the in-app agent/server) ──
  // These change the WORK CONTEXT, so they never reach a sandboxed extension (absent from SUPPORTED) NOR the in-app
  // adapters (excluded via IN_APP_TOOLS — an in-app agent must not swap the work out from under the open GUI).
  {
    name: 'openWork',
    description:
      'Open a work by ABSOLUTE path (a folder containing content/) and make it the active work for every ' +
      'subsequent tool. The headless MCP server uses this to point at a project on disk. Returns the work meta ' +
      '(root, id, counts) or null if the path is not a valid work.',
    write: true,
    input: { path: z.string() }
  },
  {
    name: 'ingestWork',
    description:
      'Run T1 INGEST on the open work — read its content/*.md into the analysis DB (markdown → nvs.db). The first ' +
      'producer step: run it after openWork on a fresh or changed project, before runAnalysis. Returns ' +
      '{ chapters, scenes, dialogNodes, changed, skipped }.',
    write: true,
    verifyWith: 'listStructuralIssues (the readiness oracle)',
    input: empty
  }
]

export const TOOL_NAMES = TOOL_CATALOG.map((t) => t.name)

/**
 * The v1 HOST-API freeze map — each tool's capability tag (internal/host-api-v1-spec.md Part A). This is the
 * contract layer: an adapter gates a call by the `cap` here; `tests/hostApiSurface.test.ts` pins tool ↔ cap ↔
 * hostApi.SUPPORTED so a breaking change to a `/1` tool fails the build (forcing a deliberate `/2`, per the CLAP
 * rules in host-api.md) instead of silently breaking a consumer. Tiers: `read`/`write` gate on SUPPORTED/FAMILIES;
 * `lifecycle` (open/create/ingest/runAnalysis) is trusted-adapter-only (hostApi.LIFECYCLE_CAPS), never negotiated
 * to a sandboxed manifest. Every tool in TOOL_CATALOG MUST have an entry (the test enforces completeness).
 */
export type ToolTier = 'read' | 'write' | 'lifecycle'
/** D/R/A/V — the functional role a tool plays in the routing ladder (internal/tool-surface.md). The RGBE
 *  ladder abstracted: discover finds refs, read fetches detail, act mutates, verify is the deterministic
 *  oracle after an act. Metadata only — tool names stay domain-nouned. */
export type ToolKind = 'discover' | 'read' | 'act' | 'verify'
/** Which consumers ADVERTISE a tool (advertisement-time filtering, no runtime router — tool-surface.md):
 *  `chat` = the in-app agent (weak models allowed → tight core); `skill` = the plugin/MCP agent lanes
 *  (strong models, explicit contracts → full non-lifecycle surface). The sandbox lane (openSandbox/
 *  captureAsset/…) is a separate registration entirely (mcp/appTools.ts), not a profile here. */
export type ToolProfile = 'chat' | 'skill'
export interface ToolCapability {
  cap: string // the capability id it needs (e.g. read:scenes/1, write:tier:*/1, lifecycle/1)
  tier: ToolTier
  stability: 'stable' | 'draft'
  kind: ToolKind
  profiles: readonly ToolProfile[]
}
const BOTH = ['chat', 'skill'] as const
const SKILL = ['skill'] as const // skill-lane only: analysis internals, restructuring, curation, the SQL escape hatch
export const TOOL_CAPS: Readonly<Record<string, ToolCapability>> = {
  // read — resources
  currentProject: { cap: 'read:project/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  mcpStats: { cap: 'read:project/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  projectInfo: { cap: 'read:project/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listScenes: { cap: 'read:scenes/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: SKILL }, // chat finds via search
  search: { cap: 'read:scenes/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  readScene: { cap: 'read:scenes/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  exportFormat: { cap: 'read:scenes/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  checkPageFormat: { cap: 'read:scenes/1', tier: 'read', stability: 'stable', kind: 'verify', profiles: BOTH },
  listBoards: { cap: 'read:corkboard/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  readBoard: { cap: 'read:corkboard/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  readCard: { cap: 'read:corkboard/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listStoryTree: { cap: 'read:story/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  listWorldPages: { cap: 'read:world/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  listCustodyTopics: { cap: 'read:world/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  readTree: { cap: 'read:tree/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  // read — derived tiers + queries
  listThreads: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listCoherenceFindings: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listCharacterArcs: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listCast: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listStructuralIssues: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'verify', profiles: BOTH },
  listChapterLedgers: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: BOTH },
  readChapterLedger: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  queryDb: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: SKILL }, // the escape hatch (tool-surface.md): semantic lists + search cover chat questions
  listLoreView: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: BOTH },
  listTierStatus: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'discover', profiles: SKILL },
  tierInputHash: { cap: 'read:tiers/1', tier: 'read', stability: 'stable', kind: 'read', profiles: SKILL },
  // write — page/prose files (create/edit/move/phase)
  createPage: { cap: 'write:files/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  queuePageEdit: { cap: 'write:files/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  setPhase: { cap: 'write:files/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL }, // the canon gate — explicit-request policy fits the skill lane
  moveStoryPaths: { cap: 'write:files/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  removeEmptyStoryFolders: { cap: 'write:files/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  // write — the story graph (tree variants)
  connectScenes: { cap: 'write:tree/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  connectScenesBatch: { cap: 'write:tree/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  disconnectScenes: { cap: 'write:tree/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  createVariant: { cap: 'write:tree/1', tier: 'write', stability: 'stable', kind: 'act', profiles: BOTH },
  // write — derived analysis (the tier family: writeTier keystone + curation/dedup + the run trigger)
  writeTier: { cap: 'write:tier:*/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  mergeThreads: { cap: 'write:tier:*/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  mergeEntities: { cap: 'write:tier:*/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  setRuling: { cap: 'write:tier:*/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL },
  runAnalysis: { cap: 'write:tier:*/1', tier: 'write', stability: 'stable', kind: 'act', profiles: SKILL }, // acts on the CURRENT work → a write, not lifecycle (stays exposed on the MCP)
  // lifecycle — trusted host adapter ONLY (headless MCP server); change the work context, excluded from IN_APP_TOOLS
  openWork: { cap: 'lifecycle/1', tier: 'lifecycle', stability: 'stable', kind: 'act', profiles: SKILL },
  ingestWork: { cap: 'lifecycle/1', tier: 'lifecycle', stability: 'stable', kind: 'act', profiles: SKILL }
}

/**
 * The tools an IN-APP adapter (the BYO-key agent + the localhost MCP server) may expose: everything EXCEPT
 * lifecycle. A running app already has a work open in the GUI; an in-app agent must not `openWork` a different one
 * or re-`ingest` out from under the user. The headless/standalone MCP server (which owns the work context) is the
 * only adapter that registers the full TOOL_CATALOG. This is the runtime half of the lifecycle trust tier.
 */
export const IN_APP_TOOLS: ToolDef[] = TOOL_CATALOG.filter((t) => TOOL_CAPS[t.name].tier !== 'lifecycle')

/**
 * Advertisement-time profile filter (internal/tool-surface.md): the tools a consumer LISTS to its model.
 * Lifecycle stays excluded for every in-app profile (same trust rule as IN_APP_TOOLS). The model can't
 * misroute to a tool it never saw — `chat` trims the surface a weak model juggles (no SQL escape hatch,
 * no analysis internals, no restructuring); `skill` keeps the full non-lifecycle contract for the plugin
 * lanes. Dispatch is unchanged — this filters what's OFFERED, not what exists.
 */
export function toolsForProfile(profile: ToolProfile): ToolDef[] {
  return IN_APP_TOOLS.filter((t) => TOOL_CAPS[t.name].profiles.includes(profile))
}
