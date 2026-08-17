/**
 * The scene-read pass (Phase 3) — the in-app reader the ingest runner calls per outdated scene.
 *
 * For one scene: gather its dialogue + light context, ask the ACTIVE connection to read it (the app's
 * reference instructions), parse the JSON, and map it to the app's `SceneRows`. Returns an apply-ready tier
 * entry, or a `skip` reason when there's nothing to do (no AI, no dialogue). Throws on a real failure (AI or
 * parse error) so the runner marks the step failed. This is the one line the Phase-2 runner was built around.
 */
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { SKIM_EMPTY, buildSceneUserPayload, buildBatchUserPayload, buildWindowUserPayload, buildEntityWindowPayload, buildCoherenceUserPayload, buildDigestPayload, buildProfilePayload, languageDirective, BATCH_CONFIG, analysisPrompts, type AnalysisPrompts, type SceneExtraction, type BatchSceneExtraction, type WindowExtraction, type EntityWindowExtraction, type CoherenceExtraction } from '@shared/config/extraction'
import { hasArc, allowedArcChanges } from '@shared/config/entityArc'
import { worldCategoryByKey } from '@shared/config/worldCategories'
import { toRows, parseJson, parseJsonArray, distributeBatch, type SceneEntry, type BatchReadResult } from './batchDistribute'
import { recoverEvidence } from './evidenceRecovery'
import type { AnalysisDepth, ArcEventRow, CoherenceFindingRow, TierWrite } from '@shared/ipc'
import * as engine from '@engine/index'
import { declaredSecrets } from '@engine/io/secrets'
import { getAnalysis } from './registry'
import { runPlanComplete } from './planSession'
import { logIngestEvent } from './ingestTelemetry'
import { withTimeout } from '../guard/withTimeout'

/** Every pass carries the work-language directive (non-English projects): free text follows the WORK,
 *  machine handles stay ASCII. No-op for English/unset — see languageDirective (extraction.ts).
 *  `inLanguage` is a list (multilingual works) — the FIRST entry is the primary output language. */
const withLang = (user: string): string => user + languageDirective(engine.readProjectInfo().inLanguage?.[0])

/** The KIND-selected instruction set (fiction default / non-fiction for conversation works). Read per call so a
 *  project's declared `domain` steers every pass — the tables stay domain-blind; only the prompt text swaps. */
const prompts = (): AnalysisPrompts => analysisPrompts(engine.readProjectInfo().domain)
import { AiError, classifyAi, type AiFailureKind } from './aiErrors'

// A cached reply is only trustworthy if the CALLER can still use it. These validators gate BOTH what we
// memoize AND whether a cache HIT is honored — a long-but-unparseable reply (a truncated batch JSON, a prose
// refusal) must never get cached and replayed on every re-read (the "unsalvageable fail"). See complete().
const isJsonObject = (t: string): boolean => parseJson(t) != null
const isJsonArray = (t: string): boolean => parseJsonArray(t) != null

// The active model's real per-turn OUTPUT cap — set as max_tokens on API calls AND fed to the batch packer,
// so a batch is never packed larger than what the model can actually emit (the haiku 8192-vs-50k truncation,
// 2026-07-18). Resolved once per model from the Anthropic Models API — a cheap METADATA GET (~100-300ms), not
// a generation probe: the model can't self-report its cap, and forcing a truncation to measure it would cost a
// whole turn. Falls back to the config default for providers without a Models API. Cached per model id.
let currentOutCap: number = BATCH_CONFIG.apiMaxOutTokens
const outCapCache = new Map<string, number>()

/** Resolve (and cache) the active analysis model's output-token ceiling; also stamps `currentOutCap` for the
 *  readers' max_tokens. Call once at run start before sizing batches. */
export async function resolveModelOutputCap(): Promise<number> {
  const active = getAnalysis()
  if (!active) return (currentOutCap = BATCH_CONFIG.apiMaxOutTokens)
  const key = `${active.type}:${active.model}`
  const cached = outCapCache.get(key)
  if (cached != null) return (currentOutCap = cached)
  let cap: number = BATCH_CONFIG.apiMaxOutTokens
  if (active.type === 'anthropic' && active.secret) {
    try {
      const m = await new Anthropic({ apiKey: active.secret }).models.retrieve(active.model)
      const real = (m as unknown as { max_tokens?: number }).max_tokens // Models API exposes the output cap (Mar 2026+)
      if (typeof real === 'number' && real > 0) cap = real
    } catch {
      /* metadata lookup failed (offline / older API) — keep the safe config default */
    }
  }
  outCapCache.set(key, cap)
  return (currentOutCap = cap)
}
const COH_BATCH = 8 // characters per coherence call — bounds output even when the significant cast is large

/** How many analysis calls may run concurrently: API providers parallelize (window/coherence targets are
 *  independent); the 'plan' host (one warm Claude Code session) must stay serial. Scene reads NEVER
 *  parallelize regardless (each needs the prior scenes' open threads — continuity beats speed). */
export function analysisConcurrency(): number {
  const a = getAnalysis()
  return a && AI_PROVIDERS[a.type].api !== 'plan' ? 3 : 1
}

