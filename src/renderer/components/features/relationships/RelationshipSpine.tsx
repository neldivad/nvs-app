/**
 * RelationshipSpine — the RAIL's single unified view (internal/relationship-rail.md). ONE centered scene spine;
 * every lens is a STACKABLE layer (via the shared GanttLayer float, standardized with the Cast rail). The pane's
 * own scroll carries it (no inner overflow). Layers (read from `ganttLayers`), all composable on the same spine:
 *   • Presence — back-to-back dialogue bars (A ◀ cell ▶ B).
 *   • Chapters — wrap contiguous same-folder scenes in a labeled shell.
 *   • Warmth   — a BACKGROUND layer: a Warm(red)↔Cold(blue) gradient wash + a vertical familiarity line that
 *     drifts left(warm)/right(cold) behind the centered cells. Doesn't move the spine — just shades behind it.
 *   • Events   — shift markers overlaid on the flanks; the whole row (minus the cell) opens the EventDetail.
 * Clicking a scene CELL opens the scene page; clicking anywhere else on a row with shifts opens the detail.
 * Sort (oldest/latest) is owned by the panel (the ⚔-aligned toggle).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { cn } from '@/lib/utils'
import { facetVisual } from '@/config/arcVisual'
import { useWorkspace } from '@/stores/workspace'
import { relationshipMetrics } from '@/lib/analysis/relationshipMetrics'
import { CHAPTER_BARS, cleanChapterName, sceneChainMap } from '@/components/features/custody/LifecycleGantt'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { RelationshipDetailFloat } from '@/components/features/relationships/RelationshipDetail'
import type { RelationshipEvidence, RelEvidenceEvent } from '@shared/ipc'

export interface SceneAxisCol {
  sceneId: string
  title: string
  chapter: string
  path: string
  la: number // A dialogue lines
  lb: number // B dialogue lines
}

const WARM = '#ef4444'
const COLD = '#3b82f6'
const WARMTH_GRADIENT = `linear-gradient(to right, rgba(239,68,68,0.13), rgba(239,68,68,0) 42%, rgba(59,130,246,0) 58%, rgba(59,130,246,0.13))`

/** Lens D marks for one scene: per side, the secrets the READER is ahead on (irony) and the secrets the
 *  OTHER fighter is ahead on (arb — information arbitrage between the pair). Band = the unknowing side. */
export interface IronySceneSides {
  a: { irony: { label: string; path: string }[]; arb: { label: string; path: string }[] }
  b: { irony: { label: string; path: string }[]; arb: { label: string; path: string }[] }
}

