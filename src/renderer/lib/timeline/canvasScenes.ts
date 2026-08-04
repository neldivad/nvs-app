/**
 * canvasScenes — the scene_ids currently PLACED on the timeline canvas (placed scene nodes + every scene under a
 * placed folder node). This is the working "subset": quick-connect, reset-connectors, and the Chart Config axis
 * builder all scope to it, so at Genshin volume you can work one region at a time (drag Liyue on → those surfaces
 * only touch Liyue). An EMPTY canvas means "no subset" — callers fall back to every scene. Pure.
 */
import type { StoryNode, TimelineNode } from '@shared/ipc'

/** Every scene_id beneath a node (recursive). */
function collectScenes(node: StoryNode, into: Set<string>): void {
  for (const c of node.children ?? []) {
    if (c.type === 'scene') { if (c.sceneId) into.add(c.sceneId) }
    else collectScenes(c, into)
  }
}

/** Scenes under the folder at `folderRel` (its whole subtree). */
function folderScenes(tree: StoryNode[], folderRel: string, into: Set<string>): void {
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue
      if (n.relPath === folderRel) collectScenes(n, into)
      else walk(n.children ?? [])
    }
  }
  walk(tree)
}

/** The scene_ids on the canvas: placed scene nodes + all scenes under placed folder nodes. Empty = empty canvas. */
export function canvasSceneIds(nodes: TimelineNode[], tree: StoryNode[]): Set<string> {
  const out = new Set<string>()
  for (const n of nodes) {
    if (n.kind === 'scene') out.add(n.sceneId)
    else if (n.kind === 'folder') folderScenes(tree, n.folderRel, out)
  }
  return out
}
