/**
 * The shared (rows × scenes) Gantt chrome behind every ThreadsRail pivot (Thread · Character · Entity).
 * It owns the uniform parts — the frozen gutter, the sticky scene-column header, the optional window
 * **wrap-layer**, scrolling, and per-row selection highlight — and delegates the *lane* (what fills a
 * row over the columns) to each mode via `renderLane`. Thread mode draws fine per-scene markers;
 * arc modes draw coarse window-spanning bands. See decisions.md L16.
 */
import type { ReactNode, JSX } from 'react';
import { cn, compactNumber } from '@/lib/utils'
import { cleanChapterName } from '@/lib/analysis/chapterIndex'
import { levelColorHex } from '@/config/sceneLadder'
import { SequenceSelect } from '@/components/layout/SequenceSelect'
import type { StoryNode, TimelineGraph } from '@shared/ipc'

export const GANTT_COL_W = 22 // px per scene column
// The uniform row-title (frozen gutter label) style — one source so every rail's row names match (DESIGN.md).
// Standardized to the CustodyGantt format: 11px, foreground/80. Compose semantic color overrides AFTER it.
export const GANTT_ROW_TITLE = 'truncate text-[11px] text-foreground/80'
/** Per-chapter bar palette (cycled by chapter order) — shared with the Cast heatmap's volume bars. */
export const CHAPTER_BARS = ['bg-thread', 'bg-character', 'bg-lore', 'bg-ok', 'bg-flag']

// cleanChapterName moved to lib/chapterIndex (the pure home); re-exported so existing importers are unchanged.
export { cleanChapterName }

/** Per-scene dialogue volume (sum of cast character-volume) — the universal "scene weight" the counter bar plots. */
export function sceneVolumes(graph: TimelineGraph): Map<string, number> {
  const m = new Map<string, number>()
  for (const [sid, sc] of Object.entries(graph.scenes)) m.set(sid, sc.cast.reduce((n, c) => n + (c.volume ?? 0), 0))
  return m
}

const GUT = 'sticky left-0 z-10 w-44 shrink-0 bg-canvas'
const CORNER = 'sticky left-0 z-30 w-44 shrink-0 bg-canvas'

export interface GanttCol {
  id: string
  title: string
}
/** A wrap-layer band over a contiguous column range [min,max] (a folder/window). `level` = ladder label, if any. */
export interface GanttWrap {
  title: string
  min: number
  max: number
  level?: string // the folder's ladder level (act/part/…) → the band tint; undefined = neutral
}
/**
 * Derive the chaptering wrap-layer from the story tree: each leaf folder (one that directly holds
 * scenes) becomes a band over its scenes' columns. Window = the scene's own folder — universal across
 * any free-form nesting; scenes with no folder simply get no band. See decisions.md L16.
 */
export function deriveChapterWraps(tree: StoryNode[], colOf: Map<string, number>): GanttWrap[] {
  const out: GanttWrap[] = []
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue
      const idxs = (n.children ?? [])
        .filter((c) => c.type === 'scene')
        .map((c) => colOf.get(c.sceneId ?? c.name))
        .filter((i): i is number => i != null)
      if (idxs.length > 0) out.push({ title: cleanChapterName(n.name), min: Math.min(...idxs), max: Math.max(...idxs) })
      walk(n.children ?? [])
    }
  }
  walk(tree)
  return out.sort((a, b) => a.min - b.min)
}

/** One ancestor folder in a scene's chain (root → immediate parent). `level` = the folder's ladder label, if any. */
export interface ChainSeg {
  name: string
  level?: string
}
/** sceneId → its ancestor-folder chain (top-most folder first). The shared source for the multi-level bands. */
export function sceneChainMap(tree: StoryNode[]): Map<string, ChainSeg[]> {
  const map = new Map<string, ChainSeg[]>()
  const walk = (nodes: StoryNode[], anc: ChainSeg[]): void => {
    for (const n of nodes) {
      if (n.type === 'folder') walk(n.children ?? [], [...anc, { name: n.name, level: n.containerType }])
      else if (n.sceneId) map.set(n.sceneId, anc)
    }
  }
  walk(tree, [])
  return map
}
/** A wrap-band's background: a light tint of its ladder-level colour when labeled, else neutral panel-soft. */
export function bandBg(level?: string): string {
  const hex = level ? levelColorHex(level) : undefined
  return hex ? `color-mix(in srgb, ${hex} 22%, var(--panel-soft))` : 'var(--panel-soft)'
}
/**
 * The MULTI-LEVEL wrap-layer: one `GanttWrap[]` per folder DEPTH above the scene (top-most first), so the
 * rails render the full story hierarchy (book → act → chapter → …), not just the leaf chapter. A depth is
 * dropped when it doesn't subdivide the visible window (a single band spanning everything — e.g. a lone
 * "chapters" wrapper — conveys nothing). Scenes nested shallower simply leave a gap at deeper levels.
 */
export function deriveWrapLevels(tree: StoryNode[], colOf: Map<string, number>): GanttWrap[][] {
  const chains = sceneChainMap(tree)
  const order: string[] = []
  colOf.forEach((idx, id) => {
    order[idx] = id
  })
  const maxDepth = [...chains.values()].reduce((m, c) => Math.max(m, c.length), 0)
  const levels: GanttWrap[][] = []
  for (let d = 0; d < maxDepth; d++) {
    const bands: GanttWrap[] = []
    let lastRaw: string | undefined
    let lastLevel: string | undefined
    for (let i = 0; i < order.length; i++) {
      const seg = order[i] ? chains.get(order[i])?.[d] : undefined
      if (!seg) {
        lastRaw = undefined // a gap breaks the run so distinct same-named folders never merge across it
        continue
      }
      const last = bands[bands.length - 1]
      if (last && lastRaw === seg.name && lastLevel === seg.level && last.max === i - 1) last.max = i
      else {
        bands.push({ title: cleanChapterName(seg.name), min: i, max: i, level: seg.level })
        lastRaw = seg.name
        lastLevel = seg.level
      }
    }
    const spansAll = bands.length === 1 && bands[0].min === 0 && bands[0].max === order.length - 1
    if (bands.length > 0 && !spansAll) levels.push(bands)
  }
  return levels
}

