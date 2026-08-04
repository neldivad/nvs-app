/**
 * threadDups.ts — detect LIKELY-duplicate threads (a read-only nudge; no merge yet).
 *
 * Thread ids are `thr:<opening-scene>:<slug>`. The common duplication mode is the scene
 * pass RE-OPENING an existing thread under a new scene prefix but the SAME slug-tail →
 * two umbrella rows for one promise, with the beats split between them. We flag that
 * exact-slug collision: high precision (the model reused the verbatim handle), cheap, and
 * deterministic. The harder semantic case (`find_heir` vs `locate_heir` — different slugs,
 * one promise) needs meaning, so it's the LLM's call and deliberately out of scope here.
 *
 * A deliberate recast is recorded via `succeeds` (a thread supersedes its predecessor). We
 * DON'T drop those — during the observe-the-firing-rate phase we want every collision — but
 * we annotate the group so the UI can soften the wording instead of crying duplicate.
 */
import type { Thread } from '@shared/ipc'

export interface DuplicateGroup {
  slug: string
  threads: Thread[] // ≥2 threads sharing this slug, earliest opener first (the natural canonical)
  superseded: boolean // a member's `succeeds` points at another member → likely an intentional retcon, not a dupe
}

/** Group threads by their slug-tail; a slug shared by ≥2 umbrellas is a duplicate candidate. */
export function duplicateThreadGroups(threads: Thread[]): DuplicateGroup[] {
  const bySlug = new Map<string, Thread[]>()
  for (const t of threads) {
    if (!t.slug) continue
    const arr = bySlug.get(t.slug)
    if (arr) arr.push(t)
    else bySlug.set(t.slug, [t])
  }

  const groups: DuplicateGroup[] = []
  for (const [slug, ts] of bySlug) {
    if (ts.length < 2) continue
    const ids = new Set(ts.map((t) => t.id))
    const superseded = ts.some((t) => !!t.succeeds && ids.has(t.succeeds))
    const sorted = [...ts].sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))
    groups.push({ slug, threads: sorted, superseded })
  }
  // Most-threads-first surfaces the worst splits at the top; slug breaks ties for stable order.
  groups.sort((a, b) => b.threads.length - a.threads.length || a.slug.localeCompare(b.slug))
  return groups
}
