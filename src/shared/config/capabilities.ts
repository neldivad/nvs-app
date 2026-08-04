/**
 * Plain-English glosses for extension capability ids (the ids `engine/hostApi.ts` serves and an extension
 * manifest declares). Installing an extension GRANTS these — so the store detail names them the way a browser
 * or VS Code names permissions ("This extension can read your manuscript"), instead of showing raw `read:scenes/1`.
 *
 * Keyed by capability FAMILY (the id minus its `/N` version, with the parameterized `write:tier:*` collapsed).
 * Unknown ids fall back to the raw id — honest about "this build doesn't recognise it" rather than inventing a gloss.
 */
export interface CapabilityGloss {
  label: string
  detail: string
  scope: 'read' | 'write'
}

const TABLE: Record<string, { label: string; detail: string }> = {
  'read:scenes': { label: 'Read your scenes', detail: 'The manuscript text of every scene — frontmatter and body.' },
  'read:story': { label: 'Read your story structure', detail: 'The folder tree: acts, chapters, and scene ordering.' },
  'read:world': { label: 'Read your world bible', detail: 'Character, location, and lore pages.' },
  'read:timeline': { label: 'Read your timeline', detail: 'The manual timeline-canvas layout.' },
  'read:project': { label: 'Read project details', detail: "The open work's title, author, and metadata." },
  'read:corkboard': { label: 'Read your corkboards', detail: 'The freeform planning boards — cards, notes, and the connections you drew between them.' },
  'read:tiers': { label: 'Read the analysis ledger', detail: 'Derived threads, beats, and coherence findings.' },
  'write:files': { label: 'Write files', detail: 'Create, edit, rename, or delete scenes and world pages.' },
  'write:timeline': { label: 'Edit the timeline', detail: 'Move nodes and change the canvas layout.' },
  'write:assets': { label: 'Add images', detail: 'Import cover art and avatars into the project.' },
  'write:tier': { label: 'Write analysis', detail: 'Produce a tier of the analysis ledger (provenance-stamped).' }
}

/** Resolve a capability id to its user-facing gloss. Strips the version, collapses `write:tier:*`. */
export function describeCapability(id: string): CapabilityGloss {
  const name = id.split('/')[0] // drop the "/1" version suffix
  const family = name.startsWith('write:tier:') ? 'write:tier' : name
  const scope: 'read' | 'write' = name.startsWith('write') ? 'write' : 'read'
  const g = TABLE[family]
  return g ? { ...g, scope } : { label: id, detail: "A capability this build doesn't recognise.", scope }
}
