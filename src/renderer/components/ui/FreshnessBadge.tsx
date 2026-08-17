/**
 * The freshness doorway — a small badge the analysis-fed rails (Threads, Coherence) show in their header.
 *
 * It's the discoverability fix from internal/ingest-model.md: the author already looks at the rails, so the
 * rail itself says "N scenes outdated — Update" and clicking it opens the Analysis console. The author never
 * has to know the dock exists. Shared so every rail speaks identically; re-reads when `freshnessVersion`
 * bumps (a scene save, an Update run).
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { TierStatusRow } from '@shared/ipc'
import { freshnessCounts, needsAttention, outdatedCount } from '@shared/config/ingest'
import { useWorkspace } from '@/stores/workspace'

/** Read the canon-set tracer, re-fetching whenever freshness may have changed. Shared by the rail
 *  badge and the notification mailbox so they agree on what's outdated. */
export function useFreshness(): TierStatusRow[] {
  const version = useWorkspace((s) => s.freshnessVersion)
  const project = useWorkspace((s) => s.project)
  const [rows, setRows] = useState<TierStatusRow[]>([])
  useEffect(() => {
    let alive = true
    void window.nvs.listTierStatus().then((r) => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [version, project])
  return rows
}

/** Header pill: hidden when everything's up to date; otherwise the clickable "Update" doorway. */
export function FreshnessBadge(): JSX.Element | null {
  const { t } = useTranslation('freshnessBadge')
  const rows = useFreshness()
  const openDockTab = useWorkspace((s) => s.openDockTab)
  const counts = freshnessCounts(rows)
  if (!needsAttention(counts)) return null
  const n = outdatedCount(counts)
  // A status DOORWAY, not a second Update button — clicking opens the Analysis dock where the single
  // Update action lives. (The dock owns the verb; everywhere else just points there.)
  return (
    <button
      onClick={() => openDockTab('ingest')}
      title={t('title')}
      className="flex shrink-0 items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn hover:bg-warn/20"
    >
      <AlertTriangle className="size-2.5" />
      {t('outdated', { count: n })}
    </button>
  )
}