/** Run tasks with a bounded worker pool, preserving result order. `stop` aborts launching new tasks. */
export async function pooled<T, R>(items: T[], limit: number, run: (item: T, i: number) => Promise<R>, stop?: () => boolean): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      if (stop?.()) return
      const i = next++
      out[i] = await run(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** An apply-ready scene tier entry (a TierWrite minus the engine-stamped inputHash). */
type WindowEntry = Omit<Extract<TierWrite, { kind: 'window' }>, 'inputHash'>
type CoherenceEntry = Omit<Extract<TierWrite, { kind: 'coherence' }>, 'inputHash'>
export type ReadResult = { entry: SceneEntry } | { skip: string }
export type WindowResult = { entries: WindowEntry[] } | { skip: string }
export type CoherenceResult = { entries: CoherenceEntry[] } | { skip: string }

const norm = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * A hot thread's context line, now WITH its ordered prior beats (thread-resolve-contradiction.md): a `close`/
 * `advance` re-narrated without the earlier `advance` in view can assert its negation ("finds X" → "without
 * finding X"). Surfacing the beats lets the reader describe the OUTCOME relative to them. Bounded: the most
 * recent 5 beats, each ≤140 chars, so this stays a small addition to the working set.
 */
function threadContextLine(
  t: { id: string; description: string; resolutionCondition: string | null },
  beats: { action: string; description: string }[]
): string {
  const head = `${t.id} — ${t.description}${t.resolutionCondition ? ` [closes when: ${t.resolutionCondition}]` : ''}`
  const trail = beats
    .slice(-5)
    .map((b) => `    · ${b.action}: ${b.description.slice(0, 140)}`)
    .join('\n')
  return trail ? `${head}\n${trail}` : head
}

export async function readScene(unitId: string, signal: AbortSignal, depth: AnalysisDepth = 'full'): Promise<ReadResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const dialogue = engine.sceneDialogue(unitId)
  if (dialogue.length === 0) return { skip: 'no dialogue to read' }
  const skim = depth === 'skim'

  const knownCharacters = engine.listWorldPages().filter((p) => p.kind === 'character').map((p) => p.name)
  // STORY SO FAR (working-set M1): hierarchical digests of everything before this scene — bounded memory,
  // so the thread list stops being the only history the model gets.
  const sofar = engine.storySoFar(unitId)
  // Threads open ENTERING this scene (as-of-N — not the global set, so an early scene can't see the future).
  // Fed by id so the model can advance/close them — that's what connects a later scene to an earlier one.
  // HOT (activity within the working-set window) get full descriptions; DORMANT shrink to an id+title index
  // (still advance-valid — reopen-by-exact-id is the P4G safety line). Bounded at any corpus size.
  const openList = engine.openThreadsAsOf(unitId)
  const hotList = openList.filter((t) => t.lastPos >= sofar.hotCutoffPos)
  const dormantList = openList.filter((t) => t.lastPos < sofar.hotCutoffPos)
  // Prior beats of the HOT threads (open/advance/reopen before this scene), so a close/advance can't negate an
  // earlier beat (thread-resolve-contradiction.md). Dormant threads stay a bare id+title index (token budget).
  const beatsByThread = engine.threadBeatsBefore(hotList.map((t) => t.id), unitId)
  const openThreads = hotList.map((t) => threadContextLine(t, beatsByThread[t.id] ?? []))
  // Dormant threads keep their CLOSE-GATE (not just id+title) so a long-arc payoff can still be recognized —
  // the millennium-mystery miss (thread-resolve-contradiction.md §context-limit): without the gate the reader
  // can't tell a late scene pays off an old thread. One short sentence each; description stays dropped.
  const dormantThreads = dormantList.map((t) => `${t.id} "${t.title ?? t.description.slice(0, 40)}"${t.resolutionCondition ? ` [closes when: ${t.resolutionCondition}]` : ''}`)
  // Anchor a re-read to this scene's previous extraction so the model reuses the same handles (anti-drift):
  // for an open, show the bare handle (the ref) it should reuse; for advance/close, the full thread id.
  const priorReading = engine.scenePriorThreads(unitId).map((p) => {
    const label = p.action === 'open' ? p.threadId.split(':').slice(2).join(':') : p.threadId
    return `${p.action} ${label}${p.description ? ` — ${p.description}` : ''}`
  })
  // The third bucket's enum + grounding: the structure's tracked, non-character/location categories
  // (item · faction · genre packs). The model classifies into THESE or leaves a thing out — never invents.
  // SKIM reads none of this — the skim contract has no things/lore fields, so carrying their grounding
  // context would be pure prompt weight (input trims alongside the output diet).
  const thingCategories = skim
    ? []
    : engine
        .readStructure()
        .world.filter((c) => c.tracked && c.key !== 'character' && c.key !== 'location')
        .map((c) => ({ key: c.key, description: c.description }))
  const knownThings = skim ? [] : engine.listTrackedThings(sofar.hotCutoffPos) // working-set view: recent ∪ top-N (M4); the writer's resolve stays corpus-wide
  const knownLore = skim ? [] : engine.listKnownLore(sofar.hotCutoffPos) // anti-dupe grounding: reuse existing lore_refs, don't coin synonyms
  const user = buildSceneUserPayload({ sceneId: unitId, dialogue, knownCharacters, openThreads, priorReading, thingCategories, knownThings, knownLore, storySoFar: sofar.blocks, dormantThreads })

  // The WORKING-SET AUDIT: attribute the prompt per part. `dialogue` is the only part that IS the work —
  // everything else is context carried to read it, and each context part grows with the corpus while the
  // scene does not. When `dialogue` is a small fraction of `promptChars`, the working set has drifted and
  // this line names the part to bound (it caught lore at 43% of a 40k prompt for a 6.5k scene).
  const bytes = (x: unknown): number => (typeof x === 'string' ? x.length : JSON.stringify(x ?? '').length)
  const t0 = Date.now()
  const P = prompts()
  const text = await complete(skim ? P.skim : P.extraction, withLang(user), active.model, signal, isJsonObject)
  logIngestEvent({
    kind: 'scene',
    targetId: unitId,
    ms: Date.now() - t0,
    model: active.model,
    promptChars: user.length,
    responseChars: text.length,
    parts: {
      dialogue: bytes(dialogue),
      storySoFar: bytes(sofar.blocks),
      lore: bytes(knownLore),
      openThreads: bytes(openThreads),
      things: bytes(knownThings),
      priorReading: bytes(priorReading),
      dormantThreads: bytes(dormantThreads),
      knownCharacters: bytes(knownCharacters),
      thingCategories: bytes(thingCategories)
    },
    status: 'ok'
  })
  const parsed = parseJson<SceneExtraction>(text)
  if (!parsed) throw new Error('the reader returned unparseable JSON')
  // A skim reply carries only summary/characters/threads — default the ledger fields empty so toRows and
  // applyEntry see one shape regardless of depth.
  const x: SceneExtraction = skim ? { ...SKIM_EMPTY, ...parsed } : parsed

  const model = active.model || AI_PROVIDERS[active.type].label
  const validThreadIds = new Set(openList.map((t) => t.id))
  const allowedThings = new Set(thingCategories.map((c) => c.key))
  return { entry: { tier: 't2', kind: 'scene', targetId: unitId, asOfUnitId: null, model, depth, rows: toRows(unitId, x, validThreadIds, allowedThings) } }
}

/**
 * BATCHED scene read (internal/batched-extraction.md ②③) — reads N consecutive scenes in ONE LLM turn. The
 * shared context (roster + open threads + story-so-far) is gathered AS-OF THE FIRST scene and amortized across
 * the batch; the model reads the scenes in order and tracks new threads across them. Returns one apply-ready
 * entry per scene the model returned, plus the scenes it dropped/omitted (retried next run). A batch of one is
 * equivalent to `readScene` — so incremental single-scene edits keep their granularity.
 */
export async function readSceneBatch(sceneIds: string[], signal: AbortSignal, depth: AnalysisDepth = 'full'): Promise<BatchReadResult> {
  const active = getAnalysis()
  if (!active) return { entries: [], skipped: sceneIds.map((sceneId) => ({ sceneId, reason: 'no AI connected' })) }
  const skim = depth === 'skim'
  // Gather each scene's dialogue; a dialogue-less scene can't be read — drop it to `skipped`.
  const scenes: { sceneId: string; dialogue: ReturnType<typeof engine.sceneDialogue> }[] = []
  const skipped: { sceneId: string; reason: string }[] = []
  for (const id of sceneIds) {
    const dialogue = engine.sceneDialogue(id)
    if (dialogue.length === 0) skipped.push({ sceneId: id, reason: 'no dialogue to read' })
    else scenes.push({ sceneId: id, dialogue })
  }
  if (scenes.length === 0) return { entries: [], skipped }

  // Context AS-OF THE FIRST scene (the batch's entry point) — same working-set gathering as readScene, once.
  const first = scenes[0].sceneId
  const knownCharacters = engine.listWorldPages().filter((p) => p.kind === 'character').map((p) => p.name)
  const sofar = engine.storySoFar(first)
  const openList = engine.openThreadsAsOf(first)
  const hotList = openList.filter((t) => t.lastPos >= sofar.hotCutoffPos)
  const dormantList = openList.filter((t) => t.lastPos < sofar.hotCutoffPos)
  // Prior beats as-of the batch's first scene (same fix as readScene; see thread-resolve-contradiction.md).
  const beatsByThread = engine.threadBeatsBefore(hotList.map((t) => t.id), first)
  const openThreads = hotList.map((t) => threadContextLine(t, beatsByThread[t.id] ?? []))
  // Dormant threads keep their CLOSE-GATE (not just id+title) so a long-arc payoff can still be recognized —
  // the millennium-mystery miss (thread-resolve-contradiction.md §context-limit): without the gate the reader
  // can't tell a late scene pays off an old thread. One short sentence each; description stays dropped.
  const dormantThreads = dormantList.map((t) => `${t.id} "${t.title ?? t.description.slice(0, 40)}"${t.resolutionCondition ? ` [closes when: ${t.resolutionCondition}]` : ''}`)
  const thingCategories = skim
    ? []
    : engine
        .readStructure()
        .world.filter((c) => c.tracked && c.key !== 'character' && c.key !== 'location')
        .map((c) => ({ key: c.key, description: c.description }))
  const knownThings = skim ? [] : engine.listTrackedThings(sofar.hotCutoffPos)
  const knownLore = skim ? [] : engine.listKnownLore(sofar.hotCutoffPos)
  const user = buildBatchUserPayload({ scenes, knownCharacters, openThreads, thingCategories, knownThings, knownLore, storySoFar: sofar.blocks, dormantThreads })

  const t0 = Date.now()
  const P = prompts()
  const text = await complete(skim ? P.batchSkim : P.batchExtraction, withLang(user), active.model, signal, isJsonArray)
  logIngestEvent({ kind: 'scene', targetId: `batch:${first}+${scenes.length - 1}`, ms: Date.now() - t0, model: active.model, promptChars: user.length, responseChars: text.length, status: 'ok' })
  const objects = parseJsonArray<BatchSceneExtraction>(text)
  if (!objects) {
    // Unparseable almost always means TRUNCATED: the packer over-filled the batch, so the reply hit
    // max_tokens mid-array. The packer sizes on a per-project k (out chars per input char) that a shifting
    // beat mix can invalidate — a work that becomes narration-heavy realizes far more output per input char
    // than a dialogue-heavy prior predicts, and k only re-learns from batches that SUCCEED, so an over-fill
    // can't self-correct. Splitting halves the expected output and retries; the recursion bottoms out at a
    // single scene, which is the genuinely unrecoverable case. Turns whole-batch loss into a slower success.
    if (scenes.length > 1) {
      const ids = scenes.map((s) => s.sceneId)
      const mid = Math.ceil(ids.length / 2)
      logIngestEvent({
        kind: 'scene', targetId: `batch:${first}+${scenes.length - 1}`, model: active.model, status: 'ok',
        note: `unparseable reply (likely truncated) — splitting ${ids.length} → ${mid}/${ids.length - mid} and retrying`
      })
      const a = await readSceneBatch(ids.slice(0, mid), signal, depth)
      const b = await readSceneBatch(ids.slice(mid), signal, depth)
      return { entries: [...a.entries, ...b.entries], skipped: [...skipped, ...a.skipped, ...b.skipped] }
    }
    throw new Error('the batch reader returned unparseable JSON (expected an array) — single scene, cannot split further')
  }
  // Realized output vs the batch's dialogue volume → the project learns its OWN k for the packer (per depth).
  // Only on a parsed (complete) reply — a truncated batch throws above, so its short output never skews the k.
  const dialogueChars = scenes.reduce((a, s) => a + s.dialogue.reduce((b, d) => b + d.text.length, 0), 0)
  engine.recordExtractionSample(depth, dialogueChars, text.length)

  const model = active.model || AI_PROVIDERS[active.type].label
  const result = distributeBatch(
    scenes.map((s) => s.sceneId),
    objects,
    { model, depth, allowedThings: new Set(thingCategories.map((c) => c.key)), entryThreadIds: new Set(openList.map((t) => t.id)) }
  )
  return { entries: result.entries, skipped: [...skipped, ...result.skipped] }
}


/**
 * The window/arc pass — roll up ONE chapter into per-character arcs (T2 window). One AI call over the
 * chapter's scene EVIDENCE (not raw dialogue) → a window per present character → a `writeTier(window)`
 * entry each (so a chapter is one call, N small writes). Cast is resolved to entity pages BEFORE the call
 * (only resolvable characters are offered), so the model's names map cleanly back to ids — no invention.
 */
export async function readWindow(chapterId: string, signal: AbortSignal): Promise<WindowResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const evidence = engine.chapterEvidence(chapterId)
  if (!evidence.length) return { skip: 'no scenes in chapter' }

  // Resolve the present cast to character pages up front (FK target + clean name↔id mapping). Then gate to the
  // SIGNIFICANT set (scale cap) so a sprawling paged cast doesn't get a window for every minor name.
  const pages = engine.listWorldPages().filter((p) => p.kind === 'character')
  const pageByNorm = new Map(pages.map((p) => [norm(p.name), p]))
  const significant = engine.significantEntityIds()
  const present = new Map<string, string>() // entity id → canonical name
  for (const sc of evidence) for (const nm of sc.characters) {
    const pg = pageByNorm.get(norm(nm))
    if (pg && (!significant.size || significant.has(pg.id))) present.set(pg.id, pg.name)
  }
  if (!present.size) return { skip: 'no resolvable cast' }
  const idByNorm = new Map([...present].map(([id, name]) => [norm(name), id]))

  const roster = engine.collectDeclaredSecrets()
  const rosterIds = new Set(roster.map((r) => r.id))
  const user = buildWindowUserPayload({
    chapterId,
    scenes: evidence,
    cast: [...present.values()],
    secretsRoster: roster.map((r) => `[${r.id}] (${r.ownerName}) ${r.text}`)
  })
  const text = await completeLogged('window', chapterId, prompts().window, withLang(user), active.model, signal, isJsonObject)
  const x = parseJson<WindowExtraction>(text)
  if (!x) throw new Error('the window pass returned unparseable JSON')

  const model = active.model || AI_PROVIDERS[active.type].label
  const validScenes = new Set(evidence.map((s) => s.sceneId))
  const entries: WindowEntry[] = []
  for (const w of x.windows ?? []) {
    const eid = idByNorm.get(norm(w.character ?? ''))
    if (!eid) continue // a window for someone not in the offered cast → drop (no invention)
    const arcEvents: ArcEventRow[] = (w.events ?? [])
      .filter((e) => e && validScenes.has(e.scene_id) && (e.change === 'gain' || e.change === 'loss' || e.change === 'expose') && e.category && e.value)
      .map((e) => {
        // knowledge semantics (secret category only): target resolves against the offered cast; the secret
        // citation must be a roster id — anything else is dropped to null (never invented, never blocking).
        const isSecret = e.category === 'secret'
        const rawTarget = isSecret && e.change === 'expose' && typeof e.target === 'string' ? e.target.trim() : ''
        const target = rawTarget.toLowerCase() === 'public' ? 'public' : (idByNorm.get(norm(rawTarget)) ?? null)
        const citation = isSecret && typeof e.secret === 'string' ? e.secret.trim().replace(/^\[|\]$/g, '').toLowerCase() : ''
        return {
          category: e.category,
          change: e.change as ArcEventRow['change'],
          value: e.value,
          description: e.description ?? '',
          sceneId: e.scene_id,
          target,
          secret: rosterIds.has(citation) ? citation : null
        }
      })
    entries.push({ tier: 't2', kind: 'window', targetId: eid, asOfUnitId: chapterId, model, rows: { window: { summary: w.summary ?? null }, arcEvents } })
  }
  return { entries }
}

