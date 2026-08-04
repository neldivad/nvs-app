import { FolderOpen, Sparkles, RotateCw } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { AiGate } from '@/config/aiFeatures'
import { activeVariant } from '@/lib/timeline/treeVariant'
import { buildTimelinePrompt } from '@shared/config/chatPrompts'
import { SceneNavigator } from '@/components/features/story/SceneNavigator'
import { WorldNavigator } from '@/components/features/story/WorldNavigator'
import { ScenePalette } from '@/components/features/story/ScenePalette'
import { SequenceSidebar } from '@/components/layout/SequenceSidebar'
import { TimelineTreePicker } from '@/components/features/timeline/TimelineTreePicker'
import { CastSidebar } from '@/components/features/cast/CastSidebar'
import { RelationshipSidebar } from '@/components/features/relationships/RelationshipSidebar'
import { ThreadSidebar } from '@/components/features/threads/ThreadSidebar'
import { CoherenceSidebar } from '@/components/features/coherence/CoherenceSidebar'
import { CustodySidebar } from '@/components/features/custody/CustodyPanel'
import { CorkboardSidebar } from '@/components/features/corkboard/CorkboardSidebar'
import { SidebarHeader, SidebarScroll, SidebarRow } from '@/components/layout/SidebarKit'

import type { JSX } from "react";
import { SidebarEmpty } from '@/components/ui/EmptyRailState'

/**
 * The side bar — contextual. In the editor workspace it's the scene tree; else
 * it's the works library (the persistent way back to any work).
 */
export function Sidebar(): JSX.Element {
  const works = useWorkspace((s) => s.works)
  const setDetailWork = useWorkspace((s) => s.setDetailWork)
  const project = useWorkspace((s) => s.project)
  const workspace = useWorkspace((s) => s.workspace)
  const openExternal = useWorkspace((s) => s.openExternal)

  if (project && workspace === 'editor') return <SceneNavigator />
  if (project && workspace === 'world') return <WorldNavigator />
  // Timeline: the active tree-variant picker (shared across all 3 tabs) atop the scene palette (Canvas/Cells) or
  // the saved-sequence list (Chart Config).
  if (project && workspace === 'timeline') return <TimelineSidebar />
  if (project && workspace === 'cast') return <CastSidebar />
  if (project && workspace === 'relationships') return <RelationshipSidebar />
  if (project && workspace === 'threads') return <ThreadSidebar />
  if (project && workspace === 'custody') return <CustodySidebar />
  if (project && workspace === 'coherence') return <CoherenceSidebar />
  if (project && workspace === 'corkboard') return <CorkboardSidebar />

  return (
    <div {...regionAttrs('sidebar')} className="flex h-full flex-col bg-panel">
      <SidebarHeader
        title="Library"
        action={
          <button
            onClick={() => void openExternal()}
            title="Open elsewhere…"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <FolderOpen className="size-3.5" />
          </button>
        }
      />
      <SidebarScroll>
        {works.length === 0 ? (
          <SidebarEmpty>No works yet.</SidebarEmpty>
        ) : (
          works.map((w) => (
            <SidebarRow
              key={w.path}
              selected={project?.root === w.path}
              onClick={() => setDetailWork(w)}
              label={w.title || w.name}
              sub={`${w.scenes} scenes · ${w.worldPages} world`}
            />
          ))
        )}
      </SidebarScroll>
    </div>
  )
}

/** Timeline sidebar: the active tree-variant picker (constant across Canvas · Cells · Chart Config) + the
 *  "build with AI" trigger, above the tab-specific content — the scene palette, or the saved-sequence list. */
function TimelineSidebar(): JSX.Element {
  const timelineTab = useWorkspace((s) => s.timelineTab)
  const trees = useWorkspace((s) => s.trees)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const reloadTimeline = useWorkspace((s) => s.reloadTimeline)

  // Prefill the chat composer with the routing prompt (config/chatPrompts — the author reviews + sends).
  const buildWithAi = (): void => {
    setChatDraft(buildTimelinePrompt(activeVariant(trees)?.name ?? 'this timeline'))
    setChatOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <TimelineTreePicker />
        <button
          onClick={() => void reloadTimeline()}
          title="Reload from disk"
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
        >
          <RotateCw className="size-3.5" />
        </button>
        <AiGate>
          <button
            onClick={buildWithAi}
            title="Opens chat and build timeline with AI"
            className="flex shrink-0 items-center gap-1 rounded-md border border-thread/40 bg-thread/10 px-2 py-1 text-[11px] text-thread transition-colors hover:bg-thread/20"
          >
            <Sparkles className="size-3.5" />
          </button>
        </AiGate>
      </div>
      <div className="min-h-0 flex-1">{timelineTab === 'config' ? <SequenceSidebar /> : <ScenePalette />}</div>
    </div>
  )
}
