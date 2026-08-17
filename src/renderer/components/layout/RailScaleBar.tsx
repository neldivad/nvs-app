/**
 * RailScaleBar — the unified BOTTOM control bar for every gantt rail (Cast · Threads · Coherence). Three zones:
 *  • left   "Scene" + the scene-range slider (window the columns)
 *  • middle "‹ N–M of TOTAL noun ›" pagination (the row page)
 *  • right  a metric slider ("Line" · "Range") that trims rows by a per-row count (lines · beats · findings)
 *
 * Design: the labels stay put, but the numeric readouts are HIDDEN until you hover that slider group — the bar
 * reads as three quiet sliders at rest, and the exact window/counts surface only when you reach for them. Lives at
 * the bottom (border-t), below the board and above RailChrome, so the top header holds nothing but tabs/filters and
 * the Layers float never covers a control.
 */
import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { RangeSlider } from '@/components/ui/RangeSlider'

export interface ScenePart {
  lo: number
  hi: number
  full: number // whole-axis length (fullCols.length)
  auto?: boolean // window is at its default (not user-set)
  onChange: (v: [number, number] | null) => void
  onReset?: () => void // back to the default window (shown on hover when the user has narrowed)
  title?: string // native-tooltip detail, e.g. the from→to scene titles
}
export interface PagePart {
  from: number
  to: number
  total: number
  noun: string // "threads" · "characters"
  page: number
  pageCount: number
  onPage: (p: number) => void
}
export interface MetricPart {
  label: string // "Line" · "Range"
  min: number
  max: number
  value: [number, number]
  onChange: (v: [number, number] | null) => void
  readout: string // "3–7" · "all"
  onReset?: () => void
  title?: string
}

// Value readout: hidden at rest, fades in on hover of its slider group.
const VALUE = 'shrink-0 tabular-nums opacity-0 transition-opacity'

export function RailScaleBar({ left, scene, page, metric }: { left?: ReactNode; scene?: ScenePart; page?: PagePart; metric?: MetricPart }): JSX.Element | null {
  const { t } = useTranslation('railScaleBar')
  const showScene = scene != null && scene.full > 1
  const showPage = page != null && page.pageCount > 1
  const showMetric = metric != null && metric.max > metric.min
  if (left == null && !showScene && !showPage && !showMetric) return null
  return (
    <div data-export-hide="1" className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-faint">
      {left != null && <span className="flex shrink-0 items-center gap-2">{left}</span>}
      {showScene ? (
        <span className="group/scene flex items-center gap-2" title={scene!.title}>
          <span className="shrink-0">{t('scene')}</span>
          <RangeSlider min={0} max={Math.max(0, scene!.full - 1)} value={[scene!.lo, scene!.hi]} onChange={scene!.onChange} className="w-40 shrink-0" />
          <span className={`${VALUE} group-hover/scene:opacity-100`}>
            {t('sceneReadout', { shown: scene!.hi - scene!.lo + 1, full: scene!.full })}
            {scene!.auto ? t('autoSuffix') : ''}
          </span>
          {scene!.onReset && (
            <button onClick={scene!.onReset} className={`shrink-0 opacity-0 transition-opacity hover:text-foreground group-hover/scene:opacity-100`} title={t('backToDefault')}>
              {t('reset')}
            </button>
          )}
        </span>
      ) : (
        <span /> // hold the left anchor so pagination still centers
      )}

      <span className="flex flex-1 justify-center">
        {showPage && (
          <span className="flex items-center gap-1.5 tabular-nums">
            <button disabled={page!.page === 0} onClick={() => page!.onPage(page!.page - 1)} title={t('previousPage')} className="rounded p-0.5 hover:text-foreground disabled:opacity-30 disabled:hover:text-faint">
              <ChevronLeft className="size-3.5" />
            </button>
            <span>
              {t('pageReadout', { from: page!.from, to: page!.to, total: page!.total, noun: page!.noun })}
            </span>
            <button disabled={page!.page >= page!.pageCount - 1} onClick={() => page!.onPage(page!.page + 1)} title={t('nextNoun', { noun: page!.noun })} className="rounded p-0.5 hover:text-foreground disabled:opacity-30 disabled:hover:text-faint">
              <ChevronRight className="size-3.5" />
            </button>
          </span>
        )}
      </span>

      {showMetric && (
        <span className="group/metric flex items-center gap-2" title={metric!.title}>
          <span className="shrink-0">{metric!.label}</span>
          <RangeSlider min={metric!.min} max={metric!.max} value={metric!.value} onChange={metric!.onChange} className="w-32 shrink-0" />
          <span className={`${VALUE} group-hover/metric:opacity-100`}>{metric!.readout}</span>
          {metric!.onReset && (
            <button onClick={metric!.onReset} className="shrink-0 opacity-0 transition-opacity hover:text-foreground group-hover/metric:opacity-100" title={t('resetWindow')}>
              {t('all')}
            </button>
          )}
        </span>
      )}
    </div>
  )
}
