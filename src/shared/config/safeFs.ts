/**
 * Cross-platform filesystem-safe names — ONE source of truth for both the guard and the sanitiser.
 *
 * Windows reserves  :  \  /  <  >  "  |  ?  *  (and a trailing dot/space) in file and folder names. Linux only
 * bans `/` and NUL, so a name a Linux author types freely (a chapter title with a colon) would make a project
 * that WON'T open on a collaborator's Windows machine. Rather than reject such names, we rewrite the reserved
 * characters to a safe standard so the on-disk name stays portable everywhere.
 */

/** The reserved-character class: `: \ / < > " | ? *`. Space and dash are fine and deliberately NOT here. NOT
 *  global, so `.test()` stays stateless; the sanitiser adds the `g` flag itself. */
export const safeFsRegex = /[:\\/<>"|?*]/

/** True if a name is already filesystem-safe AND within `maxLen` (the guard — a safety net after sanitising). */
export function isSafeFsName(name: string, maxLen: number): boolean {
  const n = name.trim()
  return n.length > 0 && n.length <= maxLen && !safeFsRegex.test(n) && n !== '.' && n !== '..' && !/[. ]$/.test(n)
}

/**
 * Rewrite a display name into a filesystem-safe folder/scene name: reserved chars → a dash, whitespace and dash
 * runs collapsed, no trailing dot/space (also Windows-illegal), bounded to `maxLen`. Returns '' when a name
 * sanitises to nothing (e.g. all-reserved) so callers can still reject the truly-empty case.
 */
export function sanitizeFsName(name: string, maxLen: number): string {
  const cleaned = name
    .replace(new RegExp(safeFsRegex, 'g'), '-') // reserved → dash
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/-{2,}/g, '-') // collapse dash runs
    .trim()
  // slice AFTER cleaning, then strip any trailing separator the cut/clean left behind.
  return cleaned.slice(0, maxLen).replace(/[-.\s]+$/, '').trim()
}
