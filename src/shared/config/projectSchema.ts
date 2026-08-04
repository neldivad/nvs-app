/**
 * projectSchema.ts — the controlled vocabularies for a project's AUTHORED metadata (.nvs/project.json), the
 * "book card" an author declares about the whole work. Field NAMES follow schema.org/CreativeWork so the metadata
 * is machine-readable (emit JSON-LD later) and AI/search-friendly: `inLanguage`, `genre`, `about` (themes),
 * `contributor`, `isBasedOn` (lineage), `contentRating` (warnings).
 *
 * NVS deliberately keeps these AUTHORED-only — characters, story arcs, plot points, relationships are DERIVED in
 * the analysis DB (cast/entities · threads · arcs · coherence), not duplicated here.
 *
 * DRAFT vocabularies — starting sets, meant to be edited. Each option is { value (stable id), label (display) }.
 */
import type { ProjectInfo } from '../ipc'

export interface Option {
  value: string
  label: string
  flag?: string // emoji flag (languages) — AniDB/VNDB-style
}

/** schema.org `inLanguage` — ISO 639-1 codes, with a flag for the AniDB/VNDB-style facts table. */
export const LANGUAGES: readonly Option[] = [
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'zh', label: 'Chinese', flag: '🇨🇳' },
  { value: 'ja', label: 'Japanese', flag: '🇯🇵' },
  { value: 'de', label: 'German', flag: '🇩🇪' },
  { value: 'fr', label: 'French', flag: '🇫🇷' },
  { value: 'es', label: 'Spanish', flag: '🇪🇸' },
  { value: 'ko', label: 'Korean', flag: '🇰🇷' },
  { value: 'ru', label: 'Russian', flag: '🇷🇺' },
  { value: 'pt', label: 'Portuguese', flag: '🇵🇹' },
  { value: 'it', label: 'Italian', flag: '🇮🇹' }
]

/** The kind of work — drives medium-specific fields later (book vs screenplay vs VN vs game). */
/**
 * KIND — the top of the classification hierarchy, ABOVE medium/genre (which are fiction sub-taxonomies). Asking
 * genre first silently assumes fiction; KIND un-loads that. `blurb` is the one-line "what changes" shown next to
 * the choice. Declaration only for now: it does NOT branch analysis behavior yet (that's the domain-profile epic).
 */
export interface DomainOption extends Option { blurb: string }
export const DOMAINS: readonly DomainOption[] = [
  { value: 'fiction', label: 'Fiction', blurb: 'Characters, plot, arcs — coherence against your world.' },
  { value: 'nonfiction', label: 'Non-fiction', blurb: 'Speakers, topics — consistency of what’s actually said.' }
]
/** The default when a project declares no domain — every existing project reads as fiction, unchanged. */
export const DEFAULT_DOMAIN = 'fiction'

/** A MEDIUM (schema.org form of the work) is KIND-scoped: fiction media (novel/screenplay…) vs non-fiction forms
 *  (podcast/interview…). `kind` omitted = universal (shows for both, e.g. Other). Filtered by the project's domain. */
export interface MediumOption extends Option { kind?: 'fiction' | 'nonfiction' }
export const MEDIUMS: readonly MediumOption[] = [
  // fiction
  { value: 'novel', label: 'Novel', kind: 'fiction' },
  { value: 'short-story', label: 'Short story', kind: 'fiction' },
  { value: 'screenplay', label: 'Screenplay', kind: 'fiction' },
  { value: 'visual-novel', label: 'Visual novel', kind: 'fiction' },
  { value: 'game', label: 'Game', kind: 'fiction' },
  { value: 'film', label: 'Film', kind: 'fiction' },
  { value: 'tv-series', label: 'TV series', kind: 'fiction' },
  { value: 'comic', label: 'Comic / manga', kind: 'fiction' },
  // non-fiction
  { value: 'podcast', label: 'Podcast', kind: 'nonfiction' },
  { value: 'interview', label: 'Interview', kind: 'nonfiction' },
  { value: 'lecture', label: 'Lecture / Talk', kind: 'nonfiction' },
  { value: 'panel', label: 'Panel / Roundtable', kind: 'nonfiction' },
  { value: 'documentary', label: 'Documentary', kind: 'nonfiction' },
  { value: 'speech', label: 'Speech', kind: 'nonfiction' },
  { value: 'article', label: 'Article / Essay', kind: 'nonfiction' },
  { value: 'transcript', label: 'Transcript / Record', kind: 'nonfiction' },
  // universal
  { value: 'other', label: 'Other' }
]
/** Media offered for a KIND — the picker filters by the project's domain (universal entries always shown). */
export const mediumsForKind = (domain: string): MediumOption[] =>
  MEDIUMS.filter((m) => !m.kind || m.kind === domain)

