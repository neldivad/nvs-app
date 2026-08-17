import { useMemo, useRef, useState, Fragment, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Trash2,
  ListTree,
  FoldVertical
} from 'lucide-react'
import { useTree } from '@headless-tree/react'
import {
  syncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
  dragAndDropFeature,
  isOrderedDragTarget,
  type ItemInstance,
  type DragTarget,
  type TreeInstance
} from '@headless-tree/core'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { SidebarHeader, DetailedRow } from '@/components/layout/SidebarKit'
import { defaultPhase, PHASE_META, slugify } from '@/config/worldSchema'
import { ConfirmDialog } from '@/components/ui/confirm'
import { ContextMenuShell, MenuItem, MenuSeparator, PhaseSection } from '@/components/layout/RailContextMenu'
import { levelColorHex, STORY_LADDER } from '@/config/sceneLadder'
import type { StoryNode } from '@shared/ipc'
import type { SearchResult } from '@/components/ui/SearchPopover'

// Stable feature list — headless-tree rebuilds its ENTIRE tree whenever the `features` array identity changes.
// A fresh literal every render, combined with any re-render, spins an infinite rebuild loop, so keep it a
// module constant (never re-created).
const TREE_FEATURES = [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, dragAndDropFeature]

/** Vertical indent-guide lines — one thin rule per ANCESTOR level, aligned to that ancestor's chevron column
 *  (row padding is 8 + level*12; a chevron centres ~6px in), so nesting depth reads at a glance. Absolutely
 *  positioned → zero layout impact; they sit in the left gutter, clear of the phase spine + active marker. */
function IndentGuides({ level }: { level: number }): JSX.Element | null {
  if (level <= 0) return null
  return (
    <>
      {Array.from({ length: level }, (_, i) => (
        <span
          key={i}
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-border opacity-0 transition-opacity group-hover/tree:opacity-100"
          style={{ left: 14 + i * 12 }}
        />
      ))}
    </>
  )
}

/** Find a node by its on-disk `path` (scenes carry one) anywhere in the tree — used by search to open a pick. */
function findByPath(nodes: StoryNode[], path: string): StoryNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    const hit = n.children && findByPath(n.children, path)
    if (hit) return hit
  }
  return null
}

type MenuState = { x: number; y: number; node: StoryNode | null } | null
type CreateState = { parentRel: string; type: 'folder' | 'scene'; container?: string } | null

const baseName = (rel: string): string => rel.split('/').pop() ?? rel
const parentOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')
const joinRel = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name)

/** Drop any relPath whose ancestor is also in the set — so a bulk move/delete of a folder + its own child acts
 *  on the folder once (the child rides along), instead of double-operating and colliding on stale paths. */
function topMost(rels: string[]): string[] {
  const set = new Set(rels)
  return rels.filter((r) => {
    const parts = r.split('/')
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return false
    return true
  })
}

/** Every scene PATH (absolute) under a node — a scene is itself, a folder yields all scenes beneath it. */
const collectScenePaths = (n: StoryNode): string[] => (n.type === 'scene' ? [n.path] : (n.children ?? []).flatMap(collectScenePaths))

/**
 * The seed collapse set for a fresh rail: every folder relPath collapsed EXCEPT the path down to the first
 * scene (the first folder that DIRECTLY holds a scene, plus its ancestors) — so the rail opens showing one
 * scene instead of a wall of closed folders. Used only until the author's own choice is saved.
 */
function defaultSceneCollapsed(tree: StoryNode[]): Set<string> {
  const all: string[] = []
  const collect = (ns: StoryNode[]): void => {
    for (const n of ns)
      if (n.type === 'folder') {
        all.push(n.relPath)
        collect(n.children ?? [])
      }
  }
  collect(tree)
  const keepOpen = new Set<string>()
  const find = (ns: StoryNode[], ancestors: string[]): boolean => {
    for (const n of ns) {
      if (n.type !== 'folder') continue
      if ((n.children ?? []).some((c) => c.type === 'scene')) {
        ancestors.forEach((a) => keepOpen.add(a))
        keepOpen.add(n.relPath)
        return true
      }
      if (find(n.children ?? [], [...ancestors, n.relPath])) return true
    }
    return false
  }
  find(tree, [])
  return new Set(all.filter((r) => !keepOpen.has(r)))
}