/**
 * The ENTITY window pass — roll ONE chapter into per-THING change (items/factions/…), the object-world analog of
 * `readWindow`. One AI call over the chapter's scene summaries + the arc-worthy things present → a window per
 * thing with facet events + the UNIVERSAL change axis → a `writeTier(window)` entry each. Present things are
 * gated two ways: the category must be arc-tracked (`hasArc` — declared `arc` in MASTER_WORLD, so this adapts to
 * whatever the project enabled) AND the thing must clear the significance gate (page OR ≥2 scenes OR major).
 * Reuses the same window write path (character_windows + entity_arc_events).
 */
export async function readEntityWindow(chapterId: string, signal: AbortSignal): Promise<WindowResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const evidence = engine.chapterEvidence(chapterId)
  if (!evidence.length) return { skip: 'no scenes in chapter' }
  // Present things → keep only arc-tracked categories (hasArc) AND arc-worthy entities (the significance gate).
  const worthy = engine.arcWorthyEntityIds()
  const present = engine.chapterEntities(chapterId).filter((e) => hasArc(e.type) && worthy.has(e.id))
  if (!present.length) return { skip: 'no arc-worthy things in chapter' }
  const idByNorm = new Map(present.map((e) => [norm(e.name), e.id]))

  // Vocab from the PRESENT categories, resolved from the master arc defs by key (not the stored structure, so a
  // pre-`arc` structure.json still gets live facets). Adapts to project config — a suspect entity brings suspect facets.
  const cats = [...new Set(present.map((e) => e.type))]
  const vocab = cats.flatMap((category) => {
    const arc = worldCategoryByKey(category)?.arc
    return arc ? [{ category, archetype: arc.archetype as string, facets: arc.facets.map((f) => ({ key: f.key, blurb: f.blurb })) }] : []
  })
  // characters the custody `holder` field may cite (resolved to entity ids below)
  const cast = engine.listWorldPages().filter((pg) => pg.kind === 'character')
  const castByNorm = new Map(cast.map((c) => [norm(c.name), c.id]))
  const user = buildEntityWindowPayload({
    chapterId,
    scenes: evidence.map((s) => ({ sceneId: s.sceneId, title: s.title, summary: s.summary })),
    things: present.map((e) => ({ name: e.name, category: e.type })),
    vocab,
    cast: cast.map((c) => c.name)
  })
  const text = await completeLogged('entity-window', chapterId, prompts().entityWindow, withLang(user), active.model, signal, isJsonObject)
  const x = parseJson<EntityWindowExtraction>(text)
  if (!x) throw new Error('the entity window pass returned unparseable JSON')

  const model = active.model || AI_PROVIDERS[active.type].label
  const validScenes = new Set(evidence.map((s) => s.sceneId))
  const typeById = new Map(present.map((e) => [e.id, e.type]))
  const entries: WindowEntry[] = []
  for (const w of x.windows ?? []) {
    const eid = idByNorm.get(norm(w.entity ?? ''))
    if (!eid) continue // a window for a thing not offered → drop (no invention)
    const type = typeById.get(eid)!
    const okChange = allowedArcChanges(type) // the change AXIS is enforced (writeTier re-guards)…
    const arcEvents: ArcEventRow[] = (w.events ?? [])
      // …the FACET is guided-open (like entities.type): the prompt steers to the category's facets, but an
      // off-list facet the model coins is kept, not dropped. Only require it be non-empty.
      .filter((e) => e && validScenes.has(e.scene_id) && okChange.has(e.change) && e.facet && e.value)
      .map((e) => ({
        category: e.facet,
        change: e.change,
        value: e.value,
        description: e.description ?? '',
        sceneId: e.scene_id,
        // custody holder → structured target (the end-of-scene holder as an entity id; unresolvable → null,
        // the rail falls back to text matching). Never invented: must resolve against the offered cast.
        target: e.facet === 'custody' && typeof e.holder === 'string' ? (castByNorm.get(norm(e.holder)) ?? null) : null
      }))
    entries.push({ tier: 't2', kind: 'window', targetId: eid, asOfUnitId: chapterId, model, rows: { window: { summary: w.summary ?? null }, arcEvents } })
  }
  return { entries }
}

