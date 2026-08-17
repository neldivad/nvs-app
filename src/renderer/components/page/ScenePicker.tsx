/**
 * The CALENDAR scene picker — chapters read as month bands, scenes as day cells shaded by dialogue
 * volume (the same "scene weight" the chart's counter bar plots). Picking a scene by where it sits in
 * the book beats scrolling a flat list; one component serves every scene field (custody records now,
 * `#scene` triggers and frontmatter fields later).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { deriveChapterWraps, sceneVolumes } from '@/components/features/custody/LifecycleGantt'

export function ScenePicker({
  value,
  onChange,
  allowStart,
  className
}: {
  value: string
  onChange: (sceneId: string) => void
  allowStart?: boolean // offer the 'start' pseudo-scene (true before page one)
  className?: string
}): JSX.Element {
  const { t } = useTranslation('scenePicker')
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const ordered = useSceneAxis(scenes) // follows the active chart-sequence — the calendar's geography must match the charts'
  const colOf = useMemo(() => new Map(ordered.map((sc, i) => [sc.sceneId, i])), [ordered])
  const counts = useMemo(() => sceneVolumes(graph), [graph])
  const maxCount = useMemo(() => Math.max(1, ...[...counts.values()]), [counts])
  // chapter bands + the leftovers (scenes in no folder) as a trailing unlabeled band
  const bands = useMemo(() => {
    const wraps = deriveChapterWraps(storyTree, colOf)
    const covered = new Set<number>()
    for (const w of wraps) for (let i = w.min; i <= w.max; i++) covered.add(i)
    const out = wraps.map((w) => ({ title: w.title, cells: ordered.slice(w.min, w.max + 1) }))
    const loose = ordered.filter((_, i) => !covered.has(i))
    if (loose.length) out.push({ title: '—', cells: loose })
    return out
  }, [storyTree, colOf, ordered])

  const current =
    value === 'start' ? t('startShort') : (ordered.find((sc) => sc.sceneId === value)?.title ?? (value ? `⚠ ${value}` : t('placeholder')))
  const cell = (sc: { sceneId: string; title: string }): JSX.Element => {
    const vol = (counts.get(sc.sceneId) ?? 0) / maxCount
    return (
      <button
        key={sc.sceneId}
        title={sc.title}
        onMouseDown={(e) => {
          e.preventDefault()
          onChange(sc.sceneId)
          setOpen(false)
        }}
        className={cn('size-4 rounded-sm border transition-colors hover:border-lore', value === sc.sceneId ? 'border-lore ring-1 ring-lore' : 'border-border')}
        style={{ backgroundColor: `color-mix(in srgb, var(--lore) ${Math.round(15 + vol * 60)}%, transparent)` }}
      />
    )
  }
  return (
    <div ref={wrap} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-7 w-44 items-center rounded-md border border-border bg-canvas px-2 text-left text-[11px]', value.startsWith('⚠') || (!value && 'text-faint'))}
      >
        <span className={cn('min-w-0 flex-1 truncate', current.startsWith('⚠') && 'text-flag', !value && 'text-faint')}>{current}</span>
        <span className="ml-1 shrink-0 text-[9px] text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-border bg-panel p-2 shadow-lg">
          {allowStart && (
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                onChange('start')
                setOpen(false)
              }}
              className={cn('mb-2 w-full rounded border px-2 py-1 text-left text-[10px]', value === 'start' ? 'border-lore text-lore' : 'border-border text-muted-foreground hover:bg-panel-soft')}
            >
              {t('startFull')}
            </button>
          )}
          {bands.map((b, bi) => (
            <div key={bi} className="mb-2">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-faint">{b.title}</div>
              <div className="flex flex-wrap gap-1">{b.cells.map(cell)}</div>
            </div>
          ))}
          {bands.length === 0 && <p className="p-2 text-[11px] text-faint">{t('empty')}</p>}
          <p className="mt-1 border-t border-border pt-1 text-[9px] text-faint">{t('legend')}</p>
        </div>
      )}
    </div>
  )
}
