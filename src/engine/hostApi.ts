/**
 * The Host API capability table + the extension handshake (internal/host-api.md, gh/NOTES.md).
 *
 * This is the "negotiation" made literal: the host owns a SET of capability ids it serves; an extension's
 * manifest lists the ids it needs; installing/spawning an extension is a set-comparison — refuse loudly
 * (required missing, with the reason), degrade quietly (optional missing), or run.
 *
 * Versioning rules (CLAP-shaped):
 *  - Every id carries its version: `read:scenes/1`. Additive changes don't bump; a BREAKING change mints
 *    `/2` as a NEW entry here while `/1` stays in the set through a deprecation window. Removing an old
 *    `/N` from this set is the act of retiring it — do that on an announced date, never silently.
 *  - `draft:` ids are unstable (no promise; first-party consumers only). When one graduates, its stable id
 *    is added here and the draft id goes into COMPAT_ALIASES with a sunset note.
 *  - Nothing ENFORCES minting /2 instead of quietly changing /1's shape — that's the discipline this file
 *    exists to make cheap: a breaking change should be a one-line diff HERE, which makes it reviewable.
 *
 * Only extension-facing capabilities live here. Host lifecycle (listWorks, openWork, window controls…)
 * is deliberately absent — extensions never get the app shell.
 */

export const ENGINE_API = 1 // the handshake promise itself (manifest shape + these rules); bump ≈ never

/**
 * What this build of the engine serves. Derived from the ✅ items in internal/host-api.md — every entry
 * must exist in NvsApi today; planned capabilities enter as `draft:` only when they actually run.
 */
export const SUPPORTED: ReadonlySet<string> = new Set([
  // read — resources
  'read:scenes/1', // listScenes / readScene → { frontmatter, body }
  'read:story/1', // listStoryTree — the folder tree
  'read:world/1', // listWorldPages + world-page reads
  'read:timeline/1', // readTimeline — the manual canvas layout
  'read:tree/1', // readTree — the tree variants (branch/merge graphs); the connection structure (not frontmatter)
  'read:project/1', // currentProject — open-work meta
  'read:corkboard/1', // listBoards / readBoard / readCard — the author's freeform planning boards (read-only)
  // read — derived tiers (questlog · threadDetail · characterArc · coherence · timelineGraph · backlinks)
  'read:tiers/1',
  // write — through engine writers only (validate + ingest; never raw file/DB access)
  'write:files/1', // writeScene · createScene · createWorldPage · rename/delete/setOrder
  'write:timeline/1',
  'write:tree/1', // connectScenes · connectScenesBatch · disconnectScenes — wire the story graph in a tree variant (not frontmatter)
  'write:assets/1' // importImages / importImagePaths
])

/**
 * Parameterized capability families: the tier a producer writes is part of the id
 * (`write:tier:t2:pacing/1`), so membership is a prefix+version match, not an exact lookup.
 * A producer may only write the tier its manifest declared (invariant 3).
 */
const FAMILIES: ReadonlyArray<{ prefix: string; version: number }> = [
  { prefix: 'write:tier:', version: 1 } // writeTier — the T2/T3 producer doorway (provenance-stamped)
]

/** Draft ids that graduated to stable: draft-id → stable-id. Keep each until its stated sunset. */
export const COMPAT_ALIASES: Readonly<Record<string, string>> = {
  // (none yet — first candidate: 'draft:entity-knowledge/1' → 'read:entity-knowledge/1' when it graduates)
}

/**
 * LIFECYCLE capabilities — held by the TRUSTED host adapter only (the MCP server the user launches, pointed at a
 * work dir; that IS the authorization). Deliberately ABSENT from SUPPORTED, so `serves()` returns false and
 * `checkManifest` already REFUSES any sandboxed manifest that declares one (a third-party pacing lens can't open
 * arbitrary works). The freeze surface tags these so the conformance test can classify them; the runtime GATING —
 * routing lifecycle tools only for the trusted adapter tier — is Phase 1 (see internal/host-api-v1-spec.md).
 */
export const LIFECYCLE_CAPS: ReadonlySet<string> = new Set(['lifecycle/1'])

/** The capability-negotiation slice of an extension manifest (extensions.md has the full shape). */
export interface CapabilityManifest {
  id: string
  engineApi: number
  capabilities: { required: string[]; optional?: string[] }
}

export type HandshakeResult =
  | { ok: true; granted: string[]; degraded: string[] } // degraded = optional ids we can't serve
  | { ok: false; reasons: string[] }

function parse(cap: string): { name: string; version: number } | null {
  const slash = cap.lastIndexOf('/')
  if (slash < 1) return null
  const version = Number(cap.slice(slash + 1))
  return Number.isInteger(version) && version > 0 ? { name: cap.slice(0, slash), version } : null
}

/** Is `cap` served to a manifest — an exact SUPPORTED entry (or compat alias), or a FAMILIES prefix+version match?
 *  Lifecycle caps are intentionally NOT served here (they're trusted-adapter-only; see LIFECYCLE_CAPS). */
export function serves(cap: string): boolean {
  const id = COMPAT_ALIASES[cap] ?? cap
  if (SUPPORTED.has(id)) return true
  const p = parse(id)
  return !!p && FAMILIES.some((f) => p.name.startsWith(f.prefix) && p.version === f.version)
}

/** "needs write:tier:t2:pacing/3 — this NVS serves /1" when only the version differs; else "unknown". */
function refusalReason(cap: string): string {
  const p = parse(cap)
  if (!p) return `"${cap}" is not a valid capability id (expected name/version, e.g. read:scenes/1)`
  const servedVersions = [...SUPPORTED]
    .map(parse)
    .filter((s): s is NonNullable<ReturnType<typeof parse>> => !!s && s.name === p.name)
    .map((s) => s.version)
  for (const f of FAMILIES) if (p.name.startsWith(f.prefix)) servedVersions.push(f.version)
  return servedVersions.length
    ? `needs ${cap} — this NVS serves /${servedVersions.sort().join(', /')} (update ${p.version > Math.max(...servedVersions) ? 'the app' : 'the extension'})`
    : `needs ${cap} — this NVS doesn't serve that capability`
}

/**
 * The handshake: compare a manifest's declared needs against what this build serves.
 * Refuse BEFORE any work happens; the reasons are user-facing (the "Requires NVS ≥ X" pattern).
 */
export function checkManifest(m: CapabilityManifest): HandshakeResult {
  const reasons: string[] = []
  if (m.engineApi !== ENGINE_API) {
    reasons.push(`engineApi ${m.engineApi} not supported (this NVS speaks ${ENGINE_API})`)
  }
  for (const cap of m.capabilities.required) {
    if (!serves(cap)) reasons.push(refusalReason(cap))
  }
  if (reasons.length) return { ok: false, reasons }
  const degraded = (m.capabilities.optional ?? []).filter((cap) => !serves(cap))
  const granted = [...m.capabilities.required, ...(m.capabilities.optional ?? []).filter(serves)]
  return { ok: true, granted, degraded }
}