/** Authoring lifecycle. */
export const STATUSES: readonly Option[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'published', label: 'Published' },
  { value: 'hiatus', label: 'On hiatus' },
  { value: 'abandoned', label: 'Abandoned' }
]

/** schema.org `genre` — the conventional shelf. KIND-scoped: fiction genres vs non-fiction SUBJECTS. `kind`
 *  omitted = universal. The picker filters by the project's domain. */
export interface GenreOption extends Option { kind?: 'fiction' | 'nonfiction' }
export const GENRES: readonly GenreOption[] = [
  // fiction genres
  { value: 'fantasy', label: 'Fantasy', kind: 'fiction' },
  { value: 'science-fiction', label: 'Science fiction', kind: 'fiction' },
  { value: 'romance', label: 'Romance', kind: 'fiction' },
  { value: 'mystery', label: 'Mystery', kind: 'fiction' },
  { value: 'thriller', label: 'Thriller', kind: 'fiction' },
  { value: 'horror', label: 'Horror', kind: 'fiction' },
  { value: 'drama', label: 'Drama', kind: 'fiction' },
  { value: 'comedy', label: 'Comedy', kind: 'fiction' },
  { value: 'historical', label: 'Historical', kind: 'fiction' },
  { value: 'literary', label: 'Literary fiction', kind: 'fiction' },
  { value: 'adventure', label: 'Adventure', kind: 'fiction' },
  { value: 'slice-of-life', label: 'Slice of life', kind: 'fiction' },
  { value: 'action', label: 'Action', kind: 'fiction' },
  { value: 'crime', label: 'Crime', kind: 'fiction' },
  { value: 'dystopian', label: 'Dystopian', kind: 'fiction' },
  { value: 'satire', label: 'Satire', kind: 'fiction' },
  // non-fiction subjects (the "shelf" for non-fiction)
  { value: 'technology', label: 'Technology', kind: 'nonfiction' },
  { value: 'business', label: 'Business', kind: 'nonfiction' },
  { value: 'politics', label: 'Politics', kind: 'nonfiction' },
  { value: 'science', label: 'Science', kind: 'nonfiction' },
  { value: 'history', label: 'History', kind: 'nonfiction' },
  { value: 'true-crime', label: 'True crime', kind: 'nonfiction' },
  { value: 'health', label: 'Health', kind: 'nonfiction' },
  { value: 'philosophy', label: 'Philosophy', kind: 'nonfiction' },
  { value: 'education', label: 'Education', kind: 'nonfiction' },
  { value: 'culture', label: 'Culture & arts', kind: 'nonfiction' },
  { value: 'sports', label: 'Sports', kind: 'nonfiction' },
  { value: 'religion', label: 'Religion', kind: 'nonfiction' }
]
/** Genres/subjects offered for a KIND — the picker filters by the project's domain. */
export const genresForKind = (domain: string): GenreOption[] =>
  GENRES.filter((g) => !g.kind || g.kind === domain)