/**
 * The DIGEST reduce (working-set M2) — compress one reducible unit (act/part/book) into its story-so-far
 * paragraph. Inputs = the unit's children digests/summaries (gathered engine-side, hash included so the
 * write records exactly what was reduced). Plain prose out — no JSON to parse.
 */
export async function readDigest(unitId: string, signal: AbortSignal): Promise<{ body: string; inputHash: string; model: string } | { skip: string }> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const inp = engine.digestInputs(unitId)
  if (inp.parts.length === 0) return { skip: 'nothing extracted beneath this unit yet' }
  const text = await completeLogged('digest', unitId, prompts().digest, withLang(buildDigestPayload({ title: inp.title, parts: inp.parts })), active.model, signal)
  const body = text.trim()
  if (!body) throw new Error('the digest reduce returned nothing')
  return { body, inputHash: inp.inputHash, model: active.model || AI_PROVIDERS[active.type].label }
}

/**
 * The PROFILE reduce (working-set M3) — fold one chapter's evidence into a character's cumulative profile.
 * One chain link per call; the runner keeps a character's links sequential (each consumes the previous).
 */
export async function readProfile(entityId: string, chapterId: string, signal: AbortSignal): Promise<{ body: string; inputHash: string; model: string } | { skip: string }> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const inp = engine.profileInputs(entityId, chapterId)
  if (!inp.increment && !inp.prevProfile) return { skip: 'no evidence yet' }
  // CARRY link — the character has no evidence this chapter: the profile rolls forward unchanged, no AI
  // call (post-reset first runs plan the full char×chapter grid; absent chapters must cost nothing).
  if (!inp.increment) return { body: inp.prevProfile, inputHash: inp.inputHash, model: 'carry' }
  const text = await completeLogged('profile', `${entityId}|${chapterId}`, prompts().profile, withLang(buildProfilePayload(inp)), active.model, signal)
  const body = text.trim()
  if (!body) throw new Error('the profile reduce returned nothing')
  return { body, inputHash: inp.inputHash, model: active.model || AI_PROVIDERS[active.type].label }
}

