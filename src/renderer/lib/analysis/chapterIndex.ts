/**
 * The ONE format-agnostic chapter index, derived from the story FOLDER TREE — shared by every surface that
 * needs to map a scene/chapter reference to "which chapter" (the coherence map + detail, the arc float's
 * chapter scope, …). A reference may be a scene id (od-c2-s8, q1009, hamlet-a1-s5), a prefixed chapter
 * unit-id (c:chapters/005-act-v), or a bare chapter name (001-act-i); `resolveKey` maps every shape to a
 * chapter key (the folder's relPath). It NEVER parses a `c<digit>` token — that only ever fit one dataset.
 */
import type { StoryNode } from '@shared/ipc'

/** "001-act-i" → "act-i" — strip a leading numeric ordering prefix so all rails show the same band label.
 *  Pure (no component deps) so it lives with the chapter index and unit tests can import it directly. */
export const cleanChapterName = (name: string): string => name.replace(/^\s*\d+[\s._-]+/, '') || name

export interface ChapterIndex {
  sceneChapter: Map<string, string> // scene_id → chapter key (its folder relPath)
  chapters: Map<string, { title: string; sceneIds: string[] }> // chapter key → clean title + its scenes
  resolveKey: (id: string) => string | undefined
}

export function buildChapterIndex(tree: StoryNode[]): ChapterIndex {
  const sceneChapter = new Map<string, string>()
  const chapters = new Map<string, { title: string; sceneIds: string[] }>()
  const byFolderId = new Map<string, string>() // stable folderId (.id dotfile) → relPath key
  const byLabel = new Map<string, string>() // clean chapter label (band header text / `chapter:` frontmatter) → relPath
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue
      if (n.folderId) byFolderId.set(n.folderId, n.relPath)
      const sceneIds: string[] = []
      for (const c of n.children ?? []) {
        if (c.type !== 'scene') continue
        const sid = c.sceneId ?? c.name
        sceneChapter.set(sid, n.relPath)
        sceneIds.push(sid)
      }
      if (sceneIds.length) {
        const title = cleanChapterName(n.name)
        chapters.set(n.relPath, { title, sceneIds })
        // Index by the CLEAN label too (folder "001-C1" → "C1"), case-insensitively. The coherence/custody
        // analysis references a chapter by its `chapter:` frontmatter value (e.g. "C2", or "c:C4" for as_of) —
        // the SAME text the band header shows — not by folder relPath, so this is the bridge that lets those
        // findings land on their real column instead of collapsing to the as_of checkpoint (all dots pile right).
        if (!byLabel.has(title.toLowerCase())) byLabel.set(title.toLowerCase(), n.relPath) // first wins on a dup label
      }
      walk(n.children ?? [])
    }
  }
  walk(tree)
  const resolveKey = (id: string): string | undefined => {
    const viaScene = sceneChapter.get(id) // a scene id → its folder
    if (viaScene) return viaScene
    const bare = id.replace(/^[a-z]+:/i, '') // strip a "c:"/"s:" prefix → "005-act-v-e37c20" | "chapters/005-act-v" | "C4"
    const viaFolderId = byFolderId.get(bare) // a STABLE chapter unit id (c:<folderId> — the post-migration form)
    if (viaFolderId) return viaFolderId
    if (chapters.has(bare)) return bare // exact folder relPath (legacy path-keyed unit ids)
    for (const key of chapters.keys()) {
      if (key === bare || key.endsWith('/' + bare) || key.split('/').pop() === bare) return key // tail / folder name
    }
    // Chapter LABEL match — a bare/`chapter:`-frontmatter token ("C2", "c:C4"→"C4") → the chapter whose clean
    // name is that label. Both the raw token and its prefix-stripped clean form are tried (case-insensitive).
    return byLabel.get(bare.toLowerCase()) ?? byLabel.get(cleanChapterName(bare).toLowerCase())
  }
  return { sceneChapter, chapters, resolveKey }
}
