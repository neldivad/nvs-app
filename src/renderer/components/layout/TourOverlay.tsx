/**
 * The replayable app tour (Help → Tour the app) — the author's curriculum, sequenced by CATEGORY and
 * KIND-SCOPED to the project's domain: FICTION walks Writing → Sequencing → Analysis → Custody → More;
 * NON-FICTION skips the author-only Sequencing + Custody and gets a Learnings step instead (steps carry an
 * optional `kinds`; unmarked = shared). Each step spotlights a `data-region`
 * marker via the SAME registry as the debug overlay (config/regions), so the tour can't drift from real
 * components. A region that isn't mounted (e.g. the tab strip with no open pages) shows the card
 * CENTERED instead of skipping — the tour never auto-advances (the v1 skip read as a bug).
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace, type WorkspaceId } from '@/stores/workspace'
import { regionSelector, type RegionId } from '@/config/regions'
import { useModalEscape } from '@/lib/editor/escapeStack'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TourStep {
  /** Section key — a stable id used for grouping/comparison; the display label comes from `section.<key>`. */
  section: string
  region: RegionId
  /** Catalog key for this step's title/body (`step.<key>.title` / `.body`). */
  key: string
  workspace?: WorkspaceId
  /** Which KIND(s) this step is for. Omitted = both. Fiction gets Sequencing + Custody; non-fiction skips those
   *  (a transcript has no author-authored timeline or custody) and gets Learnings instead. See the create-wizard
   *  KIND choice — the tour is the same domain concept as the analysis, told as a walkthrough. */
  kinds?: ('fiction' | 'nonfiction')[]
}

const TOUR_STEPS: TourStep[] = [
  // ── Writing ─────────────────────────────────────────────────────────────────
  { section: 'writing', region: 'sceneNavigator', workspace: 'editor', key: 'firstPages' },
  { section: 'writing', region: 'sceneEditor', workspace: 'editor', key: 'turnBased' },
  { section: 'writing', region: 'sceneEditor', workspace: 'editor', key: 'views' },
  { section: 'writing', region: 'editorFab', workspace: 'editor', key: 'properties' },
  { section: 'writing', region: 'worldNavigator', workspace: 'world', key: 'worldPages' },
  { section: 'writing', region: 'worldNavigator', workspace: 'world', key: 'categories' },
  { section: 'writing', region: 'corkboardPanel', workspace: 'corkboard', key: 'corkboard' },
  { section: 'writing', region: 'sceneNavigator', workspace: 'editor', key: 'declareCanon' },

  // ── Sequencing pages ────────────────────────────────────────────────────────
  // a transcript has no author-authored reading-order timeline → fiction-only
  { section: 'sequencing', kinds: ['fiction'], region: 'timelinePanel', workspace: 'timeline', key: 'timeline' },
  { section: 'sequencing', kinds: ['fiction'], region: 'timelinePanel', workspace: 'timeline', key: 'connecting' },
  { section: 'sequencing', kinds: ['fiction'], region: 'timelinePanel', workspace: 'timeline', key: 'chartConfig' },
  { section: 'sequencing', kinds: ['fiction'], region: 'cellView', workspace: 'timeline', key: 'cellFlow' },

  // ── Project details ──────────────────────────────────────────────────────────
  { section: 'projectDetails', region: 'titleBar', key: 'setup' },

  // ── Analysis (basic → advanced) ──────────────────────────────────────────────
  { section: 'analysis', region: 'castPanel', workspace: 'cast', key: 'presence' },
  { section: 'analysis', kinds: ['fiction'], region: 'threadsPanel', workspace: 'threads', key: 'tracing' },
  { section: 'analysis', kinds: ['fiction'], region: 'coherencePanel', workspace: 'coherence', key: 'secondReader' },
  { section: 'analysis', kinds: ['nonfiction'], region: 'castPanel', workspace: 'cast', key: 'whoTalking' },

  // ── Custody ─────────────────────────────────────────────────────────────────
  { section: 'custody', kinds: ['fiction'], region: 'custodyPanel', workspace: 'custody', key: 'possession' },
  { section: 'custody', kinds: ['fiction'], region: 'custodySidebar', workspace: 'custody', key: 'revisionTool' },

  // ── Learnings (non-fiction) ──────────────────────────────────────────────────
  { section: 'learnings', kinds: ['nonfiction'], region: 'coherencePanel', workspace: 'coherence', key: 'reveals' },

  // ── More (get help · get ai · get community) ─────────────────────────────────
  { section: 'more', region: 'titleBar', key: 'getHelp' },
  { section: 'more', region: 'statusBar', key: 'makeYours' },
  { section: 'more', region: 'consoleDock', key: 'getAi' },
  { section: 'more', region: 'storeView', key: 'getCommunity' }
]

