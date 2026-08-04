/**
 * cellGraph — folder CONTRACTION for the Cell view (internal/cell-canvas.md ★). The Cell view reads a scene-level
 * branch/merge graph, but a book placed whole is 120 stacked scene cards. When a placed folder is COLLAPSED (its
 * `folderRel` in the variant's `collapsed` set), we contract its whole subtree into ONE "folder cell": every
 * scene inside becomes that node, scene→scene edges that cross the folder boundary become folder↔node edges, and
 * edges wholly inside the folder vanish. Placed scenes and EXPANDED folders' scenes stay individual.
 *
 * The result is a plain (ids, adjacency) graph over MIXED node ids — scene_ids and `folder:<rel>` ids — so the
 * generic layout/route helpers (cellLayout, longestPath, routeThrough) consume it unchanged. Pure + testable.
 */
import type { StoryNode } from '@shared/ipc'

const FOLDER_PREFIX = 'folder:'
export const folderCellId = (folderRel: string): string => `${FOLDER_PREFIX}${folderRel}`
export const isFolderCell = (id: string): boolean => id.startsWith(FOLDER_PREFIX)
export const folderRelOf = (id: string): string => id.slice(FOLDER_PREFIX.length)

export interface CellNodeMeta {
  kind: 'scene' | 'folder'
  folderRel?: string // folder cell: the contracted folder's relPath
  title?: string // folder cell: its display name
  count?: number // folder cell: how many of its scenes are on the canvas
}

export interface CellGraph {
  ids: string[] // node ids in first-seen order — scene_ids + folder:<rel> ids
  adjacency: Record<string, string[]> // contracted edges (self-loops dropped, deduped)
  meta: Map<string, CellNodeMeta>
  repOf: (sceneId: string) => string // a scene_id → its representative node (folder cell or itself)
}

/** Every scene_id beneath a node (recursive). */
function collectScenes(node: StoryNode, into: Set<string>): void {
  for (const c of node.children ?? []) {
    if (c.type === 'scene') { if (c.sceneId) into.add(c.sceneId) }
    else collectScenes(c, into)
  }
}
/** The folder StoryNode at `folderRel` (or null) — for its scenes + display name. */
function findFolder(tree: StoryNode[], folderRel: string): StoryNode | null {
  const walk = (nodes: StoryNode[]): StoryNode | null => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue
      if (n.relPath === folderRel) return n
      const hit = walk(n.children ?? [])
      if (hit) return hit
    }
    return null
  }
  return walk(tree)
}

export interface PlacedFolder {
  folderRel: string
  collapsed: boolean
}

/**
 * Contract the collapsed placed folders of a canvas subset into folder cells. `subsetSceneIds` is the expanded
 * scene frontier (canvasSceneIds); `adjacency` is the variant's scene→scene graph; `placedFolders` are the
 * canvas's folder nodes with their collapse state. Nested collapse groups under the OUTERMOST collapsed folder
 * (shortest relPath) so a book collapses to its top block, not its innermost chapters.
 */
export function contractFolders(
  subsetSceneIds: readonly string[],
  adjacency: Record<string, readonly string[]>,
  placedFolders: readonly PlacedFolder[],
  tree: StoryNode[]
): CellGraph {
  const collapsed = placedFolders.filter((f) => f.collapsed).sort((a, b) => a.folderRel.length - b.folderRel.length)
  const folderScenes = new Map<string, Set<string>>()
  for (const f of collapsed) {
    const node = findFolder(tree, f.folderRel)
    const s = new Set<string>()
    if (node) collectScenes(node, s)
    folderScenes.set(f.folderRel, s)
  }
  const subset = new Set(subsetSceneIds)

  const repOf = (sid: string): string => {
    for (const f of collapsed) if (folderScenes.get(f.folderRel)!.has(sid)) return folderCellId(f.folderRel)
    return sid
  }

  // node ids: the reps of every subset scene, first-seen order (so the spine/sequence keeps reading order)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const sid of subsetSceneIds) {
    const r = repOf(sid)
    if (!seen.has(r)) { seen.add(r); ids.push(r) }
  }

  // contracted adjacency: map both ends through repOf, drop self-loops (intra-folder edges) + dups
  const adj: Record<string, string[]> = {}
  const add = (a: string, b: string): void => {
    if (a === b) return
    ;(adj[a] ??= [])
    if (!adj[a].includes(b)) adj[a].push(b)
  }
  for (const [from, tos] of Object.entries(adjacency)) {
    if (!subset.has(from)) continue
    const rf = repOf(from)
    for (const to of tos) {
      if (!subset.has(to)) continue
      add(rf, repOf(to))
    }
  }

  const meta = new Map<string, CellNodeMeta>()
  for (const id of ids) {
    if (isFolderCell(id)) {
      const rel = folderRelOf(id)
      const all = folderScenes.get(rel)!
      const count = [...all].filter((s) => subset.has(s)).length
      meta.set(id, { kind: 'folder', folderRel: rel, title: findFolder(tree, rel)?.name ?? rel, count })
    } else meta.set(id, { kind: 'scene' })
  }

  return { ids, adjacency: adj, meta, repOf }
}