/** schema.org `about` — THEMES. The layer that predicts taste + powers AI discovery better than genre. */
export const THEMES: readonly Option[] = [
  { value: 'identity', label: 'Identity' },
  { value: 'revenge', label: 'Revenge' },
  { value: 'mortality', label: 'Mortality' },
  { value: 'power', label: 'Power' },
  { value: 'love', label: 'Love' },
  { value: 'betrayal', label: 'Betrayal' },
  { value: 'redemption', label: 'Redemption' },
  { value: 'coming-of-age', label: 'Coming of age' },
  { value: 'found-family', label: 'Found family' },
  { value: 'class-struggle', label: 'Class struggle' },
  { value: 'survival', label: 'Survival' },
  { value: 'freedom', label: 'Freedom' },
  { value: 'justice', label: 'Justice' },
  { value: 'memory', label: 'Memory' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'sacrifice', label: 'Sacrifice' }
]

/** schema.org `contentRating`-ish — VNDB-style warnings, for discovery + compliance. */
export const CONTENT_WARNINGS: readonly Option[] = [
  { value: 'violence', label: 'Violence' },
  { value: 'gore', label: 'Gore' },
  { value: 'sexual-content', label: 'Sexual content' },
  { value: 'suicide', label: 'Suicide' },
  { value: 'self-harm', label: 'Self-harm' },
  { value: 'substance-abuse', label: 'Substance abuse' },
  { value: 'abuse', label: 'Abuse' },
  { value: 'death', label: 'Death' },
  { value: 'mental-illness', label: 'Mental illness' },
  { value: 'strong-language', label: 'Strong language' }
]

/** schema.org `contributor` roles — one person can hold several (writer + translator + composer …). */
export const CONTRIBUTOR_ROLES: readonly Option[] = [
  { value: 'writer', label: 'Writer' },
  { value: 'co-writer', label: 'Co-writer' },
  { value: 'scenario', label: 'Scenario' },
  { value: 'translator', label: 'Translator' },
  { value: 'editor', label: 'Editor' },
  { value: 'illustrator', label: 'Illustrator' },
  { value: 'character-designer', label: 'Character designer' },
  { value: 'composer', label: 'Composer' },
  { value: 'voice-actor', label: 'Voice actor' },
  { value: 'director', label: 'Director' },
  { value: 'producer', label: 'Producer' }
]

/** label lookup for rendering a stored value. */
export const labelOf = (opts: readonly Option[], value: string): string => opts.find((o) => o.value === value)?.label ?? value

/**
 * Field length caps — the FIRST line of defense against overflow (guard the input, not just the render). A title
 * that can't be 500 chars can't break a card, a tooltip, a folder name, or an export. Display truncation
 * (`truncate`) is the second line, for the still-long-but-legal cases.
 */
export const FIELD_LIMITS = {
  projectName: 80, // the "New project" name → the folder on disk
  title: 120,
  subtitle: 120,
  logline: 200, // one sentence
  synopsis: 2000,
  author: 80,
  contributorName: 80,
  keywords: 300 // the whole comma-separated string
} as const

/** The ProjectInfo fields the contract declares as arrays (schema.org multi-value). */
const ARRAY_FIELDS = ['inLanguage', 'genre', 'about', 'contentRating', 'keywords'] as const

/**
 * Coerce a raw project.json into a contract-shaped ProjectInfo, tolerant of SHAPE DRIFT. Early converter output
 * (and hand-edited files) sometimes stored an array field as a scalar — e.g. `inLanguage: "en"` instead of
 * `["en"]`. Consumers do `field.map(...)`, so a bare string is a crash landmine (`??` doesn't catch it, and
 * `"en".length` is a truthy false-friend). This normalizes scalars → single-element arrays at the boundary, so
 * every reader (BookCard, the library grid, the details wizard) can trust the array contract. Pure — no I/O.
 */
export function normalizeProjectInfo(raw: unknown): ProjectInfo {
  if (!raw || typeof raw !== 'object') return {}
  const info = { ...(raw as Record<string, unknown>) } as Record<string, unknown>
  for (const f of ARRAY_FIELDS) {
    const v = info[f]
    if (typeof v === 'string') info[f] = v.trim() ? [v] : []
    else if (v != null && !Array.isArray(v)) info[f] = []
  }
  if (info.contributor != null && !Array.isArray(info.contributor)) info.contributor = []
  return info as ProjectInfo
}
