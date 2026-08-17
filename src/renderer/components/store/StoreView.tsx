/**
 * StoreView — the full-page "Store" place (a sibling of the library), launched from the RightRail's bottom
 * corner. It's a thin SHELL: a header (← Projects · a top-center search · the two page tabs) over two pages —
 * Community (content: shared works) and Extensions (tools: out-of-process plugins). Each page owns its own
 * sub-tabs + card/detail (composed from the shared StoreCard / StoreDetail). The `discoverOpen` value ('community'
 * | 'extensions' | null) drives both open-state and which page is active.
 */
import { useState, type JSX } from 'react'
import { ArrowLeft, Globe2, Puzzle, Search, X, Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { regionAttrs } from '@/config/regions'
import { cn } from '@/lib/utils'
import { CommunityPage } from '@/components/store/CommunityPage'
import { ExtensionPage } from '@/components/store/ExtensionPage'
import { ClaudeConnectPage } from '@/components/store/ClaudeConnectPage'

export function StoreView(): JSX.Element | null {
  const { t } = useTranslation('store')
  const page = useWorkspace((s) => s.discoverOpen)
  const setPage = useWorkspace((s) => s.setDiscoverOpen)
  const project = useWorkspace((s) => s.project)
  const [search, setSearch] = useState('')

  if (!page) return null

  // The store OVERLAYS the workspace — closing it just returns you to whatever was underneath (your open
  // project, unedited; or the library). It must NEVER exit your work. Leaving the project for the library is
  // a separate, deliberate action (TitleBar → Return to Library).
  const close = (): void => setPage(null)

  // Each page is a different KIND of thing — stories to read (character/cyan), tools that run inside NVS
  // (thread/indigo), NVS inside Claude (lore/amber). The accent stays lit even when inactive so the three
  // identities read apart at a glance instead of blurring into one tab strip.
  const TABS = {
    community: { icon: Globe2, label: t('tab.works'), hint: t('tab.worksHint'), tint: 'text-character', active: 'bg-character/10 text-character' },
    extensions: { icon: Puzzle, label: t('tab.extensions'), hint: t('tab.extensionsHint'), tint: 'text-thread', active: 'bg-thread/10 text-thread' },
    claude: { icon: Bot, label: 'Claude', hint: t('tab.claudeHint'), tint: 'text-lore', active: 'bg-lore/10 text-lore' }
  } as const

  const pageTab = (id: keyof typeof TABS): JSX.Element => {
    const t = TABS[id]
    const Icon = t.icon
    return (
      <button
        key={id}
        onClick={() => { setPage(id); setSearch('') }}
        title={t.hint}
        className={cn('type-body-sm flex items-center gap-1.5 rounded-md px-3 py-1 transition-colors', page === id ? t.active : 'text-muted-foreground hover:bg-panel-soft hover:text-foreground')}
      >
        <Icon className={cn('size-4', page === id ? '' : t.tint)} />
        {t.label}
      </button>
    )
  }

  return (
    <div {...regionAttrs('storeView')} className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* header: back · centered search · page tabs */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button onClick={close} className="type-caption flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground" title={project ? t('nav.backToWork') : t('nav.backToProjects')}>
            <ArrowLeft className="size-4" /> {project ? t('nav.back') : t('nav.projects')}
          </button>
          <div className="h-4 w-px bg-border" />
          <span className="type-panel-heading">{t('shell.heading')}</span>
        </div>
        {/* top-center search (not on the instructional Claude tab) */}
        <div className="relative w-80 max-w-[40vw]">
          {page !== 'claude' && (
            <>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={page === 'community' ? t('search.works') : t('search.extensions')}
                className="type-caption w-full rounded-md border border-border bg-panel/60 py-1.5 pl-8 pr-7 text-foreground outline-none placeholder:text-faint focus:border-thread/50"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint hover:text-foreground"><X className="size-3.5" /></button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-1">
          {pageTab('community')}
          {pageTab('extensions')}
          {pageTab('claude')}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Store content is reading material (titles, authors, loglines, sizes) — override the app-chrome
            user-select:none so it can be copied. */}
        <div className="mx-auto max-w-5xl select-text p-6">
          {page === 'community' ? <CommunityPage search={search} /> : page === 'extensions' ? <ExtensionPage search={search} /> : <ClaudeConnectPage />}
        </div>
      </div>
    </div>
  )
}
