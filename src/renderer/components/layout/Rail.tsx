import { type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { BookOpen, SlidersHorizontal, Info, Share2 } from 'lucide-react'
import { NAV } from '@/config/nav'
import { HOTKEYS } from '@/config/hotkeys'
import { useWorkspace, type WorkspaceId } from '@/stores/workspace'
import { cn } from '@/lib/utils'

const ACCENT: Record<string, string> = {
  ink: 'text-ink',
  thread: 'text-thread',
  character: 'text-character',
  lore: 'text-lore',
  flag: 'text-flag'
}

/**
 * The activity rail: the book returns to the library (dirty-aware via
 * requestReturnToLibrary); icons switch workspace. Project actions and help live
 * in the TitleBar menus; the unsaved-changes prompt is UnsavedExitDialog.
 */
export function Rail(): JSX.Element {
  const { t } = useTranslation('nav')
  const workspace = useWorkspace((s) => s.workspace)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const requestReturnToLibrary = useWorkspace((s) => s.requestReturnToLibrary)
  const project = useWorkspace((s) => s.project) // no project (library/home) → the workspace nav is inert
  const aiEnabled = useWorkspace((s) => s.aiEnabled)
  const hasThreads = useWorkspace((s) => (s.threads?.length ?? 0) > 0)
  const hasCoherence = useWorkspace((s) => (s.coherence?.length ?? 0) > 0)
  // ALL rails show for every KIND — non-fiction included (the showcase wants the full rail set). The fast
  // time-to-value for a transcript is the DETERMINISTIC rails (Cast volume · Relations · Timeline), which
  // populate from T1 with no AI; the AI-inferred rails (Threads/Coherence) stay empty until the deferred
  // extraction skill runs. (Earlier this hid group 't2' for non-fiction — reverted per the showcase direction.)
  // With AI OFF, those two rails can only ever show "run analysis" (impossible without AI) — so hide them WHEN
  // EMPTY (never analyzed); keep them if prior results exist to view.
  const nav = NAV.filter(
    (item) =>
      aiEnabled ||
      (item.id !== 'threads' && item.id !== 'coherence') ||
      (item.id === 'threads' ? hasThreads : hasCoherence)
  )
  const setStructureDialogOpen = useWorkspace((s) => s.setStructureDialogOpen)
  const setDetailsDialogOpen = useWorkspace((s) => s.setDetailsDialogOpen)
  const setShareDialogOpen = useWorkspace((s) => s.setShareDialogOpen)

  // Project setup actions — an always-visible cluster (was buried in the header menu). Only with a project open.
  const projectActions = [
    { id: 'structure', icon: SlidersHorizontal, title: t('action.structure', { shortcut: HOTKEYS.projectConfig.display }), onClick: () => setStructureDialogOpen(true) },
    { id: 'info', icon: Info, title: t('action.info'), onClick: () => setDetailsDialogOpen(true) },
    { id: 'share', icon: Share2, title: t('action.share'), onClick: () => setShareDialogOpen(true) }
  ]

  return (
    <nav
      {...regionAttrs('rail')}
      className="flex w-12 flex-col items-center gap-1 border-r border-border bg-panel py-2"
    >
      <button
        onClick={() => requestReturnToLibrary()}
        title={t('library')}
        className="mb-2 flex size-9 items-center justify-center rounded-md text-thread transition-colors hover:bg-panel-soft"
      >
        <BookOpen className="size-4" />
      </button>
      {nav.map((item, i) => {
        const Icon = item.icon
        const on = workspace === item.id
        const newGroup = i > 0 && nav[i - 1].group !== item.group
        return (
          <div key={item.id} className="flex flex-col items-center">
            {newGroup && <div className="my-1 h-px w-5 bg-border" />}
          <button
            data-group={item.group}
            onClick={() => setWorkspace(item.id as WorkspaceId)}
            disabled={!project || item.phase > 1}
            title={!project ? t('disabledNoProject', { label: t(item.id) }) : item.phase > 1 ? t('disabledSoon', { label: t(item.id) }) : t(item.id)}
            className={cn(
              'flex size-9 items-center justify-center rounded-md transition-colors disabled:cursor-default',
              on ? 'bg-panel-soft' : 'hover:bg-panel-soft',
              (item.phase > 1 || !project) && 'opacity-40'
            )}
          >
            <Icon className={cn('size-5', on ? ACCENT[item.accent] : 'text-muted-foreground')} />
          </button>
          </div>
        )
      })}

      {/* Project setup — pinned to the rail BOTTOM (where it used to live), always visible with a project open,
          so structure/info/share aren't buried in the header menu. ⌘, opens Structure. */}
      {project && (
        <>
          <div className="flex-1" />
          <div className="my-1 h-px w-5 bg-border" />
          {projectActions.map((a) => (
            <button
              key={a.id}
              onClick={a.onClick}
              title={a.title}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
            >
              <a.icon className="size-4" />
            </button>
          ))}
        </>
      )}
    </nav>
  )
}
