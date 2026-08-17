/**
 * StructuralChecks — the deterministic "second reader" strip atop the Coherence rail. Runs the instant, no-LLM
 * integrity pass (duplicate scene_id · dangling/self leads_to · missing id) over the story tree and lists what
 * it finds, each clickable to the offending scene. Clean = a quiet confirmation line (so the check is visible,
 * not a hidden feature). See internal/renpy-crossref.md (borrow: static second reader; anti-pattern #1).
 */
import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { checkIntegrity, type IntegritySeverity } from '@/lib/analysis/integrityCheck'
import { activeVariant, withVariantEdges } from '@/lib/timeline/treeVariant'

const DOT: Record<IntegritySeverity, string> = { error: 'bg-flag', warn: 'bg-lore', info: 'bg-muted-foreground' }
const CAP = 12 // render-depth bound — cap the list, honest "+N more" tail

export function StructuralChecks(): JSX.Element {
  const { t } = useTranslation('structuralChecks')
  const storyTree = useWorkspace((s) => s.storyTree)
  const trees = useWorkspace((s) => s.trees)
  const graph = useWorkspace((s) => s.timelineGraph) // scene cast → orphan-page check
  const worldPages = useWorkspace((s) => s.worldPages) // pages to test for orphans
  const openPage = useWorkspace((s) => s.openPage)
  // Check the ACTIVE tree variant's connections (they live in trees.json now, not frontmatter) — dangling/self
  // edges are the variant's, and a dangling edge is exactly the "points at a scene that no longer exists" case.
  const tree = useMemo(() => withVariantEdges(storyTree, activeVariant(trees)?.adjacency ?? {}), [storyTree, trees])
  const issues = useMemo(() => checkIntegrity(tree, { graph, worldPages }), [tree, graph, worldPages])

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-1 text-[11px] text-faint" title={t('checkTitle')}>
        <span className="size-1.5 rounded-full bg-ok" />
        {t('clean')}
      </div>
    )
  }

  const errors = issues.filter((i) => i.severity === 'error').length
  const shown = issues.slice(0, CAP)
  return (
    <div className="border-b border-border bg-panel-soft/30">
      <div className="flex items-center gap-1.5 px-4 py-1 text-[11px] font-medium text-foreground">
        <span className="size-1.5 rounded-full bg-flag" />
        {t('issues', { count: issues.length })}
        {errors > 0 && <span className="text-flag">{t('toFix', { count: errors })}</span>}
      </div>
      <div className="max-h-32 overflow-auto px-2 pb-1">
        {shown.map((iss, i) => (
          <button
            key={i}
            onClick={() => void openPage({ path: iss.path, title: iss.title, kind: iss.pageKind ?? 'scene' })}
            title={iss.pageKind ? t('openPage') : t('openScene')}
            className="flex w-full items-start gap-1.5 rounded px-2 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
          >
            <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', DOT[iss.severity])} />
            <span className="min-w-0 flex-1">{iss.message}</span>
          </button>
        ))}
        {issues.length > CAP && <div className="px-2 py-0.5 text-[10px] text-faint">{t('more', { count: issues.length - CAP })}</div>}
      </div>
    </div>
  )
}
