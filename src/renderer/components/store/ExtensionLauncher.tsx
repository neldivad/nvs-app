/**
 * The extension RUN surface (internal/extensions.md "Run surface", decided 2026-07-08). Opened from the RightRail
 * launcher (next to the Store, divider-separated). The Store only ACQUIRES + configures; this INVOKES the installed
 * ACTIVE extensions — a tools list that starts / watches / stops each, over the supervised
 * startExtension/stopExtension/extensionStatus IPC. Ambient (`kind:'ui'`) extensions have nothing to run (they
 * contribute a persistent effect while enabled), so they never appear here.
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Blocks, Play, Square, Loader2, TriangleAlert, ExternalLink } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExtensionInfo, ExtensionStatus } from '@shared/ipc'

// State → a small visual (label + dot color). Unknown/idle = never started this session.
const STATE_VIS: Record<ExtensionStatus['state'], { label: string; dot: string; text: string }> = {
  starting: { label: 'Starting…', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  running: { label: 'Running', dot: 'bg-thread animate-pulse', text: 'text-thread' },
  done: { label: 'Done', dot: 'bg-ok', text: 'text-ok' },
  stopped: { label: 'Stopped', dot: 'bg-faint', text: 'text-faint' },
  crashed: { label: 'Crashed', dot: 'bg-flag', text: 'text-flag' },
  unresponsive: { label: 'Unresponsive', dot: 'bg-flag', text: 'text-flag' }
}

export function ExtensionLauncher(): JSX.Element | null {
  const open = useWorkspace((s) => s.extensionRunOpen)
  const setOpen = useWorkspace((s) => s.setExtensionRunOpen)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)
  const [exts, setExts] = useState<ExtensionInfo[]>([])
  const runs = useWorkspace((s) => s.extensionRuns) // shared with the hosted panels (ExtensionPanels owns the poll)
  const setRun = useWorkspace((s) => s.setExtensionRun)
  const [busy, setBusy] = useState<string | null>(null) // id mid start/stop

  // Only installed ACTIVE extensions are runnable — ambient `kind:'ui'` ones contribute while enabled, nothing to run.
  const runnable = useMemo(() => exts.filter((e) => e.installed && e.kind !== 'ui'), [exts])

  const refresh = useCallback((): void => {
    void window.nvs.listExtensions?.().then(setExts).catch(() => {})
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const run = async (e: ExtensionInfo): Promise<void> => {
    setBusy(e.id)
    try {
      const st = await window.nvs.startExtension(e.id)
      setRun(e.id, e.name, st)
    } catch (err) {
      setRun(e.id, e.name, { id: e.id, state: 'crashed', startedAt: Date.now(), error: err instanceof Error ? err.message : 'failed to start' })
    } finally {
      setBusy(null)
    }
  }
  const stop = async (e: ExtensionInfo): Promise<void> => {
    setBusy(e.id)
    try {
      await window.nvs.stopExtension(e.id)
      setRun(e.id, e.name, { ...(runs[e.id]?.status ?? { id: e.id, startedAt: Date.now() }), state: 'stopped' })
    } finally {
      setBusy(null)
    }
  }

  const goStore = (): void => {
    setOpen(false)
    setDiscoverOpen('extensions')
  }

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Extension tools"
      size="panel"
      footer={
        <DialogFooter aside={<span className="text-[12px] text-faint">Run an installed extension; it works in its own process.</span>}>
          <Button variant="ghost" size="sm" onClick={goStore}><ExternalLink className="size-3.5" /> Get more in Store</Button>
        </DialogFooter>
      }
    >
      {runnable.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <Blocks className="size-8 text-faint" />
          <p className="text-sm text-muted-foreground">No runnable extensions installed.</p>
          <p className="max-w-xs text-xs text-faint">Active extensions — tools that do a thing on demand — show up here once installed. Ambient ones (like a font) just apply while enabled.</p>
          <Button variant="outline" size="sm" onClick={goStore}><ExternalLink className="size-3.5" /> Browse the Store</Button>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {runnable.map((e) => {
            const st = runs[e.id]?.status
            const live = st?.state === 'running' || st?.state === 'starting'
            const vis = st ? STATE_VIS[st.state] : null
            const blocked = e.check.ok === false // failed the handshake against this app
            const disabled = e.enabled === false
            return (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                <Blocks className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">{e.name}</span>
                    <span className="shrink-0 rounded bg-panel-soft px-1 text-[9px] uppercase tracking-wide text-faint">{e.kind}</span>
                    {vis && (
                      <span className={cn('inline-flex shrink-0 items-center gap-1 text-[10px]', vis.text)}>
                        <span className={cn('size-1.5 rounded-full', vis.dot)} /> {vis.label}
                      </span>
                    )}
                  </div>
                  {(e.description || blocked || disabled) && (
                    <p className={cn('truncate text-xs', blocked ? 'text-flag' : 'text-faint')}>
                      {blocked ? (
                        <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3" /> {e.check.ok === false ? e.check.reasons[0] ?? "won't run in this app" : ''}</span>
                      ) : disabled ? 'Disabled — enable it in the Store to run' : e.description}
                    </p>
                  )}
                </div>
                {live ? (
                  <Button variant="outline" size="sm" disabled={busy === e.id} onClick={() => void stop(e)}>
                    {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5 fill-current" />} Stop
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy === e.id || blocked || disabled} onClick={() => void run(e)}>
                    {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />} Run
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
