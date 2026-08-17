import { useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { ChevronDown, X } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import type { PageRef } from '@shared/ipc'

const KIND_ACCENT: Record<string, string> = {
  scene: 'text-thread',
  character: 'text-character',
  location: 'text-location',
  item: 'text-lore',
  lore: 'text-lore'
}

/** VSCode-style tab strip — lives above the editor toolbar. Scrolls horizontally; a ⌄ overflow menu lists
 *  every open tab (jump / close / close-others / close-all) so a big pile stays manageable. */
export function TabBar(): JSX.Element | null {
  const { t } = useTranslation('editor')
  const openTabs = useWorkspace((s) => s.openTabs)
  const activePath = useWorkspace((s) => s.activePage?.path)
  const sceneDirty = useWorkspace((s) => s.sceneDirty)
  const openPage = useWorkspace((s) => s.openPage)
  const closeTab = useWorkspace((s) => s.closeTab)
  const requestCloseTab = useWorkspace((s) => s.requestCloseTab)
  const saveScene = useWorkspace((s) => s.saveScene)
  const reorderTabs = useWorkspace((s) => s.reorderTabs)

  const dragIdxRef = useRef<number>(-1)
  const [dragOverIdx, setDragOverIdx] = useState<number>(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Keep the active tab visible — scroll it into view when the active file changes (it can scroll off at 30 tabs).
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [activePath])

  if (openTabs.length === 0) return null

  return (
    <div {...regionAttrs('tabBar')} className="relative flex h-8 shrink-0 border-b border-border bg-panel">
      <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none">
        {openTabs.map((tab, idx) => (
          <Tab
            key={tab.path}
            tab={tab}
            active={tab.path === activePath}
            dirty={tab.path === activePath && sceneDirty}
            innerRef={tab.path === activePath ? activeRef : undefined}
            dragOver={dragOverIdx === idx}
            onSelect={() => void openPage(tab)}
            onClose={(e) => {
              e.stopPropagation()
              requestCloseTab(tab.path)
            }}
            onDragStart={() => { dragIdxRef.current = idx }}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
            onDragLeave={() => setDragOverIdx(-1)}
            onDrop={() => {
              setDragOverIdx(-1)
              const from = dragIdxRef.current
              if (from !== -1 && from !== idx) reorderTabs(from, idx)
              dragIdxRef.current = -1
            }}
            onDragEnd={() => { dragIdxRef.current = -1; setDragOverIdx(-1) }}
          />
        ))}
      </div>

      {/* overflow menu — the "see all open tabs" list (replaces a VS Code OPEN EDITORS panel, lighter) */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title={t('tab.allOpen')}
        className={cn('flex shrink-0 items-center gap-1 border-l border-border px-2 text-[11px] hover:bg-panel-soft', menuOpen ? 'text-foreground' : 'text-muted-foreground')}
      >
        <ChevronDown className="size-3" /> {openTabs.length}
      </button>
      {menuOpen && (
        <TabMenu
          tabs={openTabs}
          activePath={activePath}
          onPick={(t) => { void openPage(t); setMenuOpen(false) }}
          onClose={(p) => requestCloseTab(p)}
          onCloseOthers={() => { openTabs.filter((t) => t.path !== activePath).forEach((t) => closeTab(t.path)); setMenuOpen(false) }}
          onCloseAll={async () => { if (sceneDirty) await saveScene(); openTabs.slice().forEach((t) => closeTab(t.path)); setMenuOpen(false) }}
          dismiss={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

function TabMenu({ tabs, activePath, onPick, onClose, onCloseOthers, onCloseAll, dismiss }: {
  tabs: PageRef[]
  activePath?: string
  onPick: (t: PageRef) => void
  onClose: (path: string) => void
  onCloseOthers: () => void
  onCloseAll: () => void
  dismiss: () => void
}): JSX.Element {
  const { t } = useTranslation('editor')
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={dismiss} />
      {/* flex column: the TAB LIST scrolls, the close actions are PINNED below it (a long list used to
          scroll them out of reach — the actions must be one click away regardless of tab count) */}
      <div className="absolute right-0 top-full z-50 mt-px flex max-h-80 w-64 flex-col rounded-md border border-border bg-panel py-1 text-[12px] shadow-xl">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tabs.map((tab) => (
            <div key={tab.path} className={cn('group flex items-center gap-2 px-2 py-1 hover:bg-panel-soft', tab.path === activePath && 'bg-panel-soft')}>
              <button onClick={() => onPick(tab)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <span className={cn('shrink-0 font-mono text-[9px] capitalize', tab.path === activePath ? (KIND_ACCENT[tab.kind] ?? 'text-faint') : 'text-faint')}>{tab.kind[0]}</span>
                <span className="truncate text-foreground/90">{tab.title}</span>
              </button>
              <button onClick={() => onClose(tab.path)} title={t('tab.close')} className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:bg-panel hover:text-foreground group-hover:opacity-100"><X className="size-2.5" /></button>
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-border pt-1">
          <button onClick={onCloseOthers} className="block w-full px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-panel-soft">{t('tab.closeOthers')}</button>
          <button onClick={onCloseAll} className="block w-full px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-panel-soft">{t('tab.closeAll')}</button>
        </div>
      </div>
    </>
  )
}

function Tab({
  tab,
  active,
  dirty,
  innerRef,
  dragOver,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: {
  tab: PageRef
  active: boolean
  dirty: boolean
  innerRef?: React.Ref<HTMLButtonElement>
  dragOver: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  const { t } = useTranslation('editor')
  const accent = KIND_ACCENT[tab.kind] ?? 'text-muted-foreground'
  return (
    <button
      ref={innerRef}
      draggable
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'group flex min-w-0 shrink-0 items-center gap-1.5 border-r border-border px-3 text-[12px] transition-colors',
        active
          ? 'bg-canvas text-foreground'
          : 'bg-panel text-muted-foreground hover:bg-panel-soft hover:text-foreground',
        dragOver && 'border-l-2 border-l-thread'
      )}
    >
      <span className={cn('font-mono text-[9px] capitalize', active ? accent : 'text-faint')}>
        {tab.kind[0]}
      </span>
      <span className="max-w-35 truncate">{tab.title}</span>
      <span
        role="button"
        onClick={onClose}
        title={t('tab.close')}
        className={cn(
          'ml-0.5 flex size-4 items-center justify-center rounded transition-opacity hover:bg-panel-soft',
          dirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          !dirty && active && 'opacity-60'
        )}
      >
        {dirty ? (
          <>
            {/* VS Code-style: an unsaved dot that becomes the X on hover */}
            <span className="size-2 rounded-full bg-thread group-hover:hidden" />
            <X className="hidden size-2.5 group-hover:block" />
          </>
        ) : (
          <X className="size-2.5" />
        )}
      </span>
    </button>
  )
}
