/**
 * projectInfo — reading a work's authored metadata (`project.json`), tolerant of two long-standing drifts:
 *
 *   • LOCATION — the canonical path is `<root>/.nvs/project.json`, but early converter output (and pre-migration
 *     projects) wrote it at `<root>/project.json`. We fall back to the root file when the `.nvs` one is absent,
 *     so those projects' title/author/language surface instead of degrading to the folder name. The next
 *     writeProjectInfo re-homes it under `.nvs` (canonical), non-destructively.
 *   • SHAPE — array fields stored as scalars are coerced (normalizeProjectInfo, shared with the renderer).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NVS_DIR } from '@engine/io/nvsArtifacts'
import { normalizeProjectInfo } from '@shared/config/projectSchema'
import type { ProjectInfo } from '@shared/ipc'

/** Read + normalize a work's project.json (canonical `.nvs/`, root as fallback). `{}` if neither exists / parse fails. */
export function loadProjectInfo(root: string): ProjectInfo {
  for (const p of [join(root, NVS_DIR, 'project.json'), join(root, 'project.json')]) {
    if (!existsSync(p)) continue
    try {
      return normalizeProjectInfo(JSON.parse(readFileSync(p, 'utf8')))
    } catch {
      return {}
    }
  }
  return {}
}
