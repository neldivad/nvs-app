import { useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Image as ImageIcon, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LANGUAGES, MEDIUMS, STATUSES, GENRES, THEMES, CONTENT_WARNINGS, CONTRIBUTOR_ROLES, DOMAINS, labelOf, normalizeProjectInfo, type Option } from '@shared/config/projectSchema'
import type { ProjectInfo } from '@shared/ipc'

/**
 * The read-only "book card" — a project's authored identity rendered AniDB/VNDB-style: cover + a labeled facts
 * table (Type · Status · Author · Language with flags · Genre/Themes/Warnings as chips · Keywords) + Synopsis +
 * a staff-style Credits table (capped, "Show all"). Shared by Project Details (view + review) and the Share
 * dialog (preview). `onEdit` shows an Edit button; omit it for a pure preview.
 */
export function BookCard({ info: rawInfo, fallbackTitle, onEdit, basePath, preview }: { info: ProjectInfo; fallbackTitle: string; onEdit?: () => void; basePath?: string; preview?: boolean }): JSX.Element {
  // Last line of defense against SHAPE DRIFT — this render point is fed from the engine (already normalized), the
  // edit wizard's draft (arrays), AND the community registry (registryWorkToProjectInfo, which may forward a scalar
  // `genre`). Normalize here too so a scalar array-field can never reach a `.map` below and white-screen the dialog.
  const { t } = useTranslation('store')
  const info = normalizeProjectInfo(rawInfo)
  // `info.cover` is project-relative. Open project → the protocol resolves it against current.root. Previewing an
  // UNOPENED work (basePath given) → build the absolute, encoded library path instead (else it 404s — no project).
  const bust = `?t=${encodeURIComponent(info.updatedAt ?? '')}`
  const coverUrl = info.cover ? (basePath ? `nvs-asset://${encodeURI(`${basePath}/${info.cover}`)}${bust}` : `nvs-asset://${info.cover}${bust}`) : null
  const langs = (info.inLanguage ?? []).map((v) => {
    const o = LANGUAGES.find((x) => x.value === v)
    return o ? `${o.flag ?? ''} ${o.label}`.trim() : v
  })
  // `preview` mode (the library detail dialog) always renders the FULL facts table so the dialog is a constant
  // size regardless of how much a project fills in — empty fields show an em-dash placeholder rather than vanish.
  const dash = <span className="text-faint">—</span>
  const facts: Array<[string, ReactNode]> = []
  const add = (label: string, value: ReactNode, has: boolean): void => { if (has || preview) facts.push([label, has ? value : dash]) }
  // KIND — the parent of the shelf, shown first with its identity color (fiction=indigo/thread, non-fic=teal/ok).
  // Only surfaced when the project has DECLARED a domain (existing fiction projects don't shout "Fiction").
  add(t('field.kind'), info.domain ? <KindChip domain={info.domain} /> : null, !!info.domain)
  add(t('field.type'), info.medium ? labelOf(MEDIUMS, info.medium) : null, !!info.medium)
  add(t('field.status'), info.status ? labelOf(STATUSES, info.status) : null, !!info.status)
  add(t('field.author'), info.author, !!info.author)
  add(t('field.language'), langs.length ? langs.join('   ') : null, langs.length > 0)
  add(info.domain === 'nonfiction' ? t('field.subject') : t('field.genre'), info.genre?.length ? <Chips key="g" opts={GENRES} vals={info.genre} tone="text-character" /> : null, !!info.genre?.length)
  add(t('field.themes'), info.about?.length ? <Chips key="t" opts={THEMES} vals={info.about} tone="text-lore" /> : null, !!info.about?.length)
  add(t('field.warnings'), info.contentRating?.length ? <Chips key="w" opts={CONTENT_WARNINGS} vals={info.contentRating} tone="text-flag" /> : null, !!info.contentRating?.length)
  add(t('field.keywords'), info.keywords?.length ? info.keywords.join(', ') : null, !!info.keywords?.length)
  const credits = (info.contributor ?? []).filter((c) => c.name.trim())
  const [showAllCredits, setShowAllCredits] = useState(false)
  const shownCredits = showAllCredits ? credits : credits.slice(0, 10) // a whole village → cap, "show all"

  // Lineage / IP — shown only when present (fork sets forkedFrom; the rest are authored).
  const relations: Array<[string, ReactNode]> = []
  if (info.isPartOf) relations.push([t('relation.series'), info.position ? `${info.isPartOf} · #${info.position}` : info.isPartOf])
  if (info.isBasedOn) relations.push([t('relation.basedOn'), info.isBasedOn])
  if (info.forkedFrom) relations.push([t('relation.forkedFrom'), info.forkedFrom])
  if (info.coverOf) relations.push([t('relation.coverOf'), info.coverOf])
  if (info.promptSource) relations.push([t('relation.prompt'), info.promptSource])

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="flex h-44 w-30 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-soft">
          {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : <ImageIcon className="size-7 text-faint" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold leading-tight text-foreground">{info.title || fallbackTitle}</div>
              {info.subtitle && <div className="text-xs text-muted-foreground">{info.subtitle}</div>}
              {info.logline && <p className="mt-0.5 text-[12px] italic text-muted-foreground">“{info.logline}”</p>}
            </div>
            {onEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="size-3" /> {t('button.edit')}
              </Button>
            )}
          </div>
          {facts.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-md border border-border/60">
              {facts.map(([label, value], i) => (
                <div key={label} className={cn('grid grid-cols-[5.25rem_1fr] gap-2 px-2.5 py-1 text-[12px]', i % 2 === 1 && 'bg-panel-soft/30')}>
                  <span className="pt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</span>
                  <span className="min-w-0 wrap-break-word text-foreground/85">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(info.description || preview) && (
        <Section title={t('heading.synopsis')}>
          {info.description ? (
            <p className="text-[12px] leading-relaxed text-foreground/85">{info.description}</p>
          ) : (
            <p className="text-[12px] italic text-faint">{t('empty.noSynopsis')}</p>
          )}
        </Section>
      )}

      {credits.length > 0 && (
        <Section title={`${t('heading.credits')}${credits.length > 1 ? ` · ${credits.length}` : ''}`}>
          <div className="overflow-hidden rounded-md border border-border/60">
            {shownCredits.map((c, i) => (
              <div key={i} className={cn('grid grid-cols-[1fr_1.3fr] items-baseline gap-2 px-2.5 py-1 text-[12px]', i % 2 === 1 && 'bg-panel-soft/30')}>
                <span className="wrap-break-word font-medium text-foreground/90">{c.name}</span>
                <span className="wrap-break-word text-faint">{c.roles.map((r) => labelOf(CONTRIBUTOR_ROLES, r)).join(', ') || t('empty.contributor')}</span>
              </div>
            ))}
          </div>
          {credits.length > 10 && (
            <button onClick={() => setShowAllCredits((v) => !v)} className="mt-1 text-[11px] text-thread hover:underline">
              {showAllCredits ? t('button.showLess') : t('button.showAll', { count: credits.length })}
            </button>
          )}
        </Section>
      )}

      {relations.length > 0 && (
        <Section title={t('heading.relations')}>
          <div className="overflow-hidden rounded-md border border-border/60">
            {relations.map(([label, value], i) => (
              <div key={label} className={cn('grid grid-cols-[5.25rem_1fr] gap-2 px-2.5 py-1 text-[12px]', i % 2 === 1 && 'bg-panel-soft/30')}>
                <span className="pt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</span>
                <span className="min-w-0 wrap-break-word text-foreground/85">{value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

/** KIND indicator — a colored dot + label (fiction=indigo/thread, non-fiction=teal/ok; never red). */
function KindChip({ domain }: { domain: string }): JSX.Element {
  const dot = domain === 'nonfiction' ? 'bg-ok' : 'bg-thread'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', dot)} />
      {labelOf(DOMAINS, domain)}
    </span>
  )
}

/** Inline chips for a facts-table value cell (genre/themes/warnings). */
function Chips({ opts, vals, tone }: { opts: readonly Option[]; vals: string[]; tone: string }): JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {vals.map((v) => (
        <span key={v} className={cn('rounded-full border border-current/30 px-1.5 py-0 text-[10px] leading-relaxed', tone)}>{labelOf(opts, v)}</span>
      ))}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</div>
      {children}
    </div>
  )
}
