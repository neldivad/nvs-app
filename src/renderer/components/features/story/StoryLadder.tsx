import type { JSX } from 'react'
import { STORY_LADDER, SCENE_LEVEL } from '@/config/sceneLadder'
import { cn } from '@/lib/utils'

/**
 * The fixed story ladder as a visual — Book › Volume › … › Section › Scene, colour-dotted and indented. The
 * base component both Project Config (Structure) and Templates inherit: pass `active` to highlight the levels a
 * project (or preset) uses and dim the rest. Read-only; the ladder isn't editable (see config/sceneLadder.ts).
 */
export function StoryLadder({ active, compact }: { active?: Iterable<string>; compact?: boolean }): JSX.Element {
  const activeSet = active ? new Set(active) : null
  // Scene is the atomic leaf — always present, so never dimmed.
  const on = (key: string): boolean => key === SCENE_LEVEL.key || !activeSet || activeSet.has(key)
  const rows = [...STORY_LADDER, SCENE_LEVEL]
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      {rows.map((lvl, i) => (
        <div
          key={lvl.key}
          className={cn('flex items-center gap-2 rounded-md border px-2.5 transition-opacity', compact ? 'py-0.5' : 'py-1', on(lvl.key) ? 'border-border bg-panel' : 'border-transparent opacity-35')}
          style={{ marginLeft: `${i * (compact ? 10 : 14)}px` }}
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: lvl.color }} />
          <span className="shrink-0 text-[12px] font-medium text-foreground">{lvl.label}</span>
          {!compact && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{lvl.description}</span>}
        </div>
      ))}
    </div>
  )
}
