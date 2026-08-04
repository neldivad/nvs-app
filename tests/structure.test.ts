/**
 * The project STRUCTURE artifact (.nvs/structure.json) — the designed taxonomy, split by domain (world + scene),
 * that ingest + extraction + both sidebars read. Verifies defaults, materialization, the pre-split migration,
 * and graceful fallback on a missing/malformed file.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultStructure, readStructure, ensureStructure, writeStructure } from '../src/engine/analysis/structure'
import { DEFAULT_WORLD_KEYS, worldCategoriesFor, sceneCategoriesFor } from '../src/shared/config/worldCategories'

describe('defaultStructure — core categories, split by domain', () => {
  it('has the core world kinds (lore = reference) and a scene container', () => {
    const s = defaultStructure()
    expect(s.world.map((c) => c.key)).toEqual([...DEFAULT_WORLD_KEYS])
    expect(s.world.find((c) => c.key === 'location')?.tracked).toBe(true)
    expect(s.world.find((c) => c.key === 'lore')?.tracked).toBe(false)
    expect(s.scene.map((c) => c.key)).toContain('chapter')
  })
})

describe('readStructure — file, migration, or default', () => {
  it('returns the default when no file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-struct-'))
    try {
      expect(readStructure(root).world.length).toBe(DEFAULT_WORLD_KEYS.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('migrates a pre-split {categories} file into world[]', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-struct-'))
    try {
      mkdirSync(join(root, '.nvs'), { recursive: true })
      // old shape (world categories under `categories`, no `scene`)
      writeFileSync(join(root, '.nvs', 'structure.json'), JSON.stringify({ version: 1, categories: worldCategoriesFor(['character', 'item']) }))
      const s = readStructure(root)
      expect(s.world.map((c) => c.key)).toEqual(['character', 'item'])
      expect(s.scene.map((c) => c.key)).toContain('chapter') // scene backfilled from default
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads a split file and falls back to default when malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-struct-'))
    try {
      mkdirSync(join(root, '.nvs'), { recursive: true })
      writeFileSync(join(root, '.nvs', 'structure.json'), JSON.stringify({ version: 1, world: worldCategoriesFor(['suspect', 'clue']), scene: sceneCategoriesFor(['act']) }))
      const s = readStructure(root)
      expect(s.world.map((c) => c.key)).toEqual(['suspect', 'clue'])
      expect(s.scene.map((c) => c.key)).toEqual(['act'])

      writeFileSync(join(root, '.nvs', 'structure.json'), '{ not json')
      expect(readStructure(root).world.length).toBe(DEFAULT_WORLD_KEYS.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ensureStructure / writeStructure', () => {
  it('materializes the default file when absent, and writeStructure persists an edit', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-struct-'))
    try {
      mkdirSync(join(root, '.nvs'), { recursive: true })
      const p = join(root, '.nvs', 'structure.json')
      expect(existsSync(p)).toBe(false)
      ensureStructure(root)
      expect(existsSync(p)).toBe(true)

      // route/ending are NOT world categories (2026-07-09 ruling: a branch = a saved chart-sequence,
      // not a page kind) — worldCategoriesFor correctly filters unknown keys OUT rather than stubbing them
      writeStructure(root, worldCategoriesFor(['character', 'suspect', 'clue']), sceneCategoriesFor(['chapter']))
      const back = JSON.parse(readFileSync(p, 'utf8'))
      expect(back.world.map((c: { key: string }) => c.key)).toEqual(['character', 'suspect', 'clue'])
      expect(readStructure(root).world.map((c) => c.key)).toEqual(['character', 'suspect', 'clue'])
      expect(worldCategoriesFor(['character', 'route', 'ending']).map((c) => c.key)).toEqual(['character'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
