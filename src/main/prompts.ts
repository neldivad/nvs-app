/**
 * The global Prompt Library — reusable page-agent instructions, shared across every work.
 *
 * Persisted in userData/prompts.json (mirrors the ai-connections registry). Seeded on first run with the
 * built-in presets (Reformat / Placeholders / …). Built-ins are APP-OWNED: re-synced from code on every
 * load (so a sharpened directive reaches existing users) and read-only — the UI offers view + duplicate, not
 * edit/delete. User prompts are the persisted layer. New built-ins shipped later are merged in on load.
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_PROMPTS } from '@shared/config/agentCommands'
import type { SavedPrompt } from '@shared/ipc'

/** Built-in seeds (Reformat / Placeholders / Draft next beat / the analysis pack). */
const BUILT_INS: SavedPrompt[] = BUILTIN_PROMPTS.map((p) => ({
  id: p.id,
  label: p.label,
  directive: p.directive,
  mode: p.mode,
  category: p.category,
  builtIn: true
}))
const BUILTIN_BY_ID = new Map(BUILT_INS.map((b) => [b.id, b]))

function file(): string {
  return join(app.getPath('userData'), 'prompts.json')
}

let cache: SavedPrompt[] | null = null

function load(): SavedPrompt[] {
  if (cache) return cache
  let stored: SavedPrompt[] = []
  let onDisk = false
  try {
    if (existsSync(file())) {
      onDisk = true
      const d = JSON.parse(readFileSync(file(), 'utf8'))
      if (Array.isArray(d)) stored = d
    }
  } catch {
    stored = []
  }
  // Migrate built-in ids renamed across versions (the old slash-derived ids → the new explicit ids), and
  // backfill `category` on prompts saved before it existed (default the page-edit catch-all).
  const RENAMES: Record<string, string> = { fo: 'reformat', place: 'placeholders' }
  // Built-ins removed in a later version — drop any stored copy so it can't linger as an undeletable orphan.
  const RETIRED = new Set(['sync-links'])
  const migrated = stored
    .map((p) => ({
      ...p,
      id: RENAMES[p.id] ?? p.id,
      category: p.category ?? ('maintenance' as const)
    }))
    .filter((p) => !RETIRED.has(p.id))
  // Dedupe by id — drops the duplicate built-ins the id-rename bug left behind (keep the first seen).
  const seen = new Set<string>()
  const deduped = migrated.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  // Re-sync built-ins from code: they're APP-PROVIDED defaults, so they always reflect the latest label/
  // directive/mode/category (this is how a sharpened directive reaches existing users). User prompts are
  // untouched. To customize a built-in, add your own with + (built-in edits don't persist across launches).
  const synced = deduped.map((p) => BUILTIN_BY_ID.get(p.id) ?? p)
  // Ensure every built-in is present (seed first run + backfill new built-ins).
  const have = new Set(synced.map((p) => p.id))
  const seeds = BUILT_INS.filter((b) => !have.has(b.id))
  const merged = [...seeds, ...synced]
  cache = merged
  // Rewrite the file whenever the on-disk content no longer matches (first run, seeds, rename/dedupe, re-sync).
  if (!onDisk || JSON.stringify(merged) !== JSON.stringify(stored)) persist(merged)
  return cache
}

function persist(list: SavedPrompt[]): void {
  cache = list
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file(), JSON.stringify(list, null, 2))
  } catch {
    /* best-effort */
  }
}

export function listPrompts(): SavedPrompt[] {
  return load()
}

export function savePrompt(prompt: SavedPrompt): SavedPrompt[] {
  const list = [...load()]
  const id = prompt.id?.trim() || randomUUID()
  const existing = list.find((p) => p.id === id)
  // Built-ins are app-owned & read-only — ignore any attempt to overwrite one (the UI duplicates instead).
  if (existing?.builtIn) return list
  const next: SavedPrompt = {
    id,
    label: prompt.label.trim() || 'Untitled',
    directive: prompt.directive.trim(),
    mode: prompt.mode === 'replace' ? 'replace' : 'append',
    category: prompt.category ?? existing?.category ?? 'maintenance',
    builtIn: existing?.builtIn // can't flip the built-in flag from the renderer
  }
  const out = existing ? list.map((p) => (p.id === id ? next : p)) : [...list, next]
  persist(out)
  return out
}

export function deletePrompt(id: string): SavedPrompt[] {
  // Built-ins are kept (only user prompts are deletable).
  const out = load().filter((p) => p.id !== id || p.builtIn)
  persist(out)
  return out
}