/** Flatten every archived scene out of the tree — they live in the collapsed "Archived" bin, not inline. */
function collectArchived(nodes: StoryNode[]): StoryNode[] {
  const out: StoryNode[] = []
  const walk = (ns: StoryNode[]): void => {
    for (const n of ns) {
      if (n.type === 'scene') {
        if (n.phase === 'archived') out.push(n)
      } else if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Find a node by its relPath anywhere in the tree (used to inspect a create target's siblings). */
function findNode(nodes: StoryNode[], relPath: string): StoryNode | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return n
    const hit = n.children && findNode(n.children, relPath)
    if (hit) return hit
  }
  return null
}

/** The story tree: a free-form folder/scene hierarchy with a right-click context menu.
 *
 * Rendering is driven by @headless-tree — it owns the flattened visible list, expand/collapse, roving-tabindex
 * KEYBOARD NAVIGATION (↑/↓ move, ←/→ collapse/expand, Enter opens), a11y `role="tree"`, and drag-and-drop
 * geometry. We keep the app-specific behavior around it: single-click-opens, the inline create/rename inputs
 * (with duplicate-name guards), the right-click menu, the phase spine + active marker, and the Archived bin. */
export function SceneNavigator(): JSX.Element {
  const { t } = useTranslation('sceneNav')
  const storyTree = useWorkspace((s) => s.storyTree)
  const activePath = useWorkspace((s) => s.activePage?.path)
  const openTabs = useWorkspace((s) => s.openTabs)
  const openPaths = useMemo(() => new Set(openTabs.map((t) => t.path)), [openTabs]) // files with an open tab → shaded in the tree
  const archivedScenes = useMemo(() => collectArchived(storyTree), [storyTree]) // cut scenes → the Archived bin
  const [archivedOpen, setArchivedOpen] = useState(false)
  const openPage = useWorkspace((s) => s.openPage)
  const createFolder = useWorkspace((s) => s.createFolder)
  const createSceneInFolder = useWorkspace((s) => s.createSceneInFolder)
  const renamePath = useWorkspace((s) => s.renamePath)
  const retitleScene = useWorkspace((s) => s.retitleScene)
  const setPagePhase = useWorkspace((s) => s.setPagePhase)
  const setPagePhaseBulk = useWorkspace((s) => s.setPagePhaseBulk)
  const exportScene = useWorkspace((s) => s.exportScene)
  const setFolderType = useWorkspace((s) => s.setFolderType)
  const deleteStoryPath = useWorkspace((s) => s.deleteStoryPath)
  const reorder = useWorkspace((s) => s.reorder)
  const refreshStoryTree = useWorkspace((s) => s.refreshStoryTree)

  // A flat index of the tree (relPath → node) so headless-tree's data loader resolves items in O(1). Rebuilt
  // only when the store swaps in a new tree.
  const index = useMemo(() => {
    const m = new Map<string, StoryNode>()
    const walk = (ns: StoryNode[]): void => ns.forEach((n) => { m.set(n.relPath, n); if (n.children) walk(n.children) })
    walk(storyTree)
    return m
  }, [storyTree])
  const allFolders = useMemo(() => [...index.values()].filter((n) => n.type === 'folder').map((n) => n.relPath), [index])

  // Collapse memory is persisted per-work (ui-state.json). null = never set → seed the default: everything
  // collapsed except the path down to the first scene. Every toggle saves the full set.
  const persistedCollapsed = useWorkspace((s) => s.sceneCollapsed)
  const setSceneCollapsed = useWorkspace((s) => s.setSceneCollapsed)
  const collapsed = useMemo(
    () => (persistedCollapsed != null ? new Set(persistedCollapsed) : defaultSceneCollapsed(storyTree)),
    [persistedCollapsed, storyTree]
  )
  // headless-tree wants an EXPANDED set; ours is stored inverted (collapsed). The root is implicitly expanded and
  // must NOT be listed here — listing it makes headless-tree fight to strip it back out on every reconcile,
  // which ping-pongs against our setExpandedItems and spins an infinite render loop.
  const expandedItems = useMemo(() => allFolders.filter((f) => !collapsed.has(f)), [allFolders, collapsed])

  // Stable data-loader identity so the per-render setConfig doesn't churn the sync loader's cache.
  const dataLoader = useMemo(
    () => ({
      getItem: (id: string) =>
        id === '' ? ({ relPath: '', name: '', type: 'folder', children: storyTree } as StoryNode) : index.get(id)!,
      getChildren: (id: string) => {
        const node = id === '' ? { children: storyTree } : index.get(id)
        return (node?.children ?? []).filter((c) => !(c.type === 'scene' && c.phase === 'archived')).map((c) => c.relPath)
      }
    }),
    [index, storyTree]
  )

  const [menu, setMenu] = useState<MenuState>(null)
  const [creating, setCreating] = useState<CreateState>(null)
  const [createError, setCreateError] = useState<string | null>(null) // inline warning under the "new…" input
  const [renaming, setRenaming] = useState<string | null>(null) // relPath
  const [renameError, setRenameError] = useState<string | null>(null) // inline warning under the rename input (folder dup)
  const [confirm, setConfirm] = useState<StoryNode | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<StoryNode[] | null>(null) // pending bulk-delete confirmation
  // Multi-selection is OURS (a plain Set of relPaths) — one source of truth for both the highlight and the bulk
  // menu, following the standard list algorithm (ctrl toggles, shift ranges from the anchor over the visible order).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const anchorRef = useRef<string | null>(null)

  // ── headless-tree instance ────────────────────────────────────────────────────
  // Stable hotkeys object (see TREE_FEATURES) — the F2 handler reads the latest `beginRename` through a ref so
  // the object identity never changes across renders.
  const renameRef = useRef<(rel: string) => void>(() => {})
  const hotkeys = useMemo(
    () => ({
      // renamingFeature isn't loaded (we use the custom inline input with dup-error handling), so bind F2 ourselves.
      customRename: {
        hotkey: 'F2',
        handler: (_e: KeyboardEvent, t: TreeInstance<StoryNode>) => {
          const f = t.getFocusedItem()
          const d = f?.getItemData()
          if (d && !d.protected) renameRef.current(f.getId())
        }
      }
    }),
    []
  )
  const tree = useTree<StoryNode>({
    rootItemId: '',
    // expandedItems is controlled (persisted); selectedItems is left to headless-tree's own selectionFeature —
    // the single source of truth for multi-select (read back via tree.getState().selectedItems / item.isSelected).
    state: { expandedItems },
    setExpandedItems: (updater) => {
      const next = typeof updater === 'function' ? updater(expandedItems) : updater
      const nextSet = new Set(next)
      setSceneCollapsed(allFolders.filter((f) => !nextSet.has(f))) // persist the inverse
    },
    getItemName: (item) => {
      const d = item.getItemData()
      if (!d) return ''
      return (d.type === 'scene' ? d.title ?? d.name : d.name) ?? ''
    },
    isItemFolder: (item) => item.getItemData()?.type === 'folder',
    onPrimaryAction: (item) => {
      // keyboard Enter / double-click: open a scene, toggle a folder
      const d = item.getItemData()
      if (d.type === 'scene') void openScene(d)
      else item.isExpanded() ? item.collapse() : item.expand()
    },
    canDrag: (items) => items.every((i) => !i.getItemData().protected),
    canDrop: (items, target) => {
      const dragRel = items[0]?.getId()
      const t = target.item.getId()
      if (dragRel == null) return false
      if (t === dragRel || t.startsWith(dragRel + '/')) return false // never into itself or its own subtree
      // An "into" (unordered) target MUST be a folder — headless-tree otherwise offers a scene's middle as a
      // drop-inside target, and moving a scene inside a scene makes the engine mkdir a path under a .md file
      // (EEXIST crash). Reorders (ordered targets, whose item is the parent) are unaffected.
      if (!isOrderedDragTarget(target) && target.item.getItemData()?.type !== 'folder') return false
      return true
    },
    reorderAreaPercentage: 0.2, // top/bottom 20% of a folder reorder before/after; the middle 60% drops inside
    onDrop: (items, target) => void performDrop(items, target),
    indent: 12,
    dataLoader,
    hotkeys,
    features: TREE_FEATURES
  })
  renameRef.current = beginRename // keep the F2 handler pointed at the latest closure

  // Sync external store → the imperative tree WITHOUT a useEffect: rebuild only when the store swaps the tree
  // reference. Guarded by a ref so it fires once per change (no render loop). This is the derived-during-render
  // escape hatch, kept effect-free by house rule.
  const lastTree = useRef<StoryNode[] | null>(null)
  if (lastTree.current !== storyTree) {
    lastTree.current = storyTree
    tree.rebuildTree()
  }

  const openScene = (d: StoryNode): Promise<void> => openPage({ path: d.path!, title: d.title ?? d.name, kind: 'scene' })
  const selectedRels: string[] = [...selectedIds]

  // A row click: ⌘/Ctrl toggles this row, Shift extends a range from the anchor over the visible order, a plain
  // click clears the selection and does the row's default (open a scene / toggle a folder). Focus always follows.
  const onRowClick = (item: ItemInstance<StoryNode>, e: React.MouseEvent, plain: () => void): void => {
    const id = item.getId()
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
      anchorRef.current = id
    } else if (e.shiftKey && anchorRef.current) {
      const ids = tree.getItems().map((i) => i.getId()) // flat, visible order
      const a = ids.indexOf(anchorRef.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedIds(new Set(ids.slice(lo, hi + 1)))
      }
    } else {
      // VS Code: a plain click SELECTS just this row (not an empty set) and opens it — so the open/active row is
      // always part of the selection, and ctrl-clicking others extends from it (was the "bulk skips the active
      // page" bug: clearing to empty here left the opened row out of every subsequent selection).
      setSelectedIds(new Set([id]))
      anchorRef.current = id
      plain()
    }
    item.setFocused()
  }

  // Full tree always shown; search is a jump-to popover — pick a scene to open it, a folder to reveal it.
  const searchResults = (query: string): SearchResult[] => {
    const lc = query.trim().toLowerCase()
    if (!lc) return []
    const out: SearchResult[] = []
    const walk = (nodes: StoryNode[], trail: string[]): void => {
      for (const n of nodes) {
        if (n.type === 'scene') {
          const name = n.title ?? n.name
          if (n.phase !== 'archived' && name.toLowerCase().includes(lc))
            out.push({ id: 'scene:' + n.path, label: name, icon: <FileText className="size-3 shrink-0 text-faint" />, meta: trail.join(' · ') || undefined })
        } else {
          if (n.name.toLowerCase().includes(lc))
            out.push({ id: 'folder:' + n.relPath, label: n.name, icon: <Folder className="size-3 shrink-0 text-faint" />, meta: trail.join(' · ') || undefined })
          walk(n.children ?? [], [...trail, n.name])
        }
      }
    }
    walk(storyTree, [])
    return out
  }
  const onSearchSelect = (id: string): void => {
    if (id.startsWith('scene:')) {
      const node = findByPath(storyTree, id.slice('scene:'.length))
      if (node) void openPage({ path: node.path, title: node.title ?? node.name, kind: 'scene' })
    } else {
      // reveal a folder: uncollapse it and every ancestor down the path
      const rel = id.slice('folder:'.length)
      const next = new Set(collapsed)
      let acc = ''
      for (const part of rel.split('/')) {
        acc = acc ? `${acc}/${part}` : part
        next.delete(acc)
      }
      setSceneCollapsed([...next])
    }
  }

  function openMenu(e: React.MouseEvent, node: StoryNode | null): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  function cancelCreate(): void {
    setCreating(null)
    setCreateError(null)
  }

  function beginCreate(parentRel: string, type: 'folder' | 'scene', container?: string): void {
    const n = new Set(collapsed)
    n.delete(parentRel) // reveal the parent so the new child is visible
    setSceneCollapsed([...n])
    setCreating({ parentRel, type, container })
    setCreateError(null)
    setMenu(null)
  }

  function beginRename(rel: string): void {
    setRenaming(rel)
    setRenameError(null)
    setMenu(null)
  }
  function cancelRename(): void {
    setRenaming(null)
    setRenameError(null)
  }

  async function submitCreate(name: string): Promise<void> {
    if (!creating) return
    const trimmed = name.trim()
    if (!trimmed) return cancelCreate()
    const ok =
      creating.type === 'folder'
        ? await createFolder(creating.parentRel, trimmed, creating.container)
        : await createSceneInFolder(creating.parentRel, trimmed)
    if (ok) return cancelCreate()
    // Creation bounced — keep the input open and say why instead of silently discarding what they typed. A
    // matching sibling name is by far the common cause (case-insensitive on macOS/Windows fs); otherwise the
    // name had characters the folder/file couldn't take.
    const parent = creating.parentRel === '' ? { children: storyTree } : findNode(storyTree, creating.parentRel)
    const siblings = parent?.children ?? []
    const dup =
      creating.type === 'folder'
        ? siblings.some((c) => c.type === 'folder' && c.name.toLowerCase() === trimmed.toLowerCase())
        : siblings.some((c) => c.type === 'scene' && c.name.toLowerCase() === slugify(trimmed).toLowerCase())
    setCreateError(
      dup
        ? t('error.dupExists', { kind: t(`kind.${creating.type}`), name: trimmed })
        : t('error.badName', { kind: t(`kind.${creating.type}`), name: trimmed })
    )
  }

  async function submitRename(node: StoryNode, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      cancelRename()
      return
    }
    if (node.type === 'scene') {
      // A scene rename is a TITLE change (identity is the slug/id) — titles may repeat, so it can't bounce. Persist
      // even when `trimmed` matches the shown label: that label may only be the DEFAULTED filename (no `title` in
      // frontmatter), so writing it is what actually SAVES the name — the `=== current` no-op couldn't.
      await retitleScene(node.path, trimmed)
      cancelRename()
      return
    }
    const current = node.name
    if (trimmed === current) {
      cancelRename()
      return
    }
    // A folder rename changes the folder slug → it can bounce on a duplicate sibling (or an unusable name). Mirror
    // the create fix: keep the input open with a precise inline warning instead of silently discarding the edit.
    const parent = parentOf(node.relPath)
    const ok = await renamePath(node.relPath, parent ? `${parent}/${trimmed}` : trimmed)
    if (ok) {
      cancelRename()
      return
    }
    const siblings = (parent === '' ? { children: storyTree } : findNode(storyTree, parent))?.children ?? []
    const dup = siblings.some((c) => c.type === 'folder' && c.relPath !== node.relPath && c.name.toLowerCase() === trimmed.toLowerCase())
    setRenameError(
      dup
        ? t('error.dupExists', { kind: t('kind.folder'), name: trimmed })
        : t('error.badName', { kind: t('kind.folder'), name: trimmed })
    )
  }

  // ── drag: reorder (drop between siblings) + move (drop onto a folder) ────────────
  // Move a set of relPaths INTO a folder (raw IPC per file, ONE refresh), then pin the moved files to the TOP of
  // the target's .order (the tree is order-sensitive → moved-in files otherwise sort to the bottom). Shared by the
  // right-click bulk move AND multi-drag.
  const moveInto = async (folderRel: string, rels: string[]): Promise<void> => {
    const set = topMost(rels).filter((rel) => folderRel !== parentOf(rel) && folderRel !== rel && !folderRel.startsWith(rel + '/'))
    const moved: string[] = []
    for (const rel of set) {
      try {
        if (await window.nvs.renamePath(rel, joinRel(folderRel, baseName(rel)))) moved.push(baseName(rel))
      } catch {
        /* collision / bad name → skip that one */
      }
    }
    await refreshStoryTree()
    if (moved.length) {
      const fresh = useWorkspace.getState().storyTree
      const bases = ((folderRel === '' ? fresh : findNode(fresh, folderRel)?.children) ?? []).map((c) => baseName(c.relPath))
      await reorder(folderRel, [...moved.filter((nm) => bases.includes(nm)), ...bases.filter((nm) => !moved.includes(nm))])
    }
  }

  async function performDrop(items: ItemInstance<StoryNode>[], target: DragTarget<StoryNode>): Promise<void> {
    const dragRel = items[0]?.getId()
    if (!dragRel) return
    // The dragged set: the whole selection if the grabbed row is part of it, else just the grabbed row — sorted
    // into VISIBLE order so a multi-drag lands in the order the rows appear, not the order they were clicked.
    const visOrder = new Map(tree.getItems().map((it, i) => [it.getId(), i]))
    const dragging = (selectedIds.has(dragRel) && selectedIds.size > 1 ? topMost([...selectedIds]) : [dragRel]).sort(
      (a, b) => (visOrder.get(a) ?? 0) - (visOrder.get(b) ?? 0)
    )

    // Dropped ONTO a folder (unordered target) → a pure move into it. Only a FOLDER can be an "into" target.
    if (!isOrderedDragTarget(target)) {
      if (target.item.getItemData()?.type !== 'folder') return
      await moveInto(target.item.getId(), dragging)
      if (selectedIds.size > 1) setSelectedIds(new Set())
      return
    }

    // Dropped BETWEEN siblings (ordered target → the item is the PARENT). The dragged group lands, in visible
    // order, right after the last non-dragged sibling before the drop line (or at the top). Cross-folder draggees
    // are moved in first, then the parent's .order is rewritten in one shot.
    const parentRel = target.item.getId()
    const dragSet = new Set(dragging.map(baseName))
    const preBases = dataLoader.getChildren(parentRel).map(baseName) // current order, BEFORE any move
    let anchorBase: string | null = null
    for (let i = Math.min(target.childIndex, preBases.length) - 1; i >= 0; i--) {
      if (!dragSet.has(preBases[i])) {
        anchorBase = preBases[i]
        break
      }
    }
    for (const rel of dragging) {
      if (parentOf(rel) !== parentRel) {
        const dest = joinRel(parentRel, baseName(rel))
        if (dest !== rel) {
          try {
            await window.nvs.renamePath(rel, dest)
          } catch {
            /* collision → skip that one */
          }
        }
      }
    }
    await refreshStoryTree()
    const fresh = useWorkspace.getState().storyTree
    const fullBases = ((parentRel === '' ? fresh : findNode(fresh, parentRel)?.children) ?? []).map((c) => baseName(c.relPath))
    const rest = fullBases.filter((nm) => !dragSet.has(nm))
    const anchorPos = anchorBase ? rest.indexOf(anchorBase) : -1
    rest.splice(anchorPos + 1, 0, ...dragging.map(baseName).filter((nm) => fullBases.includes(nm)))
    await reorder(parentRel, rest)
    if (selectedIds.size > 1) setSelectedIds(new Set())
  }

  // ── row rendering ───────────────────────────────────────────────────────────────
  function renderItem(item: ItemInstance<StoryNode>): JSX.Element {
    const d = item.getItemData()
    if (!d) return <Fragment /> // data momentarily missing during a rebuild — skip rather than crash
    const level = item.getItemMeta().level
    const pad = 8 + level * 12
    // headless-tree's own onClick selects/focuses; we override with single-click-opens, so strip it and keep the
    // rest (draggable, drag handlers, keydown, tabindex, role, aria) for the OUTER row element.
    const { onClick: _dropClick, ...rowProps } = item.getProps()

    if (renaming === item.getId()) {
      return (
        <NewInput
          depth={level}
          initial={d.type === 'scene' ? d.title ?? d.name : d.name}
          placeholder={d.type === 'scene' ? t('placeholder.sceneTitle') : t('placeholder.folderName')}
          error={d.type === 'folder' ? renameError : null}
          onSubmit={(n) => void submitRename(d, n)}
          onCancel={cancelRename}
        />
      )
    }

    if (d.type === 'scene') {
      const active = activePath === d.path
      const isOpen = openPaths.has(d.path)
      return (
        <DetailedRow
          buttonRef={item.registerElement}
          focused={item.isFocused()}
          active={active}
          open={isOpen}
          selected={selectedIds.has(item.getId())}
          phase={d.phase ?? defaultPhase('scene')}
          indent={pad}
          leading={<IndentGuides level={level} />}
          buttonProps={rowProps} // headless-tree's drag/keyboard/aria props — must ride on the button (grab surface)
          onClick={(e) => onRowClick(item, e, () => void openScene(d))}
          onContextMenu={(e) => openMenu(e, d)}
          icon={<FileText className={cn('size-3 shrink-0', active || isOpen ? 'text-muted-foreground' : 'text-faint')} />}
          label={d.title ?? d.name}
          labelClassName={cn(active ? 'text-foreground' : isOpen && 'text-foreground/90')}
          actions={<RowActions onArchive={() => void setPagePhase(d.path, 'archived')} onDelete={() => setConfirm(d)} />}
        />
      )
    }

    // folder
    const folderArchived = collectArchived(d.children ?? []).length
    return (
      <div
        className={cn(
          'group/row relative flex items-center transition-colors',
          selectedIds.has(item.getId()) && 'bg-thread/15 ring-1 ring-inset ring-thread/50', // multi-selection
          item.isFocused() && !selectedIds.has(item.getId()) && 'ring-1 ring-inset ring-thread/40',
          item.isUnorderedDragTarget() && 'bg-thread/15 ring-1 ring-inset ring-thread/60' // dragging INTO this folder
        )}
      >
        <IndentGuides level={level} />
        <button
          {...rowProps}
          ref={item.registerElement}
          onClick={(e) => onRowClick(item, e, () => (item.isExpanded() ? item.collapse() : item.expand()))}
          onContextMenu={(e) => openMenu(e, d)}
          style={{ ...rowProps.style, paddingLeft: pad }}
          className="flex w-full items-center gap-1 py-1 pr-3 text-left hover:bg-panel-soft"
        >
          {item.isExpanded() ? <ChevronDown className="size-3 shrink-0 text-faint" /> : <ChevronRight className="size-3 shrink-0 text-faint" />}
          {item.isExpanded() ? <FolderOpen className="size-3 shrink-0 text-faint" /> : <Folder className="size-3 shrink-0 text-faint" />}
          <span className="min-w-0 truncate text-[12px] text-foreground/90">{d.name}</span>
          {d.containerType && (
            <span className="ladder-chip shrink-0 rounded border px-1 text-[8px] uppercase tracking-wide" style={{ ['--chip']: levelColorHex(d.containerType) ?? '#94a3b8' } as React.CSSProperties}>{d.containerType}</span>
          )}
          <span className="flex-1" />
          {folderArchived > 0 && (
            <span
              title={t('tooltip.archivedInside', { count: folderArchived })}
              className="flex shrink-0 items-center gap-0.5 text-[9px] text-faint"
            >
              <Archive className="size-2.5" />
              {folderArchived}
            </span>
          )}
          {d.protected && <span className="font-mono text-[8px] uppercase text-faint/60">{t('badge.locked')}</span>}
        </button>
      </div>
    )
  }

  const items = tree.getItems()

  return (
    <div
      {...regionAttrs('sceneNavigator')}
      className="flex h-full flex-col overflow-auto bg-panel pb-3"
      onContextMenu={(e) => openMenu(e, null)}
    >
      <SidebarHeader
        title={t('title')}
        className="group/story"
        search={{ results: searchResults, onSelect: onSearchSelect, placeholder: t('search.placeholder') }}
        action={
          <>
            <button
              title={t('action.expandAll')}
              onClick={() => setSceneCollapsed([])}
              className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-panel-soft hover:text-foreground group-hover/story:opacity-100"
            >
              <ListTree className="size-3.5" />
            </button>
            <button
              title={t('action.collapseAll')}
              onClick={() => setSceneCollapsed(allFolders)}
              className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-panel-soft hover:text-foreground group-hover/story:opacity-100"
            >
              <FoldVertical className="size-3.5" />
            </button>
            <button
              title={t('action.new')}
              onClick={(e) => openMenu(e, null)}
              className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-panel-soft hover:text-foreground group-hover/story:opacity-100"
            >
              <Plus className="size-3.5" />
            </button>
          </>
        }
      />

      {creating?.parentRel === '' && (
        <NewInput
          depth={0}
          placeholder={creating.type === 'folder' ? t('placeholder.folderName') : t('placeholder.sceneTitle')}
          error={createError}
          onSubmit={(n) => void submitCreate(n)}
          onCancel={cancelCreate}
        />
      )}

      {items.length === 0 && !creating ? (
        typeof window.nvs.listStoryTree !== 'function' ? (
          <p className="px-3 text-xs leading-relaxed text-flag">
            {t('empty.relaunch')}
          </p>
        ) : storyTree.length === 0 ? (
          <p className="px-3 text-xs leading-relaxed text-muted-foreground">
            {t('empty.hintPrefix')} <Plus className="inline size-3" /> {t('empty.hintSuffix')}
          </p>
        ) : null
      ) : (
        <div ref={tree.registerElement} {...tree.getContainerProps(t('title'))} className="group/tree relative">
          {items.map((item) => (
            <Fragment key={item.getId()}>
              {renderItem(item)}
              {/* inline "new…" input under this folder (new items land at the top of the parent's order) */}
              {creating?.parentRel === item.getId() && item.isExpanded() && item.getItemData()?.type === 'folder' && (
                <NewInput
                  depth={item.getItemMeta().level + 1}
                  placeholder={creating.type === 'folder' ? t('placeholder.folderName') : t('placeholder.sceneTitle')}
                  error={createError}
                  onSubmit={(n) => void submitCreate(n)}
                  onCancel={cancelCreate}
                />
              )}
            </Fragment>
          ))}
          {/* the single insertion line shown while dragging between siblings */}
          {tree.getDragLineData() && (
            <div style={tree.getDragLineStyle()} className="pointer-events-none absolute z-20 flex items-center">
              <span className="size-1.5 shrink-0 rounded-full bg-thread" />
              <span className="h-0.5 flex-1 rounded-full bg-thread" />
            </div>
          )}
        </div>
      )}

      {/* Archived bin — cut scenes, lifted out of their folders into one collapsed list (mirrors the World rail). */}
      {archivedScenes.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => setArchivedOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-panel-soft"
          >
            {archivedOpen ? (
              <ChevronDown className="size-3 shrink-0 text-faint" />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-faint" />
            )}
            <Archive className="size-3 shrink-0 text-faint" />
            <span className="flex-1 text-[10px] uppercase tracking-wide text-faint">{t('archived.heading')}</span>
            <span className="font-mono text-[9px] text-faint/50">{archivedScenes.length}</span>
          </button>
          {archivedOpen &&
            archivedScenes.map((node) => (
              <ArchivedSceneRow
                key={node.path}
                node={node}
                active={activePath === node.path}
                onOpen={() => void openPage({ path: node.path, title: node.title ?? node.name, kind: 'scene' })}
                onRestore={() => void setPagePhase(node.path, 'developing')}
                onDelete={() => setConfirm(node)}
                onMenu={(e) => openMenu(e, node)}
              />
            ))}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          node={menu.node}
          onClose={() => setMenu(null)}
          onNewFolder={(rel, container) => beginCreate(rel, 'folder', container)}
          onNewScene={(rel) => beginCreate(rel, 'scene')}
          onRename={(node) => beginRename(node.relPath)}
          onDelete={(node) => {
            setConfirm(node)
            setMenu(null)
          }}
          onSetPhase={(node, phase) => {
            void setPagePhase(node.path, phase)
            setMenu(null)
          }}
          onSetPhaseBulk={(node, phase) => {
            // every scene beneath the folder — the 1000-scene canon answer (one re-ingest for the batch)
            const collect = (n: StoryNode): string[] => (n.type === 'scene' ? [n.path] : (n.children ?? []).flatMap(collect))
            void setPagePhaseBulk(collect(node), phase)
            setMenu(null)
          }}
          onExportScene={(node) => {
            void exportScene(node.path)
            setMenu(null)
          }}
          onSetType={(node, type) => {
            void setFolderType(node.relPath, type)
            setMenu(null)
          }}
          // ── bulk (2+ selected, right-clicked row is in the selection) ──
          selection={
            menu.node && selectedRels.includes(menu.node.relPath) && selectedRels.length >= 2
              ? selectedRels.map((r) => index.get(r)).filter((n): n is StoryNode => !!n)
              : []
          }
          folders={[{ rel: '', name: t('folder.root') }, ...allFolders.map((r) => ({ rel: r, name: r }))]}
          onBulkPhase={(phase) => {
            const nodes = selectedRels.map((r) => index.get(r)).filter((n): n is StoryNode => !!n)
            void setPagePhaseBulk([...new Set(nodes.flatMap(collectScenePaths))], phase)
            setSelectedIds(new Set())
            setMenu(null)
          }}
          onBulkMove={(folderRel) => {
            const rels = [...selectedRels]
            setMenu(null)
            setSelectedIds(new Set())
            void moveInto(folderRel, rels)
          }}
          onBulkDelete={() => {
            setBulkConfirm(topMost(selectedRels).map((r) => index.get(r)).filter((n): n is StoryNode => !!n))
            setMenu(null)
          }}
        />
      )}

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.type === 'folder' ? t('confirm.titleFolder') : t('confirm.titleScene')}
        danger
        confirmLabel={t('confirm.delete')}
        message={
          <>
            {t('confirm.prefix')} <span className="text-foreground">{confirm?.title ?? confirm?.name}</span>
            {confirm?.type === 'folder' ? t('confirm.folderInside') : ''}{t('confirm.suffix')}
            {(() => {
              const n = confirm?.type === 'folder' ? collectArchived(confirm.children ?? []).length : 0
              return n > 0 ? (
                <span className="mt-1.5 block text-flag">
                  {t('confirm.alsoArchived', { count: n })}
                </span>
              ) : null
            })()}
          </>
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void deleteStoryPath(confirm.relPath)
          setConfirm(null)
        }}
      />

      <ConfirmDialog
        open={bulkConfirm != null}
        title={t('bulkConfirm.title', { count: bulkConfirm?.length ?? 0 })}
        danger
        confirmLabel={t('confirm.delete')}
        message={
          <>
            {t('bulkConfirm.prefix')} <span className="text-foreground">{bulkConfirm?.length ?? 0}</span>{' '}
            {t('bulkConfirm.suffix', { count: bulkConfirm?.length ?? 0 })}
          </>
        }
        onCancel={() => setBulkConfirm(null)}
        onConfirm={() => {
          const items = bulkConfirm ?? []
          setBulkConfirm(null)
          void (async () => {
            for (const it of items) await deleteStoryPath(it.relPath)
            setSelectedIds(new Set())
          })()
        }}
      />
    </div>
  )
}

