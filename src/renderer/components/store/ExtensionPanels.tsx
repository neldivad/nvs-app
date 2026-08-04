/**
 * ExtensionPanels — hosts an active extension's OWN UI (the honest UI rung). When a running extension declares a
 * `panel`, the app drops it into a **sandboxed iframe** loaded from `nvs-ext://<id>/<panel>` (its own origin + CSP,
 * `sandbox="allow-scripts"` → no parent access, no network) and BLINDLY forwards its `{state, event}` over
 * postMessage. The app owns only the chrome (border, title, Stop) — it never interprets the payload, so it needs
 * ZERO knowledge of what the extension does. The sprint-timer's countdown is drawn by the timer's own panel.html.
 *
 * This is the standard both VS Code and Chrome use (scoped scheme → sandboxed iframe → CSP → postMessage). The
 * app-rendered version would have been a cheat: the core implementing each extension's face.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { X, Square, Loader2 } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import type { ExtensionInfo, ExtensionStatus } from '@shared/ipc'

const isLive = (s: ExtensionStatus['state']): boolean => s === 'running' || s === 'starting'

/** One extension's floating panel: the app chrome around a sandboxed iframe it forwards events into. */
function Panel({ id, name, entry, status }: { id: string; name: string; entry: string; status: ExtensionStatus }): JSX.Element {
  const dismiss = useWorkspace((s) => s.dismissExtensionRun)
  const setRun = useWorkspace((s) => s.setExtensionRun)
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const live = isLive(status.state)

  // Forward {state, event} into the iframe whenever it changes — but only once the panel has said it's listening
  // (its `panel-ready` handshake), so early events aren't lost. The app does NOT inspect the payload.
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return // only our iframe
      if (e.data?.type === 'panel-ready') {
        ready.current = true
        frame.current?.contentWindow?.postMessage({ state: status.state, event: status.lastEvent }, '*')
      } else if (e.data?.type === 'stop') {
        void window.nvs.stopExtension(id).then(() => setRun(id, name, { ...status, state: 'stopped' })).catch(() => {})
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [id, name, status, setRun])

  useEffect(() => {
    if (ready.current) frame.current?.contentWindow?.postMessage({ state: status.state, event: status.lastEvent }, '*')
  }, [status.state, status.lastEvent])

  return (
    <div className={cn('pointer-events-auto w-56 overflow-hidden rounded-lg border bg-panel/95 shadow-lg backdrop-blur', status.state === 'crashed' || status.state === 'unresponsive' ? 'border-flag/40' : status.state === 'done' ? 'border-ok/40' : 'border-border')}>
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1 text-[10px] uppercase tracking-wide text-faint">
        {live && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-thread" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {live ? (
          <button onClick={() => void window.nvs.stopExtension(id).then(() => setRun(id, name, { ...status, state: 'stopped' })).catch(() => {})} title="Stop" className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-panel-soft hover:text-flag">
            {status.state === 'starting' ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-2.5 fill-current" />}
          </button>
        ) : (
          <button onClick={() => dismiss(id)} title="Dismiss" className="flex size-5 items-center justify-center rounded text-faint hover:bg-panel-soft hover:text-foreground"><X className="size-3" /></button>
        )}
      </div>
      {/* The extension's own UI. sandbox="allow-scripts" (no allow-same-origin) → opaque origin, no storage/parent/network. */}
      <iframe
        ref={frame}
        title={`${name} panel`}
        src={`nvs-ext://${id}/${entry}`}
        sandbox="allow-scripts"
        className="block h-[84px] w-full border-0 bg-transparent"
      />
    </div>
  )
}

export function ExtensionPanels(): JSX.Element | null {
  const runs = useWorkspace((s) => s.extensionRuns)
  const setRun = useWorkspace((s) => s.setExtensionRun)
  const [panels, setPanels] = useState<Record<string, string>>({}) // id → panel entry file (from listExtensions)

  // Learn which extensions declare a panel (once per run set) — only those get a hosted iframe.
  useEffect(() => {
    void window.nvs.listExtensions?.().then((xs: ExtensionInfo[]) => {
      const m: Record<string, string> = {}
      for (const x of xs) if (x.panel) m[x.id] = x.panel
      setPanels(m)
    }).catch(() => {})
  }, [runs])

  // Poll live status so a hosted panel keeps getting events with no launcher open. Interval clears when all idle.
  const anyLive = useMemo(() => Object.values(runs).some((r) => isLive(r.status.state)), [runs])
  useEffect(() => {
    if (!anyLive) return
    const t = setInterval(() => {
      for (const [id, r] of Object.entries(useWorkspace.getState().extensionRuns)) {
        if (isLive(r.status.state)) void window.nvs.extensionStatus?.(id).then((st) => st && setRun(id, r.name, st)).catch(() => {})
      }
    }, 1000)
    return () => clearInterval(t)
  }, [anyLive, setRun])

  const shown = Object.entries(runs).filter(([id, r]) => !r.dismissed && panels[id])
  if (shown.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-3 right-11 z-40 flex flex-col items-end gap-2">
      {shown.map(([id, r]) => (
        <Panel key={id} id={id} name={r.name} entry={panels[id]} status={r.status} />
      ))}
    </div>
  )
}
