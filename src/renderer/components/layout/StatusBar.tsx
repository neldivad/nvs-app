import { useState, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { Bot, Check, ChevronDown, ChevronUp, Eye, FolderOpen, Plug, Route, X, Zap } from 'lucide-react'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { useWorkspace } from '@/stores/workspace'
import { activeVariant } from '@/lib/timeline/treeVariant'
import { NotificationMailbox } from './NotificationMailbox'
import { cn } from '@/lib/utils'

/** The thin bottom status line — LIVE status only: what's open, the active AI provider, the narrative-debt
 *  indicator, the notification mailbox. (The static app version moved to the header — it's metadata, not status.) */
export function StatusBar(): JSX.Element {
  const project = useWorkspace((s) => s.project)
  const title = useWorkspace((s) => s.projectInfo?.title)
  const threads = useWorkspace((s) => s.threads)
  const coherence = useWorkspace((s) => s.coherence)
  const dockOpen = useWorkspace((s) => s.dockOpen)
  const setDockOpen = useWorkspace((s) => s.setDockOpen)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the console dock toggle (dock is AI-scoped)
  const aiState = useWorkspace((s) => s.aiState)
  const viewing = useWorkspace((s) => s.viewingVersion && s.viewingVersion !== s.currentVersion)
  const viewVersion = useWorkspace((s) => s.viewVersion)
  const trees = useWorkspace((s) => s.trees)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const setTimelineTab = useWorkspace((s) => s.setTimelineTab)
  const setActiveVariant = useWorkspace((s) => s.setActiveVariant)
  const variant = activeVariant(trees)
  const floatDockOpen = useWorkspace((s) => s.floatDockOpen)
  const setFloatDockOpen = useWorkspace((s) => s.setFloatDockOpen)
  const [helpOpen, setHelpOpen] = useState(false)
  const [variantMenu, setVariantMenu] = useState(false)

  const open = threads?.filter((t) => t.status === 'open').length ?? 0
  const flags = coherence?.filter((f) => f.kind !== 'confirmation').length ?? 0

  // The active connection — its provider API decides whether parallel analysis is available (keyless = serial).
  const active = aiState?.connections.find((c) => c.id === aiState.activeId) ?? null
  const meta = active ? AI_PROVIDERS[active.type] : null
  const parallel = !!meta && meta.api !== 'plan'
  const ProviderIcon = parallel ? Zap : Bot

  return (
    <footer
      {...regionAttrs('statusBar')}
      className="relative flex h-6 items-center gap-3 border-t border-border bg-panel px-3 font-mono text-[10px] text-muted-foreground"
    >
      {/* Left cluster — bounded widths + truncation so the variant/AI/console buttons sit in the SAME x across
          projects (a long podcast title can't shove them around; it just ellipsises). */}
      {project ? (
        <span className="flex shrink-0 items-center gap-1" title={project.root}>
          <span className="max-w-48 truncate text-foreground/90">{title || project.name}</span>
          {/* When the display title differs from the disk folder (backups/copies share a title), surface the
              folder so you always know WHICH project on disk is live — the confusion this whole cue fixes. */}
          {title && title !== project.name && (
            <span className="flex min-w-0 shrink items-center gap-0.5 text-faint">
              <FolderOpen className="size-2.5 shrink-0" />
              <span className="max-w-32 truncate">{project.name}</span>
            </span>
          )}
          <span className="shrink-0 text-faint">· {project.counts.scenes} scenes</span>
        </span>
      ) : (
        <span>no project</span>
      )}
      {/* Active tree variant — the branch/merge graph driving the analysis + charts. Click → quick-switch dropdown;
          double-click → open the timeline canvas (where you author variants). */}
      {project && variant && (
        <div className="relative">
          <button
            onClick={() => setVariantMenu((o) => !o)}
            onDoubleClick={() => { setVariantMenu(false); setWorkspace('timeline'); void setTimelineTab('canvas') }}
            title={`Active tree variant "${variant.name}" — click to switch, double-click to open the timeline`}
            className="flex items-center gap-1 rounded px-1.5 transition-colors hover:bg-panel-soft"
          >
            <Route className="size-3 shrink-0 text-thread" />
            <span className="max-w-40 truncate text-foreground/90">{variant.name}</span>
            <ChevronUp className="size-2.5 shrink-0 text-faint" />
          </button>
          {variantMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setVariantMenu(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-48 overflow-auto rounded-md border border-border bg-panel py-1 font-sans shadow-lg">
                {trees.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => { void setActiveVariant(v.id); setVariantMenu(false) }}
                    className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] hover:bg-panel-soft', v.id === variant.id && 'bg-panel-soft')}
                  >
                    <Route className={cn('size-3 shrink-0', v.id === variant.id ? 'text-thread' : 'text-faint')} />
                    <span className="flex-1 truncate">{v.name}</span>
                    {v.id === variant.id && <Check className="size-3 shrink-0 text-ok" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex-1" />

      {/* Centered dock handle — a gradient "pull" that summons/dismisses the floating dock. Glows thread-accent
          when the dock is open. Absolutely centered so it sits in the same spot regardless of the side clusters. */}
      <button
        onClick={() => setFloatDockOpen(!floatDockOpen)}
        title={floatDockOpen ? 'Hide the dock' : 'Show the dock — Composition · Settings · Theme'}
        className="group absolute left-1/2 top-0 flex h-full -translate-x-1/2 items-center px-4"
        aria-label="Toggle the floating dock"
        aria-pressed={floatDockOpen}
      >
        <span
          className={cn(
            'h-1 rounded-full bg-linear-to-r from-transparent to-transparent transition-all duration-200',
            floatDockOpen ? 'w-20 via-thread' : 'w-14 via-foreground/25 group-hover:w-16 group-hover:via-foreground/50'
          )}
        />
      </button>

      {/* Theme + Settings now live in the floating dock (summoned by the centered handle above) — not duplicated here. */}
      {viewing && (
        <button
          onClick={() => void viewVersion(null)}
          title="You're viewing a past analysis version (read-only). Click to return to current."
          className="flex items-center gap-1 rounded bg-lore/15 px-1.5 text-lore hover:bg-lore/25"
        >
          <Eye className="size-3" /> viewing past version · return
        </button>
      )}
      {/* Active AI provider — the model-connection indicator; hidden when the AI layer is off (nothing to connect). */}
      {aiEnabled && (
        <button
          onClick={() => setHelpOpen(true)}
          title={active ? `${meta?.label}${parallel ? ' — parallel analysis available' : ' — keyless, serial'}. Click for details.` : 'No AI connected — click to compare options'}
          className="flex min-w-0 items-center gap-1 rounded px-1.5 transition-colors hover:bg-panel-soft"
        >
          {active ? (
            <>
              <ProviderIcon className={cn('size-3 shrink-0', parallel ? 'text-thread' : 'text-muted-foreground')} />
              <span className="shrink-0 text-foreground/90">{meta?.label}</span>
              {/* model can be very long (e.g. qwen-512b-fast-thinking-multimodal) — cap + ellipsise, full name in the tooltip */}
              {active.model && <span className="max-w-40 truncate text-faint" title={active.model}>· {active.model}</span>}
            </>
          ) : (
            <>
              <Plug className="size-3 text-faint" />
              <span className="text-faint">No AI</span>
            </>
          )}
        </button>
      )}
      {project && aiEnabled && (
        <button
          onClick={() => setDockOpen(!dockOpen)}
          title={dockOpen ? 'Hide the tracker console' : 'Show the tracker console — open threads & coherence flags'}
          className={cn(
            'flex items-center gap-1.5 rounded px-1.5 transition-colors hover:bg-panel-soft',
            dockOpen && 'bg-panel-soft text-foreground'
          )}
        >
          <span className={cn('size-1.5 rounded-full', open > 0 ? 'bg-thread' : 'bg-faint/50')} />
          {open} open
          <span className={cn(flags > 0 && 'text-flag')}>· {flags} flag{flags === 1 ? '' : 's'}</span>
          {dockOpen ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </button>
      )}
      {/* Kept regardless of AI — it also carries non-AI notices (exports, import/rename errors, "structure
          updated"). Only the analysis FRESHNESS nudge inside it is AI-gated (see NotificationMailbox). */}
      <NotificationMailbox />
      {helpOpen && <ProviderHelp onClose={() => setHelpOpen(false)} />}
    </footer>
  )
}

/** The "which AI should I use?" card — decision-first, plain language, so gating parallelism reads as a choice.
 *  TODO(handbook): wire "Detailed guide" to the provider page once the handbook exists (see internal/backlog.md). */
function ProviderHelp({ onClose }: { onClose: () => void }): JSX.Element {
  const setDockOpen = useWorkspace((s) => s.setDockOpen)
  const setDockTab = useWorkspace((s) => s.setDockTab)
  const manage = (): void => {
    setDockOpen(true)
    setDockTab('agent') // the Agent tab hosts the Connections manager
    onClose()
  }
  const Option = ({ icon: Icon, title, tag, best, body, highlight }: { icon: typeof Bot; title: string; tag: string; best: string; body: string; highlight?: boolean }): JSX.Element => (
    <div className={cn('flex-1 rounded-md border p-3', highlight ? 'border-thread/40 bg-thread/5' : 'border-border')}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className={cn('size-4', highlight ? 'text-thread' : 'text-muted-foreground')} />
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        <span className="rounded bg-panel-soft px-1 text-[9px] uppercase tracking-wide text-faint">{tag}</span>
      </div>
      <p className="mb-1 text-[11px] font-medium text-foreground/80">Best for {best}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg border border-border bg-panel p-4 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Which AI should I use?</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close"><X className="size-4" /></button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">Both run the <b className="text-foreground/80">same analysis</b> — pick by what matters today. You can switch anytime; only speed and billing change.</p>
        <div className="flex gap-2">
          {/* Order matches the table below (API | Claude Code) so the dialog doesn't flip sides mid-read. */}
          <Option
            icon={Zap}
            title="API key"
            tag="fast"
            best="getting it done fast"
            body="Reads many scenes in parallel, so a full re-analysis finishes in minutes. Billed per token; rate and credit limits apply."
            highlight
          />
          <Option
            icon={Bot}
            title="Claude Code"
            tag="keyless"
            best="writing day-to-day"
            body="Chat, agent tasks, and steady analysis on your existing Claude subscription — no per-token bill. Reads one scene at a time, so big batches take a while."
          />
        </div>

        {/* The feature reference — kept for those who want the specifics, under the at-a-glance cards. */}
        <table className="mt-3 w-full text-left text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-faint">
              <th className="w-16 font-medium"></th>
              <th className="font-medium text-thread">API key</th>
              <th className="font-medium">Claude Code</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {[
              ['Speed', 'Parallel — fast batch', 'One scene at a time'],
              ['Cost', 'Per token', 'Your subscription'],
              ['Model', 'You choose (e.g. Haiku for speed)', 'Session default'],
              ['Limits', 'Rate + credit balance', 'Session / usage limits']
            ].map(([k, a, c]) => (
              <tr key={k} className="border-t border-border/50">
                <td className="py-1 pr-2 text-faint">{k}</td>
                <td className="py-1 pr-2 text-foreground/90">{a}</td>
                <td className="py-1 text-foreground/90">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* For the paranoid: does the choice change the actual result? (No — only the model can.) */}
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-faint hover:text-muted-foreground">Does it matter?</summary>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            Your pick changes <b className="text-foreground/80">speed and billing, not the result</b> — both run the identical pipeline and write the same data, so switching providers won't rewrite your threads or coherence. The one quality lever is <i>which model reads</i> (a faster model can be a little looser at linking threads), and you can re-analyze on a stronger one anytime.
          </p>
        </details>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-faint" title="A fuller comparison is coming to the handbook">Detailed guide — coming soon</span>
          <button onClick={manage} className="rounded-md border border-thread/50 bg-thread/10 px-2.5 py-1 text-[12px] text-foreground hover:bg-thread/20">Manage connections</button>
        </div>
      </div>
    </div>
  )
}
