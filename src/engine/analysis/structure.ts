/**
 * structure.ts — the project STRUCTURE artifact (`.nvs/structure.json`): the designed, hidden, set-and-forget
 * config that declares the project's categories, split by domain — `world` (bible kinds → entities) and `scene`
 * (story containers). Source of truth for the taxonomy both sidebars + ingest + extraction read (see
 * internal/open-taxonomy.md). Defaults to the CORE categories; materialized on first ingest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  worldCategoriesFor,
  sceneCategoriesFor,
  DEFAULT_WORLD_KEYS,
  DEFAULT_SCENE_KEYS,
  type WorldCategory,
  type SceneCategory
} from '@shared/config/worldCategories'

export interface ProjectStructure {
  version: number
  world: WorldCategory[] // bible categories → entities (character/location/item/faction/lore/…)
  scene: SceneCategory[] // story container types (act/part/chapter/…)
}

const rel = (root: string): string => join(root, '.nvs', 'structure.json')

/** The default structure — the CORE categories (genre packs are opt-in via a template). */
export function defaultStructure(): ProjectStructure {
  return { version: 1, world: worldCategoriesFor(DEFAULT_WORLD_KEYS), scene: sceneCategoriesFor(DEFAULT_SCENE_KEYS) }
}

/** Read the project's structure, or the default when absent/malformed. Migrates the pre-split `{categories}` shape. */
export function readStructure(root: string): ProjectStructure {
  const p = rel(root)
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<ProjectStructure> & { categories?: WorldCategory[] }
      // pre-split files stored world categories under `categories` — migrate them to `world`.
      const world = Array.isArray(raw.world) ? raw.world : Array.isArray(raw.categories) ? raw.categories : null
      if (world && world.length > 0) {
        return { version: raw.version ?? 1, world, scene: Array.isArray(raw.scene) && raw.scene.length ? raw.scene : defaultStructure().scene }
      }
    } catch {
      /* malformed → fall through to default */
    }
  }
  return defaultStructure()
}

/** Materialize the structure file if missing (so it's a real artifact), then return the effective structure. */
export function ensureStructure(root: string): ProjectStructure {
  const p = rel(root)
  if (existsSync(p)) return readStructure(root)
  const s = defaultStructure()
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(s, null, 2))
  } catch {
    /* best-effort — falls back to the in-memory default */
  }
  return s
}

/** Persist an edited structure (from the Project Structure dialog — e.g. applying a template). Returns it. */
export function writeStructure(root: string, world: WorldCategory[], scene: SceneCategory[]): ProjectStructure {
  const s: ProjectStructure = { version: 1, world, scene }
  const p = rel(root)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(s, null, 2))
  return s
}
