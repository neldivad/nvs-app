import { useMemo, useState, type JSX } from 'react';
import { Trans, useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { ChevronDown, ChevronRight, Plus, Trash2, Archive, ArchiveRestore, Key } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { SidebarHeader, DetailedRow } from '@/components/layout/SidebarKit'
import { entityVisual } from '@/config/entityVisual'
import { worldCategoriesFor, DEFAULT_WORLD_KEYS } from '@shared/config/worldCategories'
import { ConfirmDialog } from '@/components/ui/confirm'
import { ContextMenuShell, MenuItem, MenuSeparator, PhaseSection } from '@/components/layout/RailContextMenu'
import type { SearchResult } from '@/components/ui/SearchPopover'
import type { PageRef, WorldPage } from '@shared/ipc'

/** A world page's row glyph: its avatar THUMBNAIL if the page has one (served via nvs-asset), else the kind's
 *  icon — so a character with a portrait shows it, matching the Cast rail. */
function pageIcon(p: WorldPage, iconClassName: string): JSX.Element {
  if (p.avatar) return <img src={`nvs-asset://${p.avatar}`} alt="" className="size-4 shrink-0 rounded-full object-cover" />
  const { Icon } = entityVisual(p.kind)
  return <Icon className={iconClassName} />
}

/** World bible sidebar — groups by kind, each collapsible/creatable, with an Archived section. */
export function WorldNavigator(): JSX.Element {
  const worldPages = useWorkspace((s) => s.worldPages)
  const activePath = useWorkspace((s) => s.activePage?.path)
  const openPage = useWorkspace((s) => s.openPage)
  const createWorldPage = useWorkspace((s) => s.createWorldPage)
  const deletePage = useWorkspace((s) => s.deletePage)
  const setPagePhase = useWorkspace((s) => s.setPagePhase)
  const setPagePhaseBulk = useWorkspace((s) => s.setPagePhaseBulk)
  const renameWorldPage = useWorkspace((s) => s.renameWorldPage)
  const exportScene = useWorkspace((s) => s.exportScene)
  const worldCats = useWorkspace((s) => s.structure.world)
  const { t } = useTranslation('worldNav')

  // The rail's sections/create-options come from the project STRUCTURE (bounded enum, world domain), not a hardcoded
  // list — custom categories appear, creation is constrained to them. Falls back to the core defaults pre-load.
  const cats = worldCats.length ? worldCats : worldCategoriesFor(DEFAULT_WORLD_KEYS)
  const groups = cats.map((c) => ({ kind: c.key, label: c.label, Icon: entityVisual(c.key).Icon }))

  // Collapse memory persisted per-work (ui-state.json). null = never set → seed the default: every category
  // collapsed except the first non-empty one (Archived always starts collapsed). Every toggle saves the set.
  const persistedCollapsed = useWorkspace((s) => s.worldCollapsed)
  const setWorldCollapsed = useWorkspace((s) => s.setWorldCollapsed)
  const collapsed = useMemo(() => {
    if (persistedCollapsed != null) return new Set(persistedCollapsed)
    const firstOpen = groups.find((g) => worldPages.some((p) => p.kind === g.kind && p.phase !== 'archived'))?.kind
    const seed = new Set<string>(['archived'])
    for (const g of groups) if (g.kind !== firstOpen) seed.add(g.kind)
    return seed
  }, [persistedCollapsed, groups, worldPages])
  // The rail always shows the full bible; search is a jump-to that opens the picked page (a "remote row-click").
  const searchResults = (query: string): SearchResult[] => {
    const s = query.trim().toLowerCase()
    if (!s) return []
    return worldPages
      .filter((p) => p.name.toLowerCase().includes(s))
      .map((p) => ({ id: p.path, label: p.name, icon: pageIcon(p, 'size-3.5 shrink-0 text-faint'), meta: groups.find((g) => g.kind === p.kind)?.label }))
  }
  const onSearchSelect = (path: string): void => {
    const p = worldPages.find((w) => w.path === path)
    if (p) void openPage(toRef(p))
  }
  const [creating, setCreating] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<WorldPage | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; page: WorldPage } | null>(null)
  const [catMenu, setCatMenu] = useState<{ x: number; y: number; kind: string; label: string } | null>(null)
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number } | null>(null) // right-click empty rail → New <category>
  const [renaming, setRenaming] = useState<string | null>(null) // page path being renamed inline

  function openMenu(e: React.MouseEvent, page: WorldPage): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, page })
  }

  function toggle(key: string): void {
    const next = new Set(collapsed)
    next.has(key) ? next.delete(key) : next.add(key)
    setWorldCollapsed([...next])
  }

  function beginCreate(kind: string): void {
    const next = new Set(collapsed)
    next.delete(kind) // reveal the category so the new page is visible
    setWorldCollapsed([...next])
    setError(null)
    setCreating(kind)
  }

  async function submitNew(kind: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreating(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const page = await createWorldPage(kind, trimmed)
      if (page) setCreating(null)
      else setError(t('createError', { name: trimmed }))
    } finally {
      setBusy(false)
    }
  }

  const archived = worldPages.filter((p) => p.phase === 'archived')

  return (
    <div
      {...regionAttrs('worldNavigator')}
      className="flex h-full flex-col overflow-auto bg-panel pb-3"
      onContextMenu={(e) => { e.preventDefault(); setCreateMenu({ x: e.clientX, y: e.clientY }) }}
    >
      <SidebarHeader
        title={t('title')}
        count={worldPages.length}
        search={{ results: searchResults, onSelect: onSearchSelect, placeholder: t('searchPlaceholder') }}
      />
      {groups.map(({ kind, label, Icon }) => {
        const items = worldPages.filter((p) => p.kind === kind && p.phase !== 'archived')
        const isCollapsed = collapsed.has(kind)
        return (
          <div key={kind} className="group/section mb-0.5">
            {/* right-click the header → bulk phase for the whole category (the 1000-page canon answer) */}
            <div
              className="flex w-full items-center gap-1.5 px-2 py-1 hover:bg-panel-soft"
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation() // don't bubble to the panel root — it opens the NEW PAGE menu on top of this one
                setCatMenu({ x: e.clientX, y: e.clientY, kind, label })
              }}
            >
              <button onClick={() => toggle(kind)} className="flex flex-1 items-center gap-1.5 text-left">
                {isCollapsed ? (
                  <ChevronRight className="size-3 shrink-0 text-faint" />
                ) : (
                  <ChevronDown className="size-3 shrink-0 text-faint" />
                )}
                <Icon className="size-3 shrink-0 text-faint" />
                <span className="flex-1 text-[10px] uppercase tracking-wide text-faint">{label}</span>
                <span className="font-mono text-[9px] text-faint/50">{items.length}</span>
              </button>
              {kind !== 'custody' ? (
                <button
                  title={t('newCategory', { name: label.replace(/s$/, '').toLowerCase() })}
                  onClick={() => beginCreate(kind)}
                  className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-panel-soft hover:text-foreground group-hover/section:opacity-100"
                >
                  <Plus className="size-3" />
                </button>
              ) : (
                <span title={t('custodyHint')} className="inline-flex items-center gap-0.5 p-0.5 text-[9px] text-faint/50 opacity-0 group-hover/section:opacity-100">
                  <Trans t={t} i18nKey="custodyBadge" components={{ key: <Key className="inline size-2.5" /> }} />
                </span>
              )}
            </div>
            {!isCollapsed && (
              <>
                {creating === kind && (
                  <>
                    <NewPageInput busy={busy} onSubmit={(name) => void submitNew(kind, name)} onCancel={() => setCreating(null)} />
                    {error && <p className="px-3 pb-1 pl-7 text-[11px] text-flag">{error}</p>}
                  </>
                )}
                {items.map((p) => (
                  <WorldRow
                    key={p.path}
                    label={p.name}
                    icon={pageIcon(p, 'size-3 shrink-0 text-faint')}
                    phase={p.phase}
                    active={activePath === p.path}
                    renaming={renaming === p.path}
                    onClick={() => void openPage(toRef(p))}
                    onMenu={(e) => openMenu(e, p)}
                    onArchive={() => void setPagePhase(p.path, 'archived')}
                    onDelete={() => setToDelete(p)}
                    onSubmitRename={(name) => { void renameWorldPage(p.path, name); setRenaming(null) }}
                    onCancelRename={() => setRenaming(null)}
                  />
                ))}
                {items.length === 0 && creating !== kind && (
                  <p className="py-1 pl-7 pr-3 text-[11px] text-faint/70">{t('emptyCategory')}</p>
                )}
              </>
            )}
          </div>
        );
      })}
      {archived.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => toggle('archived')}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-panel-soft"
          >
            {collapsed.has('archived') ? (
              <ChevronRight className="size-3 shrink-0 text-faint" />
            ) : (
              <ChevronDown className="size-3 shrink-0 text-faint" />
            )}
            <Archive className="size-3 shrink-0 text-faint" />
            <span className="flex-1 text-[10px] uppercase tracking-wide text-faint">{t('archived')}</span>
            <span className="font-mono text-[9px] text-faint/50">{archived.length}</span>
          </button>
          {!collapsed.has('archived') &&
            archived.map((p) => {
              return (
              <WorldRow
                key={p.path}
                label={p.name}
                icon={pageIcon(p, 'size-3 shrink-0 text-faint')}
                phase={p.phase}
                active={activePath === p.path}
                archived
                renaming={renaming === p.path}
                onClick={() => void openPage(toRef(p))}
                onMenu={(e) => openMenu(e, p)}
                onArchive={() => void setPagePhase(p.path, 'developing')}
                onDelete={() => setToDelete(p)}
                onSubmitRename={(name) => { void renameWorldPage(p.path, name); setRenaming(null) }}
                onCancelRename={() => setRenaming(null)}
              />
              )
            })}
        </div>
      )}
      {catMenu && (
        <ContextMenuShell x={catMenu.x} y={catMenu.y} onClose={() => setCatMenu(null)}>
          <PhaseSection
            current=""
            label={t('categoryPhase', { name: catMenu.label.toLowerCase() })}
            onSet={(p) => {
              const paths = worldPages.filter((w) => w.kind === catMenu.kind && w.phase !== 'archived').map((w) => w.path)
              void setPagePhaseBulk(paths, p)
              setCatMenu(null)
            }}
          />
        </ContextMenuShell>
      )}
      {menu && (
        <ContextMenuShell x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem label={t('menu.rename')} onClick={() => { setRenaming(menu.page.path); setMenu(null) }} />
          <MenuItem label={t('menu.exportMd')} onClick={() => { const p = menu.page.path; setMenu(null); void exportScene(p) }} />
          <PhaseSection current={menu.page.phase ?? 'draft'} onSet={(p) => { void setPagePhase(menu.page.path, p); setMenu(null) }} />
          <MenuSeparator />
          <MenuItem label={t('menu.delete')} danger onClick={() => { setToDelete(menu.page); setMenu(null) }} />
        </ContextMenuShell>
      )}

      {createMenu && (
        <ContextMenuShell x={createMenu.x} y={createMenu.y} onClose={() => setCreateMenu(null)}>
          <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{t('createMenu.heading')}</div>
          {groups.filter((g) => g.kind !== 'custody').map(({ kind, label, Icon }) => (
            <button
              key={kind}
              onMouseDown={(e) => { e.preventDefault(); beginCreate(kind); setCreateMenu(null) }}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-foreground hover:bg-panel-soft"
            >
              <Icon className="size-3.5 shrink-0 text-faint" />
              {label.replace(/s$/, '')}
            </button>
          ))}
        </ContextMenuShell>
      )}

      <ConfirmDialog
        open={toDelete != null}
        title={t('delete.title')}
        danger
        confirmLabel={t('delete.confirm')}
        message={
          <Trans
            t={t}
            i18nKey="delete.message"
            values={{ name: toDelete?.name ?? '' }}
            components={{ hl: <span className="text-foreground" /> }}
          />
        }
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deletePage(toDelete.path)
          setToDelete(null)
        }}
      />
    </div>
  );
}

