/**
 * POV default — when a scene doesn't declare `pov` in frontmatter, it defaults to the scene's **dominant
 * speaker** (the cast member with the most dialogue volume). Pure: the renderer derives it from the timeline
 * graph's per-scene `cast` (which already carries `volume`), so no new engine query. See decisions.md (POV).
 */
import type { TimelinePresence } from '@shared/ipc'

/** The entityId who speaks the most volume in a scene; null when nobody speaks (all-narration). Ties → the
 *  first (highest-ranked) cast member, since `volume` strictly increases to replace. */
export function dominantSpeaker(cast: Pick<TimelinePresence, 'entityId' | 'volume'>[]): string | null {
  let best: { entityId: string; volume: number } | null = null
  for (const c of cast) {
    const volume = c.volume ?? 0
    if (volume > 0 && (!best || volume > best.volume)) best = { entityId: c.entityId, volume }
  }
  return best?.entityId ?? null
}
