/**
 * RelationshipDetail — the SCOPED peek (rail row-click): a CENTERED two-sided leaf spine of the given scene(s).
 * Shifts hang off as LEAVES, A's left / B's right (conflicts, mutual, sit left w/ a flag tone); filled ● active
 * / hollow ○ nodes. `RelationshipDetailFloat` wraps it in FloatWindow chrome. (The castRail "full" peek is the
 * separate RelationshipPreviewFloat — a slice of the actual rail pane + a doorway; it doesn't live here to keep
 * this file free of the RelationshipSpine import cycle.)
 */
import { useMemo, type JSX } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { facetVisual } from '@/config/arcVisual'
import { FloatWindow, type Box } from '@/components/layout/FloatWindow'
import type { RelationshipEvidence, RelEvidenceEvent } from '@shared/ipc'

const CHANGE_LABEL: Record<string, string> = { gain: 'gains', loss: 'loses', expose: 'exposes' }
const SPINE_COLS = 'grid-cols-[1fr_1.25rem_1fr]'

/** Defensive de-dup: the engine now emits a clean description, but a legacy/verbose one may still lead with
 *  "<name> · <verb> <facet>: " — strip that echo since the leaf already prints owner + facet + change. */
function cleanText(t: string): string {
  const i = t.indexOf(': ')
  if (i > 0 && i < 60) {
    const head = t.slice(0, i)
    if (/·/.test(head) || /\b(gains?|gained|los[te]|loses?|lost|expos\w*|neutral)\b/i.test(head)) return t.slice(i + 2).trim()
  }
  return t.trim()
}

export function RelationshipDetail({ ev, scenes }: { ev: RelationshipEvidence; scenes: Set<string> }): JSX.Element {
  const nodes = useMemo(() => {
    const meta = new Map<string, { title: string; pos: number }>()
    for (const s of ev.coScenes) if (scenes.has(s.sceneId)) meta.set(s.sceneId, { title: s.title, pos: s.pos })
    for (const e of ev.events) if (scenes.has(e.sceneId) && !meta.has(e.sceneId)) meta.set(e.sceneId, { title: e.title, pos: e.pos })
    const evByScene = new Map<string, RelEvidenceEvent[]>()
    for (const e of ev.events) {
      if (!scenes.has(e.sceneId)) continue
      const arr = evByScene.get(e.sceneId)
      if (arr) arr.push(e)
      else evByScene.set(e.sceneId, [e])
    }
    return [...meta.entries()]
      .map(([sceneId, m]) => {
        const evs = evByScene.get(sceneId) ?? []
        return {
          sceneId,
          title: m.title,
          pos: m.pos,
          left: evs.filter((e) => e.owner === null || e.owner === 'a'),
          right: evs.filter((e) => e.owner === 'b'),
          active: evs.length > 0
        }
      })
      .sort((x, y) => x.pos - y.pos)
  }, [ev.coScenes, ev.events, scenes])

  if (nodes.length === 0) return <p className="p-4 text-sm text-muted-foreground">No shifts here.</p>

  return (
    <div className="space-y-3">
      <div className={cn('grid gap-2 text-[11px] font-medium', SPINE_COLS)}>
        <div className="truncate text-right text-character">{ev.a.name}</div>
        <div />
        <div className="truncate text-left text-character">{ev.b.name}</div>
      </div>
      <div>
        {nodes.map((n, i) => (
          <div key={n.sceneId} className={cn('grid gap-2', SPINE_COLS)}>
            <div className="flex flex-col items-end justify-center gap-1 py-1">
              {n.left.map((e, j) => <Leaf key={j} e={e} side="a" />)}
            </div>
            <div className="flex flex-col items-center">
              <span title={n.title} className={cn('mt-1 text-[11px] leading-none', n.active ? 'text-character' : 'text-faint/50')}>{n.active ? '●' : '○'}</span>
              {i < nodes.length - 1 && <span className="mt-1 w-px flex-1 bg-border/60" />}
            </div>
            <div className="flex flex-col items-start justify-center gap-1 py-1">
              {n.right.map((e, j) => <Leaf key={j} e={e} side="b" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One shift as a leaf hanging off the spine toward its owner's side. */
function Leaf({ e, side }: { e: RelEvidenceEvent; side: 'a' | 'b' }): JSX.Element {
  const v = e.facet ? facetVisual(e.facet) : null
  const conflict = e.owner === null
  return (
    <div className={cn('max-w-64 rounded border px-2 py-1', side === 'a' ? 'text-right' : 'text-left', conflict ? 'border-flag/40 bg-flag/5' : 'border-border/50 bg-panel')}>
      <div className={cn('mb-0.5 flex items-center gap-1 text-[9px] uppercase leading-tight tracking-wide', side === 'a' && 'flex-row-reverse')}>
        <span className={cn('size-1.5 shrink-0 rounded-full', v?.sw ?? 'bg-flag')} />
        <span className={cn(conflict ? 'text-flag' : v?.text)}>
          {conflict ? 'conflict · mutual' : `${e.facet}${e.change ? ` · ${CHANGE_LABEL[e.change] ?? e.change}` : ''}`}
        </span>
      </div>
      {e.text && <p className="text-[11px] leading-snug text-foreground/85">{cleanText(e.text)}</p>}
    </div>
  )
}

const detailBox = (): Box => ({
  left: Math.max(8, window.innerWidth / 2 - 260),
  top: 110,
  width: 520,
  height: Math.max(240, Math.min(window.innerHeight - 220, 420))
})

/** FloatWindow-wrapped scoped leaf spine (rail row-click passes `ev` + the clicked scene). */
export function RelationshipDetailFloat({ ev, scenes, onClose }: { ev: RelationshipEvidence; scenes: Set<string>; onClose: () => void }): JSX.Element {
  return (
    <FloatWindow region="characterDynamicFloat" persistKey="relationship-detail" accent="var(--character)" maxWidth={720} onEscape={onClose} initial={detailBox}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <div className="truncate text-sm font-medium">{ev.a.name} ↔ {ev.b.name}</div>
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 select-text overflow-auto p-3">
          <RelationshipDetail ev={ev} scenes={scenes} />
        </div>
      </div>
    </FloatWindow>
  )
}
