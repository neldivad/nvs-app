/**
 * railEmpty — the ONE declaration of every rail's EMPTY-STATE teaching copy (author rule: an empty panel should
 * show a CENTERED placeholder that explains what the panel is, how to fill it, and its role in the project —
 * not a whisper in a corner). Rendered by `EmptyRailState`; copy only, no components (config stays data).
 * Three lines per rail: WHAT it shows · HOW it gets filled · its ROLE in the project.
 */

export type RailEmptyId = 'threads' | 'cast' | 'arcs' | 'entities' | 'lore' | 'coherence' | 'custody' | 'relationships' | 'timeline'

export interface RailEmptyCopy {
  title: string
  what: string // what this panel shows once alive
  how: string // the concrete action that fills it
  role: string // why it exists — its place in the project
}

export const RAIL_EMPTY: Record<RailEmptyId, RailEmptyCopy> = {
  threads: {
    title: 'Threads',
    what: 'Every promise your story opens — mysteries, tasks, conflicts, foreshadowing — charted as beats across your scenes.',
    how: 'Run analysis (Console → Update analysis). Each scene read adds its thread beats here.',
    role: 'Your ledger of what’s open, what resolved, and what the reader is still owed.'
  },
  cast: {
    title: 'Cast',
    what: 'Who appears where — every character’s presence and dialogue volume across your scenes.',
    how: 'Add character pages under world/characters (or let analysis discover speakers from your scenes).',
    role: 'The attendance sheet of your story — who carries which chapters, and who’s gone quiet.'
  },
  arcs: {
    title: 'Character arcs',
    what: 'What each character gains, loses, and exposes — accumulated chapter by chapter into scrubbable windows.',
    how: 'Run analysis; the arc pass rolls each chapter’s scenes into per-character windows.',
    role: 'How your people move through the story — the growth ledger behind coherence checks.'
  },
  entities: {
    title: 'Entity journeys',
    what: 'Your items and factions tracked through the story — where they appear, what happens to them.',
    how: 'Analysis discovers them while reading scenes; each chapter adds to their journey.',
    role: 'The object-and-faction memory of your world — what exists and where it’s been.'
  },
  lore: {
    title: 'Lore disclosures',
    what: 'Every world-truth the story reveals, and exactly when the reader learns it.',
    how: 'The scene pass logs reveals as it reads — run analysis to populate the ledger.',
    role: 'Your pacing lens: is a fact planted early, woven across acts, or dumped at once?'
  },
  coherence: {
    title: 'Coherence',
    what: 'Where the prose drifts from — or contradicts — what your world pages declare.',
    how: 'Run analysis, then Check coherence (Console). Findings land here as flags to review or dismiss.',
    role: 'The consistency safety-net between your world bible and what the story actually shows.'
  },
  custody: {
    title: 'Custody',
    what: 'Who HOLDS an item (a baton passing hand to hand) and who KNOWS a secret (a contagion spreading), scene by scene.',
    how: 'Create a topic page (the + above, or World → Custody). Its ## Timeline is drawn here exactly as written; analysis can propose checkpoints.',
    role: 'The audience-experience lens — what the reader believes about who has, and who knows, at any moment.'
  },
  relationships: {
    title: 'Relationships',
    what: 'How two characters stand with each other — and how that shifts scene over scene.',
    how: 'Pick a pair in the sidebar; analysis fills their shared history from the scenes they appear in.',
    role: 'The map of tensions and alliances your plot hangs on.'
  },
  timeline: {
    title: 'Timeline',
    what: 'Your story’s structure as a graph — scenes wired into routes, branches, and merges.',
    how: 'Drag scenes or folders from the left onto the canvas and connect them — or use Build with AI in the sidebar. Folders drop collapsed; expand to reveal their scenes.',
    role: 'The reading-order truth every analysis follows. Variants let you test alternate orderings side by side.'
  }
}