/** A row in the Archived bin — flat (no folder indent), muted, with restore + delete shortcuts. */
function ArchivedSceneRow({
  node,
  active,
  onOpen,
  onRestore,
  onDelete,
  onMenu
}: {
  node: StoryNode
  active: boolean
  onOpen: () => void
  onRestore: () => void
  onDelete: () => void
  onMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const { t } = useTranslation('sceneNav')
  return (
    <div className={cn('group/row relative flex items-center transition-colors hover:bg-panel-soft', active && 'bg-panel-soft')}>
      <span className={cn('pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-1', PHASE_META.archived.dot)} />
      <button onClick={onOpen} onContextMenu={onMenu} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-3 pr-2 text-left text-[13px]">
        <FileText className="size-3 shrink-0 text-faint" />
        <span className={cn('truncate', active ? 'text-foreground/90' : 'text-muted-foreground')}>{node.title ?? node.name}</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 transition-opacity group-hover/row:opacity-100">
        <button title={t('row.restore')} onClick={(e) => { e.stopPropagation(); onRestore() }} className="rounded p-0.5 text-faint hover:text-foreground"><ArchiveRestore className="size-3" /></button>
        <button title={t('row.delete')} onClick={(e) => { e.stopPropagation(); onDelete() }} className="rounded p-0.5 text-faint hover:text-flag"><Trash2 className="size-3" /></button>
      </div>
    </div>
  )
}

/** Inline hover shortcuts on a scene row — archive (→ phase archived) + delete. Mirrors the World rail. */
function RowActions({ onArchive, onDelete }: { onArchive: () => void; onDelete: () => void }): JSX.Element {
  const { t } = useTranslation('sceneNav')
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 transition-opacity group-hover/row:opacity-100">
      <button
        title={t('row.archive')}
        onClick={(e) => {
          e.stopPropagation()
          onArchive()
        }}
        className="rounded p-0.5 text-faint hover:text-foreground"
      >
        <Archive className="size-3" />
      </button>
      <button
        title={t('row.delete')}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="rounded p-0.5 text-faint hover:text-flag"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

// ── context menu ──────────────────────────────────────────────────────────────

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onNewFolder,
  onNewScene,
  onRename,
  onDelete,
  onSetPhase,
  onSetPhaseBulk,
  onExportScene,
  onSetType,
  selection,
  folders,
  onBulkPhase,
  onBulkMove,
  onBulkDelete
}: {
  x: number
  y: number
  node: StoryNode | null // null = root
  onClose: () => void
  onNewFolder: (parentRel: string, container?: string) => void
  onNewScene: (parentRel: string) => void
  onRename: (n: StoryNode) => void
  onDelete: (n: StoryNode) => void
  onSetPhase: (n: StoryNode, phase: string) => void
  onSetPhaseBulk: (n: StoryNode, phase: string) => void // folder → every scene beneath it
  onExportScene: (n: StoryNode) => void
  onSetType: (n: StoryNode, type: string | null) => void
  selection: StoryNode[] // non-empty (2+) → show the BULK menu instead of the single-node one
  folders: { rel: string; name: string }[] // move-to-folder targets (root + every folder)
  onBulkPhase: (phase: string) => void
  onBulkMove: (folderRel: string) => void
  onBulkDelete: () => void
}): JSX.Element {
  const { t } = useTranslation('sceneNav')
  const [showFolders, setShowFolders] = useState(false)
  // Where "new" items go: inside a folder, beside a scene (its parent), or root.
  const parentRel =
    node == null ? '' : node.type === 'folder' ? node.relPath : node.relPath.split('/').slice(0, -1).join('/')
  const canEdit = node != null && !node.protected

  // BULK menu — the right-clicked row is part of a 2+ selection.
  if (selection.length >= 2) {
    return (
      <ContextMenuShell x={x} y={y} onClose={onClose}>
        <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{t('menu.selectedCount', { count: selection.length })}</div>
        <MenuSeparator />
        <PhaseSection current="" label={t('menu.setPhase')} onSet={onBulkPhase} />
        <MenuSeparator />
        <MenuItem label={t('menu.moveToFolder')} onClick={() => setShowFolders((v) => !v)} />
        {showFolders && (
          <div className="max-h-48 overflow-y-auto border-y border-border">
            {folders.map((f) => (
              <button
                key={f.rel || '(root)'}
                onMouseDown={(e) => { e.preventDefault(); onBulkMove(f.rel) }}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-foreground hover:bg-panel-soft"
              >
                <Folder className="size-3 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}
        <MenuSeparator />
        <MenuItem label={t('menu.bulkDelete', { count: selection.length })} danger onClick={onBulkDelete} />
      </ContextMenuShell>
    )
  }

  return (
    <ContextMenuShell x={x} y={y} onClose={onClose}>
      {/* Free-form: make a folder or a scene anywhere (suggested, not enforced). */}
      <MenuItem label={t('menu.newScene')} onClick={() => onNewScene(parentRel)} />
      <MenuItem label={t('menu.newFolder')} onClick={() => onNewFolder(parentRel)} />
      {/* optional soft label: shade a folder with a ladder level (colour swatch, Cast-style — no constraint) */}
      {node?.type === 'folder' && (
        <>
          <MenuSeparator />
          <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{t('menu.labelAs')}</div>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-1">
            {STORY_LADDER.map((lvl) => (
              <button
                key={lvl.key}
                title={lvl.label}
                onMouseDown={(e) => { e.preventDefault(); onSetType(node, lvl.key) }}
                className={cn('size-4 rounded-full border-2 transition-colors', node.containerType === lvl.key ? 'border-foreground' : 'border-transparent hover:border-border')}
                style={{ backgroundColor: lvl.color }}
              />
            ))}
            {node.containerType && (
              <button onMouseDown={(e) => { e.preventDefault(); onSetType(node, null) }} className="ml-0.5 text-[10px] text-faint hover:text-foreground">{t('menu.clear')}</button>
            )}
          </div>
        </>
      )}
      <MenuSeparator />
      {node?.type === 'scene' && <PhaseSection current={node.phase ?? defaultPhase('scene')} onSet={(p) => onSetPhase(node, p)} />}
      {/* folder → bulk phase for every scene beneath (the 1000-scene canon answer); no current check — a folder is mixed */}
      {node?.type === 'folder' && !node.protected && <PhaseSection current="" label={t('menu.phaseEveryScene')} onSet={(p) => onSetPhaseBulk(node, p)} />}
      {node?.type === 'scene' && <MenuSeparator />}
      {node?.type === 'scene' && <MenuItem label={t('menu.exportMd')} onClick={() => onExportScene(node)} />}
      {canEdit && <MenuSeparator />}
      {canEdit && <MenuItem label={t('menu.rename')} onClick={() => onRename(node!)} />}
      {canEdit && <MenuItem label={t('menu.delete')} danger onClick={() => onDelete(node!)} />}
    </ContextMenuShell>
  )
}

// ── inline input ──────────────────────────────────────────────────────────────

function NewInput({
  depth,
  placeholder,
  initial = '',
  error,
  onSubmit,
  onCancel
}: {
  depth: number
  placeholder: string
  initial?: string
  error?: string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <div style={{ paddingLeft: 8 + depth * 12 }} className="py-1 pr-3">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          else if (e.key === 'Escape') onCancel()
        }}
        // Don't discard-on-blur while an error is showing — the input just bounced, so blurring away must not
        // silently throw away what they typed. Keep it open so they can fix the name (or Esc to dismiss).
        onBlur={() => {
          if (error) return
          value.trim() && value !== initial ? onSubmit(value) : onCancel()
        }}
        className={cn(
          'w-full rounded border bg-canvas px-1.5 py-0.5 text-[13px] text-foreground outline-none',
          error ? 'border-flag focus:border-flag' : 'border-border focus:border-thread'
        )}
      />
      {error && <p className="mt-1 pl-1.5 text-[11px] leading-tight text-flag">{error}</p>}
    </div>
  )
}

// Re-export for Sidebar's WorldNavigator chip link
export type { SceneFile } from '@shared/ipc'
