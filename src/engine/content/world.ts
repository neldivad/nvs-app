/**
 * World-page access (main process) — the "bible": characters, locations, items,
 * lore. For now we list characters (the cast), so the editor can offer them as a
 * pick-list instead of free text. Same .md + frontmatter shape as scenes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import matter from 'gray-matter'
import type { WorldPage } from '@shared/ipc'
import { uniqueId } from '@engine/content/storyTree'
import { MASTER_WORLD } from '@shared/config/worldCategories'
import { memoSlot, fingerprintDir } from '@engine/enumCache'

// [folder, kind] for every built-in world category — DERIVED from the master vocabulary so a category added to
// MASTER_WORLD (faction/suspect/clue/…) is scanned here automatically, instead of silently missing from the
// sidebar because this list drifted. (folder === content/world subfolder; kind === the category key.)
const KINDS: readonly (readonly [string, string])[] = MASTER_WORLD.map((c) => [c.folder, c.key])

/** The content/world subfolder for a kind (e.g. 'character' → 'characters'). */
function dirForKind(kind: WorldPage['kind']): string {
  return KINDS.find(([, k]) => k === kind)?.[0] ?? `${kind}s`
}

function pagesIn(dir: string, kind: WorldPage['kind']): WorldPage[] {
  if (!existsSync(dir)) return []
  const pages: WorldPage[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md') || /^readme\.md$/i.test(entry)) continue
    const path = join(dir, entry)
    let data: Record<string, unknown> = {}
    try {
      data = matter(readFileSync(path, 'utf8')).data as Record<string, unknown>
    } catch {
      /* fall back to filename */
    }
    const avatar = data.avatar ? String(data.avatar) : undefined
    const phase = data.phase ? String(data.phase) : undefined
    const aliases = Array.isArray(data.aliases)
      ? data.aliases.map(String)
      : typeof data.aliases === 'string' && data.aliases.trim()
      ? [String(data.aliases)]
      : []
    pages.push({
      id: String(data.id ?? basename(entry, '.md')),
      name: String(data.name ?? data.title ?? basename(entry, '.md')),
      path,
      kind,
      ...(avatar ? { avatar } : {}),
      ...(phase ? { phase } : {}),
      ...(aliases.length ? { aliases } : {})
    })
  }
  return pages.sort((a, b) => a.name.localeCompare(b.name))
}

const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g

/**
 * Backlinks: every world page whose body links to `pageId` (a `[Name](pageId)` mention).
 * On-demand single-pass scan — O(N) over all world pages, one read each (frontmatter + body
 * together), bounded memory. Fine for a page view at realistic sizes; for very large worlds
 * the answer is a materialized link index built on ingest (see notes). Powers "Mentioned by"
 * and lets an agent find connected pages.
 */
export function worldBacklinks(root: string, pageId: string): WorldPage[] {
  const base = join(root, 'content', 'world')
  const out: WorldPage[] = []
  for (const [dir, kind] of KINDS) {
    const d = join(base, dir)
    if (!existsSync(d)) continue
    for (const entry of readdirSync(d)) {
      if (!entry.endsWith('.md') || /^readme\.md$/i.test(entry)) continue
      const path = join(d, entry)
      try {
        const { data, content } = matter(readFileSync(path, 'utf8')) // one read: frontmatter + body
        const id = String((data as Record<string, unknown>).id ?? basename(entry, '.md'))
        if (id === pageId) continue
        LINK_RE.lastIndex = 0
        let m: RegExpExecArray | null
        let hit = false
        while ((m = LINK_RE.exec(content)) !== null) {
          if (m[1] === pageId) {
            hit = true
            break
          }
        }
        if (!hit) continue
        const d2 = data as Record<string, unknown>
        out.push({
          id,
          name: String(d2.name ?? d2.title ?? basename(entry, '.md')),
          path,
          kind,
          ...(d2.avatar ? { avatar: String(d2.avatar) } : {}),
          ...(d2.phase ? { phase: String(d2.phase) } : {})
        })
      } catch {
        /* unreadable page — skip */
      }
    }
  }
  return out
}

/** Every world "bible" page — characters, locations, items, lore. */
const worldMemo = memoSlot<WorldPage[]>('worldPages')
export function listWorldPages(root: string): WorldPage[] {
  const base = join(root, 'content', 'world')
  // Memoized by the world dir's fingerprint — a hit skips re-parsing every page's frontmatter. See enumCache.ts.
  return worldMemo(fingerprintDir(base), () => KINDS.flatMap(([dir, kind]) => pagesIn(join(base, dir), kind)))
}

/**
 * Create a new world page from renderer-supplied frontmatter + body (scaffolded in
 * worldSchema.ts). Returns the new WorldPage, or null if a file with that id already
 * exists (caller should pick another name). The renderer owns the scaffold; the engine
 * just places the file in the right content/world/{kind} folder.
 */
export function createWorldPage(
  root: string,
  kind: WorldPage['kind'],
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): WorldPage | null {
  const dir = join(root, 'content', 'world', dirForKind(kind))
  mkdirSync(dir, { recursive: true })
  // The page `id` is its immutable identity — make it unique within the kind (slug + -2/-3),
  // rather than rejecting, so two same-named pages both land. Override frontmatter to match.
  const taken = new Set(pagesIn(dir, kind).map((p) => p.id))
  const uid = uniqueId(id, taken)
  const path = join(dir, `${uid}.md`)
  if (existsSync(path)) return null // shouldn't happen (uid is unique), but stay safe
  writeFileSync(path, matter.stringify(body.replace(/^\n+/, ''), { ...frontmatter, id: uid }), 'utf8')
  return {
    id: uid,
    name: String(frontmatter.name ?? uid),
    path,
    kind,
    ...(frontmatter.avatar ? { avatar: String(frontmatter.avatar) } : {}),
    ...(frontmatter.phase ? { phase: String(frontmatter.phase) } : {})
  }
}
