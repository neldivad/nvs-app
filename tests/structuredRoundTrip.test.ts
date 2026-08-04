/**
 * Integration: the STRUCTURED export→import round-trip against a real project on disk (RoTK, if present).
 * Proves the engine seam end-to-end — exportStructured reads real Fountain prose → serialize → importStructured
 * writes a fresh work → re-export yields the SAME structured project. Skips gracefully if the library/work is absent
 * (CI has no library), so this is a local fidelity check, not a hard gate.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { exportStructured, serializeStructured, importStructured } from '../src/engine/analysis/structured'
import { setLibraryRoot } from '../src/engine/io/library'

const ROTK = join(homedir(), 'Documents', 'Novel Visual Studio', 'Romance of the Three Kingdoms')
const has = existsSync(join(ROTK, 'content'))
const maybe = has ? describe : describe.skip

maybe('structured round-trip (RoTK)', () => {
  it('export → import → re-export is stable', () => {
    const before = exportStructured(ROTK)
    expect(before.scenes.length).toBeGreaterThan(0)
    expect(before.meta.beats).toBeGreaterThan(0)

    // real import into a throwaway library
    const tmpLib = mkdtempSync(join(tmpdir(), 'nvs-rt-'))
    try {
      setLibraryRoot(tmpLib)
      const json = serializeStructured(ROTK, 'json')
      const res = importStructured(json, 'RoTK Round Trip')
      expect(res.ok).toBe(true)
      expect(res.path && existsSync(res.path)).toBe(true)

      const after = exportStructured(res.path!)

      // scene set + per-scene beats survive identically (order, kind, speaker, mood, text)
      expect(after.scenes.length).toBe(before.scenes.length)
      expect(after.meta.beats).toBe(before.meta.beats)
      const strip = (p: typeof before): unknown =>
        p.scenes
          .map((s) => ({ scene_id: s.scene_id, chapter: s.chapter, beats: s.beats }))
          .sort((a, b) => a.scene_id.localeCompare(b.scene_id))
      expect(strip(after)).toEqual(strip(before))

      // cast survives: id/name/aliases round-trip
      const byId = (p: typeof before) => [...p.characters].sort((a, b) => a.id.localeCompare(b.id))
      expect(after.characters.length).toBe(before.characters.length)
      expect(byId(after)).toEqual(byId(before))

      // CSV is a valid flat beats table with the parser's header + one row per beat
      const csv = serializeStructured(res.path!, 'csv').trimEnd().split('\n')
      expect(csv[0]).toBe('scene_id,chapter,beat,speaker,kind,mood,start,end,text')
      expect(csv.length - 1).toBe(after.meta.beats) // header + N beat rows
    } finally {
      rmSync(tmpLib, { recursive: true, force: true })
    }
  })

  it('preserves any cue mood present in the source', () => {
    const p = exportStructured(ROTK)
    const moody = p.scenes.flatMap((s) => s.beats).filter((b) => b.mood)
    // RoTK may or may not carry moods; if it does, they must be uppercase and only on speech beats.
    for (const b of moody) {
      expect(b.kind).toBe('speech')
      expect(b.mood).toBe(b.mood!.toUpperCase())
    }
    console.log(`[round-trip] scenes=${p.meta.scenes} beats=${p.meta.beats} characters=${p.meta.characters} moody-beats=${moody.length}`)
  })
})
