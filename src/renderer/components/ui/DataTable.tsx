/**
 * DataTable — the app's ONE table primitive. A thin, headless-in-spirit shell (no Radix, no TanStack): you
 * describe the columns as data (id · header · cell · alignment · width · optional sort) and it renders a real
 * semantic <table> with deterministic widths (via <colgroup>, not width-coercion CSS hacks), a sticky header,
 * hover rows, and optional click-to-sort.
 *
 * Borrowed from TanStack's mental model — columns-as-data + a cell renderer per column — WITHOUT its runtime.
 * Sorting is UNCONTROLLED (internal useState): there is deliberately no `sort`/`onSortChange` seam, so the
 * controlled-state-without-an-updater bug that once froze the renderer is structurally impossible here.
 */
import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Fixed column width in px. Omit + `grow` for the one flexible column; omit both = sized to content. */
  width?: number
  /** Absorbs remaining width. At most ONE column should grow. Pair with `truncate` for a growing TEXT column;
   *  leave `truncate` off for a growing non-text cell (e.g. a full-width bar) so it isn't clipped to zero. */
  grow?: boolean
  /** Clip the cell to its column width with an ellipsis (a text column — capped-fixed OR growing). */
  truncate?: boolean
  /** Enables click-to-sort on this header. Requires `sortValue`. */
  sortable?: boolean
  sortValue?: (row: T) => number | string
  /** Small uppercase tag after the header label (e.g. "local"). */
  headerTag?: string
  /** Title tooltip on the header cell. */
  headerHint?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  emptyMessage?: ReactNode
  density?: 'compact' | 'cozy'
  /** Initial sort (uncontrolled — the table owns sort state thereafter). */
  defaultSort?: { id: string; dir: 'asc' | 'desc' }
  /** Per-row class hook (e.g. highlight the active row) — receives the row + its rendered index. */
  rowClassName?: (row: T, index: number) => string | undefined
  className?: string
}

const alignCls = (a?: 'left' | 'right' | 'center'): string =>
  a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Nothing to show.',
  density = 'compact',
  defaultSort,
  rowClassName,
  className
}: DataTableProps<T>): JSX.Element {
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null)
  const pad = density === 'cozy' ? 'px-3 py-2.5' : 'px-3 py-1.5'

  // Click cycle per column: asc → desc → unsorted (back to the caller's natural row order).
  const toggle = (id: string): void =>
    setSort((s) => (s?.id !== id ? { id, dir: 'asc' } : s.dir === 'asc' ? { id, dir: 'desc' } : null))

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sortValue) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })
  }, [rows, sort, columns])

  return (
    <table className={cn('w-full border-collapse text-[11px]', className)}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.id} style={{ width: c.grow ? 'auto' : c.width ? `${c.width}px` : '1px' }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-panel text-faint">
        <tr className="border-b border-border">
          {columns.map((c) => {
            const sortActive = sort?.id === c.id
            return (
              <th
                key={c.id}
                title={c.headerHint}
                className={cn(pad, 'font-medium', alignCls(c.align), c.grow ? '' : 'whitespace-nowrap')}
              >
                {c.sortable && c.sortValue ? (
                  <button
                    onClick={() => toggle(c.id)}
                    className={cn(
                      'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                      sortActive && 'text-foreground',
                      c.align === 'right' && 'flex-row-reverse'
                    )}
                  >
                    <span>{c.header}</span>
                    {sortActive ? (
                      sort.dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-25" />
                    )}
                  </button>
                ) : (
                  <>
                    {c.header}
                    {c.headerTag && <span className="ml-1 text-[8px] uppercase text-faint/60">{c.headerTag}</span>}
                  </>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-3 py-8 text-center text-xs text-faint">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sorted.map((row, i) => (
            <tr key={rowKey(row)} className={cn('border-b border-border/50 hover:bg-panel-soft/40', rowClassName?.(row, i))}>
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    pad,
                    'align-middle',
                    alignCls(c.align),
                    c.grow && c.truncate ? 'max-w-0 truncate' : c.truncate ? 'truncate' : c.grow ? '' : 'whitespace-nowrap'
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