/**
 * The coherence pass (T3) — ONE call over the whole cast diffing each character's DECLARED page against their
 * OBSERVED arc reduction. The model tags every finding with the entity_id from that character's block; we group
 * by entity, drop any finding tagged with an id we didn't offer (no invention), and emit one writeTier(coherence)
 * entry per character at the single global checkpoint (the chapter of the last scene). One call, N small writes.
 */
export async function readCoherence(signal: AbortSignal): Promise<CoherenceResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const checkpoint = engine.coherenceCheckpoint()
  if (!checkpoint) return { skip: 'no scenes to check' }
  const all = [...engine.coherenceInputs(), ...engine.entityCoherenceInputs()] // cast + paged things — one pass
  if (!all.length) return { skip: 'no characters with both a page and an arc' }
  // Incremental (scoped-rebuild): only re-diff characters whose page or through-checkpoint dialogue moved
  // since their last check. A diff is O(cast), so re-doing fresh characters is pure waste + churn.
  const stale = new Set(engine.coherenceStatus().filter((s) => s.status !== 'fresh').map((s) => s.entityId))
  const inputs = all.filter((c) => stale.has(c.entityId))
  if (!inputs.length) return { skip: 'coherence is up to date' }

  const model = active.model || AI_PROVIDERS[active.type].label
  const KINDS = new Set(['drift', 'gap', 'contradiction', 'confirmation']) // confirmation = secret-covered deception on track (layered truth)
  // STRUCTURAL no-flood guarantee: a confirmation is only meaningful as a secret-covered verdict, so it only
  // passes for characters whose declared page HAS a ## Secrets section. The old unconditional "trait holds up ✓"
  // noise (the reason confirmations were once banned) is impossible by construction, regardless of model whim.
  const hasSecrets = new Set(inputs.filter((c) => /^##\s*Secrets\b/im.test(c.declared)).map((c) => c.entityId))
  // The declared text was id-annotated by the engine (annotateSecretIds) — the model may only CITE those ids.
  const declaredIds = new Map(inputs.map((c) => [c.entityId, new Set(declaredSecrets(c.declared).map((x) => x.id))]))
  const SEVS = new Set(['low', 'medium', 'high'])
  const byEntity = new Map<string, CoherenceFindingRow[]>(inputs.map((c) => [c.entityId, []]))
  // Batch the cast: one giant call over every character overflows max_tokens and the JSON truncates. Chunks
  // keep each call's OUTPUT bounded (input context is cheap; output is the limit). Still "one pass" — the run
  // is a single coherence step that internally fans a few bounded calls, CONCURRENTLY on API providers
  // (batches are independent; results merge after, so bucket order stays deterministic).
  // Evidence recovery: haiku reliably NAMES where a finding occurs in prose ("in vol-01…") but often leaves the
  // structured `evidence_unit_ids` empty — and the coherence MAP places a finding by that field, so an empty one
  // collapses onto the as-of checkpoint (every finding piled on the last volume). We control the anchors we put in
  // each entity's observed side (`[title · c:windowId]`), so when a finding cites nothing, match the model's OWN
  // prose (observed + suggestion) back to those ids. This is what spreads findings across the timeline.
  const anchorsByEntity = new Map<string, { title: string; id: string; text: string }[]>()
  for (const c of inputs) {
    const list: { title: string; id: string; text: string }[] = []
    // `[title <sep> c:windowId] <window summary + beats…>` — separator-agnostic; group 3 captures the window's
    // content (up to the next anchor) for the content-overlap fallback below.
    for (const m of c.observed.matchAll(/\[([^\]]+?) \S (c:[^\]]+)\]([^[]*)/g)) list.push({ title: m[1].trim(), id: m[2].trim(), text: m[3] })
    anchorsByEntity.set(c.entityId, list)
  }
  // (the recovery itself lives in ./evidenceRecovery — shared with the continuity pass, which had no fallback)

  const batches: (typeof inputs)[] = []
  for (let i = 0; i < inputs.length; i += COH_BATCH) batches.push(inputs.slice(i, i + COH_BATCH))
  const parsed = await pooled(batches, analysisConcurrency(), async (batch, i) => {
    const user = buildCoherenceUserPayload({ characters: batch })
    const text = await completeLogged('coherence', `coh:${i}`, prompts().coherence, withLang(user), model, signal, isJsonObject)
    const x = parseJson<CoherenceExtraction>(text)
    if (!x) throw new Error('the coherence pass returned unparseable JSON')
    return x
  })
  for (const x of parsed) {
    if (!x) continue
    for (const f of x.findings ?? []) {
      const bucket = byEntity.get(f.entity_id)
      if (!bucket) continue // a finding for an id we never offered → drop (no invention)
      if (!KINDS.has(f.kind) || !SEVS.has(f.severity)) continue
      if (f.kind === 'confirmation' && !hasSecrets.has(f.entity_id)) continue // no Secrets → no on-track verdicts
      // secret citation: confirmations only, and only ids that exist on the entity's page (never invented)
      const citation = typeof f.secret === 'string' ? f.secret.trim().replace(/^\[|\]$/g, '').toLowerCase() : null
      const secret = f.kind === 'confirmation' && citation && declaredIds.get(f.entity_id)?.has(citation) ? citation : null
      // VALIDATE citations against the anchors we actually offered (mirror of continuityReader): an invented or
      // mangled id would pass the old nonempty check here, then be silently DROPPED by writeTier's canonicalizer —
      // leaving evidence [] and the finding piled on the as-of checkpoint. Only offered window ids count as a real
      // citation; anything else falls through to prose recovery, which grounds in those same anchors.
      const anchors = anchorsByEntity.get(f.entity_id) ?? []
      const anchorIds = new Set(anchors.map((a) => a.id))
      const cited = Array.isArray(f.evidence_unit_ids) ? f.evidence_unit_ids.filter((s) => typeof s === 'string' && s) : []
      const valid = cited.filter((id) => anchorIds.has(id))
      const evidence = valid.length ? valid : recoverEvidence(`${f.observed ?? ''}\n${f.suggestion ?? ''}\n${cited.join('\n')}`, anchors)
      bucket.push({
        trait: f.trait ?? '',
        declared: f.declared ?? '(unstated)',
        observed: f.observed ?? '',
        kind: f.kind,
        severity: f.severity,
        suggestion: f.suggestion ?? '',
        evidence,
        why: null,
        secret
      })
    }
  }


  // One entry per character (even empty — that's a real "no incoherence found" result we want to record).
  const entries: CoherenceEntry[] = inputs.map((c) => ({
    tier: 't3',
    kind: 'coherence',
    targetId: c.entityId,
    asOfUnitId: checkpoint,
    model,
    rows: { findings: byEntity.get(c.entityId) ?? [] }
  }))
  return { entries }
}

