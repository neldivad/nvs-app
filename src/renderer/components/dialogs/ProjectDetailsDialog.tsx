import { Fragment, useEffect, useState, type JSX, type ReactNode } from 'react'
import { Image as ImageIcon, Plus, X, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BookCard } from '@/components/store/ProjectCard'
import { LANGUAGES, STATUSES, THEMES, CONTENT_WARNINGS, CONTRIBUTOR_ROLES, FIELD_LIMITS, DOMAINS, DEFAULT_DOMAIN, mediumsForKind, genresForKind, type Option } from '@shared/config/projectSchema'
import type { ProjectInfo, Contributor } from '@shared/ipc'

const STEPS = ['Details', 'Cover', 'Classification', 'Credits', 'Review'] as const

// KIND tint — design tokens, not literal red (non-fiction isn't a warning): fiction=indigo/thread, non-fic=teal/ok.
const KIND_TINT: Record<string, string> = { fiction: 'border-thread bg-thread/10', nonfiction: 'border-ok bg-ok/10' }
const KIND_DOT: Record<string, string> = { fiction: 'bg-thread', nonfiction: 'bg-ok' }

// Field caps live in the shared schema (guard the input, not just the render). Metadata = a book CARD, not the
// manuscript: a synopsis is a blurb, not the whole novel; a title can't be 500 chars and break a card/tooltip/folder.
const LIMITS = FIELD_LIMITS

/**
 * The project's authored identity (.nvs/project.json). Opens to a read-only "book card"; Edit launches a 5-step
 * wizard (Details · Cover · Classification · Credits · Review). No absolute dropdowns inside the scroll area:
 * Medium/Status are single-select chips, the classification fields are searchable pickers with INLINE results
 * (so nothing clips and they scale past 100 options). Closing a dirty wizard prompts before discarding.
 */
export function ProjectDetailsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const info = useWorkspace((s) => s.projectInfo)
  const project = useWorkspace((s) => s.project)
  const save = useWorkspace((s) => s.saveProjectInfo)
  const pickCover = useWorkspace((s) => s.pickCover)
  const pickCoverFromPath = useWorkspace((s) => s.pickCoverFromPath)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<ProjectInfo>({})
  const [keywordsText, setKeywordsText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    if (open) {
      setMode('view')
      setStep(0)
      setConfirmDiscard(false)
    }
  }, [open])
  useEffect(() => {
    if (mode === 'edit') {
      setDraft(info ?? {})
      setKeywordsText((info?.keywords ?? []).join(', '))
      setDirty(false)
    }
  }, [mode, info])

  const set = <K extends keyof ProjectInfo>(k: K, v: ProjectInfo[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }))
    setDirty(true)
  }
  const setKeywords = (s: string): void => {
    setKeywordsText(s)
    setDirty(true)
  }
  const fallbackTitle = project?.name ?? 'Untitled'
  const onSave = async (): Promise<void> => {
    await save({ ...draft, keywords: keywordsText.split(',').map((t) => t.trim()).filter(Boolean) })
    setDirty(false)
    setMode('view')
  }
  // Esc / backdrop: a dirty wizard prompts before throwing the edits away (the user's accidental-exit guard).
  const guardedClose = (): void => {
    if (mode === 'edit' && dirty) setConfirmDiscard(true)
    else onClose()
  }
  const draftForReview: ProjectInfo = { ...draft, keywords: keywordsText.split(',').map((t) => t.trim()).filter(Boolean) }

  return (
    <Dialog region="projectDetailsDialog"
      open={open}
      onClose={guardedClose}
      title="Project details"
      // View mode gets a fixed height so a sparse project doesn't collapse to a tiny box (BookCard `preview`
      // keeps the full facts table + synopsis present with placeholders — same treatment as the library preview).
      className={mode === 'edit' ? 'h-[75vh] w-[50vw] max-w-none' : 'h-128 max-w-xl'}
      bodyClassName={mode === 'edit' ? 'flex flex-col overflow-hidden' : 'select-text overflow-auto'}
    >
      {mode === 'view' ? (
        <BookCard info={info ?? {}} fallbackTitle={fallbackTitle} onEdit={() => setMode('edit')} preview />
      ) : (
        // a flex-col that FILLS the fixed 60×60 frame: stepper + footer pinned, step content scrolls between.
        <div className="relative flex min-h-0 flex-1 select-text flex-col">
          <Stepper current={step} onJump={setStep} />
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {step === 0 && <DetailsStep draft={draft} set={set} fallbackTitle={fallbackTitle} />}
            {step === 1 && (
              <CoverStep
                info={info ?? {}}
                draft={draft}
                onPick={() => void pickCover()}
                onDropPath={(path) => void pickCoverFromPath(path)}
              />
            )}
            {step === 2 && <ClassificationStep draft={draft} set={set} keywordsText={keywordsText} setKeywords={setKeywords} />}
            {step === 3 && <CreditsStep draft={draft} set={set} />}
            {step === 4 && <BookCard info={draftForReview} fallbackTitle={fallbackTitle} preview />}
          </div>
          <div className="mt-3 flex shrink-0 items-center justify-between border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => (dirty ? setConfirmDiscard(true) : setMode('view'))}>Cancel</Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)}>
                  <ChevronLeft className="size-3.5" /> Back
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                  Next <ChevronRight className="size-3.5" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => void onSave()}>Save</Button>
              )}
            </div>
          </div>

          <ConfirmDialog
            open={confirmDiscard}
            title="Discard changes?"
            message="Your edits to this project won’t be saved."
            confirmLabel="Discard"
            danger
            onCancel={() => setConfirmDiscard(false)}
            onConfirm={() => { setConfirmDiscard(false); setDirty(false); onClose() }}
          />
        </div>
      )}
    </Dialog>
  )
}

