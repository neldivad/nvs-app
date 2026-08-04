import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { snapTime, snapshotsToKeep, compactSnapshots, KEEP_MAX, RECENT_MS } from '../src/engine/data/writeTier'

// Snapshots are the revert safety net AND the top disk-bloat risk (10 full DB copies of a growing DB). The
// VACUUM/restore round-trip needs better-sqlite3, which doesn't self-register under vitest, so it's verified
// in-app (see exportImport.test.ts). Here we lock the PURE anti-bloat logic: id-time parsing, tiered
// retention, and legacy-→-gzip compaction — none of which touch the DB.

const DAY = 24 * 60 * 60 * 1000
const idAt = (ms: number, label = 'run'): string => `${new Date(ms).toISOString().replace(/[:.]/g, '-')}__${label}`

describe('snapTime — id timestamp parsing (the retention key)', () => {
  it('round-trips an id back to its capture epoch', () => {
    const ms = Date.parse('2026-07-21T18:01:56.627Z')
    expect(snapTime(idAt(ms))).toBe(ms)
  })
  it('returns 0 for a malformed id (sorts as oldest → pruned first, never mistaken for recent)', () => {
    expect(snapTime('not-a-timestamp__x')).toBe(0)
    expect(snapTime('')).toBe(0)
  })
})

describe('snapshotsToKeep — tiered retention', () => {
  const now = Date.parse('2026-07-21T12:00:00.000Z')

  it('keeps EVERY snapshot from the last day (dense recent revert)', () => {
    const snaps = [0, 1, 3, 6, 11].map((h) => ({ id: idAt(now - h * 3600_000), t: now - h * 3600_000 }))
    const keep = snapshotsToKeep(snaps, now)
    expect(keep.size).toBe(snaps.length) // all within RECENT_MS
    expect(RECENT_MS).toBe(DAY)
  })

  it('thins OLDER snapshots to one per calendar-day', () => {
    // three snapshots on the same old day + one on another old day → 2 survive (one per day)
    const d1 = Date.parse('2026-07-10T00:00:00.000Z')
    const d2 = Date.parse('2026-07-08T00:00:00.000Z')
    const snaps = [
      { id: idAt(d1 + 1_000), t: d1 + 1_000 },
      { id: idAt(d1 + 2_000), t: d1 + 2_000 },
      { id: idAt(d1 + 3_000), t: d1 + 3_000 },
      { id: idAt(d2 + 1_000), t: d2 + 1_000 }
    ]
    const keep = snapshotsToKeep(snaps, now)
    expect(keep.size).toBe(2) // one per calendar-day
    expect([...keep].filter((id) => id.startsWith('2026-07-10')).length).toBe(1)
    expect([...keep].filter((id) => id.startsWith('2026-07-08')).length).toBe(1)
  })

  it('hard-caps the survivor set at KEEP_MAX (newest days win)', () => {
    // 20 snapshots, each on its own distinct OLD day → without a cap all 20 survive; cap trims to KEEP_MAX
    const snaps = Array.from({ length: 20 }, (_, i) => {
      const t = now - (i + 2) * DAY // i+2 days ago → all older than RECENT_MS, distinct days
      return { id: idAt(t), t }
    })
    const keep = snapshotsToKeep(snaps, now)
    expect(keep.size).toBe(KEEP_MAX)
    // the survivors are the newest KEEP_MAX
    const newest = [...snaps].sort((a, b) => b.t - a.t).slice(0, KEEP_MAX).map((s) => s.id)
    expect(new Set(keep)).toEqual(new Set(newest))
  })

  it('never re-keys off mtime — an OLD id stays prunable regardless of when its file was written', () => {
    // recent dense window + one ancient snapshot: the ancient one is NOT in the dense set
    const recent = { id: idAt(now - 3600_000), t: now - 3600_000 }
    const ancient = { id: idAt(now - 40 * DAY), t: now - 40 * DAY }
    const keep = snapshotsToKeep([recent, ancient], now)
    expect(keep.has(recent.id)).toBe(true)
    expect(keep.has(ancient.id)).toBe(true) // only 2 total, under the cap → both survive, but via the DAILY tier
    // add a second snapshot on the ancient's day → still only one of that day survives
    const ancient2 = { id: idAt(now - 40 * DAY + 5_000), t: now - 40 * DAY + 5_000 }
    const keep2 = snapshotsToKeep([recent, ancient, ancient2], now)
    expect([...keep2].filter((id) => id.startsWith(ancient.id.slice(0, 10))).length).toBe(1)
  })
})

describe('compactSnapshots — reclaim pre-compression legacy .db files', () => {
  const root = mkdtempSync(join(tmpdir(), 'nvs-compact-'))
  const snapDir = join(root, '.nvs', 'snapshots')
  mkdirSync(snapDir, { recursive: true })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('gzips a legacy raw .db in place, removes the raw, and reports freed bytes', () => {
    const id = idAt(Date.parse('2026-07-10T00:00:00.000Z'), 'legacy')
    const body = Buffer.from('SQLite-ish content '.repeat(5000)) // compressible → real freed bytes
    writeFileSync(join(snapDir, `${id}.db`), body)

    const res = compactSnapshots(root)
    expect(res.compacted).toBe(1)
    expect(res.freedBytes).toBeGreaterThan(0)
    expect(existsSync(join(snapDir, `${id}.db.gz`))).toBe(true) // now compressed
    expect(existsSync(join(snapDir, `${id}.db`))).toBe(false) // raw removed
    expect(gunzipSync(readFileSync(join(snapDir, `${id}.db.gz`)))).toEqual(body) // lossless
  })

  it('is idempotent — a second pass finds nothing to compact', () => {
    const res = compactSnapshots(root)
    expect(res.compacted).toBe(0)
    expect(readdirSync(snapDir).filter((f) => f.endsWith('.db.gz')).length).toBe(1)
  })
})
