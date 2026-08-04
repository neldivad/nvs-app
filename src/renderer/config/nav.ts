import {
  PenLine,
  Globe,
  Spline,
  Users,
  Swords,
  ShieldAlert,
  Clock,
  KeyRound,
  LayoutGrid,
  type LucideIcon
} from 'lucide-react'

/** The left-rail workspaces. Order is the intended reading flow: write -> understand. */
export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  /** Archetype color token (see DESIGN.md): the only decorative system. */
  accent: 'ink' | 'thread' | 'character' | 'lore' | 'flag'
  /** P-phase that lights this panel up; shown as "soon" until then. */
  phase: number
  /** Rail section — the tier model as IA: what the AUTHOR edits · the graphic/canvas surfaces · what T1 derives ·
   *  what T2 infers. Each group gets a divider in the rail. */
  group: 'author' | 'graphic' | 't1' | 't2'
}

export const NAV: NavItem[] = [
  // what the author EDITS (files are the product)
  { id: 'editor',  label: 'Editor',  icon: PenLine,     accent: 'ink',       phase: 1, group: 'author' },
  { id: 'world',   label: 'World',   icon: Globe,        accent: 'character', phase: 1, group: 'author' },
  { id: 'custody', label: 'Custody', icon: KeyRound, accent: 'lore', phase: 1, group: 'author' },
  // the GRAPHIC / canvas surfaces (freeform board + the story chart) — both are xyflow canvases
  { id: 'corkboard', label: 'Corkboard', icon: LayoutGrid, accent: 'ink', phase: 1, group: 'graphic' },
  { id: 'timeline', label: 'Timeline', icon: Clock, accent: 'lore', phase: 1, group: 'graphic' },
  // what T1 DERIVES (deterministic — works the moment a work is ingested)
  { id: 'cast', label: 'Cast', icon: Users, accent: 'character', phase: 1, group: 't1' },
  { id: 'relationships', label: 'Relations', icon: Swords, accent: 'character', phase: 1, group: 't1' },
  // what T2/T3 INFERS (the analysis runs)
  { id: 'threads', label: 'Threads', icon: Spline,       accent: 'thread',    phase: 1, group: 't2' },
  { id: 'coherence', label: 'Coherence', icon: ShieldAlert, accent: 'flag', phase: 1, group: 't2' }
]
