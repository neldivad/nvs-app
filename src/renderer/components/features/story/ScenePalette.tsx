import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { SearchPopover, type SearchResult } from '@/components/ui/SearchPopover'
import { FileText, Folder, FolderOpen, Check, ChevronRight, ChevronDown, ListTree, FoldVertical } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { activeVariant } from '@/lib/timeline/treeVariant'
import { cn } from '@/lib/utils'
import { SidebarScroll } from '@/components/layout/SidebarKit'
import type { StoryNode } from '@shared/ipc'

/**
 * ScenePalette — the drag source shared by the Timeline's Canvas AND Cell views. A COLLAPSIBLE folder+scene tree
 * (folders expand/collapse with a chevron; scenes nest under them) so a big project isn't one endless flat list.
 * Drag a folder (a whole group, one drop-unit) or a scene onto either view. A ✓ marks what's already placed on the
 * active variant. Searching flattens to the matching folders + scenes.
 */
export function ScenePalette(): JSX.Element {
  const { t } = useTranslation('scenePalette')
  const storyTree = useWorkspace((s) => s.storyTree)
  const trees = useWorkspace((s) => s.trees)
  const placed = useMemo(() => activeVariant(trees)?.nodes ?? [], [trees]) // active variant's canvas (per-variant)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // folderRels currently open; empty = all collapsed

  const allFolderRels = useMemo(() => {
    const out: string[] = []
    const walk = (ns: StoryNode[]): void => { for (const n of ns) if (n.type === 'folder') { out.push(n.relPath); walk(n.children ?? []) } }
    walk(storyTree)
    return out
  }, [storyTree])
  const toggle = (rel: string): void => setExpanded((s) => { const n = new Set(s); n.has(rel) ? n.delete(rel) : n.add(rel); return n })

  const placedFolderRels = useMemo(() => placed.flatMap((n) => (n.kind === 'folder' ? [n.folderRel] : [])), [placed])
  const placedScenes = useMemo(() => {
    const s = new Set(placed.flatMap((n) => (n.kind === 'scene' ? [n.sceneId] : [])))
    const walk = (nodes: StoryNode[], covered: boolean): void => {
      for (const n of nodes) {
        if (n.type === 'folder') walk(n.children ?? [], covered || placedFolderRels.includes(n.relPath))
        else if (covered) s.add(n.sceneId ?? n.name)
      }
    }
    walk(storyTree, false)
    return s
  }, [placed, placedFolderRels, storyTree])
  const isCovered = (folderRel: string): boolean => placedFolderRels.some((p) => folderRel === p || folderRel.startsWith(p + '/'))
  const sceneCount = (n: StoryNode): number => (n.children ?? []).reduce((s, c) => s + (c.type === 'scene' ? 1 : sceneCount(c)), 0)

  // Search results (folders + scenes); picking one reveals it in the tree (opens its ancestor folders) so it can be dragged.
  const searchResults = (query: string): SearchResult[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: SearchResult[] = []
    const walk = (nodes: StoryNode[], trail: string[]): void => {
      for (const n of nodes) {
        if (n.type === 'scene') {
          const title = n.title ?? n.name
          if (title.toLowerCase().includes(q)) out.push({ id: 'scene:' + (n.sceneId ?? n.name), label: title, icon: <FileText className="size-3.5 shrink-0 text-faint" />, meta: trail.join(' · ') || undefined })
        } else {
          if (n.name.toLowerCase().includes(q)) out.push({ id: 'folder:' + n.relPath, label: n.name, icon: <Folder className="size-3.5 shrink-0 text-lore" />, meta: trail.join(' · ') || undefined })
          walk(n.children ?? [], [...trail, n.name])
        }
      }
    }
    walk(storyTree, [])
    return out
  }
  const revealTo = (match: (n: StoryNode) => boolean): void => {
    setExpanded((cur) => {
      const next = new Set(cur)
      const walk = (nodes: StoryNode[], anc: string[]): boolean => {
        for (const n of nodes) {
          if (match(n)) { anc.forEach((a) => next.add(a)); if (n.type === 'folder') next.add(n.relPath); return true }
          if (n.type === 'folder' && walk(n.children ?? [], [...anc, n.relPath])) return true
        }
        return false
      }
      walk(storyTree, [])
      return next
    })
  }
  const onSearchSelect = (id: string): void => {
    if (id.startsWith('folder:')) { const rel = id.slice('folder:'.length); revealTo((n) => n.type === 'folder' && n.relPath === rel) }
    else { const sid = id.slice('scene:'.length); revealTo((n) => n.type === 'scene' && (n.sceneId ?? n.name) === sid) }
  }

  return (
    <div {...regionAttrs('scenePalette')} className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
        <span className="flex-1" />
        <button onClick={() => setExpanded(new Set(allFolderRels))} title={t('expandAll')} className="shrink-0 rounded p-1 text-faint hover:bg-panel-soft hover:text-foreground"><ListTree className="size-3.5" /></button>
        <button onClick={() => setExpanded(new Set())} title={t('collapseAll')} className="shrink-0 rounded p-1 text-faint hover:bg-panel-soft hover:text-foreground"><FoldVertical className="size-3.5" /></button>
        <SearchPopover results={searchResults} onSelect={onSearchSelect} placeholder={t('searchPlaceholder')} className="rounded p-1 hover:bg-panel-soft" />
      </div>

      <SidebarScroll className="pb-3">
        {storyTree.length === 0 ? (
          <Empty>{t('empty')}</Empty>
        ) : (
          <Tree nodes={storyTree} depth={0} expanded={expanded} toggle={toggle} isCovered={isCovered} placedScenes={placedScenes} sceneCount={sceneCount} />
        )}
      </SidebarScroll>
    </div>
  )
}

