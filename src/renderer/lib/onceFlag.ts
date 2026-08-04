/**
 * One-time UX gates — an onboarding hint shown once EVER (per user, across projects), latched in
 * localStorage. Distinct from the per-project analysis state; these are teaching moments (e.g. the first
 * time you switch a loadout) that must never nag twice.
 *
 * Defensive: if localStorage is unavailable (private mode, headless test), it falls back to an in-memory
 * Map so the latch still holds within the session (and stays unit-testable) — worst case the hint can
 * reappear in a later session, which is harmless.
 */
const KEY_PREFIX = 'nvs.seen.'
const mem = new Map<string, string>() // fallback store when localStorage throws

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return mem.get(key) ?? null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    mem.set(key, value)
  }
}

/** Has this one-time gate already been latched? */
export function seenOnce(id: string): boolean {
  return read(KEY_PREFIX + id) === '1'
}

/** Latch a one-time gate (idempotent). */
export function markSeen(id: string): void {
  write(KEY_PREFIX + id, '1')
}

/**
 * `true` the FIRST time it's called for `id` (and latches so every later call is `false`). The one-liner
 * for a fire-once call site: `if (firstTime('loadout-intro')) pushNotification(...)`.
 */
export function firstTime(id: string): boolean {
  if (seenOnce(id)) return false
  markSeen(id)
  return true
}

/** Test-only: clear a gate so a scenario can re-arm it. */
export function resetSeen(id: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + id)
  } catch {
    mem.delete(KEY_PREFIX + id)
  }
}
