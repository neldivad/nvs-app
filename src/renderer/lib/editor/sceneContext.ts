/**
 * useSceneContext — the DERIVED per-scene ledger for the currently-open scene, shared by the EditorFab's
 * "on this scene" popover and the SceneInspector aside so the two never drift. Everything here is read straight
 * from already-loaded store state (no new IPC): the scene's auto-written summary, the threads landing on it, and
 * the coherence flags that CITE it. Non-scene pages return `isScene: false`.
 */
import { useMemo } from 'react'
import { useWorkspace } from '@/stores/workspace'
import type { CoherenceFinding, Thread } from '@shared/ipc'

/** A cast member present in the scene, name resolved for display. */
export interface SceneCastMember {
  entityId: string
  name: string
  role?: string
  volume?: number // dialogue characters spoken (0/undefined = silently present)
}

export interface SceneContext {
  isScene: boolean
  sceneId: string | null
  summary: string | null // extracted_scenes.summary — the derived one-line synopsis (Scrivener's card, computed)
  pov: string | null // effective POV entity (display name)
  cast: SceneCastMember[] // entity_presence for this scene, most lines first
  arcBeats: string[] // scene-level arc beat types (INTRODUCED | DEATH | …) — the enters/exits signal
  threads: { action: string; thread: Thread }[]
  flags: CoherenceFinding[]
}

export function useSceneContext(): SceneContext {
  const activePath = useWorkspace((s) => s.activePage?.path)
  const kind = useWorkspace((s) => s.activePage?.kind)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const allThreads = useWorkspace((s) => s.threads)
  const coherence = useWorkspace((s) => s.coherence)
  const characters = useWorkspace((s) => s.characters)

  return useMemo(() => {
    const none: SceneContext = { isScene: false, sceneId: null, summary: null, pov: null, cast: [], arcBeats: [], threads: [], flags: [] }
    const scene = scenes.find((s) => s.path === activePath)
    const sceneId = scene?.sceneId ?? null
    if (kind !== 'scene' || !sceneId) return none
    const sc = graph.scenes[sceneId]
    // entityId → display name (falls back to a prettified id for silent/minor entities not in the cast pick-list).
    const nameOf = (id: string): string => characters.find((c) => c.id === id)?.name ?? id.replace(/[-_]/g, ' ')
    const byId = new Map((allThreads ?? []).map((t) => [t.id, t]))
    const threads = (sc?.threads ?? [])
      .map((te) => ({ action: te.action, thread: byId.get(te.threadId) }))
      .filter((x): x is { action: string; thread: Thread } => x.thread != null)
    const cast: SceneCastMember[] = (sc?.cast ?? [])
      .map((p) => ({ entityId: p.entityId, name: nameOf(p.entityId), role: p.role, volume: p.volume }))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    // DIRECT LINK ONLY: a finding belongs to this scene when its own evidence CITES this scene — never merely
    // because someone in the cast is named (that put every late-novel Liu Bei/Guan Yu/Cao Cao hole on chapter 1).
    const flags = (coherence ?? []).filter((f) => f.kind !== 'confirmation' && (f.evidence ?? []).includes(sceneId))
    return {
      isScene: true,
      sceneId,
      summary: sc?.summary ?? null,
      pov: sc?.pov ? nameOf(sc.pov) : null,
      cast,
      arcBeats: sc?.arcBeats ?? [],
      threads,
      flags
    }
  }, [activePath, kind, scenes, graph, allThreads, coherence, characters])
}