// ── completion: route to the active connection, return raw text (no markdown guard — we want JSON) ──

const RETRY_DELAYS = [2000, 5000, 12000] // backoff for transient failures (rate-limit / overloaded / network)

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}

export async function complete(system: string, user: string, model: string, signal: AbortSignal, valid?: (text: string) => boolean): Promise<string> {
  const active = getAnalysis()
  if (!active) throw new Error('no active AI connection')
  // BUILD CACHE (working-set): same prompt + model → same output, so a hit replays it with zero LLM cost —
  // reverts become free + deterministic (no false cascade), reruns fast.
  const cacheModel = model || active.type
  // `valid` (from the caller — does it parse?) gates the cache. Default keeps the old length floor for the
  // text passes (digest/profile) that carry no JSON to validate.
  const ok = valid ?? ((t: string): boolean => t.trim().length >= 20)
  const hit = engine.llmCacheGet(system, user, cacheModel)
  if (hit != null) {
    if (ok(hit)) return hit
    engine.llmCacheEvict(system, user, cacheModel) // a poisoned entry — drop it, re-fetch below (self-heals a stuck fail)
  }
  const meta = AI_PROVIDERS[active.type]
  const once = (): Promise<string> =>
    meta.api === 'plan'
      ? planText(system, user, model, signal)
      : meta.api === 'anthropic'
        ? anthropicText(system, user, model, active.secret, signal)
        : openaiText(system, user, model, active.secret, meta.baseUrl ?? '', signal)

  // Retry transient failures with backoff; let fatal (credits/auth/session) and unknown (parse) surface so the
  // runner can stop the run vs. fail just this step. A transient that survives the backoff escalates to fatal —
  // better to pause than churn the whole frontier against a wall.
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await once()
      // Memoize ONLY a reply the caller can actually use (`ok`) — a truncated/refusal reply that fails
      // validation must NOT be cached, or every re-read replays the poison (the unsalvageable fail). Plan
      // sentinels still throw upstream; this is the generic backstop for any provider that returns junk.
      if (ok(out)) engine.llmCachePut(system, user, cacheModel, out)
      return out
    } catch (e) {
      if (signal.aborted) throw e
      const err = classifyAi(e)
      if (err.transient && attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt], signal)
        continue
      }
      if (err.transient) throw new AiError(err.kind, `${err.userMessage} (still failing after retries — paused).`, { fatal: true })
      throw err
    }
  }
}

