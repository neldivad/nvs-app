import { useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { SearchField } from '@/components/ui/SearchField'
import { cn } from '@/lib/utils'

/**
 * SearchPopover — the ONE sidebar search, modelled on the Custody anchor-picker (CustodyPanel's "Anchor the
 * topic to…"). A 🔍 trigger that sits at the far-right of a rail header; clicking it drops a floating panel with
 * a search box + a flat results list. Picking a result fires `onSelect` and closes — so search never costs the
 * rail a persistent row, and every rail looks + behaves identically. See DESIGN.md → "Sidebar search".
 *
 * The panel is `position: fixed`, measured off the trigger, so it's never clipped by a rail's own overflow.
 */
export interface SearchResult {
  /** Opaque id handed back to `onSelect` — the caller decides what it means (a scene path, a page path, an entity id). */
  id: string
  label: ReactNode
  /** Leading glyph — keep it `shrink-0`. */
  icon?: ReactNode
  /** Faint trailing note (a folder trail, a category, a count). */
  meta?: ReactNode
}

export interface SearchPopoverProps {
  /** Given the live query, return the matching results (empty query → whatever you want shown, usually nothing). */
  results: (query: string) => SearchResult[]
  /** A result was chosen — navigate/select. The popover closes right after. */
  onSelect: (id: string) => void
  placeholder?: string
  /** Optional uppercase heading above the input (Custody uses "Anchor the topic to…"). */
  title?: string
  /** Optional footer under the list — e.g. a "create new …" affordance. `close` dismisses the popover. */
  footer?: (query: string, close: () => void) => ReactNode
  /** Rows to render before a "+N more" hint. Default 50. */
  limit?: number
  className?: string
}

export function SearchPopover({ results, onSelect, placeholder, title, footer, limit = 50, className }: SearchPopoverProps): JSX.Element {
  const { t } = useTranslation('searchPopover')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }
  const openPop = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }

  const items = open ? results(query) : []
  const shown = items.slice(0, limit)

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? close() : openPop())}
        title={t('search')}
        className={cn('shrink-0 text-faint transition-colors hover:text-foreground', open && 'text-foreground', className)}
      >
        <Search className="size-3" />
      </button>
      {open && pos && (
        <>
          {/* full-screen catcher so an outside click dismisses (mousedown fires before the list's own handlers) */}
          <div className="fixed inset-0 z-40" onMouseDown={close} />
          <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-64 overflow-hidden rounded-md border border-border bg-panel shadow-lg">
            {title && <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</div>}
            <div className="px-2 pb-1 pt-2">
              <SearchField autoFocus value={query} onChange={setQuery} onKeyDown={(e) => e.key === 'Escape' && close()} placeholder={placeholder ?? t('placeholder')} />
            </div>
            <div className="max-h-72 overflow-y-auto pb-1">
              {shown.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-faint/70">{query.trim() ? t('noMatches') : t('typeToSearch')}</div>
              ) : (
                shown.map((it) => (
                  <button
                    key={it.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onSelect(it.id)
                      close()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-foreground hover:bg-panel-soft"
                  >
                    {it.icon}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.meta != null && <span className="shrink-0 text-[9px] text-faint">{it.meta}</span>}
                  </button>
                ))
              )}
              {items.length > limit && <div className="px-3 py-0.5 text-[10px] text-faint">{t('more', { n: items.length - limit })}</div>}
            </div>
            {footer?.(query, close)}
          </div>
        </>
      )}
    </>
  )
}
