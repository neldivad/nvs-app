/**
 * Character relationship graph (CastRail, T1) — a force-directed co-occurrence network: nodes are
 * characters (sized by LINES spoken), edges are lines exchanged (width by how much the pair talk). Left-click a node
 * opens its page; **right-click** assigns a color tag (the author's own grouping — session-scoped). Rename
 * the tag labels in the legend. Pan/zoom (roam) like a canvas. cf. the ECharts Les-Misérables example.
 */
import { useMemo, useState, type JSX } from 'react';
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useWorkspace } from '@/stores/workspace'
import { charsLabel } from '@/lib/utils'
import { ColorTagMenu, resolveNodePalette } from '@/components/layout/ColorTagMenu'

const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

type Menu = { x: number; y: number; id: string; name: string }

export function CharacterGraph({
  chars,
  sceneCast,
  onChar,
  onEdge
}: {
  chars: { id: string; name: string; appearances: number }[]
  sceneCast: Map<string, Map<string, number>>
  onChar: (id: string) => void
  /** Click an EDGE → the range-aware relationship dialog (the edge's story, reduced over the current window). */
  onEdge?: (aId: string, bId: string) => void
}): JSX.Element {
  const nodeColor = useWorkspace((s) => s.nodeColor)
  const paletteLabels = useWorkspace((s) => s.paletteLabels)
  const setPaletteLabel = useWorkspace((s) => s.setPaletteLabel)
  const [menu, setMenu] = useState<Menu | null>(null)

  const palette = useMemo(() => resolveNodePalette(), [])

  const option = useMemo<EChartsOption>(() => {
    const ids = new Set(chars.map((c) => c.id))
    const nameById = new Map(chars.map((c) => [c.id, c.name]))
    const shared = new Map<string, number>()
    for (const inner of sceneCast.values()) {
      const present = [...inner.keys()].filter((id) => ids.has(id))
      for (let i = 0; i < present.length; i++)
        for (let j = i + 1; j < present.length; j++) {
          const key = present[i] < present[j] ? `${present[i]}|${present[j]}` : `${present[j]}|${present[i]}`
          // edge weight = combined VOLUME (characters) the pair speak in scenes they share (both their per-scene char-volume), not scene count
          shared.set(key, (shared.get(key) ?? 0) + (inner.get(present[i]) ?? 0) + (inner.get(present[j]) ?? 0))
        }
    }
    const maxApp = Math.max(1, ...chars.map((c) => c.appearances))
    const maxShared = Math.max(1, ...shared.values())
    const character = cssVar('--character')
    const text = cssVar('--muted-foreground')
    const edge = cssVar('--border')

    const colorOf = (id: string): string => {
      const idx = nodeColor[id]
      return idx != null ? palette[idx % palette.length] : character
    }
    const nodes = chars.map((c) => ({
      id: c.id,
      name: c.name,
      value: c.appearances,
      symbolSize: 8 + Math.sqrt(c.appearances / maxApp) * 30,
      itemStyle: { color: colorOf(c.id) },
      label: { show: c.appearances / maxApp > 0.2 }
    }))
    const links = [...shared.entries()].map(([k, v]) => {
      const [source, target] = k.split('|')
      return { source, target, value: v, lineStyle: { width: 0.5 + (v / maxShared) * 4, opacity: 0.45 }, emphasis: { lineStyle: { width: 2 + (v / maxShared) * 4, opacity: 0.9 } } }
    })
    return {
      tooltip: {
        confine: true,
        formatter: (p) => {
          const d = p as { dataType?: string; data: Record<string, unknown> }
          if (d.dataType === 'edge') return `${nameById.get(d.data.source as string)} — ${nameById.get(d.data.target as string)} · ${charsLabel(d.data.value as number, true)} — click for the relationship`
          return `${d.data.name as string} · ${charsLabel(d.data.value as number)}`
        }
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          force: { repulsion: 180, edgeLength: [40, 140], gravity: 0.08 },
          emphasis: { focus: 'adjacency', label: { show: true } },
          label: { color: text, fontSize: 11, position: 'right' },
          lineStyle: { color: edge },
          data: nodes,
          links
        }
      ]
    }
  }, [chars, sceneCast, nodeColor, palette])

  // Legend = the swatches in use; labels are editable here (the rename lives in the legend, not the menu).
  const usedIdx = useMemo(
    () => [...new Set(chars.map((c) => nodeColor[c.id]).filter((i): i is number => i != null))].sort((a, b) => a - b),
    [chars, nodeColor]
  )

  if (chars.length < 2)
    return (
      <div className="flex h-full min-h-40 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Need at least two characters to graph relationships.
      </div>
    )

  return (
    <div className="relative h-full w-full">
      {usedIdx.length > 0 && (
        // Top-LEFT: the shared Layers TOC owns the top-right corner (CastPanel), so the color-group legend
        // sits opposite it — otherwise a tall legend stacks under the Layers box and they overlap.
        <div className="absolute left-2 top-2 z-10 flex max-h-[calc(100%-1rem)] flex-col gap-1 overflow-auto rounded-md border border-border bg-panel/85 p-1.5 text-[11px]">
          {usedIdx.map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: palette[i % palette.length] }} />
              <input
                value={paletteLabels[i] ?? ''}
                placeholder={`Group ${i + 1}`}
                onChange={(e) => setPaletteLabel(i, e.target.value)}
                className="w-28 bg-transparent text-foreground outline-none placeholder:text-faint"
              />
            </div>
          ))}
        </div>
      )}

      <ReactECharts
        option={option}
        notMerge
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={{
          click: (p: { dataType?: string; data?: { id?: string; source?: string; target?: string } }) => {
            if (p.dataType === 'node' && p.data?.id) onChar(p.data.id)
            else if (p.dataType === 'edge' && p.data?.source && p.data?.target) onEdge?.(p.data.source, p.data.target)
          },
          contextmenu: (p: { dataType?: string; data?: { id?: string; name?: string }; event?: { event?: MouseEvent } }) => {
            const native = p.event?.event
            native?.preventDefault?.()
            if (p.dataType === 'node' && p.data?.id && native) {
              setMenu({ x: native.clientX, y: native.clientY, id: p.data.id, name: p.data.name ?? '' })
            }
          }
        }}
      />

      {menu && <ColorTagMenu x={menu.x} y={menu.y} id={menu.id} name={menu.name} onClose={() => setMenu(null)} />}
    </div>
  )
}
