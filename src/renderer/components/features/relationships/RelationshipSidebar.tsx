/**
 * RelationshipSidebar — the LEFT fighter roster for the Relationships rail, ranked by total LINES spoken (the
 * most talkative leads float up). The right roster + arena live in RelationshipPanel; both read the matchup pair (relA/relB)
 * from the store, so this column and the pane stay in sync. Reuses the shared `Roster` + ranking hook.
 */
import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { Roster, rankChars, useCastRanking } from '@/components/features/relationships/RelationshipPanel'
import { SidebarHeader } from '@/components/layout/SidebarKit'
import type { SearchResult } from '@/components/ui/SearchPopover'
import { compactNumber } from '@/lib/utils'

export function RelationshipSidebar(): JSX.Element {
  const { t } = useTranslation('relationships')
  const characters = useWorkspace((s) => s.characters)
  const relA = useWorkspace((s) => s.relA)
  const relB = useWorkspace((s) => s.relB)
  const setRelA = useWorkspace((s) => s.setRelA)
  const { appearances } = useCastRanking()
  const ranked = useMemo(() => rankChars(characters, appearances), [characters, appearances])
  // Full roster always shown; search jumps to a fighter (picks it as the left "Fighter", same as clicking the row).
  const searchResults = (query: string): SearchResult[] => {
    const s = query.trim().toLowerCase()
    if (!s) return []
    return ranked.filter((c) => c.name.toLowerCase().includes(s)).map((c) => ({ id: c.id, label: c.name, meta: compactNumber(appearances.get(c.id) ?? 0) }))
  }
  return (
    <div className="flex h-full flex-col bg-panel">
      <SidebarHeader title={t('sidebar.reference')} search={{ results: searchResults, onSelect: setRelA, placeholder: t('panel.searchCharacters') }} />
      <div className="min-h-0 flex-1">
        <Roster chars={ranked} selected={relA} disabled={relB} onPick={setRelA} metric={appearances} />
      </div>
    </div>
  )
}
