/**
 * The per-kind PAGE TAB registry — step 3 of the BasePage plan (internal/pageshell-step3.md).
 * A page kind maps to a KIND GROUP, and a group names its tabs; PageShell renders whatever the
 * registry says. Adding a page mode (including a future extension-contributed one) = a row here,
 * not a new hand-rolled header.
 */
export type PageKindGroup = 'scene' | 'world' | 'custody'

/** scene → scene · custody → custody · every world category (character/location/item/…) → world. */
export function pageKindGroup(kind: string): PageKindGroup {
  if (kind === 'scene') return 'scene'
  if (kind === 'custody') return 'custody'
  return 'world'
}

export const PAGE_TABS = {
  scene: ['write', 'preview', 'source'],
  world: ['write', 'preview', 'source'],
  // write = the PROSE sections (Overview/Truth/Notes) — grammar-gated on save (a broken fence refuses);
  // records = the structured fence; source = read-only inspection
  custody: ['chart', 'records', 'write', 'preview', 'source']
} as const satisfies Record<PageKindGroup, readonly string[]>
