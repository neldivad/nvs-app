/**
 * Corkboard board-select — the left sidebar for the Corkboard workspace: the project's boards, with select /
 * rename / delete and a New-board button (capped at MAX_CORKBOARDS). Uses the shared SidebarKit (SidebarHeader /
 * SidebarScroll / SidebarRow) so it matches every other roster sidebar. Shares the isolated corkboard store with
 * the canvas panel, so switching here re-seeds the canvas there.
 */
import { JSX, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useCorkboard } from '@/stores/corkboard'
import { useWorkspace } from '@/stores/workspace'
import { SidebarHeader, SidebarScroll, SidebarRow } from '@/components/layout/SidebarKit'
import { MAX_CORKBOARDS } from '@shared/ipc'
import { cn } from '@/lib/utils'

export function CorkboardSidebar(): JSX.Element {
  const file = useCorkboard((s) => s.file)
  const setActive = useCorkboard((s) => s.setActive)
  const addBoard = useCorkboard((s) => s.addBoard)
  const renameBoard = useCorkboard((s) => s.renameBoard)
  const deleteBoard = useCorkboard((s) => s.deleteBoard)
  const setNotice = useWorkspace((s) => s.setNotice)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const boards = file?.boards ?? []
  const activeId = file?.activeId
  const full = boards.length >= MAX_CORKBOARDS

  const commit = (id: string): void => {
    renameBoard(id, draft)
    setEditing(null)
  }
  const iconBtn = 'shrink-0 text-faint transition-colors'

  return (
    <div {...regionAttrs('sidebar')} className="flex h-full flex-col bg-panel">
      <SidebarHeader
        title="Boards"
        count={boards.length}
        action={
          <button
            onClick={() => (full ? setNotice(`You’ve reached the ${MAX_CORKBOARDS}-board limit.`) : addBoard())}
            title={full ? `Max ${MAX_CORKBOARDS} boards` : 'New board'}
            className={cn('transition-colors', full ? 'text-faint hover:text-warn' : 'text-muted-foreground hover:text-foreground')}
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
      <SidebarScroll>
        {boards.length === 0 ? (
          <div className="px-3 py-2 text-xs text-faint">No boards yet.</div>
        ) : (
          boards.map((b) => (
            <SidebarRow
              key={b.id}
              selected={b.id === activeId}
              onClick={editing === b.id ? undefined : () => setActive(b.id)}
              label={
                editing === b.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(b.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    className="w-full rounded border border-border bg-canvas px-1 py-0.5 text-[13px] outline-none"
                  />
                ) : (
                  b.name
                )
              }
              trailing={
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(b.id)
                      setDraft(b.name)
                    }}
                    title="Rename"
                    className={cn(iconBtn, 'hover:text-foreground')}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteBoard(b.id)
                    }}
                    title="Delete"
                    className={cn(iconBtn, 'hover:text-flag')}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              }
            />
          ))
        )}
      </SidebarScroll>
    </div>
  )
}
