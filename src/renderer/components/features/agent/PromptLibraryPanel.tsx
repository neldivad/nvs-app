/**
 * The Prompt Library — the global, reusable page-agent instructions (built-in + your own).
 *
 * A MASTER-DETAIL popup (SplitDialog): browse the list on the LEFT, inspect the selected prompt on the RIGHT
 * (what the AI is told + the full run-time template), and act — Duplicate a built-in, or Edit/Delete your own.
 * It's a reference you open occasionally; the two panes keep the list calm and give the prompt room to be read.
 * The in-editor `/agent` composer's quick-pick pills are this same list. Built-ins re-sync from code each launch.
 */
import { useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, ChevronRight, MessageSquare, Search, Lock, CornerDownRight, Replace, Copy } from 'lucide-react'
import { pagePromptTemplate, isAnalysis, type PageEditMode, type PromptCategory } from '@shared/config/agentCommands'
import type { SavedPrompt } from '@shared/ipc'
import { useWorkspace } from '@/stores/workspace'
import { SplitDialog } from '@/components/ui/SplitDialog'
import { DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The category lanes, in display order. Labels + hints are chrome, resolved via i18n (`category.*` / `categoryHint.*`). */
export const CATEGORIES: { id: PromptCategory }[] = [
  { id: 'maintenance' },
  { id: 'generation' },
  { id: 'analysis' }
]

/** Distinct color per edit class so append/replace read differently at a glance — green = additive
 *  (append), amber = rewrites the page (replace). Reused by the task cards + composer pills. */
export function modeTone(mode: PageEditMode, selected = false): string {
  if (mode === 'replace') return selected ? 'border-warn/60 bg-warn/15 text-warn' : 'border-warn/40 text-warn'
  return selected ? 'border-ok/60 bg-ok/15 text-ok' : 'border-ok/40 text-ok'
}

/** What a prompt DOES, as a single colored glyph (color carries the meaning): green = append (additive),
 *  amber = replace (rewrites the page), indigo = analysis (answers in chat). */
function promptKind(p: SavedPrompt): { Icon: typeof Plus; tone: string; titleKey: string } {
  if (isAnalysis(p.category)) return { Icon: MessageSquare, tone: 'text-thread', titleKey: 'kind.analysis' }
  if (p.mode === 'replace') return { Icon: Replace, tone: 'text-warn', titleKey: 'kind.replace' }
  return { Icon: CornerDownRight, tone: 'text-ok', titleKey: 'kind.append' }
}

const NEW_PROMPT: SavedPrompt = { id: '', label: '', directive: '', mode: 'append', category: 'maintenance' }
const duplicateOf = (p: SavedPrompt, copyWord: string): SavedPrompt => ({ id: '', label: `${p.label} ${copyWord}`, directive: p.directive, mode: p.mode, category: p.category })

export function PromptLibraryPanel(): JSX.Element {
  const { t } = useTranslation('prompts')
  const open = useWorkspace((s) => s.promptsOpen)
  const setOpen = useWorkspace((s) => s.setPromptsOpen)
  const prompts = useWorkspace((s) => s.prompts)
  const savePrompt = useWorkspace((s) => s.savePrompt)
  const deletePrompt = useWorkspace((s) => s.deletePrompt)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SavedPrompt | null>(null) // set = the right pane is the EDITOR (new/edit/duplicate)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | PromptCategory>('all')

  const needle = q.trim().toLowerCase()
  const visible = prompts
    .filter((p) => filter === 'all' || p.category === filter)
    .filter((p) => !needle || `${p.label} ${p.directive}`.toLowerCase().includes(needle))
  const selected = useMemo(() => prompts.find((p) => p.id === selectedId) ?? null, [prompts, selectedId])

  const pickRow = (p: SavedPrompt): void => { setSelectedId(p.id); setDraft(null) }
  const newPrompt = (): void => { setDraft({ ...NEW_PROMPT }); setSelectedId(null) }
  const save = async (): Promise<void> => {
    if (!draft || !draft.directive.trim()) return
    await savePrompt(draft)
    setDraft(null)
  }
  const remove = async (p: SavedPrompt): Promise<void> => { await deletePrompt(p.id); if (selectedId === p.id) setSelectedId(null) }

  const left = (
    <>
      {/* Search + filters + new — the master pane's own header */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-canvas px-1.5">
          <Search className="size-3 shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-foreground outline-none placeholder:text-faint"
          />
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn('rounded px-1.5 py-0.5 capitalize', filter === c ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}
            >
              {t(`filter.${c}`)}
            </button>
          ))}
          <button onClick={newPrompt} title={t('newTooltip')} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft hover:text-foreground">
            <Plus className="size-3" /> {t('new')}
          </button>
        </div>
      </div>

      {/* The categorized list — rows SELECT (the right pane inspects); no hover-action clutter. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visible.length === 0 && <p className="p-4 text-center text-[11px] text-faint">{prompts.length === 0 ? t('empty.noneYet') : t('empty.noMatch')}</p>}
        {CATEGORIES.map((cat) => {
          const inCat = visible.filter((p) => p.category === cat.id)
          if (!inCat.length) return null
          return (
            <div key={cat.id} className="mb-2">
              <div className="flex items-center gap-2 px-1.5 pb-1 pt-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-faint">{t(`category.${cat.id}`)}</span>
                <span className="font-mono text-[9px] text-faint/60">{inCat.length}</span>
              </div>
              {inCat.map((p) => {
                const { Icon, tone, titleKey } = promptKind(p)
                const title = t(titleKey)
                const on = selectedId === p.id && !draft
                return (
                  <button
                    key={p.id}
                    onClick={() => pickRow(p)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', on ? 'bg-panel-soft' : 'hover:bg-panel-soft/60')}
                  >
                    <Icon className={cn('size-3.5 shrink-0', tone)} aria-label={title}><title>{title}</title></Icon>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{p.label || <span className="text-faint">{t('untitled')}</span>}</span>
                    {p.builtIn && <Lock className="size-2.5 shrink-0 text-faint/70"><title>{t('builtIn')}</title></Lock>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </>
  )

  const right = draft ? (
    <Editor draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} />
  ) : selected ? (
    <PromptDetail p={selected} onEdit={() => setDraft(selected)} onDuplicate={() => { setDraft(duplicateOf(selected, t('copySuffix'))); }} onDelete={() => void remove(selected)} />
  ) : (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <p className="max-w-xs text-[12px] leading-relaxed text-faint">{t('empty.selectBefore')}<span className="text-muted-foreground">{t('empty.selectNew')}</span>{t('empty.selectAfter')}</p>
    </div>
  )

  return <SplitDialog open={open} onClose={() => setOpen(false)} title={t('title')} left={left} right={right} />
}

/** The right pane in VIEW mode: the selected prompt read in full — the directive + the run-time template — with
 *  the acts you can take on it (Duplicate a built-in; Edit / Delete your own). */
function PromptDetail({ p, onEdit, onDuplicate, onDelete }: { p: SavedPrompt; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }): JSX.Element {
  const { t } = useTranslation('prompts')
  const { Icon, tone } = promptKind(p)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex items-start gap-2.5">
          <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-foreground">{p.label || t('untitled')}</h3>
            <p className="mt-0.5 text-[11px] text-faint">
              {t(`category.${p.category}`)}
              {!isAnalysis(p.category) && <> · {p.mode === 'replace' ? t('detail.replaces') : t('detail.appends')}</>}
              {isAnalysis(p.category) && <> · {t('detail.answersInChat')}</>}
              {p.builtIn && <> · {t('builtIn')}</>}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-faint">{t('detail.whatToldLabel')}</div>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-canvas/50 p-3 text-[12px] leading-relaxed text-foreground/90">{p.directive}</p>
        </div>

        {!isAnalysis(p.category) && <PromptPreview directive={p.directive} mode={p.mode} />}
      </div>

      <DialogFooter aside={p.builtIn ? <span className="text-[11px] text-faint">{t('detail.builtInNote')}</span> : undefined}>
        {!p.builtIn && <Button variant="ghost" size="sm" onClick={onDelete} className="hover:text-flag"><Trash2 className="size-3" /> {t('detail.delete')}</Button>}
        <Button variant="outline" size="sm" onClick={onDuplicate}><Copy className="size-3" /> {t('detail.duplicate')}</Button>
        {!p.builtIn && <Button size="sm" onClick={onEdit}><Pencil className="size-3" /> {t('detail.edit')}</Button>}
      </DialogFooter>
    </div>
  )
}

/** The right pane in EDIT mode: name + directive + where-it-runs + output, with Save / Cancel in the footer. */
function Editor({ draft, onChange, onSave, onCancel }: { draft: SavedPrompt; onChange: (p: SavedPrompt) => void; onSave: () => void; onCancel: () => void }): JSX.Element {
  const { t } = useTranslation('prompts')
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px]">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <label className="mb-1 block text-[10px] uppercase tracking-[0.5px] text-faint">{t('editor.nameLabel')}</label>
        <input
          autoFocus
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          placeholder={t('editor.namePlaceholder')}
          className="mb-3 w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/30"
        />
        <label className="mb-1 block text-[10px] uppercase tracking-[0.5px] text-faint">{t('editor.promptLabel')}</label>
        <textarea
          value={draft.directive}
          onChange={(e) => onChange({ ...draft, directive: e.target.value })}
          placeholder={t('editor.promptPlaceholder')}
          rows={5}
          className="w-full resize-none rounded-md border border-border bg-canvas px-2 py-1.5 text-[12px] leading-relaxed text-foreground outline-none focus:border-foreground/30"
        />
        <p className="mt-1 text-[10px] leading-snug text-faint">{t('editor.promptHelp')}</p>

        <div className="mt-4 grid grid-cols-[3.5rem_1fr] items-center gap-x-2 gap-y-2">
          <span className="text-[10px] uppercase tracking-[0.5px] text-faint">{t('editor.runs')}</span>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => onChange({ ...draft, category: c.id })} title={t(`categoryHint.${c.id}`)}
                className={cn('rounded-md border px-2 py-0.5 text-[10px]', draft.category === c.id ? 'border-thread/50 bg-thread/10 text-foreground' : 'border-border text-muted-foreground hover:bg-panel-soft')}>
                {t(`category.${c.id}`)}
              </button>
            ))}
          </div>
          {!isAnalysis(draft.category) && (
            <>
              <span className="text-[10px] uppercase tracking-[0.5px] text-faint">{t('editor.output')}</span>
              <div className="flex flex-wrap gap-1">
                {(['append', 'replace'] as PageEditMode[]).map((m) => (
                  <button key={m} onClick={() => onChange({ ...draft, mode: m })} title={m === 'replace' ? t('editor.replaceTooltip') : t('editor.appendTooltip')}
                    className={cn('rounded-md border px-2 py-0.5 text-[10px]', draft.mode === m ? modeTone(m, true) : `${modeTone(m)} hover:bg-panel-soft`)}>
                    {m === 'replace' ? t('editor.replacePage') : t('editor.append')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {!isAnalysis(draft.category) && <PromptPreview directive={draft.directive} mode={draft.mode} />}
      </div>

      <DialogFooter aside={isAnalysis(draft.category) ? <span className="text-[10px] text-faint">{t('editor.answersInChat')}</span> : undefined}>
        <Button variant="ghost" size="sm" onClick={onCancel}>{t('editor.cancel')}</Button>
        <Button size="sm" onClick={onSave} disabled={!draft.directive.trim()}>{t('editor.save')}</Button>
      </DialogFooter>
    </div>
  )
}

/** A UNIVERSAL view of the prompt this directive produces: the static framing verbatim, with the per-run inputs
 *  as `{{ … }}` placeholders (page content + live canon are filled at run time). Toggle scene vs world framing. */
function PromptPreview({ directive, mode }: { directive: string; mode: PageEditMode }): JSX.Element {
  const { t } = useTranslation('prompts')
  const [open, setOpen] = useState(false)
  const activePageKind = useWorkspace((s) => s.activePage?.kind)
  const [kind, setKind] = useState<'scene' | 'world'>(activePageKind === 'scene' ? 'scene' : 'world')
  const { system, user } = useMemo(() => pagePromptTemplate({ mode, kind, instruction: directive }), [directive, mode, kind])

  return (
    <div className="mt-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {t('preview.toggle')}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-border bg-canvas">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-[10px]">
            <span className="text-faint">{t('preview.formatFor')}</span>
            {(['scene', 'world'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn('rounded px-1.5 py-0.5', kind === k ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}>{t(`preview.${k}`)}</button>
            ))}
            <span className="ml-auto text-faint">{'{{ … }}'} {t('preview.filledPerRun')}</span>
          </div>
          <div className="max-h-72 overflow-auto p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 font-semibold uppercase tracking-wide text-faint">{t('preview.system')}</div>
            <pre className="mb-2 whitespace-pre-wrap">{system}</pre>
            <div className="mb-1 font-semibold uppercase tracking-wide text-faint">{t('preview.user')}</div>
            <pre className="whitespace-pre-wrap">{user}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
