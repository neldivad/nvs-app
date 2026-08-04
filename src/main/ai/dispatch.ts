/**
 * The one place AI tool names bind to engine calls — reused by BOTH adapters (the in-app agent
 * runner and the MCP server). The catalog (src/shared/config/aiTools.ts) declares the tools; this
 * executes them. writeTier stamps model + input_hash and the engine validates, so a tool call can
 * never corrupt the DB — it only proposes content.
 */
import { BrowserWindow } from 'electron'
import * as engine from '@engine/index'
import { CHANNELS, type ProjectChange, type TierWrite, type SceneFile, type WorldPage, type StoryNode } from '@shared/ipc'
import { slugId } from '@shared/contentId'
import { checkSceneFormat } from '@shared/config/formatCheck'
import { resolveFolder, nearestFolders } from '@shared/config/folderMatch'
import { teachError, nearestStrings } from '@shared/config/toolResult'
import { enqueueTask } from './taskQueue'
import { startIngestRun, getIngestProgress } from './ingestRunner'

/** Tell every window an out-of-band write changed files on disk → re-fetch the tree/scenes/world + toast it. */
function notifyProjectChanged(change: ProjectChange): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.onProjectChanged, change)
  } catch {
    /* headless (ELECTRON_RUN_AS_NODE) — no BrowserWindow */
  }
}

/**
 * Resolve an agent-supplied page ref to a scene / world page. Agents cite pages by absolute path, relPath
 * (under content/story), scene_id/id, or a bare filename/suffix — accept ALL (in-app links do too, via
 * openLinkedPage), so queuePageEdit/setPhase never fails on a path-form mismatch. This was the "no page found"
 * loop: SceneFile.path is ABSOLUTE, but agents naturally pass the relPath they see in listScenes/listStoryTree.
 */
