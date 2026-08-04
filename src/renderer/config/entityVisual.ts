/**
 * One identity per world-page kind — icon + accent + chip classes — so an entity looks the
 * SAME everywhere it appears: the scene EntityPicker, the @-mention menu, Preview links, and
 * the "Mentioned by" backlinks. Single source of truth (replaces the divergent per-component maps).
 */
import { Users, MapPin, Package, Boxes, ScrollText, type LucideIcon } from 'lucide-react'

export interface EntityVisual {
  Icon: LucideIcon
  text: string // text color, e.g. for links/icons
  chip: string // filled pill classes (border + bg + text)
}

const VISUALS: Record<string, EntityVisual> = {
  character: { Icon: Users, text: 'text-character', chip: 'border-character bg-character-bg text-character' },
  location: { Icon: MapPin, text: 'text-lore', chip: 'border-lore bg-lore-bg text-lore' },
  item: { Icon: Package, text: 'text-thread', chip: 'border-thread bg-thread-bg text-thread' },
  faction: { Icon: Boxes, text: 'text-character', chip: 'border-character bg-character-bg text-character' }, // actor-like → character palette
  lore: { Icon: ScrollText, text: 'text-lore', chip: 'border-lore bg-lore-bg text-lore' }
}

/** Unknown/custom categories (a user-defined enum) resolve here — a neutral generic, until the category-creation
 *  UI lets the author pick an icon (stored on the category, resolved through this same function). */
const FALLBACK: EntityVisual = { Icon: Boxes, text: 'text-muted-foreground', chip: 'border-border bg-panel-soft text-muted-foreground' }

export function entityVisual(kind: string): EntityVisual {
  return VISUALS[kind] ?? FALLBACK
}
