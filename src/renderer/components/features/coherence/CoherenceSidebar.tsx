/**
 * Coherence sidebar — the triage roster (mirrors ThreadSidebar). Concerns that share the coherence_findings table,
 * each in its own section so they don't interleave: CHARACTER coherence (the page-vs-arc diff — drift/gap/
 * contradiction) up top by severity; PLOT HOLES (continuity — the story vs itself: continuity-error/logic-gap/
 * rule-break); and THREAD VERDICTS (quest: cliffhanger/hole/sequel_hook). Click a row to open its CoherenceDetailFloat.
 */
import { useMemo, useState, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { Link2, ShieldAlert } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { severityVisual, kindGloss, displayKind } from '@/config/coherenceVisual'
import { cn } from '@/lib/utils'
import { SidebarRow, SidebarLabel, SidebarHeader, SidebarScroll } from '@/components/layout/SidebarKit'
import { CoherenceRunDialog } from '@/components/features/coherence/CoherenceRunDialog'
import { CONTINUITY_KINDS, CRITIQUE_KINDS } from '@shared/config/extraction'
import type { CoherenceFinding } from '@shared/ipc'
import { SidebarEmpty } from '@/components/ui/EmptyRailState'
import { useTranslation } from 'react-i18next'

const ORDER = ['high', 'medium', 'low']
const CONTINUITY = new Set<string>(CONTINUITY_KINDS) // plot-holes: the story vs itself (their own section)
const CRITIQUE = new Set<string>(CRITIQUE_KINDS) // tough questions: construction critique (their own section)

export function CoherenceSidebar(): JSX.Element {
  const { t } = useTranslation('coherence')
  const findings = useWorkspace((s) => s.coherence)
  const selected = useWorkspace((s) => s.selectedFindingId)
  const select = useWorkspace((s) => s.setSelectedFinding)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the coherence-run trigger (it's an AI pass)
  const [runOpen, setRunOpen] = useState(false) // the coherence-run gate (mirrors the analysis dialog)

  // Split the concerns that share the coherence_findings table: CHARACTER coherence (page-vs-arc, no thread),
  // CONTINUITY (plot-holes — the story vs itself, work-level), and THREAD VERDICTS (quest: findings). Confirmations
  // are filtered upstream in listCoherenceFindings, so all of this is actionable.
  const groups = useMemo(() => {
    const all = findings ?? []
    const bySevSort = (a: CoherenceFinding, b: CoherenceFinding): number => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
    const isConfirm = (f: CoherenceFinding): boolean => f.kind === 'confirmation'
    const isCont = (f: CoherenceFinding): boolean => CONTINUITY.has(f.kind)
    const isCrit = (f: CoherenceFinding): boolean => CRITIQUE.has(f.kind)
    const intentional = all.filter((f) => f.intentional && !isConfirm(f)) // author-ruled: quiet, reachable to unmark
    const active = all.filter((f) => !f.intentional && !isConfirm(f))
    const character = active.filter((f) => !f.threadId && !isCont(f) && !isCrit(f))
    const continuity = [...active.filter(isCont)].sort(bySevSort) // plot-holes (their own section)
    const critique = [...active.filter(isCrit)].sort(bySevSort) // tough questions (their own section)
    const onTrack = all.filter((f) => !f.threadId && isConfirm(f)) // secret-covered deception WORKING (layered truth)
    const threads = [...active.filter((f) => !!f.threadId && !isCont(f) && !isCrit(f))].sort(bySevSort)
    const bySev = (sev: string): CoherenceFinding[] => character.filter((f) => f.severity === sev)
    return { character, continuity, critique, intentional, onTrack, threads, bySev }
  }, [findings])

  const row = (f: CoherenceFinding): JSX.Element => {
    const v = severityVisual(f.severity)
    const on = selected === f.id
    return (
      <SidebarRow
        key={f.id}
        selected={on}
        onClick={() => select(on ? null : f.id)}
        title={f.trait}
        // severity badge — bordered circle matching the thread/arc rail badges (one visual system)
        leading={
          <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border border-current/40 bg-panel', v.text)} title={f.severity}>
            <span className={cn('size-1.5 rounded-full', v.dot)} />
          </span>
        }
        label={f.trait}
        trailing={
          <>
            {f.threadId && <Link2 className="size-3 shrink-0 text-faint" />}
            <span title={kindGloss(displayKind(f.kind, f.declared)).question} className="shrink-0 text-[9px] uppercase tracking-wide text-faint">
              {kindGloss(displayKind(f.kind, f.declared)).label}
            </span>
          </>
        }
      />
    )
  }

  return (
    <div {...regionAttrs('coherenceSidebar')} className="flex h-full flex-col bg-panel">
      {/* Mirrors Custody's sidebar trigger: a confirmation pass, then the SAME background coherence run the dock kicks off. */}
      <SidebarHeader
        title={t('sidebar.title')}
        count={findings ? groups.character.length : undefined}
        action={
          aiEnabled ? (
            <button
              title={t('sidebar.runTitle')}
              onClick={() => setRunOpen(true)}
              className="rounded p-0.5 text-faint transition-colors hover:text-flag"
            >
              <ShieldAlert className="size-3.5" />
            </button>
          ) : undefined
        }
      />
      <SidebarScroll className="pb-3">
        {findings == null ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('sidebar.reading')}</p>
        ) : findings.length === 0 ? (
          <SidebarEmpty>{t('sidebar.empty')}</SidebarEmpty>
        ) : (
          <>
            {/* Page vs story — the page-vs-arc diff (family header, matching "Plot holes" below), by severity */}
            {groups.character.length > 0 && <SidebarLabel>{t('sidebar.pageVsStory', { count: groups.character.length })}</SidebarLabel>}
            {ORDER.map((sev) => {
              const rows = groups.bySev(sev)
              if (rows.length === 0) return null
              return (
                <div key={sev}>
                  <SidebarLabel>{t(`sidebar.severity.${sev}`)}</SidebarLabel>
                  {rows.map(row)}
                </div>
              )
            })}
            {groups.character.length === 0 && (
              <SidebarEmpty>{t('sidebar.noCharacterIssues')}</SidebarEmpty>
            )}
            {/* Continuity — plot-holes the story opens against ITSELF (continuity-error / logic-gap / rule-break) */}
            {groups.continuity.length > 0 && (
              <div className="mt-1 border-t border-border/60">
                <SidebarLabel>{t('sidebar.plotHoles', { count: groups.continuity.length })}</SidebarLabel>
                {groups.continuity.map(row)}
              </div>
            )}
            {/* Critique — the opt-in "Tough questions" (story-critique.md): construction, not consistency */}
            {groups.critique.length > 0 && (
              <div className="mt-1 border-t border-border/60">
                <SidebarLabel>{t('sidebar.toughQuestions', { count: groups.critique.length })}</SidebarLabel>
                {groups.critique.map(row)}
              </div>
            )}
            {/* Deception on track — secret-covered divergence the analysis CONFIRMS is working (✓, calm) */}
            {groups.onTrack.length > 0 && (
              <div className="mt-1 border-t border-border/60">
                <SidebarLabel>{t('sidebar.onTrack', { count: groups.onTrack.length })}</SidebarLabel>
                {groups.onTrack.map(row)}
              </div>
            )}
            {/* Author-ruled intentional — quiet ✓ rows (dimmed, still clickable to review/unmark) */}
            {groups.intentional.length > 0 && (
              <div className="mt-1 border-t border-border/60 opacity-60">
                <SidebarLabel>{t('sidebar.intentional', { count: groups.intentional.length })}</SidebarLabel>
                {groups.intentional.map(row)}
              </div>
            )}
            {/* Thread verdicts — judgments about threads (cliffhanger / hole / sequel hook), kept separate */}
            {groups.threads.length > 0 && (
              <div className="mt-1 border-t border-border/60">
                <SidebarLabel>{t('sidebar.threadVerdicts', { count: groups.threads.length })}</SidebarLabel>
                {groups.threads.map(row)}
              </div>
            )}
          </>
        )}
      </SidebarScroll>
      <CoherenceRunDialog open={runOpen} onClose={() => setRunOpen(false)} />
    </div>
  )
}
