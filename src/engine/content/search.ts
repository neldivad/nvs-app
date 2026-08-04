/**
 * The ONE general search over a project's content — the agent's `search` tool (and reusable anywhere). Answers
 * "where is X?" across the whole work: story FOLDERS, SCENES, WORLD pages (character/lore/…), CUSTODY topics —
 * by NAME (fuzzy, via the shared normLoose), plus PROSE full-text via searchContent.
 *
 * Two RAG-shaped guarantees, on purpose:
 *   • TOP-K — results are ranked (name/exact before content) and capped to `limit`; `total`/`truncated` tell the
 *     caller to narrow rather than assume it saw everything. It never dumps the universe into context.
 *   • POINTERS, NOT PAYLOADS — each hit is a { kind, ref } the caller acts on, with only a one-line snippet for
 *     content hits. The full page is fetched later via readScene on the ONE ref chosen — never returned here.
 */
import { normLoose } from '@shared/textMatch'
import { listStoryTree } from '@engine/content/storyTree'
import { listScenes, searchContent } from '@engine/content/scenes'
import { listWorldPages } from '@engine/content/world'
import { listCustodyTopics } from '@engine/content/custodyPages'
import type { SearchHit, SearchResult, StoryNode } from '@shared/ipc'

/** All folders, flattened deep. */
function allFolders(nodes: StoryNode[], out: StoryNode[] = []): StoryNode[] {
  for (const n of nodes) if (n.type === 'folder') { out.push(n); allFolders(n.children ?? [], out) }
  return out
}

/** Scenes (deep) under a folder node. */
function scenesUnder(node: StoryNode): number {
  let c = 0
  const walk = (ns: StoryNode[]): void => { for (const n of ns) { if (n.type === 'scene') c++; else if (n.children) walk(n.children) } }
  walk(node.children ?? [])
  return c
}

export function searchAll(root: string, query: string, limit = 25): SearchResult {
  const nq = normLoose(query)
  if (!nq) return { hits: [], total: 0, truncated: false } // empty / punctuation-only → nothing to match

  // Rank a candidate by its best name/alias match: exact = 0, prefix = 1, substring = 2, none = null (drop).
  const rankOf = (candidates: string[]): number | null => {
    let best: number | null = null
    for (const c of candidates) {
      const ns = normLoose(c)
      if (!ns) continue
      const r = ns === nq ? 0 : ns.startsWith(nq) || nq.startsWith(ns) ? 1 : ns.includes(nq) || nq.includes(ns) ? 2 : null
      if (r !== null && (best === null || r < best)) best = r
    }
    return best
  }

  const seen = new Set<string>() // ref dedupe across name + content passes
  const named: (SearchHit & { rank: number })[] = []
  const add = (rank: number | null, hit: SearchHit): void => {
    if (rank === null || seen.has(hit.ref)) return
    seen.add(hit.ref)
    named.push({ ...hit, rank })
  }

  // FOLDERS (name / relPath) → ref = relPath (feed queuePageEdit `folder`)
  for (const f of allFolders(listStoryTree(root))) {
    add(rankOf([f.name, f.relPath]), { kind: 'folder', ref: f.relPath, name: f.name, matchedOn: 'name', sceneCount: scenesUnder(f) })
  }
  // SCENES (title / scene_id) → ref = absolute path (feed readScene or queuePageEdit `path`)
  for (const s of listScenes(root)) {
    add(rankOf([s.title, s.sceneId, s.relPath]), { kind: 'scene', ref: s.path, name: s.title, matchedOn: 'name' })
  }
  // WORLD pages (name / aliases / id) → ref = absolute path
  const worldKind = new Map<string, SearchHit['kind']>()
  for (const p of listWorldPages(root)) {
    worldKind.set(p.path, p.kind as SearchHit['kind'])
    add(rankOf([p.name, p.id, ...(p.aliases ?? [])]), { kind: p.kind as SearchHit['kind'], ref: p.path, name: p.name, matchedOn: 'name' })
  }
  // CUSTODY topics (name) → ref = absolute path
  for (const t of listCustodyTopics(root)) {
    add(rankOf([t.name, t.pageId]), { kind: 'custody', ref: t.path, name: t.name, matchedOn: 'name' })
  }

  named.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))

  // CONTENT (prose full-text) — snippets only; dedupe against the name hits above by ref.
  const content: SearchHit[] = []
  for (const m of searchContent(root, query, limit)) {
    const ref = m.kind === 'scene' ? m.path : m.path // absolute either way (name-hit scenes also use abs path)
    if (seen.has(ref) || seen.has(m.relPath)) continue
    seen.add(ref)
    const kind: SearchHit['kind'] = m.kind === 'scene' ? 'scene' : m.kind === 'custody' ? 'custody' : (worldKind.get(m.path) ?? 'lore')
    content.push({ kind, ref, name: m.title, matchedOn: 'content', snippet: m.snippet })
  }

  const ranked: SearchHit[] = [...named.map(({ rank: _rank, ...h }) => h), ...content]
  return { hits: ranked.slice(0, limit), total: ranked.length, truncated: ranked.length > limit }
}
