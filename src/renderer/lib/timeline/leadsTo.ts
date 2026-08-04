/**
 * Timeline `leads_to` graph helpers — pure (StoryNode in, no store/IPC), so the cycle guard is unit-testable.
 * The store uses `reaches` to REFUSE a connection that would loop (A→B→A): scenes form a DAG.
 */
import type { StoryNode } from '@shared/ipc'

/** Map every scene by its stable sceneId (timeline edges reference these). */
export function sceneIndex(nodes: StoryNode[]): Map<string, StoryNode> {
  const map = new Map<string, StoryNode>()
  const walk = (ns: StoryNode[]): void => {
    for (const n of ns) {
      if (n.type === 'scene') map.set(n.sceneId ?? n.name, n)
      else if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return map
}

/**
 * Analyze the connection graph over a set of scenes — the Gantt axis branch-detector. A Gantt X-axis is 1-D,
 * so it can only follow ONE clean line; this surfaces when the connections DON'T collapse to one (a fork/merge
 * or loose scenes) instead of silently linearizing them. Returns the chain order when it IS clean, else the
 * problems to show. `edgesOf(id)` yields a scene's out-edges — from the active TREE VARIANT's adjacency, or the
 * frontmatter `leads_to` when there's no variant (tree-variant model, internal/timeline-model.md). See chart-sequence.md.
 */
export interface LeadsToAnalysis {
  order: string[] | null // the single clean-chain order (start→end visiting every scene), else null
  clean: boolean // order !== null: one connected line, no fork, no merge
  hasEdges: boolean // any leads_to at all (false = nothing drawn yet → reading-order default)
  forks: { at: string; to: string[] }[] // a scene that leads_to more than one (a branch)
  merges: { at: string; from: string[] }[] // a scene reached from more than one (a join)
  isolated: string[] // scenes with no leads_to in OR out — loose, they tail on reading order
}

export function analyzeLeadsTo(sceneIds: readonly string[], edgesOf: (id: string) => readonly string[] | undefined): LeadsToAnalysis {
  const set = new Set(sceneIds)
  const out = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  for (const id of sceneIds) {
    out.set(id, [])
    inDeg.set(id, 0)
  }
  for (const id of sceneIds) {
    for (const to of edgesOf(id) ?? []) {
      if (set.has(to)) {
        out.get(id)!.push(to)
        inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
      }
    }
  }
  const forks = sceneIds.filter((id) => out.get(id)!.length > 1).map((at) => ({ at, to: out.get(at)!.slice() }))
  const merges = sceneIds.filter((id) => (inDeg.get(id) ?? 0) > 1).map((at) => ({ at, from: sceneIds.filter((s) => out.get(s)!.includes(at)) }))
  const isolated = sceneIds.filter((id) => out.get(id)!.length === 0 && (inDeg.get(id) ?? 0) === 0)
  const hasEdges = sceneIds.some((id) => out.get(id)!.length > 0)

  // A single clean chain: no fork/merge, exactly one start (in-degree 0 with an outgoing edge), and following
  // the line from it visits every scene.
  let order: string[] | null = null
  if (hasEdges && !forks.length && !merges.length) {
    const starts = sceneIds.filter((id) => (inDeg.get(id) ?? 0) === 0 && out.get(id)!.length > 0)
    if (starts.length === 1) {
      const chain: string[] = []
      const seen = new Set<string>()
      let cur: string | undefined = starts[0]
      while (cur && !seen.has(cur)) {
        chain.push(cur)
        seen.add(cur)
        cur = out.get(cur)![0]
      }
      if (chain.length === sceneIds.length) order = chain
    }
  }
  return { order, clean: order !== null, hasEdges, forks, merges, isolated }
}

/** True if `target` can already reach `from` via leads_to — i.e. linking `from → target` would cycle. */
export function reaches(index: Map<string, StoryNode>, target: string, from: string): boolean {
  const seen = new Set<string>()
  const stack = [target]
  while (stack.length) {
    const id = stack.pop()!
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(index.get(id)?.leadsTo ?? []))
  }
  return false
}
