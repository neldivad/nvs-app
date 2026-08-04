/**
 * Shared text primitives for the detail FLOATS (coherence finding · character arc · thread · entity), so
 * they read as one family instead of four dialects. Reference these instead of re-typing the label /
 * prose / divider classes — that's what keeps the floats uniform as we add more.
 */
import type { JSX, ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A small uppercase section label ("What the page says", "Wants", "Verify", …). */
export function DetailLabel({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint', className)}>{children}</div>
}

/** The canonical body-prose class for a float's readable text (summary / declared / observed / …). */
export const DETAIL_PROSE = 'text-[13px] leading-relaxed text-foreground/85'

/** The canonical scroll-body padding for a float (a touch tighter when embedded in a stacked list). */
export const detailBodyPad = (embedded?: boolean): string => (embedded ? 'px-6 py-4' : 'px-6 py-5')

/** Latest ⇅ Oldest order toggle for a detail float's stacked items (shared so all the floats match). */
export function DetailSortToggle({ oldestFirst, onToggle, className }: { oldestFirst: boolean; onToggle: () => void; className?: string }): JSX.Element {
  return (
    <button
      onClick={onToggle}
      title={oldestFirst ? 'Oldest first — click for latest first' : 'Latest first — click for oldest first'}
      className={cn('flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground', className)}
    >
      {oldestFirst ? 'Oldest' : 'Latest'}
      {oldestFirst ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
    </button>
  )
}

/** A themed gradient seam between stacked items (rail accent passed as a Tailwind text-color class). */
export function DetailSeam({ accent = 'via-flag/50' }: { accent?: string }): JSX.Element {
  return <div className={cn('mx-2 my-5 h-0.5 rounded-full bg-linear-to-r from-transparent to-transparent', accent)} />
}
