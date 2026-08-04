/**
 * PagedList — a fixed-height, scrollable list that paints only the first page of items and reveals the rest
 * with a "Load more". So a picker/menu never renders the whole universe at once (which would blow up the DOM
 * on a large work). Shared so every list surface gets the same truncation/scroll behavior for free.
 *
 * Pass `resetKey` (e.g. the current search + filter) so a NEW query jumps back to the first page.
 * The caller still passes the full (filtered) array — only `pageSize * page` of it is mounted.
 */
import { useEffect, useState, type ReactNode, type JSX } from 'react';
import { cn } from '@/lib/utils'

export function PagedList<T>({
  items,
  renderItem,
  getKey,
  resetKey = '',
  pageSize = 30,
  empty = 'Nothing here',
  heightClass = 'h-56',
  className
}: {
  items: T[]
  renderItem: (item: T) => ReactNode
  getKey: (item: T) => string
  resetKey?: string // changing this (the search/filter state) resets to the first page
  pageSize?: number
  empty?: ReactNode
  heightClass?: string // the constant height (overflow scrolls)
  className?: string
}): JSX.Element {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [resetKey])

  const shown = page * pageSize
  const visible = items.slice(0, shown)
  const remaining = items.length - visible.length

  return (
    <div className={cn('overflow-auto p-1', heightClass, className)}>
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-[10px] text-faint">{empty}</p>
      ) : (
        <>
          {visible.map((it) => (
            <div key={getKey(it)}>{renderItem(it)}</div>
          ))}
          {remaining > 0 && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="mt-1 w-full rounded px-2 py-1 text-center text-[10px] text-muted-foreground hover:bg-panel-soft"
            >
              Load {Math.min(remaining, pageSize)} more · {remaining} left
            </button>
          )}
        </>
      )}
    </div>
  )
}
