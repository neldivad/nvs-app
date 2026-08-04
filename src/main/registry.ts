/**
 * Community registry client — fetch the index, download + verify + import bundles.
 *
 * The registry is a JSON index + `.nvsproj` bundles (see internal/community-registry.md): works are
 * oracle-gated at publish time (nvs-datasets/tools/publish.py), so this side only has to fetch, check
 * integrity (sha256), and hand the bundle to the existing engine import. Data, not code — opening a
 * bundle executes nothing (export-gallery.md §Trust).
 *
 * Index resolution order:
 *   1. NVS_REGISTRY_URL env (a file path or URL) — dev/test override
 *   2. the published default URL (real once nvs-datasets has a public remote)
 *   3. dev fallback: the sibling ../nvs-datasets checkout, so the dialog works on a dev machine today
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, copyFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as engine from '@engine/index'
import type { ImportResult, RegistryIndex, RegistryWork } from '@shared/ipc'

// Point this at your CDN in production — Cloudflare R2's public bucket URL (zero-egress, edge-cached) is the
// right serving layer; raw.githubusercontent.com is NOT a CDN (rate-limited, "not for production traffic").
// Overridable via NVS_REGISTRY_URL. The bundles' `download` fields resolve against wherever the index came
// from, so switching hosts is just this URL — no other code changes.
const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/neldivad/nvs-datasets/master/index.json'

function devFallbackPath(): string {
  return resolve(app.getAppPath(), '..', 'nvs-datasets', 'index.json')
}

// ── Index cache: don't hit the network on every store-open (rate-limit hygiene + instant + offline-resilient).
//    Fresh (< TTL) → serve cached, no request. Else a CONDITIONAL GET (ETag → 304 is nearly free). Network
//    failure → serve STALE cache. TTL is a WEEK — the curated benchmark set changes rarely, so ~1 real fetch
//    per client per week keeps raw-GitHub comfortably within limits (decision: internal/community-registry.md).
const CACHE_FILE = (): string => join(app.getPath('userData'), 'registry-cache.json')
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week
interface RegistryCache { url: string; etag: string | null; at: number; raw: string }

function readCache(): RegistryCache | null {
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE(), 'utf8')) as RegistryCache
    return typeof c.raw === 'string' && typeof c.url === 'string' ? c : null
  } catch {
    return null
  }
}
function writeCache(c: RegistryCache): void {
  try {
    writeFileSync(CACHE_FILE(), JSON.stringify(c))
  } catch {
    /* userData not writable — cache is best-effort */
  }
}

/** Fetch a remote index with the TTL+ETag cache. Returns the parsed index, or null (caller tries the next candidate). */
async function fetchRemoteCached(url: string): Promise<RegistryIndex | null> {
  const cache = readCache()
  const forThisUrl = cache && cache.url === url ? cache : null
  if (forThisUrl && Date.now() - forThisUrl.at < CACHE_TTL_MS) return parseIndex(forThisUrl.raw, url) // fresh
  try {
    const headers: Record<string, string> = {}
    if (forThisUrl?.etag) headers['If-None-Match'] = forThisUrl.etag
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (res.status === 304 && forThisUrl) {
      writeCache({ ...forThisUrl, at: Date.now() }) // still current — bump the freshness clock
      return parseIndex(forThisUrl.raw, url)
    }
    if (res.ok) {
      const raw = await res.text()
      writeCache({ url, etag: res.headers.get('etag'), at: Date.now(), raw })
      return parseIndex(raw, url)
    }
  } catch {
    /* network failure → fall through to stale cache */
  }
  return forThisUrl ? parseIndex(forThisUrl.raw, url) : null // stale-on-failure (offline resilience)
}

/** Resolve a work's `download` field against where the index came from (file dir or URL base). */
function resolveDownload(download: string, indexSource: string): string {
  if (/^(https?|file):\/\//.test(download)) return download
  if (indexSource.startsWith('http')) return new URL(download, indexSource).toString()
  const base = dirname(indexSource)
  return pathToFileURL(isAbsolute(download) ? download : join(base, download)).toString()
}

function parseIndex(raw: string, source: string): RegistryIndex | null {
  try {
    const idx = JSON.parse(raw) as RegistryIndex
    if (idx.registryVersion !== 1 || !Array.isArray(idx.works)) return null
    return {
      ...idx,
      source,
      works: idx.works.map((w) => ({ ...w, download: resolveDownload(w.download, source) }))
    }
  } catch {
    return null
  }
}

/** Fetch the registry index — env override, then the published URL, then the dev sibling checkout. */
export async function fetchRegistry(): Promise<RegistryIndex | null> {
  const candidates = [process.env.NVS_REGISTRY_URL, DEFAULT_REGISTRY_URL, devFallbackPath()].filter(
    (c): c is string => !!c
  )
  for (const cand of candidates) {
    try {
      if (cand.startsWith('http')) {
        const idx = await fetchRemoteCached(cand) // TTL + ETag + stale-on-failure
        if (idx) return idx
      } else if (existsSync(cand)) {
        const idx = parseIndex(readFileSync(cand, 'utf8'), cand)
        if (idx) return idx
      }
    } catch {
      /* unreachable candidate — try the next */
    }
  }
  return null
}

/** Download a bundle, verify sha256, import into the library. The temp file never survives the call. */
export async function installCommunityWork(work: RegistryWork): Promise<ImportResult> {
  const tmpDir = join(app.getPath('userData'), 'downloads')
  mkdirSync(tmpDir, { recursive: true })
  const tmpFile = join(tmpDir, `${work.id.replace(/[^a-z0-9-]/gi, '-')}.nvsproj`)
  try {
    if (work.download.startsWith('file://')) {
      copyFileSync(new URL(work.download), tmpFile)
    } else {
      const res = await fetch(work.download, { signal: AbortSignal.timeout(120000) })
      if (!res.ok) return { ok: false, error: `download failed (${res.status})` }
      writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()))
    }
    const digest = createHash('sha256').update(readFileSync(tmpFile)).digest('hex')
    if (digest !== work.sha256) return { ok: false, error: 'integrity check failed (sha256 mismatch)' }
    const res = engine.importProject(tmpFile)
    if (res.ok) {
      // Log the acquisition into the reading list (survives later local edits/deletion — it's history, not state).
      engine.downloadsRegistry.recordDownload({
        registryId: work.id,
        title: work.title,
        author: work.author,
        version: work.version,
        sizeBytes: work.sizeBytes,
        at: Date.now(),
        path: res.path
      })
    }
    return res
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  } finally {
    rmSync(tmpFile, { force: true })
  }
}