function resolveScene(ref: string): SceneFile | undefined {
  const r = ref.trim()
  const norm = r.replace(/^\.?\/+/, '').replace(/^content\/story\//, '')
  const scenes = engine.listScenes()
  return (
    scenes.find((s) => s.path === r || s.relPath === r || s.relPath === norm || s.sceneId === r) ??
    scenes.find((s) => s.path.endsWith('/' + norm) || s.relPath.endsWith('/' + norm)) ??
    // By TITLE — the agent HAS titles from listScenes, so accept "Ending Note" instead of it hallucinating a
    // filename/path. Exact (case-insensitive) only, to stay unambiguous.
    scenes.find((s) => s.title.toLowerCase() === r.toLowerCase())
  )
}
function resolveWorld(ref: string): WorldPage | undefined {
  const r = ref.trim()
  const norm = r.replace(/^\.?\/+/, '').replace(/^content\/world\//, '')
  const pages = engine.listWorldPages()
  return pages.find((p) => p.path === r || p.id === r) ?? pages.find((p) => p.path.endsWith('/' + norm))
}

/** All story folders, flattened deep. */
function allStoryFolders(nodes: StoryNode[] = engine.listStoryTree(), out: StoryNode[] = []): StoryNode[] {
  for (const n of nodes) if (n.type === 'folder') { out.push(n); allStoryFolders(n.children ?? [], out) }
  return out
}

/** Resolve a folder REF to ONE folder — FORGIVING, because a model guesses names loosely (the "keeps getting
 *  stuck" loop was an exact-match reject of "Event Quests" vs the real "Event Quest"). Tries: exact relPath/name
 *  (raw + `content/story/`-stripped) → case-insensitive relPath/name/path-suffix → a UNIQUE substring hit either
 *  way. Ambiguous or none → null; the caller then lists folderRelPaths() so the model retries with a real string
 *  instead of re-calling listStoryTree. */
/** Resolve a folder REF forgivingly against the live on-disk tree — the pure logic (+ its test) lives in
 *  @shared/config/folderMatch; here we just feed it allStoryFolders(). */
function resolveStoryFolder(ref: string): StoryNode | null {
  return resolveFolder(ref, allStoryFolders())
}

// ── Enumerator guards ───────────────────────────────────────────────────────────
// The result the model sees is clamped at 6000 chars (providers.ts). A raw full enumeration on a big project
// blows past that and is TRUNCATED into invalid JSON — which the model reads as "the folder isn't here" → false
// "doesn't exist". These guards make an over-budget list DECLARE ITSELF PARTIAL and redirect to `search` (which
// scans server-side and returns only top-k), instead of silently lying. The principle: don't enumerate the
// universe into context — query it.
const LIST_BUDGET = 4500 // chars — comfortably under the 6000 clamp so a guarded result never truncates
const FIND_NOTE = 'To FIND a specific item use search("name") — do NOT scan this list to check existence, and never conclude something is absent from it.'

/** Bound a flat enumeration: return it unchanged when it fits, else a head + { total, shown, truncated, note }
 *  telling the model this is partial and to `search` instead. Never a silently-truncated array. */
function capList<T>(items: readonly T[], note = FIND_NOTE): unknown {
  if (JSON.stringify(items).length <= LIST_BUDGET) return items // small project → identical behavior
  let shown = items.length
  while (shown > 1 && JSON.stringify(items.slice(0, shown)).length > LIST_BUDGET) shown = Math.floor(shown * 0.8)
  return { items: items.slice(0, shown), total: items.length, shown, truncated: true, note }
}

/** Deep count of scene nodes in a story tree. */
function countScenes(nodes: StoryNode[]): number {
  let n = 0
  for (const x of nodes) x.type === 'scene' ? n++ : (n += countScenes(x.children ?? []))
  return n
}

/**
 * The story tree, made truncation-proof. Small project → the full tree + a note pointing "find" at `search`.
 * Big project → FOLDER PATHS ONLY (scenes omitted) + `partial: true` + a redirect, so it fits the clamp and the
 * model is TOLD it's partial instead of being handed a silently-cut dump. Either way `search` is the finder and
 * this is never an existence oracle.
 */
function storyTreeResult(): unknown {
  const tree = engine.listStoryTree()
  if (JSON.stringify(tree).length <= LIST_BUDGET) return { tree, note: FIND_NOTE }
  const folders = allStoryFolders(tree).map((f) => f.relPath)
  const capped = folders.length > 200 ? folders.slice(0, 200) : folders
  return {
    folders: capped,
    totalFolders: folders.length,
    totalScenes: countScenes(tree),
    partial: true,
    note: 'Large project — folder paths only (scenes omitted to fit). PARTIAL overview, NOT a finder: use search("name") to locate any folder/scene, or queuePageEdit(folder="name") to edit a folder. NEVER conclude something is absent from this list — search is the only authority on existence.'
  }
}

/** Folder relPaths for a "which did you mean?" error hint (capped so a huge tree can't flood the model). */
function folderRelPaths(): string[] {
  const all = allStoryFolders().map((n) => n.relPath)
  return all.length > 50 ? [...all.slice(0, 50), `…(+${all.length - 50} more)`] : all
}

/** Folder-not-found as a TEACHING error (tool-surface.md contract): echo the guess, offer the closest real
 *  relPaths, and hand back the literal retry call — never a bare dead-end. `retry` renders the next-call
 *  fragment from the best candidate so the model can copy instead of re-reason. */
function folderMiss(ref: string, retry: (rel: string) => string): unknown {
  const near = nearestFolders(ref, allStoryFolders())
  const valid = near.length ? near : folderRelPaths()
  return teachError(`no story folder matching "${ref}"`, valid, valid.length ? retry(valid[0]) : undefined)
}

/** Every scene (deep) under a story folder (ref resolved forgivingly). `null` = no such folder — so a bulk op
 *  can distinguish "folder not found" from "folder has no scenes". Shared by queuePageEdit + setPhase.
 *  Returns the RESOLVED folder too, so bulk results can echo what the ref actually landed on. */
function collectFolderScenes(ref: string): { folder: StoryNode; scenes: { path: string; title: string }[] } | null {
  const folder = resolveStoryFolder(ref)
  if (!folder) return null
  const scenes: { path: string; title: string }[] = []
  const collect = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'scene') scenes.push({ path: n.path, title: n.title ?? n.name })
      else if (n.children) collect(n.children)
    }
  }
  collect(folder.children ?? [])
  return { folder, scenes }
}

/** Resolution echo (from the "Event Quests Afterword" incident): when a folder ref resolved FUZZILY — the
 *  squashed ref matches neither the folder's name nor its relPath — the result SAYS SO, so a silent
 *  substitution of a different target than the author named becomes visible to the model AND the transcript.
 *  Success results carry it as `note`; the model is required (completion audit) to report substitutions. */
