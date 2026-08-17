/**
 * The coherence-run gate — the SIBLING of AnalysisRunDialog, same chrome and bones (a "what it'll check" line,
 * the read-only "Runs on" connection table, a Start in the footer). Coherence has no depth/frontier estimate, so
 * it's the leaner version: it diffs each character's world page against their observed arc. Opened from the dock's
 * "Check coherence" and the Coherence sidebar; the run itself streams to the Jobs/dock queue like analysis.
 */
import { useEffect, useState, type JSX } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AiState, CoherenceStatusRow } from '@shared/ipc'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

export function CoherenceRunDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { t } = useTranslation('coherenceRun')
  const checkCoherence = useWorkspace((s) => s.checkCoherence)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // coherence run is AI → unavailable when off
  const [rows, setRows] = useState<CoherenceStatusRow[] | null>(null)
  const [ai, setAi] = useState<AiState | null>(null)
  const [picked, setPicked] = useState<string | null>(null) // the analysis connection this run rides on (read-only here)
  const [critique, setCritique] = useState(false) // opt-in "Tough questions" pass (story-critique.md) — never default
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    setRows(null)
    void window.nvs.coherenceStatus().then((r) => live && setRows(r))
    void window.nvs.aiConnections().then((s) => {
      if (!live) return
      setAi(s)
      setPicked((prev) => prev ?? s.activeId)
    })
    return () => {
      live = false
    }
  }, [open])

  if (!open || !aiEnabled) return null

  const total = rows?.length ?? 0
  const stale = rows?.filter((r) => r.status !== 'fresh').length ?? 0
  const start = async (): Promise<void> => {
    if (total === 0 || starting) return
    setStarting(true)
    try {
      onClose()
      await checkCoherence(critique ? { critique: true } : undefined)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      size="panel"
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('button.cancel')}</Button>
          <Button size="sm" onClick={() => void start()} disabled={total === 0 || starting}>
            {starting ? <Loader2 className="size-3 animate-spin" /> : <ShieldAlert className="size-3" />}
            {t('button.check')}
          </Button>
        </DialogFooter>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[12px]">
        {/* What this run would check */}
        <div className="text-muted-foreground">
          {rows == null ? (
            <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> {t('summary.checking')}</span>
          ) : total === 0 ? (
            <span>{t('summary.empty')}</span>
          ) : (
            <span>
              <span className="font-medium text-foreground">{t('summary.characters', { count: total })}</span>
              <span className="text-faint"> · {t('summary.pageVsScenes')}{stale > 0 ? t('summary.moved', { n: stale }) : ''}</span>
            </span>
          )}
        </div>

        {/* What coherence is — the same quiet explanatory block the analysis gate uses for its timeline note. */}
        <div className="rounded-md border border-border bg-panel-soft/40 px-2.5 py-1.5 text-[11px] text-faint">
          {t('about')}
        </div>

        {/* Opt-in critique — the "Tough questions" dramaturge pass (story-critique.md). Explicitly chosen per run. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2">
          <input type="checkbox" checked={critique} onChange={(e) => setCritique(e.target.checked)} className="mt-0.5 accent-current" />
          <span>
            <span className="block text-[12px] font-medium text-foreground">{t('critique.label')}</span>
            <span className="block text-[11px] text-faint">{t('critique.hint')}</span>
          </span>
        </label>

        {/* Runs on — the read-only connection (same table + current-highlight as the analysis dialog; no
            per-character estimate, so no Time/Cost columns). Set the analysis connection in the console. */}
        <div>
          <div className="mb-1">
            <span title={t('connection.runsOnTooltip')} className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t('connection.runsOn')}</span>
          </div>
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-soft/50 text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-2.5 py-1 text-left font-medium">{t('connection.colConnection')}</th>
                </tr>
              </thead>
              <tbody>
                {(ai?.connections ?? []).map((conn) => (
                  <tr key={conn.id} className={cn('border-t border-border/50', picked === conn.id ? 'bg-thread/10' : 'opacity-70')}>
                    <td className="px-2.5 py-1.5">
                      <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', picked === conn.id ? 'bg-thread' : 'bg-border')} />
                      <span className="text-foreground">{conn.label || AI_PROVIDERS[conn.type].label}</span>
                      <span className="ml-1.5 text-[10px] text-faint">{conn.model}</span>
                      {picked === conn.id && <span className="ml-1.5 rounded bg-thread/20 px-1 py-px text-[9px] uppercase tracking-wide text-thread">{t('connection.current')}</span>}
                    </td>
                  </tr>
                ))}
                {(ai?.connections.length ?? 0) === 0 && (
                  <tr><td className="px-2.5 py-2 text-muted-foreground">{t('connection.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
