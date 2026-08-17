/**
 * FindBar — the shared in-editor find UI (top-right overlay: input · N/M · prev · next · close). Presentational
 * only: the parent owns the engine (ProseMirror decorations for the scene block editor, @codemirror/search for
 * the world-page / source CodeMirror surfaces) and passes state + callbacks. One bar, every editor — so ⌘F looks
 * and behaves the same everywhere, instead of the block editor and CodeMirror each having their own.
 */
import { forwardRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

export interface FindBarProps {
  query: string
  count: number
  active: number // 0-based index of the current match
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  placeholder?: string
}

export const FindBar = forwardRef<HTMLInputElement, FindBarProps>(function FindBar(
  { query, count, active, onQueryChange, onNext, onPrev, onClose, placeholder },
  ref
): JSX.Element {
  const { t } = useTranslation('editor')
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-panel px-2 py-1 shadow-lg">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext() }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        placeholder={placeholder ?? t('findBar.placeholder')}
        className="w-40 bg-transparent text-[12px] text-foreground outline-none placeholder:text-faint"
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-faint">
        {query ? `${count ? active + 1 : 0}/${count}` : ''}
      </span>
      <button onClick={onPrev} disabled={!count} title={t('findBar.prev', { keys: '⇧⏎' })} className="rounded p-0.5 text-muted-foreground hover:bg-panel-soft disabled:opacity-40"><ChevronUp className="size-3.5" /></button>
      <button onClick={onNext} disabled={!count} title={t('findBar.next', { keys: '⏎' })} className="rounded p-0.5 text-muted-foreground hover:bg-panel-soft disabled:opacity-40"><ChevronDown className="size-3.5" /></button>
      <button onClick={onClose} title={t('findBar.closeBtn', { keys: 'Esc' })} className="rounded p-0.5 text-muted-foreground hover:bg-panel-soft"><X className="size-3.5" /></button>
    </div>
  )
})