function resolutionNote(ref: string, folder: { name: string; relPath: string }): string | undefined {
  const sq = (s: string): string => s.replace(/^content\/story\//, '').toLowerCase().replace(/[\s\p{P}]+/gu, '')
  return sq(ref) === sq(folder.name) || sq(ref) === sq(folder.relPath)
    ? undefined
    : `ref "${ref}" resolved to folder "${folder.relPath}" — report this resolution to the author; if it is not the folder they meant, stop and search("${ref}") instead.`
}

/** Run a catalog tool by name. `model` tags writes with the calling adapter ('session:host' | 'session:mcp'). */
export function callTool(name: string, input: Record<string, unknown>, model: string): unknown {
  switch (name) {
    case 'currentProject': return engine.currentProject()
    case 'mcpStats': return engine.cacheStats()
    case 'projectInfo': return engine.readProjectInfo()
    case 'listScenes': return capList(engine.listScenes())
    case 'search': return engine.searchAll(String(input.query ?? ''), typeof input.limit === 'number' ? input.limit : undefined)
    case 'readScene': {
      // Resolve the ref the forgiving way (scene_id · title · relPath · absolute path) like the write tools do,
      // so callers can pass a SHORT id/title instead of a full absolute path (keeps handoff prompts compact).
      const ref = String(input.path ?? '')
      const sc = resolveScene(ref)
      if (sc) return engine.readScene(sc.path)
      try {
        return engine.readScene(ref) // fall through to the raw ref (world pages, absolute paths)
      } catch {
        // Teaching error instead of a thrown ENOENT: echo the guess, offer the nearest real refs, hand back
        // the literal retry — the model copies a `valid` entry instead of re-guessing a path shape.
        const near = nearestStrings(ref, [...engine.listScenes().map((s) => s.relPath), ...engine.listWorldPages().map((p) => p.path)])
        return teachError(`no scene or page matching "${ref}"`, near, near.length ? `readScene({ path: "${near[0]}" })` : `search("${ref}") to find the right ref first`)
      }
    }
    case 'exportFormat': {
      const path = String(input.path)
      const fmt = String(input.format)
      const format = (['md', 'json', 'csv', 'srt'] as const).includes(fmt as 'md') ? (fmt as 'md' | 'json' | 'csv' | 'srt') : 'md'
      try {
        return { path, format, content: engine.serializeSceneStructured(path, format) }
      } catch (e) {
        // srt-of-an-untimed-scene throws BY DESIGN (structured.ts). For an agent, surface it as a `note` + empty
        // content — a soft signal to pick another format — rather than a hard tool error.
        return { path, format, content: '', note: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'checkPageFormat': {
      const issues = checkSceneFormat(engine.readScene(String(input.path)).body)
      return { clean: issues.length === 0, issues }
    }
    case 'listStoryTree': return storyTreeResult()
    case 'listBoards': return engine.listBoards()
    case 'readBoard': return engine.readBoard(String(input.boardId))
    case 'readCard': return engine.readCard(String(input.boardId), String(input.cardId))
    case 'listWorldPages': return capList(engine.listWorldPages())
    case 'listCustodyTopics': return capList(engine.listCustodyTopics())
    case 'listThreads': return capList(engine.listThreads())
    case 'listCoherenceFindings': return capList(engine.listCoherenceFindings())
    case 'listCharacterArcs': return capList(engine.listCharacterArcs())
    case 'listCast': return capList(engine.listCast())
    case 'listStructuralIssues': return capList(engine.listIntegrityIssues())
    case 'listLoreView': { // was MISSING from the switch → "unknown tool" for a catalogued tool; wired + bounded
      const lv = engine.listLoreView()
      return { topics: capList(lv.topics), clock: capList(lv.clock) }
    }
    case 'queryDb': return engine.queryDb(String(input.sql))
    case 'listTierStatus': return capList(engine.listTierStatus())
    case 'tierInputHash':
      return engine.tierInputHash(input.kind as 'scene' | 'window' | 'coherence', String(input.targetId), (input.asOf as string | null) ?? null)
    case 'writeTier': {
      const kind = input.kind as 'scene' | 'window' | 'coherence'
      const targetId = String(input.targetId)
      const asOf = (input.asOfUnitId as string | null) ?? null
      const inputHash = engine.tierInputHash(kind, targetId, asOf)
      return engine.writeTier({ tier: input.tier, kind, targetId, asOfUnitId: asOf, model, inputHash, rows: input.rows } as TierWrite)
    }
    case 'queuePageEdit': {
      const instruction = String(input.instruction)
      const mode = input.mode === 'replace' ? 'replace' : 'append'
      // Folder bulk — queue the SAME instruction on EVERY scene under a folder in ONE call ("queue all edits"),
      // instead of the agent listing scenes and iterating (the fragile path a weak model loops on).
      if (input.folder != null && input.folder !== '') {
        const hit = collectFolderScenes(String(input.folder))
        if (hit === null) return folderMiss(String(input.folder), (rel) => `queuePageEdit({ folder: "${rel}", instruction, mode: "${mode}" })`)
        if (hit.scenes.length === 0) return { error: `folder "${input.folder}" exists but has no scenes (check its subfolders in listStoryTree).` }
        const taskIds = hit.scenes.map((s) => enqueueTask({ pagePath: s.path, pageTitle: s.title, pageKind: 'scene', instruction, mode, baseText: engine.readScene(s.path).body }))
        const note = resolutionNote(String(input.folder), hit.folder)
        return { ok: true, queued: taskIds.length, taskIds, folder: hit.folder.relPath, ...(note ? { note } : {}) }
      }
      const path = String(input.path ?? '')
      const scene = resolveScene(path)
      if (scene) {
        const id = enqueueTask({ pagePath: scene.path, pageTitle: scene.title, pageKind: 'scene', instruction, mode, baseText: engine.readScene(scene.path).body })
        return { ok: true, taskId: id }
      }
      const wp = resolveWorld(path)
      if (wp) {
        const id = enqueueTask({ pagePath: wp.path, pageTitle: wp.name, pageKind: wp.kind, instruction, mode, baseText: engine.readScene(wp.path).body })
        return { ok: true, taskId: id }
      }
      // Teaching error (tool-surface.md): echo the guess, offer nearest real refs, literal retry fragment.
      const near = nearestStrings(path, [...engine.listScenes().map((s) => s.relPath), ...engine.listWorldPages().map((p) => p.path)])
      return teachError(
        `no page at "${path}"`,
        near,
        near.length ? `queuePageEdit({ path: "${near[0]}", instruction, mode: "${mode}" })` : 'find the page first — search("<its name>") and pass a returned ref, or use `folder` to edit a whole folder in one call'
      )
    }
    case 'createPage': {
      // Direct create (additive + reversible by a manual delete — see internal/pending.md). We stamp the
      // page as AI-generated (a VISIBLE note + frontmatter) instead of an undo: the author finds it, reviews
      // it, and sets its status when ready. There is deliberately NO agent delete tool (deletes are a hard
      // rm — author-only).
      const kind = String(input.kind)
      const title = String(input.name).trim()
      const id = slugId(title) || 'untitled'
      const now = new Date()
      // Kind-aware note: only SCENES have a canon gate (setPhase). World pages are always-live reference.
      const note =
        (kind === 'scene'
          ? `> 🤖 Generated by AI on ${now.toLocaleString()}. Review it, then mark the scene canon (so analysis reads it) when it's ready.`
          : `> 🤖 Generated by AI on ${now.toLocaleString()}. An AI draft — review and edit it.`) + '\n\n'
      const body = note + (input.body ? String(input.body) : '')
      const fm: Record<string, unknown> = { title, generated_by: 'ai', generated_at: now.toISOString() }
      if (kind === 'scene') {
        const path = engine.createSceneInFolder(String(input.folder ?? ''), id, { ...fm, scene_id: id }, body)
        if (!path) return { error: 'could not create scene (open a work first?)' }
        engine.ingestWork() // T1 so it shows in analysis
        notifyProjectChanged({ action: 'create', path, title }) // renderer re-fetches + toasts
        return { ok: true, path }
      }
      const page = engine.createWorldPage(kind as 'character' | 'location' | 'item' | 'lore', id, fm, body)
      if (!page) return { error: `could not create ${kind} page` }
      notifyProjectChanged({ action: 'create', path: page.path, title })
      return { ok: true, path: page.path }
    }
    case 'setPhase': {
      // The canon gate — opened to the agent 2026-07-10 (author's ruling, mirroring the UI's new folder/
      // category bulk). Policy lives in the tool description: ONLY on explicit author request. Bulk pays
      // the re-ingest once, like the renderer's setPagePhaseBulk.
      const phase = String(input.phase)
      const targets: { path: string; title: string }[] = []
      let note: string | undefined
      if (input.path) {
        const path = String(input.path)
        const sc = resolveScene(path)
        const wp = sc ? null : resolveWorld(path)
        if (!sc && !wp) {
          const near = nearestStrings(path, [...engine.listScenes().map((s) => s.relPath), ...engine.listWorldPages().map((p) => p.path)])
          return teachError(`no page found at "${path}"`, near, near.length ? `setPhase({ path: "${near[0]}", phase: "${phase}" })` : `search("${path}") to find the right ref first`)
        }
        targets.push({ path: sc?.path ?? wp!.path, title: sc?.title ?? wp!.name })
      } else if (input.folder) {
        const rel = String(input.folder)
        const collect = (nodes: import('@shared/ipc').StoryNode[]): void => {
          for (const n of nodes) {
            if (n.type === 'scene') targets.push({ path: n.path, title: n.title ?? n.name })
            else if (n.children) collect(n.children)
          }
        }
        const folder = resolveStoryFolder(rel)
        if (!folder) return folderMiss(rel, (r) => `setPhase({ folder: "${r}", phase: "${phase}" })`)
        note = resolutionNote(rel, folder)
        collect(folder.children ?? [])
      } else if (input.category) {
        const kind = String(input.category)
        for (const p of engine.listWorldPages()) if (p.kind === kind && p.phase !== 'archived') targets.push({ path: p.path, title: p.name })
        if (!targets.length) {
          const kinds = [...new Set(engine.listWorldPages().map((p) => p.kind))]
          const ranked = nearestStrings(kind, kinds)
          const valid = ranked.length ? ranked : kinds
          return teachError(`no pages in world category "${kind}"`, valid, valid.length ? `setPhase({ category: "${valid[0]}", phase: "${phase}" })` : undefined)
        }
      } else if (input.allScenes === true) {
        for (const s of engine.listScenes()) targets.push({ path: s.path, title: s.title })
      } else {
        return { error: 'give exactly one target: path | folder | category | allScenes' }
      }
      if (!targets.length) return { error: 'no pages matched the target' }
      for (const t of targets) {
        const doc = engine.readScene(t.path)
        engine.writeScene(t.path, { ...doc.frontmatter, phase }, doc.body)
      }
      engine.ingestWork() // once for the batch — the canon gate takes effect in the DB
      notifyProjectChanged({
        action: 'setPhase',
        path: targets[0].path,
        title: targets.length === 1 ? targets[0].title : `${targets.length} pages`,
        phase
      })
      return { ok: true, count: targets.length, phase, ...(note ? { note } : {}) }
    }
    case 'readTree':
      return engine.trees()
    case 'connectScenes':
      return engine.connectScenes(String(input.fromSceneId), String(input.toSceneId), input.variantId ? String(input.variantId) : undefined)
    case 'connectScenesBatch': {
      const edges = Array.isArray(input.edges)
        ? (input.edges as unknown[]).map((e) => ({ from: String((e as { from: unknown }).from), to: String((e as { to: unknown }).to) }))
        : []
      return engine.connectScenesBatch(edges, { variantId: input.variantId ? String(input.variantId) : undefined, place: input.place !== false })
    }
    case 'createVariant': {
      const r = engine.createVariant({
        name: input.name ? String(input.name) : undefined,
        from: input.from === 'active' ? 'active' : 'empty',
        activate: input.activate !== false
      })
      // Nudge the renderer to re-read trees.json (new variant + possibly new activeId) and re-sync analysis/canvas.
      if (r.ok) notifyProjectChanged({ action: 'create', path: '', title: `new timeline “${r.name}”` })
      return r
    }
    case 'disconnectScenes':
      return engine.disconnectScenes(String(input.fromSceneId), String(input.toSceneId), input.variantId ? String(input.variantId) : undefined)
    case 'mergeThreads':
      return engine.mergeThreads(Array.isArray(input.threadIds) ? input.threadIds.map(String) : [])
    case 'mergeEntities':
      return engine.mergeEntities(Array.isArray(input.entityIds) ? input.entityIds.map(String) : [])
    case 'setRuling': {
      engine.setCoherenceRuling(String(input.entityId), String(input.trait), !!input.intentional)
      return { ok: true }
    }
    case 'runAnalysis': {
      if (getIngestProgress()?.active) return { ok: true, started: false, note: 'a run is already active — see the Jobs dashboard' }
      const forced = Array.isArray(input.scenes) ? input.scenes.map(String) : undefined
      // TEACHING GUARD: analysis reads CANON scenes only — draft scenes are excluded from the frontier
      // (writeTier.planIngestSteps), even when force-read. Without this, an all-draft project fired a run that
      // did NOTHING yet returned started:true — a silent no-op that reads as success and costs a whole
      // debugging session before you notice zero output. Refuse loudly with the reason instead.
      const rows = engine.listTierStatus()
      const draft = rows.filter((r) => r.phase === 'draft').length
      const canon = rows.length - draft
      if (canon === 0) {
        return {
          ok: false,
          error: draft > 0
            ? `nothing to analyze — all ${draft} scene(s) are DRAFT. Analysis reads CANON scenes only (draft is invisible to it, even when force-read). Set \`phase: canon\` in the scene frontmatter, then re-run.`
            : `nothing to analyze — no canon scenes in the frontier. Check the scenes are ingested (ingestWork) and connected on the timeline, and that drafts are promoted to canon.`
        }
      }
      void startIngestRun(forced) // fire-and-forget: the run streams to the Jobs surface
      const skip = draft > 0 ? ` (${draft} draft scene(s) skipped — canon only)` : ''
      return { ok: true, started: true, note: `analysis started${skip} — progress shows in the Jobs dashboard` }
    }
    // ── LIFECYCLE (registered ONLY by the trusted headless adapter; IN_APP_TOOLS excludes them) ──
    case 'openWork': {
      const meta = engine.openWork(String(input.path ?? ''))
      return meta ? { ok: true, work: meta } : { ok: false, error: `not a valid work (needs a content/ folder): ${String(input.path ?? '')}` }
    }
    case 'ingestWork': {
      if (!engine.currentProject()) return { ok: false, error: 'no work open — call openWork first' }
      return { ok: true, result: engine.ingestWork() }
    }
    case 'moveStoryPaths': {
      // The generic restructuring primitive — POLICY stays in the conversation (the author confirmed a shown
      // plan); the app only executes guarded moves (no overwrite, archive protected, prose bytes untouched).
      const moves = Array.isArray(input.moves) ? (input.moves as Array<{ from: unknown; to: unknown }>).map((m) => ({ from: String(m.from), to: String(m.to) })) : []
      const results = moves.map((m) => ({ ...m, ok: engine.renamePath(m.from, m.to) }))
      const moved = results.filter((r) => r.ok).length
      if (moved) {
        engine.ingestWork() // one T1 re-ingest for the batch — paths changed, scene_ids didn't
        notifyProjectChanged({ action: 'create', path: results.find((r) => r.ok)?.to ?? '', title: `moved ${moved} item${moved === 1 ? '' : 's'}` })
      }
      return { moved, results }
    }
    case 'removeEmptyStoryFolders': {
      // Content-safe by construction: any folder still containing a scene is REFUSED — this can delete
      // structure (empty shells + sidecars), never prose.
      const rels = Array.isArray(input.folders) ? input.folders.map(String) : []
      const hasScenes = (n: import('@shared/ipc').StoryNode): boolean => (n.children ?? []).some((k) => k.type === 'scene' || (k.type === 'folder' && hasScenes(k)))
      const findFolder = (nodes: import('@shared/ipc').StoryNode[], rel: string): import('@shared/ipc').StoryNode | null => {
        for (const n of nodes) {
          if (n.type !== 'folder') continue
          if (n.relPath === rel) return n
          const hit = n.children ? findFolder(n.children, rel) : null
          if (hit) return hit
        }
        return null
      }
      const tree = engine.listStoryTree()
      const removed: string[] = []
      const refused: string[] = []
      for (const rel of rels) {
        const node = findFolder(tree, rel)
        if (!node) refused.push(`${rel} (not found)`)
        else if (node.protected) refused.push(`${rel} (protected)`)
        else if (hasScenes(node)) refused.push(`${rel} (still contains scenes)`)
        else if (engine.deletePath(rel)) removed.push(rel)
        else refused.push(`${rel} (delete failed)`)
      }
      if (removed.length) engine.ingestWork()
      return { removed, refused }
    }
    default:
      return { error: `unknown tool ${name}` }
  }
}