export function TourOverlay(): JSX.Element | null {
  const { t } = useTranslation('tourOverlay')
  const step = useWorkspace((s) => s.tourStep)
  const setStep = useWorkspace((s) => s.setTourStep)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const project = useWorkspace((s) => s.project)
  const domain = useWorkspace((s) => s.projectInfo?.domain) ?? 'fiction'
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(0) // measured card height → clamp its top so a tall step near the BOTTOM never pushes Back/Next off-screen
  useModalEscape(step != null, () => setStep(null))
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0
    setCardH((prev) => (prev === h ? prev : h))
  }, [step, rect])

  // KIND-scoped curriculum: fiction walks Sequencing + Custody; non-fiction skips those and gets Learnings.
  // Steps with no `kinds` are shared. `step` indexes into THIS filtered list.
  const steps = TOUR_STEPS.filter((s) => !s.kinds || s.kinds.includes(domain as 'fiction' | 'nonfiction'))
  const spec = step != null ? steps[step] : null

  // Switch workspace when the step needs one, then measure (short retry while the target mounts).
  // A region that never appears → rect stays null → the card renders CENTERED (never auto-advance).
  useEffect(() => {
    if (!spec) return
    setRect(null)
    if (spec.workspace && project) setWorkspace(spec.workspace)
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = (): void => {
      const el = document.querySelector(regionSelector(spec.region))
      if (el) setRect(el.getBoundingClientRect())
      else if (++tries < 8) timer = setTimeout(measure, 120)
    }
    measure()
    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, spec?.region])

  if (step == null || !spec) return null

  const inSection = steps.filter((s) => s.section === spec.section)
  const sectionIdx = inSection.indexOf(spec) + 1
  const cardBelow = rect ? rect.bottom + 200 < window.innerHeight : false
  const rawTop = rect ? (cardBelow ? rect.bottom + 12 : Math.max(12, rect.top - 210)) : window.innerHeight / 2 - 110
  // Clamp so the WHOLE card (incl. Back/Next) stays on screen — a tall step over a bottom-anchored region (e.g. Get AI
  // on the console dock) otherwise overflowed the viewport. `cardH || 220` = a first-paint estimate before measuring.
  const cardTop = Math.max(12, Math.min(rawTop, window.innerHeight - (cardH || 220) - 12))
  const cardLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 384) : window.innerWidth / 2 - 180

  return (
    <div className="fixed inset-0 z-70" onClick={() => setStep(null)}>
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-lore transition-all duration-200"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        className="absolute max-h-[calc(100dvh-1.5rem)] w-90 overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-2xl"
        style={{ top: cardTop, left: cardLeft }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* section pills — jump straight to a part (the curriculum is browsable, not a corridor) */}
        <div className="flex flex-wrap items-center gap-1 pb-2">
          {[...new Set(steps.map((s) => s.section))].map((sec) => (
            <button
              key={sec}
              onClick={() => setStep(steps.findIndex((s) => s.section === sec))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                sec === spec.section ? 'border-lore bg-lore/10 text-foreground' : 'border-border text-muted-foreground hover:bg-panel-soft'
              )}
            >
              {t(`section.${sec}`)}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-lore">
          {t('counter', { section: t(`section.${spec.section}`), index: sectionIdx, total: inSection.length })}
        </p>
        <p className="pt-0.5 text-[13px] font-medium text-foreground">{t(`step.${spec.key}.title`)}</p>
        <p className="pt-1 text-[12px] leading-relaxed text-muted-foreground">{t(`step.${spec.key}.body`)}</p>
        {!rect && <p className="pt-1 text-[10px] text-faint">{t('offscreen')}</p>}
        <div className="flex items-center gap-2 pt-3">
          <div className="flex flex-1 items-center gap-1">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                title={t('stepHint', { section: t(`section.${s.section}`), title: t(`step.${s.key}.title`) })}
                className={cn('size-1.5 rounded-full transition-transform hover:scale-150', i === step ? 'bg-lore' : 'bg-border')}
              />
            ))}
          </div>
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
              {t('back')}
            </Button>
          )}
          <Button size="sm" onClick={() => setStep(step + 1 < steps.length ? step + 1 : null)}>
            {step + 1 < steps.length ? t('next') : t('done')}
          </Button>
        </div>
      </div>
    </div>
  )
}
