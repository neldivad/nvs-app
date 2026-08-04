import { useWorkspace } from '@/stores/workspace'
import { regionAttrs } from '@/config/regions'
import { WelcomeView } from '@/views/WelcomeView'
import { SceneEditor } from '@/components/editor/SceneEditor'
import { TabBar } from '@/components/editor/TabBar'
import { TimelinePanel } from '@/components/features/timeline/TimelinePanel'
import { ThreadsPanel } from '@/components/features/threads/ThreadsPanel'
import { CastPanel } from '@/components/features/cast/CastPanel'
import { CoherencePanel } from '@/components/features/coherence/CoherencePanel'
import { CustodyPanel } from '@/components/features/custody/CustodyPanel'
import { RelationshipPanel } from '@/components/features/relationships/RelationshipPanel'
import { CorkboardPanel } from '@/components/features/corkboard/CorkboardPanel'
import { JSX } from 'react/jsx-runtime'

/** The central content region, switched by the active rail workspace. */
export function MainContent(): JSX.Element {
  const project = useWorkspace((s) => s.project)
  const workspace = useWorkspace((s) => s.workspace)

  let body: JSX.Element
  if (!project) body = <WelcomeView />
  // MainContent owns the page-tab strip for EVERY page pane (editor/world/custody) — a tab is a
  // PageRef regardless of kind, so switching workspaces must never drop the strip
  else if (workspace === 'editor' || workspace === 'world')
    body = (
      <>
        <TabBar />
        <SceneEditor />
      </>
    )
  else if (workspace === 'timeline') body = <TimelinePanel />
  else if (workspace === 'cast') body = <CastPanel />
  else if (workspace === 'relationships') body = <RelationshipPanel />
  else if (workspace === 'custody')
    body = (
      <>
        <TabBar />
        <CustodyPanel />
      </>
    )
  else if (workspace === 'coherence') body = <CoherencePanel />
  else if (workspace === 'corkboard') body = <CorkboardPanel />
  else body = <ThreadsPanel />

  return (
    <div {...regionAttrs('mainContent')} className="flex h-full flex-col">
      {body}
    </div>
  )
}
