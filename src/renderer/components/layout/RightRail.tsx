/**
 * The right activity rail — a thin always-visible strip (status-bar height) that reveals the
 * right-side panels. Mirrors the left Rail; currently toggles the agent chat, and is where
 * extension-contributed right-panel icons will live.
 */
import { useTranslation } from 'react-i18next'
import { MessageSquare, Library, Store, Activity, Blocks } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

import type { JSX } from "react";

export function RightRail(): JSX.Element {
  const { t } = useTranslation('rightRail')
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the AI buttons (Chat, Prompts) + analysis Jobs
  const chatOpen = useWorkspace((s) => s.chatOpen)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const promptsOpen = useWorkspace((s) => s.promptsOpen)
  const setPromptsOpen = useWorkspace((s) => s.setPromptsOpen)
  const discoverOpen = useWorkspace((s) => s.discoverOpen)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)
  const project = useWorkspace((s) => s.project)
  const jobsOpen = useWorkspace((s) => s.jobsOpen)
  const setJobsOpen = useWorkspace((s) => s.setJobsOpen)
  const extensionRunOpen = useWorkspace((s) => s.extensionRunOpen)
  const setExtensionRunOpen = useWorkspace((s) => s.setExtensionRunOpen)
  const jobRunning = useWorkspace((s) => s.ingestProgress?.active ?? false)
  // Surface task activity even when the float is closed: a busy dot while running, else a done count.
  const running = useWorkspace((s) => s.tasks.some((t) => t.status === 'queued' || t.status === 'running'))
  const done = useWorkspace((s) => s.tasks.filter((t) => t.status === 'done').length)
  return (
    <nav {...regionAttrs('rightRail')} className="flex w-8 flex-col items-center gap-1 border-l border-border bg-panel py-2">
      {aiEnabled && (<>
      <button
        onClick={() => setChatOpen(!chatOpen)}
        disabled={!project}
        title={t('agent')}
        className={cn(
          'relative flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-30',
          chatOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
        )}
      >
        <MessageSquare className="size-4" />
        {running ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-thread" title={t('taskRunning')} />
        ) : (
          done > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-ok px-0.5 text-[8px] font-medium text-white" title={t('tasksReady', { count: done })}>
              {done}
            </span>
          )
        )}
      </button>
      <button
        onClick={() => setPromptsOpen(!promptsOpen)}
        disabled={!project}
        title={t('promptLibrary')}
        className={cn(
          'flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-30',
          promptsOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
        )}
      >
        <Library className="size-4" />
      </button>
      </>)}

      {/* JobRail + Store — pinned to the BOTTOM of the rail. JobRail opens the Jobs dashboard (analysis runs +
          progress + controls); a pulsing dot marks a live run so it's visible from any project or view. */}
      <div className="flex-1" />
      {aiEnabled && (
      <button
        onClick={() => setJobsOpen(!jobsOpen)}
        title={t('jobs')}
        className={cn(
          'relative flex size-7 items-center justify-center rounded-md transition-colors',
          jobsOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
        )}
      >
        <Activity className="size-4" />
        {jobRunning && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-thread" title={t('analysisRunning')} />}
      </button>
      )}
      <button
        onClick={() => setDiscoverOpen(discoverOpen ? null : 'community')}
        title={t('store')}
        className={cn(
          'flex size-7 items-center justify-center rounded-md transition-colors',
          discoverOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
        )}
      >
        <Store className="size-4" />
      </button>
      {/* Extension RUN surface — separated from the Store (acquire) by a divider: the Store installs, this INVOKES
          the installed active extensions (a tools list). See internal/extensions.md "Run surface". */}
      <span className="my-0.5 h-px w-4 rounded-full bg-border" aria-hidden />
      <button
        onClick={() => setExtensionRunOpen(!extensionRunOpen)}
        title={t('extensionTools')}
        className={cn(
          'flex size-7 items-center justify-center rounded-md transition-colors',
          extensionRunOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
        )}
      >
        <Blocks className="size-4" />
      </button>
    </nav>
  )
}
