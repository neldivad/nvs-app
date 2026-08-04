/**
 * Canonical archetype → color for threads (sibling of entityVisual). The Gantt lane is colored
 * by thread_type so a lane's color *means* its kind; marker shape carries the action, lane opacity
 * the open/closed status — three orthogonal channels, no redundancy.
 *
 * thread_type is a small producer vocab (mystery · promise · conflict · task · foreshadowing), but
 * it's free text, so unknown types get a *deterministic* color (hash, not index-cycle) — stable as
 * rows filter and re-sort.
 */
export interface ThreadVisual {
  text: string // text-* token for labels
  bg: string // bg-* for the lane line + filled markers
  border: string // border-* for hollow markers (reopen)
  label: string // human archetype name
}

const PALETTE: Omit<ThreadVisual, 'label'>[] = [
  { text: 'text-thread', bg: 'bg-thread', border: 'border-thread' },
  { text: 'text-character', bg: 'bg-character', border: 'border-character' },
  { text: 'text-lore', bg: 'bg-lore', border: 'border-lore' },
  { text: 'text-ok', bg: 'bg-ok', border: 'border-ok' },
  { text: 'text-flag', bg: 'bg-flag', border: 'border-flag' }
]

// Curated archetypes (index into PALETTE so known + unknown share one set).
const KNOWN: Record<string, number> = {
  task: 0,
  foreshadowing: 1,
  mystery: 2,
  promise: 3,
  conflict: 4
}

const titleCase = (s: string): string => s.replace(/(^|[\s_-])(\w)/g, (_, p, c: string) => (p ? ' ' : '') + c.toUpperCase())

export function threadVisual(type: string | null | undefined): ThreadVisual {
  const key = (type ?? 'thread').toLowerCase()
  if (key in KNOWN) return { ...PALETTE[KNOWN[key]], label: titleCase(key) }
  // Deterministic fallback: hash the type name → a stable palette slot.
  const h = [...key].reduce((a, c) => a + c.charCodeAt(0), 0)
  return { ...PALETTE[h % PALETTE.length], label: titleCase(key) }
}
