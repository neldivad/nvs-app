/**
 * The STORY LADDER — a FIXED, app-wide hierarchy of container levels (not per-project, not user-editable). It's a
 * visual indicator of how a story nests: 6 folder levels + the Scene leaf = 7 levels max (see internal/
 * open-taxonomy.md). Labeling is a soft badge only — right-click a folder → "Label as", pick a level; it never
 * constrains what you create. Each level owns a colour (a cool→warm ramp: Book violet … Scene red).
 */
export interface StoryLevel {
  key: string
  label: string
  description: string
  color: string // hex — the badge/swatch colour
}

/** The 6 container levels, top → down. Scene (below) is the atomic leaf. */
export const STORY_LADDER: readonly StoryLevel[] = [
  { key: 'book', label: 'Book', color: '#a78bfa', description: 'The top grouping of a multi-book work.' },
  { key: 'volume', label: 'Volume', color: '#60a5fa', description: 'A large grouping above parts and chapters.' },
  { key: 'part', label: 'Part', color: '#22d3ee', description: 'A mid-high grouping of acts or chapters.' },
  { key: 'act', label: 'Act', color: '#34d399', description: 'A major structural division of the story.' },
  { key: 'chapter', label: 'Chapter', color: '#fbbf24', description: 'The usual home for a run of scenes.' },
  { key: 'section', label: 'Section', color: '#fb923c', description: 'A light grouping of scenes within a chapter.' }
]

/** The atomic leaf — always the bottom, never a folder-label. */
export const SCENE_LEVEL: StoryLevel = { key: 'scene', label: 'Scene', color: '#f87171', description: 'The atomic unit of content.' }

/** 6 folder layers + a scene = 7 levels total. */
export const MAX_STORY_DEPTH = 6

/** A folder's depth in the tree = how many path segments its relPath has (root children = depth 0). */
export function depthOf(rel: string): number {
  return rel === '' ? 0 : rel.split('/').filter(Boolean).length
}

export function levelByKey(key: string | undefined): StoryLevel | undefined {
  if (!key) return undefined
  return key === 'scene' ? SCENE_LEVEL : STORY_LADDER.find((l) => l.key === key)
}

/** The badge colour for a level key, or undefined for an unlabeled/unknown folder. */
export function levelColorHex(key: string | undefined): string | undefined {
  return levelByKey(key)?.color
}

/** Which ladder levels are actually in use across the story tree (for the "active" highlight in Project Config). */
export function activeLevels(nodes: Array<{ type: string; containerType?: string; children?: Array<{ type: string; containerType?: string; children?: unknown[] }> }>): Set<string> {
  const out = new Set<string>()
  const walk = (ns: typeof nodes): void => {
    for (const n of ns) {
      if (n.type === 'folder' && n.containerType) out.add(n.containerType)
      if (n.children) walk(n.children as typeof nodes)
    }
  }
  walk(nodes)
  return out
}
