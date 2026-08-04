/**
 * coherenceRulings.ts — the author's RULINGS on coherence findings ("this divergence is intentional").
 *
 * A finding is the analysis agent's ADVICE; the author's verdict on it is AUTHORED STATE — so it lives in a
 * JSON file beside the DB (`.nvs/coherence-rulings.json`), NOT in the DB: it survives Reset analysis (which
 * deletes nvs.db + snapshots but keeps user JSON) and every coherence re-run (which scoped-deletes + reinserts
 * findings with fresh ids). Rulings are keyed by (entityId + normalized trait) since ids are regenerated per
 * run; if a re-run rewords a trait the finding resurfaces — acceptable v0 (temp-0 extraction keeps wording
 * mostly stable). This is v0 of the layered-truth ladder (v1 = the `## Secrets` section; see the discussion
 * in internal/open-taxonomy.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CoherenceFinding } from '@shared/ipc'

interface RulingsFile {
  version: 1
  /** Presence in the list = ruled intentional. Unmarking removes the entry. `at` is provenance only. */
  rulings: Array<{ entityId: string; trait: string; at: string }>
}

const fileFor = (root: string): string => join(root, '.nvs', 'coherence-rulings.json')

/** The re-run-stable identity of a finding: who it's about + the trait, punctuation/case-insensitive. */
const keyOf = (entityId: string, trait: string): string => `${entityId}::${trait.toLowerCase().replace(/[^a-z0-9]/g, '')}`

function read(root: string): RulingsFile {
  const p = fileFor(root)
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<RulingsFile>
      if (Array.isArray(raw.rulings)) return { version: 1, rulings: raw.rulings }
    } catch {
      /* malformed → treat as empty (never block findings on a bad ledger) */
    }
  }
  return { version: 1, rulings: [] }
}

/** Overlay the ledger onto a findings list — stamps `intentional` on every ruled finding. */
export function annotateFindings(root: string, findings: CoherenceFinding[]): CoherenceFinding[] {
  const ruled = new Set(read(root).rulings.map((r) => keyOf(r.entityId, r.trait)))
  if (ruled.size === 0) return findings
  return findings.map((f) => (f.entityId && ruled.has(keyOf(f.entityId, f.trait)) ? { ...f, intentional: true } : f))
}

/** Record (or withdraw) the author's ruling for one finding identity. Idempotent both ways. */
export function setRuling(root: string, entityId: string, trait: string, intentional: boolean): void {
  const file = read(root)
  const key = keyOf(entityId, trait)
  const rest = file.rulings.filter((r) => keyOf(r.entityId, r.trait) !== key)
  if (intentional) rest.push({ entityId, trait, at: new Date().toISOString() })
  const p = fileFor(root)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ version: 1, rulings: rest }, null, 2))
}
