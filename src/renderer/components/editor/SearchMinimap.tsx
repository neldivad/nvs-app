/**
 * SearchMinimap — a thin overview ruler pinned to the right edge of an editor while the FindBar is open. Each
 * match is a tick at its proportional vertical position in the document, so ⌘F gives SPATIAL awareness (where the
 * hits cluster in a long scene/page), not just next/prev. The current match is emphasized; clicking a tick jumps
 * to it. Presentational + engine-agnostic: the host passes markers ({pos 0..1, active}) computed from whichever
 * find engine it drives (tiptapSearch for the block editor, cmFind for CodeMirror), and an onJump(index).
 */
import type { JSX } from 'react'
import { cn } from '@/lib/utils'

export interface Marker {
  pos: number // 0..1 vertical position in the document
  active: boolean
}

export function SearchMinimap({ markers, onJump }: { markers: Marker[]; onJump: (index: number) => void }): JSX.Element | null {
  if (markers.length === 0) return null
  return (
    <div
      className="absolute right-0.5 top-2 bottom-2 z-10 w-2"
      title={`${markers.length} match${markers.length === 1 ? '' : 'es'}`}
    >
      {markers.map((m, i) => (
        <button
          key={i}
          onClick={() => onJump(i)}
          title={`Match ${i + 1} of ${markers.length}`}
          style={{ top: `${Math.min(99, Math.max(0, m.pos * 100))}%` }}
          className={cn(
            'absolute right-0 -translate-y-1/2 rounded-sm transition-all',
            m.active ? 'h-1 w-2 bg-thread' : 'h-0.5 w-1.5 bg-lore/70 hover:w-2 hover:bg-lore'
          )}
        />
      ))}
    </div>
  )
}

export interface LintMarker {
  pos: number // 0..1 vertical position (line / total lines) in the document
  line: number // the source line the issue points at — click to jump
  level: 'warn' | 'info'
}

/**
 * LintMinimap — the same overview ruler, for LINTER issues: a RED tick per issue at its proportional position,
 * always visible (not gated on find) so you can see where a scene's problems cluster and click a tick to jump to
 * that line in Write. Sits a touch inboard of the search ruler so the two never collide during a ⌘F.
 */
export function LintMinimap({ markers, onJump }: { markers: LintMarker[]; onJump: (line: number) => void }): JSX.Element | null {
  if (markers.length === 0) return null
  return (
    <div
      className="absolute right-2 top-2 bottom-2 z-10 w-2"
      title={`${markers.length} lint issue${markers.length === 1 ? '' : 's'}`}
    >
      {markers.map((m, i) => (
        <button
          key={i}
          onClick={() => onJump(m.line)}
          title={`Line ${m.line} — click to jump`}
          style={{ top: `${Math.min(99, Math.max(0, m.pos * 100))}%` }}
          className={cn(
            'absolute right-0 h-0.5 w-1.5 -translate-y-1/2 rounded-sm transition-all hover:w-2.5',
            m.level === 'warn' ? 'bg-flag/80 hover:bg-flag' : 'bg-muted-foreground/50 hover:bg-muted-foreground'
          )}
        />
      ))}
    </div>
  )
}