export function RelationshipSpine({
  ev,
  sceneAxis,
  latest,
  preview,
  range,
  irony
}: {
  ev: RelationshipEvidence
  sceneAxis: SceneAxisCol[]
  latest: boolean
  preview?: number
  /** Scene-range window [lo, hi] over sceneAxis — owned by the panel, shown in the pinned bottom RailScaleBar. */
  range?: [number, number] | null
  /** Lens D (layer `irony`): sceneId → the two knowledge-asymmetry tones per side. */
  irony?: Map<string, IronySceneSides>
}): JSX.Element {
  const m = useMemo(() => relationshipMetrics(ev.events), [ev])
  const L = useWorkspace((s) => s.ganttLayers)
  const storyTree = useWorkspace((s) => s.storyTree) // ancestor breadcrumb over the chapter shells
  const [scenePreview, setScenePreview] = useState<SceneAxisCol | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  // Warmth line — measured against the real rows (survives chapter shells) → one continuous polyline.
  const spineRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLElement>())
  const [line, setLine] = useState<{ w: number; h: number; pts: { x: number; y: number; cum: number }[] }>({ w: 0, h: 0, pts: [] })

  const byScene = useMemo(() => {
    const map = new Map<string, { a: RelEvidenceEvent[]; b: RelEvidenceEvent[] }>()
    for (const e of ev.events) {
      const g = map.get(e.sceneId) ?? { a: [], b: [] }
      if (e.owner === 'a' || e.owner === null) g.a.push(e)
      if (e.owner === 'b' || e.owner === null) g.b.push(e)
      map.set(e.sceneId, g)
    }
    return map
  }, [ev.events])

  // cumulative warmth carried forward across every scene (drives the background line's x).
  const warmthByScene = useMemo(() => {
    const cumAt = new Map<string, number>()
    for (const w of m.warmth) cumAt.set(w.sceneId, w.cumulative)
    const out = new Map<string, number>()
    let run = 0
    for (const c of sceneAxis) {
      if (cumAt.has(c.sceneId)) run = cumAt.get(c.sceneId)!
      out.set(c.sceneId, run)
    }
    return out
  }, [m.warmth, sceneAxis])
  const warmthMag = useMemo(() => Math.max(1, ...[...warmthByScene.values()].map((v) => Math.abs(v))), [warmthByScene])
  const maxSide = useMemo(() => Math.max(1, ...sceneAxis.map((c) => Math.max(c.la, c.lb))), [sceneAxis])
  // Warm → left of center, Cold → right; clamped so labels never touch the edges.
  const warmthX = (cum: number): number => Math.max(8, Math.min(92, 50 - (cum / warmthMag) * 40))

  const lo = range ? Math.min(range[0], Math.max(0, sceneAxis.length - 1)) : 0
  const hi = range ? Math.min(range[1], Math.max(0, sceneAxis.length - 1)) : Math.max(0, sceneAxis.length - 1)
  // A scene "matters" to the pair (a NODE): with the `mutual` layer ON → only where BOTH appear; else where either
  // speaks OR a shift lands. The two relationship layers are ORTHOGONAL: `mutual` picks WHAT is a node; `empty`
  // picks whether the non-node runs DROP (off) or collapse into a Ghost (on). So mutual+empty = mutual nodes WITH
  // the non-mutual gaps shown as ghosts — resolving the earlier collision where mutual hid the gaps outright.
  const relevant = useCallback((c: SceneAxisCol): boolean => {
    if (L.mutual) return c.la > 0 && c.lb > 0
    if (c.la > 0 || c.lb > 0) return true
    const g = byScene.get(c.sceneId)
    return !!g && (g.a.length > 0 || g.b.length > 0)
  }, [L.mutual, byScene])

  const rows = useMemo(() => {
    if (preview) return sceneAxis.filter(relevant).slice(0, preview) // teaser: first N nodes that matter (no ghosts)
    const sliced = sceneAxis.slice(lo, hi + 1)
    const shown = L.empty ? sliced : sliced.filter(relevant) // empty OFF drops non-node scenes; ON keeps them for Ghosts
    return latest ? [...shown].reverse() : shown
  }, [sceneAxis, lo, hi, latest, preview, relevant, L.empty])

  const chapterColor = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) if (!map.has(r.chapter)) map.set(r.chapter, CHAPTER_BARS[map.size % CHAPTER_BARS.length])
    return map
  }, [rows])
  const chainMap = useMemo(() => sceneChainMap(storyTree), [storyTree])
  const groups = useMemo(() => {
    const out: { chapter: string; items: SceneAxisCol[]; crumb: string[] }[] = []
    for (const r of rows) {
      const last = out[out.length - 1]
      if (last && last.chapter === r.chapter) last.items.push(r)
      // crumb = the folder levels ABOVE this scene's own folder (corpus › region › …) — the hierarchy over the chapter shell
      else out.push({ chapter: r.chapter, items: [r], crumb: (chainMap.get(r.sceneId) ?? []).slice(0, -1).map((c) => cleanChapterName(c.name)) })
    }
    return out
  }, [rows, chainMap])

  // Measure each rendered row's vertical center (relative to the spine box) → the warmth polyline points.
  useLayoutEffect(() => {
    const cont = spineRef.current
    if (!L.warmth || !cont || rows.length === 0) {
      setLine({ w: 0, h: 0, pts: [] })
      return
    }
    const measure = (): void => {
      const cr = cont.getBoundingClientRect()
      const pts: { x: number; y: number; cum: number }[] = []
      for (const c of rows) {
        const el = rowEls.current.get(c.sceneId)
        if (!el) continue
        const r = el.getBoundingClientRect()
        const cum = warmthByScene.get(c.sceneId) ?? 0
        pts.push({ x: (warmthX(cum) / 100) * cr.width, y: r.top - cr.top + r.height / 2, cum })
      }
      setLine({ w: cr.width, h: cr.height, pts })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(cont)
    return () => ro.disconnect()
    // warmthX is a stable closure over warmthMag; listing warmthMag covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.warmth, rows, warmthByScene, warmthMag])

  // A centered row: A bar+dots ◀ cell ▶ B dots+bar. The whole row (minus the cell) opens the shift detail;
  // the warmth line (measured above) washes behind, connecting scene to scene.
  // Lens-D pixels: ONE unit block per asymmetric secret — tetris accumulation, count IS the magnitude.
  // ONE strip per side, vertically centered on the row: blue (audience advantage) blocks then red
  // (opponent advantage) blocks JOINED — a split top/bottom read as belonging to different scenes.
  // Pure abstraction: no per-block hover/tooltips; a click opens the custody page (first topic, stable
  // order → deterministic). PIXEL_DEPTH bounds the DOM: past the cap, a +n chip, same click-through.
  const PIXEL_DEPTH = 24
  const openPage = useWorkspace((s) => s.openPage)
  const pixels = (side: { irony: { label: string; path: string }[]; arb: { label: string; path: string }[] }, edge: 'left' | 'right'): JSX.Element | null => {
    const dedup = (list: { label: string; path: string }[]): { label: string; path: string }[] =>
      [...new Map(list.map((x) => [x.path, x])).values()].sort((a, b) => a.path.localeCompare(b.path))
    const blocks = [
      ...dedup(side.irony).map((x) => ({ ...x, tint: 'bg-thread/70' })),
      ...dedup(side.arb).map((x) => ({ ...x, tint: 'bg-flag/60' }))
    ]
    if (!blocks.length) return null
    const shown = blocks.slice(0, PIXEL_DEPTH)
    return (
      <div
        onClick={(e) => {
          e.stopPropagation()
          void openPage({ path: blocks[0].path, title: blocks[0].label, kind: 'custody' })
        }}
        className={cn(
          'absolute top-1/2 z-20 flex max-w-[45%] -translate-y-1/2 cursor-pointer flex-wrap items-center gap-px',
          edge === 'left' ? 'left-0' : 'right-0 flex-row-reverse'
        )}
      >
        {shown.map((x, i) => (
          <span key={`${x.path}:${i}`} className={cn('size-1.25 rounded-[1px]', x.tint)} />
        ))}
        {blocks.length > PIXEL_DEPTH && (
          <span className="flex h-2.25 items-center rounded-[2px] bg-panel-soft px-0.5 text-[8px] font-semibold leading-none text-foreground/80">
            +{blocks.length - PIXEL_DEPTH}
          </span>
        )}
      </div>
    )
  }

  const row = (c: SceneAxisCol): JSX.Element => {
    const g = byScene.get(c.sceneId)
    const has = !!g && (g.a.length > 0 || g.b.length > 0)
    const ir = L.irony ? irony?.get(c.sceneId) : undefined
    return (
      <div
        key={c.sceneId}
        ref={(el) => {
          if (el) rowEls.current.set(c.sceneId, el)
          else rowEls.current.delete(c.sceneId)
        }}
        onClick={has ? () => setDetail(c.sceneId) : undefined}
        className={cn('relative grid min-h-6.5 grid-cols-[1fr_10rem_1fr] items-center gap-1 rounded px-1', has && 'cursor-pointer hover:bg-panel-soft/40')}
        title={has ? 'Click for the shift detail' : undefined}
      >
        {/* lens D: one JOINED strip per side (blue then red blocks), centered on the row — the unknowing
            fighter's edge. Click → the custody page. */}
        {ir && pixels(ir.a, 'left')}
        {ir && pixels(ir.b, 'right')}
        <div className="relative z-10 flex items-center justify-end">
          {L.presence && <div className="h-2.5 rounded-l bg-character/70" style={{ width: `${(c.la / maxSide) * 100}%` }} />}
          {L.events && <DotRow events={g?.a ?? []} side="a" className="absolute right-0 top-1/2 -translate-y-1/2" />}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setScenePreview(c) }}
          className="z-10 truncate rounded border border-border bg-panel px-1.5 py-0.5 text-center text-[11px] text-foreground/85 hover:border-character hover:text-foreground"
          title={`${c.title} — open scene`}
        >
          {c.title}
        </button>
        <div className="relative z-10 flex items-center justify-start">
          {L.presence && <div className="h-2.5 rounded-r bg-character/70" style={{ width: `${(c.lb / maxSide) * 100}%` }} />}
          {L.events && <DotRow events={g?.b ?? []} side="b" className="absolute left-0 top-1/2 -translate-y-1/2" />}
        </div>
      </div>
    )
  }

  const renderRun = (items: SceneAxisCol[], keyp: string): JSX.Element[] => {
    const out: JSX.Element[] = []
    let gap = 0
    let anchor = ''
    const flush = (): void => {
      if (gap > 0) out.push(<Ghost key={`gap-${keyp}-${anchor}`} count={gap} />)
      gap = 0
    }
    for (const c of items) {
      if (relevant(c)) {
        flush()
        out.push(row(c))
      } else {
        if (gap === 0) anchor = c.sceneId
        gap++
      }
    }
    flush()
    return out
  }

  return (
    <div className="space-y-3 text-[13px]">
      {/* The route picker + scene-range slider live in the panel's pinned bottom RailScaleBar (not here) so they
          stay visible while the spine scrolls — same treatment as every other rail. */}

      {/* Warmth axis annotation — centered, so the Layers float (top-right) never hides it. */}
      {L.warmth && rows.length > 0 && (
        <div className="text-center text-[10px] font-medium uppercase tracking-wide text-faint">
          <span style={{ color: WARM }}>◀ Warm</span> · familiarity · <span style={{ color: COLD }}>Cold ▶</span>
        </div>
      )}

      {/* Lens D legend — 1 block = 1 secret, on the unknowing side. */}
      {L.irony && irony && (
        <div className="flex items-center justify-center gap-3 text-[10px] text-faint">
          <span className="flex items-center gap-1"><span className="size-1.25 rounded-[1px] bg-thread/60" /> audience advantage</span>
          <span className="flex items-center gap-1"><span className="size-1.25 rounded-[1px] bg-flag/50" /> opponent advantage</span>
        </div>
      )}
      {L.irony && !irony && (
        <p className="text-center text-[10px] text-faint">no knowledge asymmetry between this pair — no custody topic puts the reader or either fighter ahead</p>
      )}

      <div ref={spineRef} data-part="spine" className="relative">
        {/* Warmth layer — a gradient wash + the connecting familiarity line, both behind the centered spine. */}
        {L.warmth && rows.length > 0 && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-0 z-0 rounded" style={{ background: WARMTH_GRADIENT }} />
            {line.pts.length > 1 && (
              <svg aria-hidden width={line.w} height={line.h} viewBox={`0 0 ${line.w} ${line.h}`} className="pointer-events-none absolute inset-0 z-0">
                <polyline points={line.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" className="stroke-foreground/45" strokeWidth={1.5} strokeLinejoin="round" />
                {line.pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2.6} style={{ fill: p.cum > 0 ? WARM : p.cum < 0 ? COLD : 'var(--faint)' }} />
                ))}
              </svg>
            )}
          </>
        )}

        <div className="relative">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No scenes in range.</p>
          ) : L.chapters && !preview ? (
            <div className="space-y-2">
              {groups.map((grp, i) => (
                <div key={i} className="rounded-md border border-border/50 py-1" style={{ borderLeftWidth: 3, borderLeftColor: 'var(--character)' }}>
                  <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] uppercase tracking-wide text-faint">
                    <span className={cn('size-2 rounded-[2px]', chapterColor.get(grp.chapter) ?? 'bg-character')} />
                    {grp.crumb.length > 0 && <span className="text-faint/60">{grp.crumb.join(' › ')} ›</span>}
                    {cleanChapterName(grp.chapter)}
                    <span className="text-faint/70">· {grp.items.length}</span>
                  </div>
                  {renderRun(grp.items, `ch${i}`)}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">{renderRun(rows, 'flat')}</div>
          )}
        </div>
      </div>

      {scenePreview && <PageReadDialog path={scenePreview.path} kind="scene" title={scenePreview.title} onClose={() => setScenePreview(null)} />}
      {detail && <RelationshipDetailFloat ev={ev} scenes={new Set([detail])} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** A collapsed run of scenes where neither of the pair speaks/shifts — a couple of faint nodes signal time
 *  passing, with no distracting count (the number lives in the tooltip). */
function Ghost({ count }: { count: number }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 py-1" aria-hidden title={`${count} scene${count === 1 ? '' : 's'} apart`}>
      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
        <span key={i} className="size-1 rounded-full bg-faint/30" />
      ))}
    </div>
  )
}

/** Shift dots for one flank; overlaid on the presence bar (anchored at the cell edge, growing outward). Purely
 *  visual — the parent ROW is the click target — so clicks bubble up to open the detail. `ring-canvas` keeps
 *  each dot legible on top of the teal bar. */
function DotRow({ events, side, className }: { events: RelEvidenceEvent[]; side: 'a' | 'b'; className?: string }): JSX.Element | null {
  if (events.length === 0) return null
  const shown = events.slice(0, 5)
  const extra = events.length - shown.length
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 px-0.5', side === 'a' && 'flex-row-reverse', className)}>
      {shown.map((e, i) => (
        <span key={i} className={cn('size-1.5 rounded-full ring-1 ring-canvas', e.facet ? facetVisual(e.facet).sw : 'bg-flag')} />
      ))}
      {extra > 0 && <span className="rounded bg-canvas/80 px-0.5 text-[9px] tabular-nums text-faint">+{extra}</span>}
    </span>
  )
}