// ── the stepper header ──────────────────────────────────────────────────────
function Stepper({ current, onJump }: { current: number; onJump: (i: number) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <div className={cn('h-px flex-1', i <= current ? 'bg-thread/50' : 'bg-border')} />}
          <button onClick={() => onJump(i)} className={cn('type-micro flex items-center gap-1', i === current ? 'text-thread' : 'text-faint hover:text-muted-foreground')} title={s}>
            <span className={cn('type-micro flex size-4 shrink-0 items-center justify-center rounded-full border', i === current ? 'border-thread bg-thread/15' : i < current ? 'border-thread/50 text-thread/70' : 'border-border')}>
              {i < current ? '✓' : i + 1}
            </span>
            <span className="hidden font-medium uppercase tracking-wide sm:inline">{s}</span>
          </button>
        </Fragment>
      ))}
    </div>
  )
}

// ── steps ───────────────────────────────────────────────────────────────────
function DetailsStep({ draft, set, fallbackTitle }: { draft: ProjectInfo; set: <K extends keyof ProjectInfo>(k: K, v: ProjectInfo[K]) => void; fallbackTitle: string }): JSX.Element {
  const domain = draft.domain ?? DEFAULT_DOMAIN
  return (
    <div className="space-y-4">
      {/* KIND leads: it's the top of the shelf and scopes Medium/Genre below, so it's decided FIRST. */}
      <Field label="Kind" hint="Fiction or non-fiction — the top of the shelf. (Shapes the analysis in a later update; today it’s a label.)">
        <div className="grid grid-cols-2 gap-2">
          {DOMAINS.map((d) => (
            <button
              key={d.value}
              onClick={() => set('domain', d.value)}
              className={cn(
                'flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors',
                domain === d.value ? KIND_TINT[d.value] : 'border-border hover:bg-panel-soft'
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <span className={cn('size-2 rounded-full', domain === d.value ? KIND_DOT[d.value] : 'bg-border')} />
                {d.label}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">{d.blurb}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Title" hint="The name of your work.">
        <Input maxLength={LIMITS.title} value={draft.title ?? ''} placeholder={fallbackTitle} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Subtitle" hint="An optional second line (e.g. “Book One of …”).">
        <Input maxLength={LIMITS.subtitle} value={draft.subtitle ?? ''} placeholder="Optional" onChange={(e) => set('subtitle', e.target.value)} />
      </Field>
      <Field label="Tagline" hint="A one-line hook — like a movie tagline.">
        <Input maxLength={LIMITS.logline} value={draft.logline ?? ''} placeholder="In a kingdom of liars, one truth remains." onChange={(e) => set('logline', e.target.value)} />
      </Field>
      <Field label="Synopsis" hint="The back-cover blurb — a paragraph or two, not the whole book.">
        <Textarea rows={4} maxLength={LIMITS.synopsis} value={draft.description ?? ''} placeholder="When the queen falls ill, the court fractures…" onChange={(e) => set('description', e.target.value)} />
        <div className={cn('type-micro mt-0.5 text-right', (draft.description?.length ?? 0) >= LIMITS.synopsis ? 'text-flag' : 'text-faint')}>
          {(draft.description ?? '').length} / {LIMITS.synopsis}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Medium" hint="What kind of work is this?">
          {/* Scoped to the project's KIND — a non-fiction project offers podcast/interview/…, not Novel/Screenplay. */}
          <OneOf options={mediumsForKind(draft.domain ?? DEFAULT_DOMAIN)} value={draft.medium} onChange={(v) => set('medium', v)} />
        </Field>
        <Field label="Status" hint="Where is it in its life?">
          <OneOf options={STATUSES} value={draft.status} onChange={(v) => set('status', v)} />
        </Field>
      </div>
    </div>
  )
}

const COVER_IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i

function CoverStep({
  info,
  draft,
  onPick,
  onDropPath
}: {
  info: ProjectInfo
  draft: ProjectInfo
  onPick: () => void
  onDropPath: (path: string) => void
}): JSX.Element {
  const cover = draft.cover ?? info.cover // cover persists on pick → mirrors from info
  const coverUrl = cover ? `nvs-asset://${cover}?t=${encodeURIComponent(info.updatedAt ?? '')}` : null
  const [dragOver, setDragOver] = useState(false)

  return (
    <Field label="Cover" hint="A cover gives the project a face in your library.">
      <div className="flex items-start gap-5">
        <button
          type="button"
          onClick={onPick}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = Array.from(e.dataTransfer.files).find((f) => COVER_IMAGE_EXT.test(f.name))
            if (file) onDropPath(window.nvs.getPathForFile(file))
          }}
          className={cn(
            'group relative flex h-72 w-48 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border bg-panel-soft transition-colors',
            coverUrl ? 'border-border' : 'border-2 border-dashed border-border hover:border-thread/50 hover:bg-panel-soft/70',
            dragOver && 'border-thread bg-thread/10'
          )}
        >
          {coverUrl ? (
            <>
              <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/55 group-hover:opacity-100">
                <span className="type-body-sm font-medium text-white">Change cover</span>
              </div>
            </>
          ) : (
            <>
              <ImageIcon className="size-8 text-faint" />
              <span className="type-body-sm mt-3 px-4 text-center text-muted-foreground">
                Drop an image here
              </span>
              <span className="type-caption mt-1 text-faint">or click to browse</span>
            </>
          )}
        </button>
        <div className="flex flex-col items-start gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onPick}>Choose image…</Button>
          <p className="type-caption max-w-48 text-faint">
            JPG, PNG, GIF, or WEBP. Shown on your library shelf and the project&rsquo;s book card.
          </p>
        </div>
      </div>
    </Field>
  )
}

function ClassificationStep({ draft, set, keywordsText, setKeywords }: { draft: ProjectInfo; set: <K extends keyof ProjectInfo>(k: K, v: ProjectInfo[K]) => void; keywordsText: string; setKeywords: (s: string) => void }): JSX.Element {
  const domain = draft.domain ?? DEFAULT_DOMAIN // set in step 1 (Details); still scopes the Subject/Genre picker below
  return (
    <div className="space-y-4">
      <Field label="Language" hint="What languages is it written in?">
        <TagPicker options={LANGUAGES} value={draft.inLanguage ?? []} onChange={(v) => set('inLanguage', v)} placeholder="Search languages…" />
      </Field>
      <Field label={domain === 'nonfiction' ? 'Subject' : 'Genre'} hint="The shelf it sits on.">
        <TagPicker options={genresForKind(domain)} value={draft.genre ?? []} onChange={(v) => set('genre', v)} placeholder={domain === 'nonfiction' ? 'Search subjects…' : 'Search genres…'} />
      </Field>
      <Field label="Themes" hint="What it’s really about — this powers discovery more than genre.">
        <TagPicker options={THEMES} value={draft.about ?? []} onChange={(v) => set('about', v)} placeholder="Search themes…" />
      </Field>
      <Field label="Content warnings" hint="A heads-up for sensitive content.">
        <TagPicker options={CONTENT_WARNINGS} value={draft.contentRating ?? []} onChange={(v) => set('contentRating', v)} placeholder="Search warnings…" />
      </Field>
      <Field label="Keywords" hint="Any free-form tags, comma-separated.">
        <Input maxLength={LIMITS.keywords} value={keywordsText} placeholder="court intrigue, slow burn" onChange={(e) => setKeywords(e.target.value)} />
      </Field>
    </div>
  )
}

function CreditsStep({ draft, set }: { draft: ProjectInfo; set: <K extends keyof ProjectInfo>(k: K, v: ProjectInfo[K]) => void }): JSX.Element {
  const contributors = draft.contributor ?? []
  const update = (next: Contributor[]): void => set('contributor', next)
  return (
    <div className="space-y-4">
      <Field label="Author" hint="The primary writer.">
        <Input maxLength={LIMITS.author} value={draft.author ?? ''} placeholder="Your name" onChange={(e) => set('author', e.target.value)} />
      </Field>
      <Field label="Contributors" hint="Anyone else — each with their roles (writer, translator, composer…).">
        <div className="space-y-2">
          {contributors.map((c, i) => (
            <div key={i} className="space-y-1.5 rounded-md border border-border/60 p-2">
              <div className="flex items-center gap-2">
                <Input maxLength={LIMITS.contributorName} value={c.name} placeholder="Name" onChange={(e) => update(contributors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button onClick={() => update(contributors.filter((_, j) => j !== i))} className="shrink-0 text-faint hover:text-flag" title="Remove">
                  <X className="size-4" />
                </button>
              </div>
              <TagPicker options={CONTRIBUTOR_ROLES} value={c.roles} onChange={(roles) => update(contributors.map((x, j) => (j === i ? { ...x, roles } : x)))} placeholder="Search or type a role…" allowCustom />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => update([...contributors, { name: '', roles: [] }])}>
            <Plus className="size-3.5" /> Add contributor
          </Button>
        </div>
      </Field>
    </div>
  )
}

// ── small shared pieces ─────────────────────────────────────────────────────

/** Single-select as a wrapping chip row (no dropdown — won't clip inside the scroll area). */
function OneOf({ options, value, onChange }: { options: readonly Option[]; value?: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(on ? '' : o.value)}
            className={cn('type-caption rounded-full border px-2 py-0.5 transition-colors', on ? 'border-thread bg-thread/15 text-thread' : 'border-border text-muted-foreground hover:bg-panel-soft hover:text-foreground')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Multi-select that SEARCHES (scales past 100 options): selected chips + a filter input with INLINE results. */
// `allowCustom` opens the picker to FREE TEXT — Enter (or the "Add …" row) adds whatever you typed as its own
// value, for open vocabularies like contributor roles. The stored value list is already `string[]`, and labelOf
// falls back to the raw value, so a custom tag renders everywhere. Leave it off for canonical enums (languages,
// content warnings) that must stay standardized for export.
function TagPicker({ options, value, onChange, placeholder, allowCustom }: { options: readonly Option[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; allowCustom?: boolean }): JSX.Element {
  const [query, setQuery] = useState('')
  const labelOfVal = (v: string): string => options.find((o) => o.value === v)?.label ?? v // custom values echo raw
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const matches = options.filter((o) => !value.includes(o.value) && (q === '' || o.label.toLowerCase().includes(q))).slice(0, 8)
  const exact = options.some((o) => o.label.toLowerCase() === q || o.value.toLowerCase() === q)
  const already = value.some((v) => labelOfVal(v).toLowerCase() === q)
  const canAddCustom = !!allowCustom && trimmed !== '' && !exact && !already
  const add = (v: string): void => {
    if (!value.includes(v)) onChange([...value, v])
    setQuery('')
  }
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="type-caption flex items-center gap-1 rounded-full border border-thread/40 bg-thread/15 px-2 py-0.5 text-thread">
              {labelOfVal(v)}
              <button onClick={() => onChange(value.filter((x) => x !== v))} title="Remove"><X className="size-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          placeholder={placeholder ?? (allowCustom ? 'Search or type your own…' : 'Search…')}
          className="pl-7"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (matches[0]) { e.preventDefault(); add(matches[0].value) }
            else if (canAddCustom) { e.preventDefault(); add(trimmed) }
          }}
        />
      </div>
      {trimmed !== '' && (matches.length > 0 || canAddCustom || !allowCustom) && (
        <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-panel-soft/50">
          {matches.map((o) => (
            <button key={o.value} onClick={() => add(o.value)} className="type-caption block w-full px-2 py-1 text-left text-muted-foreground hover:bg-panel-soft hover:text-foreground">
              {o.label}
            </button>
          ))}
          {canAddCustom && (
            <button onClick={() => add(trimmed)} className="type-caption block w-full px-2 py-1 text-left text-thread hover:bg-panel-soft">
              + Add “{trimmed}”
            </button>
          )}
          {matches.length === 0 && !canAddCustom && (
            <div className="type-caption px-2 py-1 text-faint">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <span className="type-label block text-faint">{label}</span>
      {hint && <span className="type-micro block leading-snug text-faint/80">{hint}</span>}
      <div className="pt-0.5">{children}</div>
    </div>
  )
}

