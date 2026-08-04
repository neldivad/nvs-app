/**
 * structured — export a project's prose to the nvs-parser interchange (JSON/CSV), and import that shape back
 * into a NEW library work. This is the "precise programmatic reading" seam: nvs-parser reads prose → structured
 * (deterministically); the app reads structured → project, bypassing its own Fountain read. The wire format is
 * @shared/structuredFormat (kept in lockstep with nvs-parser's serialize.py — scenes→beats{speaker,kind,mood,text}).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { listScenes, readScene } from '@engine/content/scenes'
import { listWorldPages } from '@engine/content/world'
import { libraryRoot } from '@engine/io/library'
import { uniqueWorkName } from '@engine/io/exportImport'
import {
  parseBeats, renderBeats, toJson, toCsv, toSrt,
  type StructuredProject, type StructuredScene, type StructuredCharacter,
} from '@shared/structuredFormat'
import type { ImportResult } from '@shared/ipc'

/** One scene file → the interchange scene shape (frontmatter cast + parsed beats). */
function toStructuredScene(sf: { path: string; sceneId: string; title: string; chapter: string }): StructuredScene {
  const doc = readScene(sf.path)
  const cp = Array.isArray(doc.frontmatter.characters_present)
    ? (doc.frontmatter.characters_present as unknown[]).map(String)
    : []
  return { scene_id: sf.sceneId, title: sf.title, chapter: sf.chapter, characters_present: cp, beats: parseBeats(doc.body) }
}

/** The project's character pages as interchange cast rows. */
function readCast(root: string): StructuredCharacter[] {
  return listWorldPages(root)
    .filter((p) => p.kind === 'character')
    .map((c) => {
      let aliases: string[] = []
      try {
        const a = matter(readFileSync(c.path, 'utf8')).data.aliases
        if (Array.isArray(a)) aliases = a.map(String)
      } catch { /* frontmatter unreadable → no aliases */ }
      return { id: c.id, name: c.name, aliases }
    })
}

/** Wrap scenes + cast in the project envelope, deriving meta. */
function envelope(scenes: StructuredScene[], characters: StructuredCharacter[]): StructuredProject {
  return {
    meta: { scenes: scenes.length, beats: scenes.reduce((n, s) => n + s.beats.length, 0), characters: characters.length },
    scenes,
    characters,
  }
}

/** Read a project's scenes + cast into the structured interchange shape (matches nvs-parser `serialize`). */
export function exportStructured(root: string): StructuredProject {
  return envelope(listScenes(root).map(toStructuredScene), readCast(root))
}

/**
 * Export ONE scene in the SAME envelope as a whole project — deliberately not a new schema, so a consumer
 * parses one shape either way; it's the SCOPE that shrinks, not the format. A whole-project dump is a poor
 * interchange unit for another app (RoTK is ~1.2 MB of JSON); a single scene is a workable one. The cast is
 * narrowed to the scene's own `characters_present` so the file stays self-contained.
 */
export function exportSceneStructured(root: string, scenePath: string): StructuredProject {
  const sf = listScenes(root).find((s) => s.path === scenePath)
  if (!sf) throw new Error('that scene is not part of the open project')
  const scene = toStructuredScene(sf)
  const present = new Set(scene.characters_present)
  return envelope([scene], readCast(root).filter((c) => present.has(c.id)))
}

/** Serialize the open project to the interchange TEXT (json or csv) for a file export. */
export function serializeStructured(root: string, format: 'json' | 'csv'): string {
  const p = exportStructured(root)
  return format === 'csv' ? toCsv(p) : toJson(p)
}

/** Serialize ONE scene. `md` is the scene file verbatim (frontmatter + Fountain) — the prose, not a reduction;
 *  `srt` is one subtitle cue per TIMED beat (empty if the scene has no timing tags). */
export function serializeSceneStructured(root: string, scenePath: string, format: 'json' | 'csv' | 'md' | 'srt'): string {
  if (format === 'md') return readFileSync(scenePath, 'utf8')
  const p = exportSceneStructured(root, scenePath)
  if (format === 'srt') {
    const srt = toSrt(p)
    // SRT is one cue per TIMED beat. A scene with no `[start → end]` timing yields an empty file (just "\n"),
    // which reads as a broken export. Fail with an actionable reason instead of writing a useless subtitle file.
    if (srt.trim() === '') throw new Error('This scene has no timing tags, so its SRT would be empty. Add [start → end] timing to its beats first, or export as MD / JSON / CSV instead.')
    return srt
  }
  return format === 'csv' ? toCsv(p) : toJson(p)
}

/** Import an nvs-parser structured JSON as a NEW library work (Fountain scene tree + character pages). */
export function importStructured(jsonText: string, title: string): ImportResult {
  const root = libraryRoot()
  if (!root || !existsSync(root)) return { ok: false, error: 'no library to import into' }
  let project: StructuredProject
  try {
    project = JSON.parse(jsonText) as StructuredProject
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!Array.isArray(project.scenes)) return { ok: false, error: 'not a structured project (missing scenes[])' }

  const name = uniqueWorkName(title || 'Imported', readdirSync(root))
  const dest = join(root, name)
  try {
    for (const sc of project.scenes) {
      const dir = join(dest, 'content', 'story', 'chapters', sc.chapter || 'ch001')
      mkdirSync(dir, { recursive: true })
      const body = renderBeats(sc.beats ?? [])
      const fm: Record<string, unknown> = { scene_id: sc.scene_id, title: sc.title, chapter: sc.chapter, phase: 'canon' }
      if (sc.characters_present?.length) fm.characters_present = sc.characters_present
      writeFileSync(join(dir, `${sc.scene_id || 'scene'}.md`), matter.stringify(body, fm), 'utf8')
    }
    const charDir = join(dest, 'content', 'world', 'characters')
    mkdirSync(charDir, { recursive: true })
    for (const c of project.characters ?? []) {
      const fm: Record<string, unknown> = { id: c.id, name: c.name, phase: 'canon' }
      if (c.aliases?.length) fm.aliases = c.aliases
      writeFileSync(join(charDir, `${c.id || 'character'}.md`), matter.stringify('## Profile\n', fm), 'utf8')
    }
    return { ok: true, name, path: dest, title }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
