/**
 * Conversation ranking — "who talks, and how much" for a non-fiction work, straight from T1 (no AI).
 *
 * DELIBERATELY COLORLESS (see internal/domain-profiles.md + the dataviz ruling): speaker volume is a
 * MAGNITUDE job, not an identity one, so it uses ONE hue with the bar LENGTH carrying the value and the
 * NAME LABEL carrying identity. That scales to any number of voices — a 2-person podcast or a 40-person
 * group chat — with no palette to cycle and no legend to read. Beyond TOP_N speakers the tail folds into a
 * single "+K others" row (never a generated hue). Magnitude = cumulative CHARACTER volume (SUM(LENGTH)),
 * the same `timelineGraph.scenes[].cast[].volume` the Cast rail ranks by — a long answer outweighs many
 * short questions. Rows are sorted by total volume, so a speaker's RANK/POSITION links this view to the
 * per-scene intensity heatmap (same order) without a shared color.
 */
import { useMemo, type JSX } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

const TOP_N = 8 // beyond this the tail folds into one "+K others" row — dataviz: a 9th series is never a new hue

interface Row {
  id: string
  name: string
  volume: number
}

export function ConversationRanking({ className }: { className?: string }): JSX.Element {
  const graph = useWorkspace((s) => s.timelineGraph)
  const characters = useWorkspace((s) => s.characters)

  const { rows, total } = useMemo(() => {
    const vol = new Map<string, number>()
    for (const sc of Object.values(graph.scenes)) for (const c of sc.cast) vol.set(c.entityId, (vol.get(c.entityId) ?? 0) + (c.volume ?? 0))
    const nameOf = new Map(characters.map((c) => [c.id, c.name]))
    const all: Row[] = [...vol.entries()]
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ id, name: nameOf.get(id) ?? id, volume: n }))
      .sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name))
    const total = all.reduce((s, r) => s + r.volume, 0) || 1
    // Fold the tail so a crowd never overflows the list or forces a palette to cycle.
    const rows: Row[] =
      all.length > TOP_N
        ? [...all.slice(0, TOP_N), { id: '__others__', name: `+${all.length - TOP_N} others`, volume: all.slice(TOP_N).reduce((s, r) => s + r.volume, 0) }]
        : all
    return { rows, total }
  }, [graph, characters])

  if (rows.length === 0)
    return <div className={cn('p-4 text-[12px] text-faint', className)}>No speaking volume yet — this reads from scene dialogue.</div>

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {rows.map((r) => {
        const pct = Math.round((r.volume / total) * 100)
        const others = r.id === '__others__'
        return (
          <div key={r.id} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2" title={`${r.name} — ${r.volume.toLocaleString()} chars`}>
            <span className={cn('truncate text-[12px]', others ? 'italic text-faint' : 'text-foreground/85')}>{r.name}</span>
            {/* Track + fill: one hue, length = share of total. 4px rounded data-end anchored to the baseline (dataviz marks). */}
            <div className="h-3 overflow-hidden rounded-[4px] bg-panel-soft">
              <div className={cn('h-full rounded-[4px]', others ? 'bg-faint/50' : 'bg-character')} style={{ width: `${Math.max((r.volume / total) * 100, 1.5)}%` }} />
            </div>
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}
