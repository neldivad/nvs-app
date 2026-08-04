/**
 * The ONE declaration of every `.nvs/` artifact and how the app treats it. Reset-analysis, Export/Import, and
 * any future tooling reference THIS instead of each hard-coding its own keep/exclude list — so the
 * persisted/derived/local boundary can never drift or be violated silently (a redeploy script deleting
 * `timeline.json` = authored routes gone). See internal/renpy-crossref.md hardening #2.
 *
 * The boundary is not one bucket — it's THREE orthogonal facts, because they genuinely disagree (e.g.
 * `snapshots/` survives Reset yet never travels in an export):
 *   • class          — a summary label: `authored` (author intent) · `derived` (rebuildable from prose) · `local` (this machine).
 *   • survivesReset  — kept when "Reset analysis" rebuilds the DB. Only `nvs.db` is rebuildable-from-prose, so ONLY it is deleted.
 *   • exported       — travels in the community export bundle. The DB ships as the inseparable ledger; authored sidecars ship; local/history don't.
 */
export type ArtifactClass = 'authored' | 'derived' | 'local'

export interface NvsArtifact {
  name: string // path under `.nvs/` — a file, or a directory when `dir` is true
  dir?: boolean
  class: ArtifactClass
  survivesReset: boolean
  exported: boolean
  note: string
}

export const NVS_DIR = '.nvs'

export const NVS_ARTIFACTS: readonly NvsArtifact[] = [
  { name: 'project.json', class: 'authored', survivesReset: true, exported: true, note: 'identity — title, author, inLanguage' },
  { name: 'structure.json', class: 'authored', survivesReset: true, exported: true, note: 'designed story-structure vocabulary (set-and-forget)' },
  { name: 'timeline.json', class: 'authored', survivesReset: true, exported: true, note: 'AUTHORED chart-sequences (routes) + node layout + collapse state — losing this loses authorial intent' },
  { name: 'trees.json', class: 'authored', survivesReset: true, exported: true, note: 'AUTHORED tree variants (tlgLoadout) — the branch/merge graphs; the connection store after frontmatter leads_to is cut (tree-variant model)' },
  { name: 'coherence-rulings.json', class: 'authored', survivesReset: true, exported: true, note: 'author rulings on ghosts/findings — deliberately OUTSIDE the DB so Reset keeps them' },
  { name: 'ingest-runs.json', class: 'authored', survivesReset: true, exported: true, note: 'analysis-run provenance ledger' },
  { name: 'nvs.db', class: 'derived', survivesReset: false, exported: true, note: 'the analysis DB — the ONLY thing rebuildable from prose (Reset deletes it + its -wal/-shm); ships as the inseparable ledger' },
  { name: 'snapshots', dir: true, class: 'local', survivesReset: true, exported: false, note: 'version history the ledger references (gzipped `<id>.db.gz` DB backups; tiered retention) — NOT rederivable so Reset KEEPS it; local-only, a fork/import starts fresh' },
  { name: 'snapshot-cache', dir: true, class: 'derived', survivesReset: true, exported: false, note: 'materialized snapshot views — a pure cache; kept on Reset (cheap), never exported' },
  { name: 'ui-state.json', class: 'local', survivesReset: true, exported: false, note: 'machine-local view state (castExcluded, node colors, collapse)' },
  { name: 'ingest-telemetry.jsonl', class: 'local', survivesReset: true, exported: false, note: 'per-step analysis timings + the working-set audit (prompt chars by part) — machine-local diagnostics; never travels' },
  { name: 'job-live.json', class: 'local', survivesReset: true, exported: false, note: 'the running analysis heartbeat (any process, incl. headless) — how the Jobs rail sees external runs; stale beats age out' },
  { name: 'chat', dir: true, class: 'local', survivesReset: true, exported: false, note: 'private chat sessions — per-session store (`chat/index.json` + `chat/sessions/<id>.jsonl`); absolute paths, never shared' },
  { name: 'chat.json', class: 'local', survivesReset: true, exported: false, note: 'LEGACY monolithic chat store — migrated to `chat/` + deleted on first open; still listed so an un-migrated copy is export-excluded / import-wiped' },
  { name: 'tasks', dir: true, class: 'local', survivesReset: true, exported: false, note: 'background AI task inbox (`tasks/<id>.json`) — queued/running/done page edits incl. completed results awaiting apply; local-only, never travels' }
]

const byName = (a: NvsArtifact): string => a.name

/** Files "Reset analysis" deletes before re-ingest (with SQLite `-wal`/`-shm` sidecars for `.db`). Everything else in `.nvs/` survives. */
export const RESET_DELETE_FILES: readonly string[] = NVS_ARTIFACTS.filter((a) => !a.survivesReset).flatMap((a) =>
  a.name.endsWith('.db') ? [a.name, `${a.name}-wal`, `${a.name}-shm`] : [a.name]
)

/** Authored sidecars that travel in the export bundle (the DB is exported separately as the ledger; prose is the tree). */
export const EXPORT_SIDECARS: readonly string[] = NVS_ARTIFACTS.filter((a) => a.exported && a.class === 'authored').map(byName)

/** Local/private state a fork or import starts fresh (wiped on import). */
export const LOCAL_ONLY: readonly string[] = NVS_ARTIFACTS.filter((a) => a.class === 'local').map(byName)

/**
 * Dead artifacts from before the current format — NOT part of `.nvs/` today, and no current code reads them.
 * Pre-ship, we migrate rather than carry legacy: `migrateLegacyArtifacts` (engine) removes these on open so old
 * projects conform. All are rebuildable/caches, so deleting them loses nothing.
 *   • novel-scribe.db*  — the pre-`nvs.db` analysis DB (old projects/demos).
 *   • llm-cache.db*     — a converter-side LLM cache that leaked into shipped projects; the app never uses it.
 */
export const LEGACY_PURGE: readonly string[] = [
  'novel-scribe.db',
  'novel-scribe.db-wal',
  'novel-scribe.db-shm',
  'llm-cache.db',
  'llm-cache.db-wal',
  'llm-cache.db-shm'
]
