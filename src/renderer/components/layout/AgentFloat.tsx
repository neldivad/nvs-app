/**
 * The agent surface — ONE floating window with two tabs: Chat (the orchestrator) and Tasks (the workers).
 *
 * Chrome (drag/resize/persist/Esc) comes from FloatWindow; this adds the tab strip + close, then renders
 * the active tab's panel. Keeping both rails in one float (decision: a single right-side agent surface)
 * means a chat "format every scene" fan-out and its resulting page-edit tasks live side by side.
 */
import { useTranslation } from 'react-i18next'
import { MessageSquare, ListTodo, X } from 'lucide-react'
import { FloatWindow } from './FloatWindow'
import { ChatPanel } from '@/components/features/agent/ChatPanel'
import { TasksPanel, doneTaskCount } from '@/components/features/agent/TasksPanel'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

import type { JSX } from "react";

export function AgentFloat(): JSX.Element {
  const { t } = useTranslation('agentFloat')
  const tab = useWorkspace((s) => s.agentTab)
  const setTab = useWorkspace((s) => s.setAgentTab)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const runningTasks = useWorkspace((s) => s.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length)
  const doneTasks = useWorkspace((s) => doneTaskCount(s.tasks))

  return (
    <FloatWindow region="agentFloat"
      persistKey="chat"
      accent="var(--facet-relationship)"
      maxWidth={1100}
      onEscape={() => setChatOpen(false)}
      initial={() => ({
        left: Math.max(8, window.innerWidth - 420),
        top: 48,
        width: 380,
        height: Math.max(240, Math.min(window.innerHeight - 120, 640))
      })}
    >
      <div className="flex h-full min-w-0 flex-col bg-canvas">
        {/* Tab strip — Chat | Tasks (+ live/ready badges) + close */}
        <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
          <Tab active={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare className="size-3.5" />} label={t('chat')} />
          <Tab
            active={tab === 'tasks'}
            onClick={() => setTab('tasks')}
            icon={<ListTodo className="size-3.5" />}
            label={t('tasks')}
            badge={runningTasks > 0 ? `${runningTasks}…` : doneTasks > 0 ? `${doneTasks}` : undefined}
            badgeTone={runningTasks > 0 ? 'busy' : 'ready'}
          />
          <button onClick={() => setChatOpen(false)} title={t('close')} className="ml-auto rounded p-1 text-muted-foreground hover:bg-panel-soft">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1">{tab === 'chat' ? <ChatPanel /> : <TasksPanel />}</div>
      </div>
    </FloatWindow>
  )
}

function Tab({
  active,
  onClick,
  icon,
  label,
  badge,
  badgeTone = 'ready'
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: string
  badgeTone?: 'busy' | 'ready'
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors',
        active ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft/60'
      )}
    >
      {icon}
      {label}
      {badge && (
        <span
          className={cn(
            'rounded-full px-1 text-[9px] font-medium tabular-nums',
            badgeTone === 'busy' ? 'bg-thread text-thread-foreground' : 'bg-ok/20 text-ok'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
