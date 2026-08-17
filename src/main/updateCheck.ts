import { app } from 'electron'
import type { UpdateCheck } from '../shared/ipc'

// Where the PUBLIC releases live and where we send users to download. We do NOT auto-update; this only reads
// the latest release tag to nudge the user. The public mirror (nvs-app, AGPL-3.0) is what the /download page
// points at — see internal/distribution-updates.md. If releases ever move, change RELEASES_REPO only.
const RELEASES_REPO = 'neldivad/nvs-app'
const DOWNLOAD_URL = 'https://www.getqed.app/nvs'
const TIMEOUT_MS = 6000

/** Parse `MAJOR.MINOR.PATCH` (leading `v` and any `-prerelease`/`+build` suffix stripped) into 3 numbers.
 *  Missing/garbage segments read as 0 so a malformed tag can't throw — it just won't compare as newer. */
function parts(v: string): [number, number, number] {
  const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0]
  const [a, b, c] = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return [a || 0, b || 0, c || 0]
}

/** True iff `latest` is a strictly higher semver than `current` (patch-level; pre-release tags ignored). */
export function isNewerVersion(latest: string, current: string): boolean {
  const l = parts(latest)
  const c = parts(current)
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true
    if (l[i] < c[i]) return false
  }
  return false
}

/** Ask GitHub for the newest published release and compare to the installed version. Never throws: any
 *  failure (offline, rate limit, 404 when no release exists yet) resolves with `latest: null` + `error`. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  const url = DOWNLOAD_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      // GitHub rejects UA-less requests; the JSON accept header pins the v3 response shape.
      headers: { 'User-Agent': `NovelVisualStudio/${current}`, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!res.ok) return { current, latest: null, isNewer: false, url, error: `HTTP ${res.status}` }
    const json = (await res.json()) as { tag_name?: string }
    const latest = (json.tag_name || '').replace(/^v/i, '').trim() || null
    return { current, latest, isNewer: latest ? isNewerVersion(latest, current) : false, url }
  } catch (e) {
    return { current, latest: null, isNewer: false, url, error: e instanceof Error ? e.message : 'update check failed' }
  } finally {
    clearTimeout(timer)
  }
}
