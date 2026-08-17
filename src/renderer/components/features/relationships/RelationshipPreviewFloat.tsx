/**
 * RelationshipPreviewFloat — the castRail peek (a co-presence cell / graph edge). Instead of a filler summary,
 * it serves a SLICE of the real Relationships pane: the first few scenes of the actual RelationshipSpine (same
 * component the rail renders), then a "view more" doorway that seeds the pair and switches to the full rail. It
 * fetches the pair's evidence + derives the scene axis exactly like the pane, so what you see is a true preview.
 */
import { useEffect, useState, type JSX } from 'react'
import { Loader2, X, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import { FloatWindow, type Box } from '@/components/layout/FloatWindow'
import { RelationshipSpine } from '@/components/features/relationships/RelationshipSpine'
import { useSceneAxis } from '@/components/features/relationships/RelationshipPanel'
import type { RelationshipEvidence } from '@shared/ipc'

const PREVIEW = 6 // scenes shown before the "view more" doorway
const box = (): Box => ({
  left: Math.max(8, window.innerWidth / 2 - 300),
  top: 100,
  width: 600,
  height: Math.max(300, Math.min(window.innerHeight - 160, 500))
})

export function RelationshipPreviewFloat({ aId, bId, onClose }: { aId: string; bId: string; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('relationships')
  const setRelA = useWorkspace((s) => s.setRelA)
  const setRelB = useWorkspace((s) => s.setRelB)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const [ev, setEv] = useState<RelationshipEvidence | null>(null)
  const sceneAxis = useSceneAxis(aId, bId)

  useEffect(() => {
    let dead = false
    void window.nvs.relationshipEvidence(aId, bId).then((r) => {
      if (!dead) setEv(r)
    })
    return () => {
      dead = true
    }
  }, [aId, bId])

  const openRail = (): void => {
    setRelA(aId)
    setRelB(bId)
    setWorkspace('relationships')
    onClose()
  }

  return (
    <FloatWindow region="characterDynamicFloat" persistKey="relationship-preview" accent="var(--character)" maxWidth={760} onEscape={onClose} initial={box}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <div className="truncate text-sm font-medium">{ev ? `${ev.a.name} ↔ ${ev.b.name}` : t('preview.title')}</div>
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 select-text overflow-auto p-3">
          {!ev ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
          ) : ev.events.length === 0 && ev.coScenes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('preview.neverShare', { a: ev.a.name, b: ev.b.name })}</p>
          ) : (
            <RelationshipSpine ev={ev} sceneAxis={sceneAxis} latest={false} preview={PREVIEW} />
          )}
        </div>
        <button
          onClick={openRail}
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[12px] font-medium text-character transition-colors hover:bg-character/10"
        >
          {t('preview.viewMore')} <ArrowRight className="size-3.5" />
        </button>
      </div>
    </FloatWindow>
  )
}