/** complete() + a telemetry event — so EVERY AI work call is logged on EVERY backend. The plan host also emits
 *  a 'plan-turn' transport event per call, but the API path (anthropic/openai) has no transport log, so without
 *  this the rollup passes (windows/arcs/coherence/digests/profiles) were invisible on API — the "api jobs don't
 *  get logged" gap (2026-07-18). The scene readers log their own richer event (with the working-set parts audit)
 *  and don't use this. */
async function completeLogged(
  kind: 'window' | 'entity-window' | 'coherence' | 'digest' | 'profile',
  targetId: string,
  system: string,
  user: string,
  model: string,
  signal: AbortSignal,
  valid?: (text: string) => boolean
): Promise<string> {
  const t0 = Date.now()
  const text = await complete(system, user, model, signal, valid)
  logIngestEvent({ kind, targetId, ms: Date.now() - t0, model, promptChars: user.length, responseChars: text.length, status: 'ok' })
  return text
}

async function anthropicText(system: string, user: string, model: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey })
  // temperature 0 — extraction is a deterministic read, not creative writing; minimizes run-to-run drift.
  const stream = client.messages.stream({ model, max_tokens: currentOutCap, temperature: 0, system, messages: [{ role: 'user', content: user }] }, { signal })
  const msg = await stream.finalMessage()
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
}

