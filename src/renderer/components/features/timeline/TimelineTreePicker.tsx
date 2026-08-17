/**
 * TimelineTreePicker — the canvas control for TREE VARIANTS (tree-variant model, internal/timeline-model.md ★).
 * The active variant is the branch/merge graph the canvas draws + edits AND the analysis + gantt axis read, so
 * switching here re-drives everything. Create (copies the active one — "born by copying"), rename, delete, pick.
 * Lives as a Panel on the timeline canvas, where you author variants.
 */
import { useState, type JSX } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Route, ChevronDown, Plus, Check, Pencil, Trash2, Sparkles } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { activeVariant } from '@/lib/timeline/treeVariant'
import { MAX_TIMELINE_VARIANTS } from '@shared/ipc'
import { buildNewTimelinePrompt } from '@shared/config/chatPrompts'
import { AiGate } from '@/config/aiFeatures'
import { cn } from '@/lib/utils'

export function TimelineTreePicker(): JSX.Element | null {
  const trees = useWorkspace((s) => s.trees)
  const setActive = useWorkspace((s) => s.setActiveVariant)
  const create = useWorkspace((s) => s.createVariant)
  const rename = useWorkspace((s) => s.renameVariant)
  const remove = useWorkspace((s) => s.deleteVariant)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const { t } = useTranslation('timeline')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const active = activeVariant(trees)
  if (!active) return null // no variant yet (pre-mirror) — nothing to pick

  const startRename = (id: string, name: string): void => { setEditingId(id); setDraft(name) }
  const commit = (): void => { if (editingId && draft.trim()) void rename(editingId, draft.trim()); setEditingId(null) }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t('variant.pickerTitle')}
        className="flex items-center gap-1.5 rounded-md border border-border bg-panel/90 px-2 py-1 text-[11px] text-foreground shadow-sm transition-colors hover:bg-panel-soft"
      >
        <Route className="size-3.5 shrink-0 text-thread" />
        <span className="max-w-40 truncate">{active.name}</span>
        <ChevronDown className="size-3 shrink-0 text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setEditingId(null) }} />
          <div className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-border bg-panel shadow-lg">
            {trees.variants.map((v) => {
              const on = v.id === active.id
              if (editingId === v.id) {
                return (
                  <div key={v.id} className="flex items-center gap-2 px-2 py-1">
                    <Route className="size-3.5 shrink-0 text-thread" />
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditingId(null) }}
                      className="min-w-0 flex-1 rounded border border-thread/50 bg-canvas px-1 py-0.5 text-[11px] outline-none"
                    />
                  </div>
                )
              }
              return (
                <div key={v.id} className={cn('group flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-panel-soft', on && 'bg-panel-soft')}>
                  <button onClick={() => { void setActive(v.id); setOpen(false) }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Route className={cn('size-3.5 shrink-0', on ? 'text-thread' : 'text-faint')} />
                    <span className="truncate">{v.name}</span>
                    {on && <Check className="size-3.5 shrink-0 text-ok" />}
                  </button>
                  <button onClick={() => startRename(v.id, v.name)} title={t('variant.rename')} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"><Pencil className="size-3" /></button>
                  {trees.variants.length > 1 && (
                    <button onClick={() => void remove(v.id)} title={t('variant.delete')} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-flag group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
              )
            })}
            <button
              onClick={() => { void create(); setOpen(false) }}
              disabled={trees.variants.length >= MAX_TIMELINE_VARIANTS}
              title={trees.variants.length >= MAX_TIMELINE_VARIANTS ? t('variant.maxTitle', { max: MAX_TIMELINE_VARIANTS }) : t('variant.newTitle')}
              className="flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus className="size-3.5" /> {trees.variants.length >= MAX_TIMELINE_VARIANTS ? t('variant.maxLabel', { max: MAX_TIMELINE_VARIANTS }) : <Trans t={t} i18nKey="variant.newWithHint" components={{ hint: <span className="text-faint" /> }} />}
            </button>
            <AiGate>
              <button
                onClick={() => { setChatDraft(buildNewTimelinePrompt()); setChatOpen(true); setOpen(false) }}
                disabled={trees.variants.length >= MAX_TIMELINE_VARIANTS}
                title={trees.variants.length >= MAX_TIMELINE_VARIANTS ? t('variant.maxTitle', { max: MAX_TIMELINE_VARIANTS }) : t('variant.aiTitle')}
                className="flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-[11px] text-thread transition-colors hover:bg-thread/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Sparkles className="size-3.5" /> {t('variant.aiNew')}
              </button>
            </AiGate>
          </div>
        </>
      )}
    </div>
  )
}
