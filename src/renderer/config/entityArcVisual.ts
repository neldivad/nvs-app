/**
 * Renderer-side visuals for entity arc events — maps a category-specific change verb (acquired/transferred/…)
 * onto the shared 4-tone arc palette via the config's `tone`, so item/faction changes render with the SAME
 * dot/verb grammar as character gain/loss/expose (no new palette). Mirrors config/arcVisual's changeVisual.
 */
import { arcChangeTone, type ArcTone } from '@shared/config/entityArc'

interface ToneVisual {
  dot: string
  text: string
}
const TONE: Record<ArcTone, ToneVisual> = {
  gain: { dot: 'bg-ok', text: 'text-ok' },
  loss: { dot: 'bg-flag', text: 'text-flag' },
  expose: { dot: 'bg-lore', text: 'text-lore' },
  neutral: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' } // a lateral move (transfer/alter/use)
}

/** change verb → {dot, text} via its tone. The verb itself is the label (already human: "acquired"). */
export const entityChangeVisual = (change: string): ToneVisual => TONE[arcChangeTone(change)]
export const entityChangeDot = (change: string): string => TONE[arcChangeTone(change)].dot
