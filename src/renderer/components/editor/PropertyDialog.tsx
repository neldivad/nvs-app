/**
 * The one Properties dialog for every page kind (scene + world).
 *
 * It edits FRONTMATTER ONLY — scalars, grouped from the page's schema. Body prose
 * (Fountain for scenes, `## sections` for world pages) is owned by the editor, never
 * here; the dialog only SEEDS sections via the wizard. That boundary is what lets one
 * component serve every kind (see internal/pending.md — unified page model).
 *
 *   • Phase pill            — content phase, all kinds
 *   • Set up (wizard)       — choose which field groups show + which sections to scaffold
 *   • Fields                — the schema-driven form (+ slotted renderers below)
 *   • Agent                 — the frontmatter YAML, copyable
 *
 * Slotted renderers: avatar (character), characters picker + task-spec textareas (scene).
 */

import { JSX, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, Circle, ImagePlus, X } from 'lucide-react'
import { dominantSpeaker } from '@/lib/analysis/pov'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { bodyHeadings } from '@/lib/fountain/wikiSerializer'
import type { WorldPage } from '@shared/ipc'
import { entityVisual } from '@/config/entityVisual'
import {
  CONTENT_PHASES,
  defaultPhase,
  groupFields,
  GROUP_NOTES,
  pageSchema,
  type FieldSpec,
  type SectionSpec
} from '@/config/worldSchema'

/** Scene fields that link to world pages (the EntityPicker handles them; ids are the truth). `single` =
 *  one ref only (POV is a single character), vs the comma-list multi-pickers. */
const REF_FIELDS: Record<string, { kind: WorldPage['kind']; single?: boolean }> = {
  characters_present: { kind: 'character' },
  location: { kind: 'location' },
  items: { kind: 'item' },
  pov: { kind: 'character', single: true }
}

// ── nested frontmatter helpers ──────────────────────────────────────────────

function getNested(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}
function setNested(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[path[path.length - 1]] = value
}
function delNested(obj: Record<string, unknown>, path: string[]): void {
  if (path.length === 1) return void delete obj[path[0]]
  const parent = getNested(obj, path.slice(0, -1))
  if (parent && typeof parent === 'object') {
    delete (parent as Record<string, unknown>)[path[path.length - 1]]
    if (Object.keys(parent as Record<string, unknown>).length === 0) delNested(obj, path.slice(0, -1))
  }
}

const isList = (f: FieldSpec): boolean => f.type === 'array' || !!f.asArray
const pathOf = (f: FieldSpec): string[] => f.nestedPath ?? [f.key]

function readField(fm: Record<string, unknown>, f: FieldSpec): string {
  const v = f.nestedPath ? getNested(fm, f.nestedPath) : fm[f.key]
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  return String(v)
}

// ── component ─────────────────────────────────────────────────────────────────