async function openaiText(system: string, user: string, model: string, apiKey: string, baseUrl: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Novel Visual Studio' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: currentOutCap, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal
  })
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

// The plan subprocess reports some failures as ordinary ASSISTANT TEXT (subtype 'success') instead of
// throwing — an org-policy block, a login/session lapse. That text then looked like a completion: it got
// cached and every re-read replayed it as "unparseable JSON" in 0.0s (the poisoned-cache bug, 2026-07-17).
// Detect the known sentinels and raise them as a FATAL AiError so the run PAUSES with the real reason and
// nothing gets memoized. Matched loosely (lowercased substring) — the CLI's exact wording drifts.
const PLAN_ERROR_SENTINELS: { needle: string; kind: AiFailureKind; message: string }[] = [
  { needle: 'disabled claude subscription access', kind: 'auth', message: 'Your organization has disabled Claude subscription access for Claude Code. Switch this analysis connection to an API key (Settings → AI), or re-enable subscription access.' },
  { needle: 'usage limit', kind: 'session', message: 'Claude Code usage/session limit reached — wait, or switch this analysis connection to an API key.' },
  { needle: 'session limit', kind: 'session', message: 'Claude Code usage/session limit reached — wait, or switch this analysis connection to an API key.' },
  { needle: 'please run /login', kind: 'auth', message: 'Claude Code is signed out — run the Claude Code login, or switch this analysis connection to an API key.' },
  { needle: 'invalid api key', kind: 'auth', message: 'Claude Code authentication failed — re-login, or switch this analysis connection to an API key.' }
]

/** A plan reply that is actually a backend error-as-text → the matching fatal AiError, else null. Guards the
 *  short replies only: a real extraction is thousands of chars of JSON, an error sentinel is a one-liner. */
function planSentinelError(text: string): AiError | null {
  if (text.length > 400) return null // real extractions are long; sentinels are short one-liners
  const low = text.toLowerCase()
  const hit = PLAN_ERROR_SENTINELS.find((s) => low.includes(s.needle))
  return hit ? new AiError(hit.kind, hit.message, { fatal: true }) : null
}

/**
 * Claude Code (keyless). Reading 20 scenes one-shot would pay the agent subprocess cold-start (~1–2 min)
 * PER scene — so we route through the warm session first (boots once, amortized across the batch, recycled
 * by its context budget). Falls back to a fresh one-shot `query` if the warm path is unavailable.
 */
async function planText(system: string, user: string, model: string, signal: AbortSignal): Promise<string> {
  const cwd = engine.currentProject()?.root ?? process.cwd()
  const warm = await runPlanComplete(system, user, model, cwd, signal)
  if (warm !== null) {
    const sentinel = planSentinelError(warm)
    if (sentinel) throw sentinel // a backend error surfaced as text — pause the run, don't cache it
    return warm
  }

  // One-shot fallback under the SAME watchdog discipline as the warm path (guard/withTimeout): a wedged
  // subprocess FAILS the step (runner marks it failed, batch continues) — it can never hang the run.
  const t0 = Date.now()
  const out = await withTimeout(
    async (ac) => {
      let text = ''
      let result = ''
      for await (const msg of query({
        prompt: user,
        options: { ...(model ? { model } : {}), systemPrompt: system, tools: [], permissionMode: 'bypassPermissions', settingSources: [], cwd, maxTurns: 1, abortController: ac }
      })) {
        if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'text') text += b.text
        } else if (msg.type === 'result' && msg.subtype === 'success') {
          result = msg.result
        }
      }
      return text || result
    },
    { ms: Number(process.env.NVS_PLAN_TURN_TIMEOUT ?? 600_000), label: 'plan one-shot read', signal }
  )
  // Same transport telemetry as warm turns — one-shots were invisible in the JSONL, which made nights like
  // the ch003 "15.4s" read impossible to reconstruct (which path ran? how fast was it actually?).
  logIngestEvent({ kind: 'plan-turn', ms: Date.now() - t0, model, backend: 'plan', warm: false, promptChars: user.length, responseChars: out.length, status: 'ok', note: 'one-shot' })
  const sentinel = planSentinelError(out)
  if (sentinel) throw sentinel // backend error-as-text on the one-shot path too — pause, don't cache
  return out
}