/** Recursively render the folder/scene tree, honoring the `expanded` set. */
function Tree({ nodes, depth, expanded, toggle, isCovered, placedScenes, sceneCount }: {
  nodes: StoryNode[]; depth: number; expanded: Set<string>; toggle: (rel: string) => void
  isCovered: (rel: string) => boolean; placedScenes: Set<string>; sceneCount: (n: StoryNode) => number
}): JSX.Element {
  const { t } = useTranslation('scenePalette')
  return (
    <>
      {nodes.map((n) => {
        if (n.type === 'scene') {
          const id = n.sceneId ?? n.name
          return <Row key={id} kind="scene" dragValue={id} depth={depth} covered={placedScenes.has(id)}
            icon={<FileText className="size-3.5 shrink-0 text-faint" />} title={n.title ?? n.name} />
        }
        const open = expanded.has(n.relPath)
        const hasChildren = (n.children?.length ?? 0) > 0
        return (
          <div key={n.relPath}>
            <Row kind="folder" dragValue={n.relPath} depth={depth} covered={isCovered(n.relPath)}
              open={hasChildren ? open : undefined} onToggle={() => toggle(n.relPath)}
              icon={open ? <FolderOpen className="size-3.5 shrink-0 text-lore" /> : <Folder className="size-3.5 shrink-0 text-lore" />}
              title={n.name} sub={t('sceneCount', { count: sceneCount(n) })} />
            {open && hasChildren && (
              <Tree nodes={n.children ?? []} depth={depth + 1} expanded={expanded} toggle={toggle} isCovered={isCovered} placedScenes={placedScenes} sceneCount={sceneCount} />
            )}
          </div>
        )
      })}
    </>
  )
}

/** One draggable tree row. Folders carry a chevron (expand/collapse); both kinds are drag sources. */
function Row({ kind, dragValue, depth, covered, icon, title, sub, open, onToggle }: {
  kind: 'folder' | 'scene'; dragValue: string; depth: number; covered: boolean
  icon: React.ReactNode; title: string; sub?: string; open?: boolean; onToggle?: () => void
}): JSX.Element {
  const { t } = useTranslation('scenePalette')
  const dragType = kind === 'folder' ? 'application/nvs-folder' : 'application/nvs-scene'
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(dragType, dragValue); e.dataTransfer.effectAllowed = 'copy' }}
      title={covered ? t('dragTip.placed') : kind === 'folder' ? t('dragTip.folder') : t('dragTip.scene')}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn('group flex cursor-grab items-center gap-1 py-1 pr-2 text-[12px] transition-colors hover:bg-panel-soft active:cursor-grabbing', covered && 'opacity-55')}
    >
      {open !== undefined ? (
        <button onClick={(e) => { e.stopPropagation(); onToggle?.() }} onDragStart={(e) => e.preventDefault()} className="shrink-0 rounded p-0.5 text-faint hover:text-foreground">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      ) : (
        <span className="w-4 shrink-0" /> // align leaf scenes with folder chevrons
      )}
      {icon}
      <span className="min-w-0 flex-1 truncate text-foreground/90">{title}</span>
      {sub && <span className="shrink-0 truncate text-[10px] text-faint">{sub}</span>}
      {covered && <Check className="size-3 shrink-0 text-character" />}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="px-3 text-[11px] text-faint/70">{children}</p>
}
