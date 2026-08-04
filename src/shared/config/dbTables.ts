/**
 * Which analysis-DB tables the Database inspector SURFACES. The engine keeps machinery tables — the migration
 * ledger, per-AI-call bookkeeping, resolution/rollup caches, and precomputed snapshots that just mirror the
 * rails — alongside the narrative primaries. The inspector's job is "what the engine knows about the STORY",
 * not its plumbing, so those are hidden.
 *
 * A DENYLIST (not an allowlist) on purpose: a new narrative table added later shows by default; only known
 * machinery is hidden. Keep this the single source — agent-facing surfaces can read the same list.
 */
export const HIDDEN_DB_TABLES: ReadonlySet<string> = new Set<string>([
  '_migrations', // the migration ledger — pure plumbing
  'inference_runs', // per-AI-call provenance + cost bookkeeping
  'name_resolution', // alias → entity resolution cache
  'rollups', // derived aggregate cache (rails compute from the primaries)
  'co_presence_snapshot', // precomputed co-presence — mirrors the Cast co-presence matrix
  'entity_presence_snapshot' // precomputed presence snapshot — derived
])

/** True when a table is worth showing in the inspector (i.e. a narrative primary, not machinery). */
export function isSurfacedTable(name: string): boolean {
  return !HIDDEN_DB_TABLES.has(name)
}
