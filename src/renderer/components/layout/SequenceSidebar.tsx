/**
 * SequenceSidebar — the Sidebar while Timeline ▸ Chart Config is open. Lists the ACTIVE tree variant's custom
 * linear AXES (re-homed chart-sequences, in trees.json): pick which drives every Gantt (Auto = the variant's own
 * reading order), create/rename/delete. The path of each axis is authored in the Chart Config panel; the branch/
 * merge graph is authored on the Canvas. See internal/timeline-model.md.
 */
import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { ListOrdered, Plus, Trash2, Check, Route, Pencil } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { variantSequences } from '@/lib/timeline/treeVariant'
import { cn, sidebarRow } from '@/lib/utils'
import { SidebarHeader, SidebarScroll } from '@/components/layout/SidebarKit'

const MAX_SEQUENCES = 50

export function SequenceSidebar(): JSX.Element {
  const { t } = useTranslation('sequence')
  const trees = useWorkspace((s) => s.trees)
  const { sequences, activeId } = variantSequences(trees)
  const setActive = useWorkspace((s) => s.setActiveChartSequence)
  const remove = useWorkspace((s) => s.deleteChartSequence)
  const save = useWorkspace((s) => s.saveChartSequence)
  const rename = useWorkspace((s) => s.renameChartSequence)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const atCap = sequences.length >= MAX_SEQUENCES
  // New = an empty axis + activate it; author its scene order in the Chart Config panel.
  const create = (): void => { if (!atCap) void save({ id: crypto.randomUUID(), name: t('newAxisName', { n: sequences.length + 1 }), path: [] }) }
  const rowCls = (on: boolean): string => cn(sidebarRow(on), 'group')

  const startRename = (id: string, name: string): void => { setEditingId(id); setDraft(name) }
  const commitRename = (): void => {
    if (editingId && draft.trim()) void rename(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <SidebarHeader
        title={t('axesTitle')}
        count={sequences.length}
        action={
          <button
            onClick={create}
            disabled={atCap}
            title={atCap ? t('maxAxesTitle', { max: MAX_SEQUENCES }) : t('newAxis')}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
      <SidebarScroll>
        {/* Auto = no active axis → charts follow the active tree variant's own reading order (its clean chain). */}
        <button data-comp="SequenceRow" onClick={() => void setActive(undefined)} className={rowCls(!activeId)}>
          <ListOrdered className={cn('size-3.5 shrink-0', !activeId ? 'text-lore' : 'text-faint')} />
          <span className="flex-1 truncate">{t('autoVariantOrder')}</span>
          {!activeId && <Check className="size-3.5 shrink-0 text-ok" />}
        </button>
        {sequences.map((s) => {
          const on = activeId === s.id
          if (editingId === s.id) {
            return (
              <div key={s.id} className={rowCls(on)}>
                <Route className="size-3.5 shrink-0 text-thread" />
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditingId(null) }}
                  className="min-w-0 flex-1 rounded border border-thread/50 bg-canvas px-1 py-0.5 text-xs outline-none"
                />
              </div>
            )
          }
          return (
            <div key={s.id} data-comp="SequenceRow" className={rowCls(on)}>
              <button onClick={() => void setActive(s.id)} onDoubleClick={() => startRename(s.id, s.name)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <Route className={cn('size-3.5 shrink-0', on ? 'text-thread' : 'text-faint')} />
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[10px] text-faint">{s.path.length}</span>
                {on && <Check className="size-3.5 shrink-0 text-ok" />}
              </button>
              <button onClick={() => startRename(s.id, s.name)} title={t('renameAxis')} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                <Pencil className="size-3" />
              </button>
              <button onClick={() => void remove(s.id)} title={t('deleteAxis')} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-flag group-hover:opacity-100">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        })}
      </SidebarScroll>
    </div>
  )
}