export interface GanttRow {
  key: string
  highlighted?: boolean
  gutter: ReactNode // the frozen left cell (usually a select button)
  /** Render the row's lane over the columns; positioned with the supplied geometry. */
  renderLane: (ctx: { colW: number; laneW: number; colOf: Map<string, number> }) => ReactNode
}

export function LifecycleGantt({
  cols,
  rows,
  wraps,
  counts,
  colW = GANTT_COL_W,
  onColClick,
  onLeave,
  empty,
  noCornerPicker
}: {
  cols: GanttCol[]
  rows: GanttRow[]
  wraps?: GanttWrap[] | GanttWrap[][] // one band-row (deriveChapterWraps) or a stack of them (deriveWrapLevels)
  counts?: Map<string, number> // per-column value → the bottom scene-counter bar (e.g. dialogue volume)
  colW?: number
  onColClick?: (col: GanttCol) => void
  onLeave?: () => void
  empty?: ReactNode
  noCornerPicker?: boolean // hide the corner sequence-switcher (e.g. the Chart Config preview, which owns the choice)
}): JSX.Element {
  // Empty = a CENTERED teaching moment (author rule), not a corner whisper — panels pass an <EmptyRailState/>
  // (or a short string, which centers the same way).
  if (rows.length === 0)
    return <div className="flex h-full min-h-40 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">{empty ?? 'Nothing to show yet.'}</div>

  const colOf = new Map(cols.map((c, i) => [c.id, i]))
  const laneW = cols.length * colW
  const maxCount = counts ? Math.max(1, ...[...counts.values()]) : 1
  // Normalize wraps to a STACK of levels (top-most first): a flat GanttWrap[] is one level; deriveWrapLevels
  // already gives the stack. The counter bars + palette key off the LEAF level (the finest = chapter).
  const wrapLevels: GanttWrap[][] = !wraps || wraps.length === 0 ? [] : Array.isArray(wraps[0]) ? (wraps as GanttWrap[][]) : [wraps as GanttWrap[]]
  const leafWraps = wrapLevels[wrapLevels.length - 1] ?? []
  // Counter-bar color = the column's chapter (from the leaf wrap band), cycling the shared palette; neutral if none.
  const barColor = (i: number): string => {
    const wi = leafWraps.findIndex((w) => i >= w.min && i <= w.max)
    return wi >= 0 ? CHAPTER_BARS[wi % CHAPTER_BARS.length] : 'bg-foreground/25'
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="inline-block min-w-full text-[11px]" onMouseLeave={onLeave}>
        {/* wrap-layer: one band-row per folder level above the scene (top-most first), tinted by ladder level */}
        {wrapLevels.map((level, li) => (
          <div key={li} className="flex">
            <div className={CORNER} />
            <div className="relative h-5 shrink-0" style={{ width: laneW }}>
              {level.map((w, i) => (
                <div
                  key={i}
                  className="absolute top-0 flex h-5 items-center justify-center truncate rounded-sm px-1 text-[10px] text-muted-foreground"
                  style={{ left: w.min * colW + 1, width: (w.max - w.min + 1) * colW - 2, backgroundColor: bandBg(w.level) }}
                  title={w.level ? `${w.title} · ${w.level}` : w.title}
                >
                  {w.title}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* scene-column header (the uniform axis) */}
        <div className="sticky top-0 z-20 flex bg-canvas">
          <div className={cn(CORNER, 'flex items-end')}>{!noCornerPicker && <SequenceSelect />}</div>
          {cols.map((c) => {
            const label = (
              <span className="block h-24 [writing-mode:vertical-rl] rotate-180 truncate pt-1 text-left">{c.title}</span>
            )
            return onColClick ? (
              <button key={c.id} onClick={() => onColClick(c)} style={{ width: colW }} className="shrink-0 text-faint hover:text-foreground">
                {label}
              </button>
            ) : (
              <div key={c.id} style={{ width: colW }} className="shrink-0 text-faint">
                {label}
              </div>
            )
          })}
        </div>

        {/* rows: frozen gutter + lane */}
        {rows.map((r) => (
          <div key={r.key} className={cn('flex items-center', r.highlighted && 'bg-panel-soft/60')}>
            <div className={cn(GUT, 'h-7')}>{r.gutter}</div>
            <div className="relative h-7 shrink-0" style={{ width: laneW }}>
              {r.renderLane({ colW, laneW, colOf })}
            </div>
          </div>
        ))}

        {/* scene-counter bar — per-column weight (dialogue volume), shared with the Cast heatmap: bars hang
            DOWN from the top and are colored by chapter (matches the Cast volume bars). */}
        {counts && (
          <div className="flex">
            <div className={CORNER} />
            <div className="flex h-12 shrink-0 items-start" style={{ width: laneW }}>
              {cols.map((c, ci) => {
                const n = counts.get(c.id) ?? 0
                return (
                  <div key={c.id} style={{ width: colW }} className="flex h-full shrink-0 items-start justify-center px-px" title={`${c.title}: ${compactNumber(n)}`}>
                    <div className={cn('w-full rounded-b-sm', barColor(ci))} style={{ height: `${(n / maxCount) * 100}%` }} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
