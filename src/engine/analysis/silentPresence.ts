/**
 * silentPresence.ts — the pure core of "who was in the room but never spoke".
 *
 * The T2 extraction reads the whole prose cast (`extracted_scenes.characters_json`), including characters
 * with no dialogue — who therefore never got an `entity_presence` 'speaker' row. Given the scene's existing
 * cast (speaker entity ids) and the prose-read names + a name→id resolver, return the ids to ADD as silent
 * presence: resolved, not already present, de-duped, source order preserved. Unresolved names (no entity /
 * world page) are dropped — we can't place them. The reader pushes each as role 'present', 0 lines.
 */
export function silentPresenceIds(
  present: Iterable<string>,
  names: string[],
  resolve: (name: string) => string | undefined
): string[] {
  const have = new Set(present)
  const out: string[] = []
  for (const nm of names) {
    const id = resolve(nm)
    if (!id || have.has(id)) continue // unresolved, already a speaker, or a duplicate name in this list
    have.add(id)
    out.push(id)
  }
  return out
}
