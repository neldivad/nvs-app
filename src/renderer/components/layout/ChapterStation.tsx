/**
 * ChapterStation — one stop on the chapter "railway" that the thread/arc sheets render as. The spine is a
 * single linear line; each CHAPTER is a station on it (the checkpoint), and events/windows are cards that hang
 * under their station. The chapter label lives HERE, once — so the cards beneath can drop it and just name the
 * scene. Three kinds:
 *   • events   — a chapter with cards (●, filled)
 *   • quiet    — an event-less chapter the line passes (○, hollow + bare ·· dots, no cards)
 *   • terminal — the chapter a thread closes in (◆, "terminus")
 * The rail connector runs the full height of each station, so the line stays continuous top-to-bottom.
 */
import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type StationKind = 'events' | 'quiet' | 'terminal'

const GLYPH: Record<StationKind, string> = { events: '●', quiet: '○', terminal: '◆' }
const TONE: Record<StationKind, string> = { events: 'text-thread', quiet: 'text-faint/70', terminal: 'text-foreground/70' }

export function ChapterStation({
  title,
  kind,
  last,
  children
}: {
  title: string
  kind: StationKind
  last: boolean
  children?: ReactNode
}): JSX.Element {
  const { t } = useTranslation('chapterStation')
  return (
    <div className="flex gap-2">
      {/* rail — the station node, then the connector down to the next station */}
      <div className="flex w-5 flex-col items-center">
        <span className={cn('mt-0.5 text-[11px] leading-none', TONE[kind])} title={kind === 'quiet' ? t('quietTooltip') : kind === 'terminal' ? t('terminusTooltip') : undefined}>{GLYPH[kind]}</span>
        {!last && <span className="mt-1 w-px flex-1 bg-border/60" />}
      </div>

      <div className="min-w-0 flex-1 pb-3">
        {/* station sign — the chapter label + a platform rule; terminus tag / quiet dots as suffix */}
        <div className="flex items-center gap-2">
          <span className={cn('shrink-0 text-[11px] font-semibold uppercase tracking-wide', kind === 'quiet' ? 'text-faint' : 'text-foreground/75')}>{title}</span>
          {kind === 'terminal' && <span className="shrink-0 text-[9px] uppercase tracking-wide text-faint">{t('terminus')}</span>}
          <span className="h-px flex-1 bg-border/40" />
          {kind === 'quiet' && <span className="shrink-0 text-[11px] leading-none text-faint/70">··</span>}
        </div>
        {children && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </div>
  )
}
