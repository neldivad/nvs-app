/**
 * SearchField — THE one search input for every rail/sidebar/picker. Before this, each rail hand-rolled its own
 * `<Search/> + <input placeholder="Search…"/>` (scene · world · timeline palette · custody · cast · relationship),
 * so they drifted on padding, icon, clear affordance, and font size. Compose this instead; the ONLY things a
 * caller owns are the value/onChange and where it sits.
 *
 *  - default: a bordered box (persistent search bars, popovers).
 *  - `bare`:  transparent, no border — for embedding in a header row (SidebarKit's SidebarHeader toggle).
 *
 * A clear ✕ appears once there's a query (suppress with `clearable={false}` when a wrapper owns close/clear).
 */
import { type JSX, type KeyboardEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
  bare,
  clearable = true,
  onKeyDown,
  inputRef,
  className
}: {
  value: string
  onChange: (q: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Transparent + borderless, for embedding in a header row. Default is a bordered box. */
  bare?: boolean
  /** Show the clear ✕ when non-empty (default true). Set false when a wrapper owns the clear/close. */
  clearable?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  inputRef?: Ref<HTMLInputElement>
  className?: string
}): JSX.Element {
  const { t } = useTranslation('searchField')
  const showClear = clearable && value !== ''
  return (
    <div className={cn('relative flex min-w-0 items-center', className)}>
      <Search className={cn('pointer-events-none absolute size-3 text-faint', bare ? 'left-0' : 'left-2')} />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? t('placeholder')}
        className={cn(
          'min-w-0 flex-1 text-xs text-foreground outline-none placeholder:text-faint',
          bare
            ? cn('bg-transparent pl-5', showClear && 'pr-5')
            : cn('rounded border border-border bg-canvas py-1 pl-7 focus:border-thread', showClear ? 'pr-6' : 'pr-2')
        )}
      />
      {showClear && (
        <button
          onClick={() => onChange('')}
          title={t('clear')}
          className={cn('absolute text-faint transition-colors hover:text-foreground', bare ? 'right-0' : 'right-1.5')}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
