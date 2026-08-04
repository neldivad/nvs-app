import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { BookOpen, FolderOpen, Plus, Import, MoreVertical, GitFork, Search, Play, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/Select'
import { ContextMenuShell, MenuItem, MenuSeparator } from '@/components/layout/RailContextMenu'
import { labelOf, GENRES, MEDIUMS } from '@shared/config/projectSchema'
import { NewWorkDialog } from '@/views/NewWorkDialog'
import { cn } from '@/lib/utils'
import nvsLogo from '@/assets/nvs-logo.svg'
import type { WorkCard } from '@shared/ipc'

type Kind = 'all' | 'originals' | 'forks'
type Sort = 'edited' | 'name'
const PAGE = 24 // grid render cap — "Show more" reveals the next page (covers are lazy-loaded on top of this)

/** Shown in the main area when no work is open — a Steam-style library: a "Continue" hero + a filterable grid. */
export function WelcomeView(): JSX.Element {
  const works = useWorkspace((s) => s.works)
  const recentEntries = useWorkspace((s) => s.recents)
  const openWork = useWorkspace((s) => s.openWork)
  const openExternal = useWorkspace((s) => s.openExternal)
  const importProject = useWorkspace((s) => s.importProject)
  const renameWork = useWorkspace((s) => s.renameWork)
  const forkWork = useWorkspace((s) => s.forkWork)
  const deleteWork = useWorkspace((s) => s.deleteWork)
  const setDetailWork = useWorkspace((s) => s.setDetailWork)

  const [naming, setNaming] = useState(false) // opens the NewWorkDialog (birth choices)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [sort, setSort] = useState<Sort>('edited')
  const [limit, setLimit] = useState(PAGE)
  const [menu, setMenu] = useState<{ x: number; y: number; work: WorkCard } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WorkCard | null>(null)
  const [deleting, setDeleting] = useState(false)

  const q = query.trim().toLowerCase()
  const hero = works[0] // works arrive newest-first
  const recents = works.slice(1, 8)
  // Works opened via "Open Folder…" that live OUTSIDE the library — the scan can't see them, the
  // pointer registry (recents.json) can. Library recents are already covered by the carousel above.
  const externalRecents = recentEntries.filter((e) => !e.insideLibrary)

  const grid = useMemo(() => {
    const byKind = works.filter((w) => (kind === 'all' ? true : kind === 'forks' ? !!w.forkedFrom : !w.forkedFrom))
    const matched = q ? byKind.filter((w) => `${w.title ?? w.name} ${w.author ?? ''}`.toLowerCase().includes(q)) : byKind
    return [...matched].sort((a, b) => (sort === 'name' ? (a.title ?? a.name).localeCompare(b.title ?? b.name) : b.lastEdited - a.lastEdited))
  }, [works, kind, sort, q])

  const openMenu = (e: React.MouseEvent, work: WorkCard): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, work })
  }
  const preview = (work: WorkCard): void => setDetailWork(work) // click a work → detail dialog (confirm to enter)

  return (
    // overflow-x-clip: the "Continue writing" row holds a fixed-width hero (w-88, shrink-0) + carousel; on a
    // narrow panel it would bleed and show a page-level horizontal scrollbar. Clip it — the library never scrolls x.
    <div className="overflow-x-clip p-6">
      {/* top bar */}
      <div className="mb-6 flex items-center gap-3">
        <img src={nvsLogo} alt="" className="size-8" />
        <h1 className="text-base font-medium">Novel Visual Studio</h1>
        <div className="relative ml-auto w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={query} placeholder="Search works…" onChange={(e) => setQuery(e.target.value)} className="h-8 pl-7 text-xs" />
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setNaming(true)}>
            <Plus className="size-3.5" /> New
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openExternal()} title="Open a project folder from anywhere">
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => void importProject()} title="Import a shared .nvsproj bundle">
            <Import className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* the birth-choices dialog (name · structure template · language) — one screen, not a wizard */}
      <NewWorkDialog open={naming} onClose={() => setNaming(false)} />

      {works.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No works in your library yet — create one, or import a <span className="font-mono">.nvsproj</span>.
        </p>
      ) : (
        <>
          {/* Continue writing — the oversized last-viewed + a carousel of recents (hidden while searching) */}
          {!q && hero && (
            <section className="mb-7">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Continue writing</h2>
              <div className="flex gap-3">
                <HeroCard work={hero} onPreview={() => preview(hero)} onContinue={() => void openWork(hero.path)} onMenu={(e) => openMenu(e, hero)} />
                {recents.length > 0 && (
                  <Carousel>
                    {recents.map((w) => (
                      <MiniCard key={w.path} work={w} onPreview={() => preview(w)} onMenu={(e) => openMenu(e, w)} />
                    ))}
                  </Carousel>
                )}
              </div>
            </section>
          )}

          {/* Opened elsewhere — outside-library projects remembered by the pointer registry */}
          {!q && externalRecents.length > 0 && (
            <section className="mb-7">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Opened elsewhere</h2>
              <div className="flex flex-wrap gap-2">
                {externalRecents.map((r) => (
                  <button
                    key={r.path}
                    onClick={() => void openWork(r.path)}
                    title={r.path}
                    className="flex max-w-72 items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1.5 text-left transition-colors hover:bg-panel-soft"
                  >
                    <FolderOpen className="size-3.5 shrink-0 text-faint" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs">{r.name}</span>
                      <span className="block truncate text-[10px] text-faint">{r.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* All works — filter (all/originals/forks) + sort */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                {q ? `Results · ${grid.length}` : `All works · ${works.length}`}
              </h2>
              <div className="ml-auto flex items-center gap-1">
                {(['all', 'originals', 'forks'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={cn('rounded-full px-2.5 py-0.5 text-[11px] capitalize transition-colors', kind === k ? 'bg-thread/15 text-thread' : 'text-muted-foreground hover:bg-panel-soft')}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <Select
                value={sort}
                onChange={(v) => setSort(v as Sort)}
                options={[{ value: 'edited', label: 'Last edited' }, { value: 'name', label: 'Name' }]}
                className="text-[11px]"
              />
            </div>

            {grid.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No {kind === 'forks' ? 'forks' : kind === 'originals' ? 'originals' : 'works'}{q ? ' match your search' : ''}.
              </p>
            ) : (
              <>
                <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                  {grid.slice(0, limit).map((w) => (
                    <GridCard key={w.path} work={w} onPreview={() => preview(w)} onMenu={(e) => openMenu(e, w)} />
                  ))}
                </div>
                {grid.length > limit && (
                  <div className="mt-4 flex justify-center">
                    <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                      Show more ({grid.length - limit})
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {menu && (
        <ContextMenuShell x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem label="Open" onClick={() => { const p = menu.work.path; setMenu(null); void openWork(p) }} />
          <MenuItem label="Details…" onClick={() => { const w = menu.work; setMenu(null); preview(w) }} />
          <MenuItem label="Fork" onClick={() => { const p = menu.work.path; setMenu(null); void forkWork(p) }} />
          {menu.work.title && menu.work.title !== menu.work.name && (
            <MenuItem
              label={`Rename folder to “${menu.work.title}”`}
              onClick={() => { const { path, title } = menu.work; setMenu(null); void renameWork(path, title!) }}
            />
          )}
          <MenuSeparator />
          <MenuItem label="Delete…" danger onClick={() => { const w = menu.work; setMenu(null); setConfirmDelete(w) }} />
        </ContextMenuShell>
      )}

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete project?">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">{confirmDelete?.title || confirmDelete?.name}</span> will be moved to your
            system Trash — prose and analysis together. You can restore it from there if you change your mind.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                if (!confirmDelete) return
                setDeleting(true)
                const ok = await deleteWork(confirmDelete.path)
                setDeleting(false)
                if (ok) setConfirmDelete(null)
              }}
            >
              Move to Trash
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

/** A horizontal carousel with paging arrows (shown only at the scrollable edges). */
function Carousel({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    // bail out (return the SAME object) when nothing changed — else useLayoutEffect(update) loops forever
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  useLayoutEffect(update) // recompute after every render (content/size can change)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update])
  const page = (dir: number): void => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={ref} className="flex gap-2 overflow-x-auto scroll-smooth pb-1 scrollbar-none">
        {children}
      </div>
      {edges.left && <Arrow dir="left" onClick={() => page(-1)} />}
      {edges.right && <Arrow dir="right" onClick={() => page(1)} />}
    </div>
  )
}

function Arrow({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel/95 text-muted-foreground shadow-md transition-colors hover:text-foreground',
        dir === 'left' ? 'left-1' : 'right-1'
      )}
    >
      {dir === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  )
}

/** cover image (or a placeholder) with a fork glyph badge in the corner when the work is a fork. */
function Cover({ work, className }: { work: WorkCard; className: string }): JSX.Element {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded border border-border bg-panel-soft', className)}>
      {work.cover ? (
        <img src={`nvs-asset://${encodeURI(`${work.path}/${work.cover}`)}`} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center"><BookOpen className="size-4 text-faint" /></div>
      )}
      {work.forkedFrom && (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-canvas/85 text-lore" title={`Forked from ${work.forkedFrom}`}>
          <GitFork className="size-2.5" />
        </span>
      )}
    </div>
  )
}

/** The parent-lineage line (Kaggle-style) + genre/medium tag chips. */
function Meta({ work, tags }: { work: WorkCard; tags: number }): JSX.Element {
  const chips = [work.medium && labelOf(MEDIUMS, work.medium), ...(work.genre ?? []).map((g) => labelOf(GENRES, g))].filter(Boolean) as string[]
  return (
    <>
      {work.forkedFrom && (
        <span className="flex items-center gap-1 text-[11px] text-lore">
          <GitFork className="size-3 shrink-0" />
          <span className="truncate">from {work.forkedFrom}</span>
        </span>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.slice(0, tags).map((c) => (
            <span key={c} className="rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground">{c}</span>
          ))}
        </div>
      )}
    </>
  )
}

/** The oversized "continue" card — clicking the face previews; the Continue button is the direct express lane. */
/**
 * The disk-folder name — shown ONLY when it differs from the display title, so copies/backups that share a
 * title (`Genshin — Story` living in `Genshin - Backup 2/`) become distinguishable at a glance. Hover reveals
 * the full path. Silent for normal projects where folder == title, keeping those cards clean.
 */
function FolderTag({ work, className = '' }: { work: WorkCard; className?: string }): JSX.Element | null {
  if (!work.title || work.title === work.name) return null
  return (
    <span className={`flex min-w-0 items-center gap-1 truncate font-mono text-[10px] text-faint ${className}`} title={work.path}>
      <FolderOpen className="size-2.5 shrink-0" />
      <span className="truncate">{work.name}</span>
    </span>
  )
}

function HeroCard({ work, onPreview, onContinue, onMenu }: { work: WorkCard; onPreview: () => void; onContinue: () => void; onMenu: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <div className="group relative w-88 shrink-0">
      <div onClick={onPreview} onContextMenu={onMenu} className="flex w-full cursor-pointer gap-3 rounded-xl border border-border bg-panel p-3 transition-colors hover:bg-panel-soft">
        <Cover work={work} className="h-40 w-28" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <span className="truncate text-base font-semibold leading-tight">{work.title || work.name}</span>
          <FolderTag work={work} />
          {work.author && <span className="truncate text-xs text-muted-foreground">{work.author}</span>}
          <Meta work={work} tags={3} />
          <span className="mt-auto font-mono text-[11px] text-faint">{work.scenes} scenes · {work.worldPages} world</span>
          <button
            onClick={(e) => { e.stopPropagation(); onContinue() }}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-thread/15 px-2 py-1 text-[11px] font-medium text-thread transition-colors hover:bg-thread/25"
          >
            <Play className="size-3 fill-current" /> Continue
          </button>
        </div>
      </div>
      <KebabButton onMenu={onMenu} />
    </div>
  )
}

/** A small recents-carousel card. */
function MiniCard({ work, onPreview, onMenu }: { work: WorkCard; onPreview: () => void; onMenu: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <button onClick={onPreview} onContextMenu={onMenu} title={work.title && work.title !== work.name ? `${work.title} — ${work.name}` : work.title || work.name} className="flex w-28 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-panel p-2 text-left transition-colors hover:bg-panel-soft">
      <Cover work={work} className="h-32 w-full" />
      <span className="w-full truncate text-[11px] font-medium">{work.title || work.name}</span>
    </button>
  )
}

/** A grid card with badge + lineage + tags + the actions kebab. */
function GridCard({ work, onPreview, onMenu }: { work: WorkCard; onPreview: () => void; onMenu: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <div className="group relative h-full min-w-0">
      <button onClick={onPreview} onContextMenu={onMenu} className="flex h-full w-full min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-panel p-2 text-left transition-colors hover:bg-panel-soft">
        <Cover work={work} className="aspect-3/4 w-full" />
        <span className="w-full truncate text-[12px] font-medium">{work.title || work.name}</span>
        <FolderTag work={work} className="w-full" />
        {work.author && <span className="w-full truncate text-[10px] text-muted-foreground">{work.author}</span>}
        <Meta work={work} tags={2} />
      </button>
      <KebabButton onMenu={onMenu} />
    </div>
  )
}

/** The hover-revealed ⋯ handle that opens the shared context menu. */
function KebabButton({ onMenu }: { onMenu: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <button
      onClick={onMenu}
      title="Project actions"
      className="absolute right-1.5 top-1.5 rounded bg-canvas/70 p-1 text-faint opacity-0 backdrop-blur-sm transition-opacity hover:bg-panel-soft hover:text-foreground group-hover:opacity-100"
    >
      <MoreVertical className="size-3.5" />
    </button>
  )
}
