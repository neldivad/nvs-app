/**
 * AppearanceHeatStrip — "where this subject appears across the whole story" as one lane: a bar per scene in
 * reading order, height = weight (dialogue volume / event count), empty scenes a faint tick, a scene-id range
 * beneath. Bars FLEX to fill the width; clicking a live bar peeks its scene. Lifted from the entity rail's
 * Presence heat-strip so entity + thread details share one strip.
 *
 * Overly-compressed projects: past MAX_BARS scenes the bars would squeeze to a sub-pixel sliver, so we STOP
 * drawing per-scene and aggregate up the story hierarchy — one bar per FOLDER (each cell's `group`), and if
 * there are still too many folders, consecutive folders merge (the "even bigger hierarchy" fallback). A bucket's
 * height = its total weight; clicking it peeks its heaviest scene.
 */
import { useMemo, type JSX } from 'react'
import { cn } from '@/lib/utils'

const MAX_BARS = 120

export interface HeatCell {
  key: string // scene id (also the range label)
  label: string // native tooltip (scene title + weight)
  weight: number // 0 = absent (faint tick), >0 = a bar sized by weight/max
  onClick?: () => void // peek the scene (only live bars are clickable)
  group?: { key: string; title: string } // the scene's folder/chapter — the level we aggregate to when compressed
}

function merge(cells: HeatCell[], keyOf: (c: HeatCell) => string, labelOf: (chunk: HeatCell[]) => { key: string; label: string }): HeatCell[] {
  const byKey = new Map<string, HeatCell[]>()
  const order: string[] = []
  for (const c of cells) {
    const k = keyOf(c)
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k) }
    byKey.get(k)!.push(c)
  }
  return order.map((k) => {
    const chunk = byKey.get(k)!
    const heaviest = chunk.filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight)[0]
    return { ...labelOf(chunk), weight: chunk.reduce((n, c) => n + c.weight, 0), onClick: heaviest?.onClick }
  })
}

/** `accentClass` is a text-color class (e.g. `text-thread`), so the bars can use `bg-current`. */
export function AppearanceHeatStrip({ cells, accentClass = 'text-thread', className }: { cells: HeatCell[]; accentClass?: string; className?: string }): JSX.Element {
  const bars = useMemo<HeatCell[]>(() => {
    if (cells.length <= MAX_BARS) return cells
    // Level 1 — one bar per folder (the scene's `group`).
    let out = merge(
      cells,
      (c) => c.group?.key ?? c.key,
      (chunk) => ({ key: chunk[0].group?.title ?? chunk[0].key, label: labelFor(chunk[0].group?.title ?? chunk[0].key, chunk) })
    )
    // Level 2 — still too many folders → merge CONSECUTIVE folders into equal chunks (broader hierarchy).
    if (out.length > MAX_BARS) {
      const size = Math.ceil(out.length / MAX_BARS)
      out = merge(
        out.map((c, i) => ({ ...c, group: { key: String(Math.floor(i / size)), title: '' } })),
        (c) => c.group!.key,
        (chunk) => ({ key: `${chunk[0].key} … ${chunk[chunk.length - 1].key}`, label: `${chunk[0].key} … ${chunk[chunk.length - 1].key}` })
      )
    }
    return out
  }, [cells])
  const max = Math.max(1, ...bars.map((c) => c.weight))

  return (
    <div className={className}>
      <div className={cn('flex h-9 items-end gap-px overflow-hidden rounded-md border border-border/60 bg-panel px-1 pt-1', accentClass)}>
        {bars.length === 0 ? (
          <span className="m-auto text-[10px] text-faint">No appearances.</span>
        ) : (
          bars.map((c) => (
            <button
              key={c.key}
              disabled={!c.weight || !c.onClick}
              onClick={c.onClick}
              title={c.label}
              className="group flex min-w-0.5 flex-1 items-end self-stretch"
            >
              <span
                className={cn('w-full rounded-[1px]', c.weight ? 'bg-current opacity-75 group-hover:opacity-100' : 'bg-border/60')}
                style={{ height: c.weight ? `${Math.round(25 + 75 * (c.weight / max))}%` : 2 }}
              />
            </button>
          ))
        )}
      </div>
      {cells.length > 1 && (
        <div className="mt-0.5 flex justify-between font-mono text-[9px] text-faint">
          <span>{cells[0].key}</span>
          <span>{cells[cells.length - 1].key}</span>
        </div>
      )}
    </div>
  )
}

function labelFor(title: string, chunk: HeatCell[]): string {
  const live = chunk.filter((c) => c.weight > 0).length
  return live ? `${title} — ${live} appearance${live === 1 ? '' : 's'}` : title
}
