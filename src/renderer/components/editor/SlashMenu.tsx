/**
 * Shared slash-command palette UI — a floating, keyboard-navigable menu.
 *
 * The scene block editor has its own inline version; this is the portal-positioned
 * twin used by the world-page CodeMirror editor, so both surfaces feel identical
 * (icon · label · description · command, arrow/Enter/Tab/Escape). The caller supplies
 * items + a caret position; the menu owns filtering, selection, and key handling.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX,
} from 'react';
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SlashItem {
  id: string
  label: string
  command: string // e.g. '/arc'
  insert: string // text inserted on select
  description?: string
  icon?: ReactNode
  present?: boolean // already on the page (e.g. the `## section` exists) — shown as added
}

export function SlashMenu({
  items,
  query,
  top,
  left,
  onSelect,
  onClose
}: {
  items: SlashItem[]
  query: string
  top: number
  left: number
  onSelect: (item: SlashItem) => void
  onClose: () => void
}): JSX.Element | null {
  const { t } = useTranslation('editor')
  const [idx, setIdx] = useState(0)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return items
      .filter((it) => it.command.toLowerCase().includes(q) || it.label.toLowerCase().includes(q))
      .slice(0, 50) // cap (mentions can have a large catalog)
  }, [items, query])

  useEffect(() => setIdx(0), [query])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (filtered[idx]) onSelect(filtered[idx])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filtered, idx, onSelect, onClose])

  // Keep the menu inside the viewport: clamp left, and flip above the caret if it would
  // overflow the bottom (measured after layout, since height depends on the item count).
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top, left })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const m = 8
    setPos({
      top: top + h > window.innerHeight - m ? Math.max(m, top - h - 8) : top,
      left: Math.min(left, window.innerWidth - w - m)
    })
  }, [top, left, filtered.length])

  // Keep the highlighted row visible as the user arrows through a scrolling list.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!filtered.length) return null

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg"
      style={{ top: pos.top, left: pos.left }}
    >
      {filtered.map((it, i) => (
        <button
          key={it.id}
          data-active={i === idx}
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
            i === idx ? 'bg-panel-soft' : 'hover:bg-panel-soft'
          )}
          onMouseEnter={() => setIdx(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(it)
          }}
        >
          {it.icon && (
            <span className={cn('shrink-0', it.present ? 'text-character' : 'text-muted-foreground')}>
              {it.present ? <Check className="size-4" /> : it.icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className={cn('font-medium', it.present ? 'text-muted-foreground' : 'text-foreground')}>
              {it.label}
            </div>
            {it.description && <div className="truncate text-[11px] text-faint">{it.description}</div>}
          </div>
          {it.present ? (
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-character/70">{t('slashMenu.added')}</span>
          ) : (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{it.command}</span>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