export function PropertyDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const activePage = useWorkspace((s) => s.activePage)
  const frontmatter = useWorkspace((s) => s.frontmatter)
  const setFrontmatter = useWorkspace((s) => s.setFrontmatter)
  const saveScene = useWorkspace((s) => s.saveScene)
  const worldPages = useWorkspace((s) => s.worldPages)
  const timelineGraph = useWorkspace((s) => s.timelineGraph)

  const kind = activePage?.kind ?? 'character'
  const schema = useMemo(() => pageSchema(kind), [kind])
  // POV default = the scene's dominant speaker (most dialogue lines), shown as a hint when `pov` is unset.
  const povDefaultName = useMemo(() => {
    if (kind !== 'scene') return undefined
    const id = dominantSpeaker(timelineGraph.scenes[String(frontmatter.scene_id ?? '')]?.cast ?? [])
    return id ? worldPages.find((p) => p.id === id)?.name : undefined
  }, [kind, frontmatter.scene_id, timelineGraph, worldPages])
  const groups = useMemo(() => groupFields(schema.fields), [schema])
  const title = kind === 'scene' ? 'Scene properties' : `${cap(kind)} properties`

  const [draft, setDraft] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<string>('draft')

  useEffect(() => {
    if (!open) return
    const d: Record<string, string> = {}
    for (const f of schema.fields) d[f.key] = readField(frontmatter, f)
    setDraft(d)
    setPhase(String(frontmatter.phase ?? defaultPhase(kind)))
  }, [open, frontmatter, schema])

  function buildFrontmatter(): Record<string, unknown> {
    const out: Record<string, unknown> = structuredClone(frontmatter)
    out.phase = phase
    for (const f of schema.fields) {
      if (f.readOnly) continue
      const raw = (draft[f.key] ?? '').trim()
      const path = pathOf(f)
      if (raw === '') {
        delNested(out, path)
        continue
      }
      setNested(out, path, isList(f) ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw)
    }
    return out
  }

  // Apply commits the change: update the store frontmatter AND persist to disk, so it
  // survives navigating away and back (which re-reads the file).
  async function apply(): Promise<void> {
    setFrontmatter(buildFrontmatter())
    await saveScene()
    onClose()
  }

  const set = (key: string, v: string): void => setDraft((d) => ({ ...d, [key]: v }))

  return (
    <Dialog
      region="scenePropertyDialog"
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void apply()}>Apply</Button>
        </DialogFooter>
      }
    >
      <div className="space-y-3">
          {/* Phase pill */}
          <div>
            <Label>Phase</Label>
            <div className="mt-1 flex gap-0.5 rounded-md border border-border p-0.5">
              {CONTENT_PHASES.map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={cn(
                    'flex-1 rounded px-1 py-0.5 text-[11px] capitalize transition-colors',
                    phase === p ? 'bg-thread text-white' : 'text-muted-foreground hover:bg-panel-soft'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <MediaRow />

          {/* Frontmatter scalars — always shown, grouped. Kept minimal; rich content lives in body sections. */}
          {groups.map(({ group, fields }) => (
            <div key={group} className="space-y-2">
              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                {group}
              </div>
              {GROUP_NOTES[group] && (
                <p className="-mt-1 text-[10px] leading-snug text-faint">{GROUP_NOTES[group]}</p>
              )}
              {fields.map((f) => {
                const ref = REF_FIELDS[f.key]
                return ref ? (
                  <EntityPicker
                    key={f.key}
                    label={f.label}
                    emptyHint={`No ${ref.kind} pages in world/${ref.kind}s yet.`}
                    kind={ref.kind}
                    single={ref.single}
                    defaultHint={f.key === 'pov' ? povDefaultName : undefined}
                    pages={worldPages.filter((p) => p.kind === ref.kind)}
                    value={draft[f.key] ?? ''}
                    onChange={(v) => set(f.key, v)}
                    onClose={onClose}
                  />
                ) : (
                  <FieldRow key={f.key} field={f} value={draft[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
                )
              })}
            </div>
          ))}

          {/* Read-only coverage of the body's section modules (added via / in the Write tab). */}
          {schema.bodyType === 'sections' && <SectionStatus sections={schema.sections} />}
        </div>
    </Dialog>
  )
}

// ── section status grid ────────────────────────────────────────────────────────

/**
 * A read-only map of the kind's section modules: which are present in the body and which
 * aren't. Not a toggle — sections are added by typing `/` in the Write tab. This is just a
 * schema detector so the author sees coverage at a glance.
 */
function SectionStatus({ sections }: { sections: SectionSpec[] }): JSX.Element {
  const body = useWorkspace((s) => s.body)
  const present = useMemo(() => new Set(bodyHeadings(body).map((h) => h.toLowerCase())), [body])

  return (
    <div className="pt-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Sections</div>
      <p className="mb-1.5 mt-0.5 text-[10px] text-faint">
        On the page below. Add one by typing <span className="font-mono">/</span> in the Write tab.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sections.map((s) => {
          const here = present.has(s.heading.toLowerCase())
          return (
            <span
              key={s.id}
              title={s.description}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                here ? 'border-character/40 bg-character/10 text-character' : 'border-border text-faint'
              )}
            >
              {here ? <Check className="size-3" /> : <Circle className="size-2.5" />}
              {s.heading}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── slotted renderers ─────────────────────────────────────────────────────────

/** Read a page's media list, tolerating older pages that only have a single `avatar`. */
function readImages(fm: Record<string, unknown>): string[] {
  if (Array.isArray(fm.images)) return fm.images.map(String)
  return fm.avatar ? [String(fm.avatar)] : []
}

/**
 * Media gallery for a world page. The first image is the avatar (the identity thumbnail
 * lists + scene cards use), so we keep `avatar` mirrored to `images[0]`. Add imports via
 * the multi-select picker; remove per image; the first is badged.
 */
function MediaRow(): JSX.Element {
  const frontmatter = useWorkspace((s) => s.frontmatter)
  const setFrontmatter = useWorkspace((s) => s.setFrontmatter)
  const saveScene = useWorkspace((s) => s.saveScene)
  const refreshWorldPages = useWorkspace((s) => s.refreshWorldPages)
  const refreshStoryTree = useWorkspace((s) => s.refreshStoryTree)
  const kind = useWorkspace((s) => s.activePage?.kind ?? 'character')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const isScene = kind === 'scene'
  // Scenes are keyed by scene_id; world pages by id. Assets land in content/assets/{pageId}/.
  const pageId = String(frontmatter.scene_id ?? frontmatter.id ?? '')
  const images = readImages(frontmatter)

  async function commit(next: string[]): Promise<void> {
    const base = { ...frontmatter }
    if (next.length) {
      base.images = next
      base.avatar = next[0]
    } else {
      delete base.images
      delete base.avatar
    }
    setFrontmatter(base)
    await saveScene()
    // Surface the new cover wherever the page shows: world lists, or the timeline (storyTree).
    if (isScene) await refreshStoryTree()
    else await refreshWorldPages()
  }

  async function add(): Promise<void> {
    setBusy(true)
    try {
      const added = await window.nvs.importImages(pageId, kind)
      if (added.length) await commit([...images, ...added])
    } finally {
      setBusy(false)
    }
  }

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i

  async function addFromDrop(files: FileList): Promise<void> {
    const paths = Array.from(files)
      .filter((f) => IMAGE_EXT.test(f.name))
      .map((f) => window.nvs.getPathForFile(f))
    if (!paths.length) return
    setBusy(true)
    try {
      const added = await window.nvs.importImagePaths(pageId, kind, paths)
      if (added.length) await commit([...images, ...added])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Label>Media</Label>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void addFromDrop(e.dataTransfer.files)
        }}
        className={cn(
          'mt-1 flex flex-wrap items-center gap-2 rounded-md',
          dragOver && 'outline-2 outline-offset-2 outline-primary'
        )}
      >
        {images.map((rel, i) => (
          <span
            key={rel}
            className="group relative size-14 overflow-hidden rounded-md border border-border bg-panel-soft"
          >
            <img src={`nvs-asset://${rel}`} alt="" className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[8px] font-medium uppercase tracking-wide text-white">
                {isScene ? 'cover' : 'avatar'}
              </span>
            )}
            <button
              title="Remove"
              onClick={() => void commit(images.filter((x) => x !== rel))}
              className="absolute right-0.5 top-0.5 rounded bg-black/55 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button
          disabled={busy}
          onClick={() => void add()}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-faint transition-colors hover:bg-panel-soft hover:text-foreground',
            busy && 'opacity-50'
          )}
          title="Add images"
        >
          <ImagePlus className="size-5" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-faint">
        First image is the {isScene ? 'cover shown on the timeline' : 'avatar used in lists'}.
      </p>
    </div>
  )
}

/**
 * Reusable entity picker — `@`-style search-and-append. Renders only the SELECTED chips
 * plus a bounded results dropdown as you type, so it scales to thousands of pages (the old
 * pill-wall rendered the whole catalog). Stores ids (the source of truth); orphan ids show red.
 * Used for a scene's cast / locations / items.
 */
function EntityPicker({
  label,
  emptyHint,
  kind,
  single,
  defaultHint,
  pages,
  value,
  onChange,
  onClose
}: {
  label: string
  emptyHint: string
  kind: WorldPage['kind']
  single?: boolean // one ref only (e.g. POV) — selecting replaces instead of appending
  defaultHint?: string // shown when a single picker is empty (e.g. POV "Defaults to <dominant speaker>")
  pages: WorldPage[]
  value: string
  onChange: (v: string) => void
  onClose: () => void
}): JSX.Element {
  const openPage = useWorkspace((s) => s.openPage)
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)

  const selected = value.split(',').map((s) => s.trim()).filter(Boolean)
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])
  const add = (id: string): void => {
    if (single) onChange(id) // single ref → replace
    else if (!selected.includes(id)) onChange([...selected, id].join(', '))
    setQ('')
  }
  const remove = (id: string): void => onChange(selected.filter((x) => x !== id).join(', '))

  const ql = q.toLowerCase()
  const results = useMemo(
    () =>
      pages
        .filter((p) => !selected.includes(p.id) && (ql === '' || p.name.toLowerCase().includes(ql) || p.id.toLowerCase().includes(ql)))
        .slice(0, 8),
    [pages, selected, ql]
  )
  const visual = entityVisual(kind)
  const Icon = visual.Icon

  return (
    <div>
      <Label>{single ? label : `${label} · ${selected.length}`}</Label>

      {single && selected.length === 0 && defaultHint && (
        <p className="mb-1 text-[11px] text-faint">Defaults to <span className="text-muted-foreground">{defaultHint}</span> (the scene’s main speaker) — pick to override.</p>
      )}

      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const p = byId.get(id)
            return (
              <span
                key={id}
                className={cn(
                  'inline-flex items-center rounded-full border text-xs',
                  p ? visual.chip : 'border-flag/60 bg-flag-bg text-flag'
                )}
              >
                <Icon className="ml-2 size-3 shrink-0" />
                <span className={cn('py-1 pl-1', p ? 'pr-1' : 'pr-1 font-mono')}>{p?.name ?? id}</span>
                {p && (
                  <button
                    title="Open page"
                    onClick={() => {
                      void openPage({ path: p.path, title: p.name, kind: p.kind })
                      onClose()
                    }}
                    className="px-0.5 opacity-70 hover:opacity-100"
                  >
                    <ArrowUpRight className="size-3" />
                  </button>
                )}
                <button title="Remove" onClick={() => remove(id)} className="pr-1.5 pl-0.5 opacity-70 hover:opacity-100">
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="relative">
        <Input
          placeholder={pages.length === 0 ? emptyHint : `@ search ${label.toLowerCase()}…`}
          disabled={pages.length === 0}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault()
              add(results[0].id)
            }
          }}
          className="h-7 text-xs"
        />
        {focused && results.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-panel shadow-lg">
            {results.map((p) => (
              <button
                key={p.id}
                onMouseDown={(e) => {
                  e.preventDefault() // keep focus; fire before blur
                  add(p.id)
                }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-panel-soft"
              >
                <Icon className={cn('size-3.5 shrink-0', visual.text)} />
                <span className="min-w-0 flex-1 truncate text-foreground/90">{p.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">{p.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldRow({
  field,
  value,
  onChange
}: {
  field: FieldSpec
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  if (field.readOnly) {
    return (
      <div>
        <Label>{field.label}</Label>
        <p className="font-mono text-[11px] text-faint">{value || '—'}</p>
      </div>
    )
  }
  const label = isList(field) ? `${field.label} · comma-separated` : field.label
  return (
    <div>
      <Label>{label}</Label>
      {field.options ? (
        // Permissive enum, via the app's token-styled Select: the placeholder doubles as a clear/None option; an
        // existing off-list value is preserved as its own option so nothing is lost.
        <Select
          value={value}
          onChange={onChange}
          placeholder={field.placeholder ?? 'Select…'}
          options={[
            { value: '', label: field.placeholder ?? 'None' },
            ...field.options.map((o) => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) })),
            ...(value && !field.options.includes(value) ? [{ value, label: value }] : [])
          ]}
        />
      ) : field.multiline ? (
        <Textarea rows={2} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
