import { describe, it, expect } from 'vitest'
import { NVS_ARTIFACTS, RESET_DELETE_FILES, EXPORT_SIDECARS, LOCAL_ONLY, LEGACY_PURGE } from '../src/engine/io/nvsArtifacts'

describe('nvsArtifacts taxonomy', () => {
  it('deletes ONLY the DB (+ sqlite sidecars) on Reset — everything else in .nvs/ survives', () => {
    expect([...RESET_DELETE_FILES].sort()).toEqual(['nvs.db', 'nvs.db-shm', 'nvs.db-wal'])
  })

  it('exports exactly the authored sidecars (the DB + prose ship separately)', () => {
    expect([...EXPORT_SIDECARS].sort()).toEqual(['coherence-rulings.json', 'ingest-runs.json', 'project.json', 'structure.json', 'timeline.json', 'trees.json'])
  })

  it('wipes exactly the local/private state on import', () => {
    expect([...LOCAL_ONLY].sort()).toEqual(['chat', 'chat.json', 'ingest-telemetry.jsonl', 'job-live.json', 'snapshots', 'tasks', 'ui-state.json'])
  })

  it('nvs.db is the ONLY artifact that does not survive Reset (only thing rebuildable from prose)', () => {
    expect(NVS_ARTIFACTS.filter((a) => !a.survivesReset).map((a) => a.name)).toEqual(['nvs.db'])
  })

  it('authored artifacts always survive Reset AND export; local never exports', () => {
    for (const a of NVS_ARTIFACTS) {
      if (a.class === 'authored') expect(a.survivesReset && a.exported).toBe(true)
      if (a.class === 'local') expect(a.exported).toBe(false)
    }
  })

  it('PURGES dead legacy artifacts (novel-scribe.db, llm-cache.db) instead of enshrining them', () => {
    const names = NVS_ARTIFACTS.map((a) => a.name)
    // not part of the current format — no current code produces or reads them
    expect(names).not.toContain('novel-scribe.db')
    expect(names).not.toContain('llm-cache.db')
    // they're on the migration purge list, with sqlite sidecars
    expect(LEGACY_PURGE).toEqual(
      expect.arrayContaining(['novel-scribe.db', 'novel-scribe.db-wal', 'novel-scribe.db-shm', 'llm-cache.db', 'llm-cache.db-wal', 'llm-cache.db-shm'])
    )
    // a purged name must NEVER also be a current artifact (would delete live data)
    for (const n of LEGACY_PURGE) expect(names).not.toContain(n)
  })

  it('every artifact carries a class and a note', () => {
    for (const a of NVS_ARTIFACTS) {
      expect(['authored', 'derived', 'local']).toContain(a.class)
      expect(a.note.length).toBeGreaterThan(0)
    }
  })
})
