/**
 * Cast sidebar — the roster, now a selection control (mirrors the Timeline's ScenePalette).
 * Click a row to include/exclude that character from the Presence + Co-presence matrices —
 * the main lever against O(chars × scenes) cell blow-up. Excluded rows dim; the matrices open
 * the character pages on row-click, so this panel stays a pure toggle. Counts come from the graph.
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { Eye, EyeOff } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { entityVisual } from '@/config/entityVisual'
import { ColorTagMenu, resolveNodePalette } from '@/components/layout/ColorTagMenu'
import { SidebarRow, SidebarHeader, SidebarScroll } from '@/components/layout/SidebarKit'
import type { SearchResult } from '@/components/ui/SearchPopover'
import { cn, compactNumber } from '@/lib/utils'
import { SidebarEmpty } from '@/components/ui/EmptyRailState'

export function CastSidebar(): JSX.Element {
  const { t } = useTranslation('cast')
  const characters = useWorkspace((s) => s.characters)
  const graph = useWorkspace((s) => s.timelineGraph)
  const excluded = useWorkspace((s) => s.castExcluded)
  const toggle = useWorkspace((s) => s.toggleCastChar)
  const setExcluded = useWorkspace((s) => s.setCastExcluded)
  const nodeColor = useWorkspace((s) => s.nodeColor)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(null)
  const palette = useMemo(() => resolveNodePalette(), [])

  const appearances = useMemo(() => {
    const m = new Map<string, number>()
    for (const sc of Object.values(graph.scenes)) for (const c of sc.cast) m.set(c.entityId, (m.get(c.entityId) ?? 0) + (c.volume ?? 0)) // rank by dialogue VOLUME (characters), not turn/scene count
    return m
  }, [graph])
  const rows = useMemo(
    () => [...characters].sort((a, b) => (appearances.get(b.id) ?? 0) - (appearances.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
    [characters, appearances]
  )
  const ex = useMemo(() => new Set(excluded), [excluded])
  const shown = characters.length - ex.size
  const v = entityVisual('character')
  const Icon = v.Icon

  // The rail always shows the full roster; search is a jump-to that toggles the picked row (a "remote row-click").
  const searchResults = (query: string): SearchResult[] => {
    const s = query.trim().toLowerCase()
    if (!s) return []
    return rows
      .filter((c) => c.name.toLowerCase().includes(s))
      .map((c) => ({ id: c.id, label: c.name, icon: <Icon className={cn('size-3.5 shrink-0', v.text)} />, meta: compactNumber(appearances.get(c.id) ?? 0) }))
  }

  return (
    <div {...regionAttrs('castSidebar')} className="flex h-full flex-col bg-panel">
      <SidebarHeader
        title={<>{t('rail.name')} · {shown}/{characters.length}</>}
        search={{ results: searchResults, onSelect: toggle, placeholder: t('sidebar.searchCast') }}
        action={
          characters.length > 0 && (
            <button
              onClick={() => setExcluded(ex.size === 0 ? characters.map((c) => c.id) : [])}
              title={ex.size === 0 ? t('sidebar.hideAll') : t('sidebar.showAll')}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {ex.size === 0 ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          )
        }
      />
      <SidebarScroll className="pb-3">
        {characters.length === 0 ? (
          <SidebarEmpty>{t('sidebar.noCharacters')}</SidebarEmpty>
        ) : (
          rows.map((c) => {
            const off = ex.has(c.id)
            const n = appearances.get(c.id) ?? 0
            return (
              <SidebarRow
                key={c.id}
                dim={off}
                onClick={() => toggle(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, id: c.id, name: c.name })
                }}
                title={off ? t('sidebar.include') : t('sidebar.exclude')}
                leading={
                  c.avatar ? (
                    <img src={`nvs-asset://${c.avatar}`} alt="" className="size-5 shrink-0 rounded-full object-cover" />
                  ) : (
                    <Icon className={cn('size-3.5 shrink-0', v.text)} />
                  )
                }
                label={c.name}
                trailing={
                  <>
                    <span className="shrink-0 font-mono text-[10px] text-faint" title={t('sidebar.charsSpoken', { chars: n.toLocaleString() })}>{compactNumber(n)}</span>
                    {nodeColor[c.id] != null ? (
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: palette[nodeColor[c.id] % palette.length] }} />
                    ) : (
                      <span className="size-2 shrink-0 rounded-full border border-faint" />
                    )}
                  </>
                }
              />
            )
          })
        )}
      </SidebarScroll>
      {menu && <ColorTagMenu x={menu.x} y={menu.y} id={menu.id} name={menu.name} onClose={() => setMenu(null)} />}
    </div>
  )
}
