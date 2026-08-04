/**
 * castRanking — rank the cast by dialogue volume, SCOPED to a scene subset (the active variant's canvas). The
 * roster + partner ranking (Relationship rail, Cast sidebar) read this so they reflect the timeline you're
 * viewing, consistent with the gantt X-axis (useSceneAxis). An EMPTY subset means "no subset placed" → every
 * scene counts. Pure + testable; magnitude is LINES spoken, not scene count.
 */

export interface Ranking {
  castByScene: { id: string; volume: number }[][]
  appearances: Map<string, number>
}

export function castRanking(
  scenes: Record<string, { cast: { entityId: string; volume?: number }[] }>,
  subset: ReadonlySet<string>
): Ranking {
  const all = subset.size === 0
  const castByScene = Object.entries(scenes)
    .filter(([id]) => all || subset.has(id))
    .map(([, sc]) => sc.cast.map((c) => ({ id: c.entityId, volume: c.volume ?? 0 })))
  const appearances = new Map<string, number>()
  for (const cast of castByScene) for (const { id, volume } of cast) appearances.set(id, (appearances.get(id) ?? 0) + volume)
  return { castByScene, appearances }
}