function NewPageInput({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation('worldNav')
  const [value, setValue] = useState('')
  return (
    <div className="py-1 pl-7 pr-3">
      <input
        autoFocus
        disabled={busy}
        value={value}
        placeholder={t('namePlaceholder')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => {
          if (!busy && !value.trim()) onCancel()
        }}
        className="w-full rounded border border-border bg-canvas px-1.5 py-0.5 text-[13px] text-foreground outline-none focus:border-character"
      />
    </div>
  )
}

function WorldRow({
  label,
  icon,
  phase,
  active,
  archived,
  renaming,
  onClick,
  onMenu,
  onArchive,
  onDelete,
  onSubmitRename,
  onCancelRename
}: {
  label: string
  icon?: React.ReactNode
  phase?: string
  active: boolean
  archived?: boolean
  renaming: boolean
  onClick: () => void
  onMenu: (e: React.MouseEvent) => void
  onArchive: () => void
  onDelete: () => void
  onSubmitRename: (name: string) => void
  onCancelRename: () => void
}): JSX.Element {
  const { t } = useTranslation('worldNav')
  if (renaming) return <WorldRenameInput initial={label} onSubmit={onSubmitRename} onCancel={onCancelRename} />
  return (
    <DetailedRow
      active={active}
      phase={phase ?? 'draft'}
      indent={22}
      icon={icon}
      label={label}
      onClick={onClick}
      onContextMenu={onMenu}
      actions={
        <>
          <button
            title={archived ? t('row.restore') : t('row.archive')}
            onClick={onArchive}
            className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100"
          >
            {archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
          </button>
          <button
            title={t('row.delete')}
            onClick={onDelete}
            className="mr-2 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-flag group-hover/row:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        </>
      }
    />
  )
}

/** Inline rename for a world page — edits the display name (the id/slug anchor is unchanged). */
function WorldRenameInput({
  initial,
  onSubmit,
  onCancel
}: {
  initial: string
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <div className="py-1 pl-7 pr-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => (value.trim() && value !== initial ? onSubmit(value) : onCancel())}
        className="w-full rounded border border-border bg-canvas px-1.5 py-0.5 text-[13px] text-foreground outline-none focus:border-character"
      />
    </div>
  )
}

function toRef(p: WorldPage): PageRef {
  return { path: p.path, title: p.name, kind: p.kind }
}
