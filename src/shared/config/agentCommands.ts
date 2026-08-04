/**
 * In-editor agent commands — the EPHEMERAL, page-scoped twin of the chat (one-shot, no inbox).
 *
 * Two categories (decisions: internal/pending.md "generative surfaces"):
 *   • read  → opens the chat panel with this page as context and asks the question (reuses streaming chat).
 *   • write → a one-shot agent run that appends to / reshapes the page; applied as ONE editor transaction
 *             (native undo = accept/reject), so write runs are NOT streamed into the buffer.
 *
 * Standardized here from config (the "tools + prompts from config" rule) so both editors (scene TipTap +
 * world CodeMirror) and the main-process page-agent read one source.
 */
import { sectionHeadings } from './worldSections'

/** Append = return only the new Markdown to add; Replace = return the full revised page. */
export type PageEditMode = 'append' | 'replace'

// The mode- AND kind-agnostic persona. The warm Plan session (planSession.ts) pins its systemPrompt once
// at creation, so it uses THIS and restates the page kind + mode per message (via `kindDirective` +
// `modeDirective`). The one-shot path uses `pageAgentSystem(mode, kind)` (persona + both directives).
const PAGE_AGENT_PERSONA = [
  'You are an in-editor writing assistant for a dialogue-driven fiction IDE.',
  'You edit exactly one page and return its new content. Match the page’s existing structure and conventions,',
  'keep the author’s voice, preserve any `---` frontmatter block at the very top unchanged, and invent no canon',
  'beyond the instruction.'
]
const OUTPUT_LINE = 'Output raw text only — no preamble, no explanation, no surrounding code fences.'

// The exact on-disk formats, so a reformat/edit CONFORMS (a scene is NOT generic Markdown).
const SCENE_FORMAT = [
  'This is a SCENE page in the NVS Fountain dialect. Keep the page’s existing structure; use ONLY these conventions:',
  '• `## Section` headings (e.g. `## Beat`, `## Scene`) label the parts of the scene — keep the ones already present.',
  '• A plain line is narration.',
  '• An ALL-CAPS line is a speaker cue; the line(s) directly below it are that character’s spoken dialogue.',
  '• `(THINKING)` after a cue (e.g. `MR ARR (THINKING)`) makes the lines below it inner monologue, not spoken.',
  '• Any OTHER `(word)` after a cue is the speaker’s MOOD — their emotion (e.g. `MARA (angry)`), not a manner-adverb. One parenthetical per cue (thinking OR mood). PRESERVE any already present; add one only when it clearly fits.',
  '• A beat’s first line may begin with a `[start → end]` timecode tag (e.g. `[00:01:23 → 00:01:27]`, or start-only `[00:01:23]`) — subtitle/transcript timing. PRESERVE these VERBATIM if present; do NOT add timing to beats that don’t already have it.',
  '• A line starting with `> ` is an action beat / stage direction.',
  '• A line starting with `= ` is a transition (e.g. `= Two weeks earlier`); for a time/scene break use `= …`, NOT a `---` rule.',
  '• `**bold**` / `*italic*` for inline emphasis. Don’t use `---` separators, `Name:` dialogue prefixes, or `[[…]]` wiki links.'
].join('\n')
const WORLD_FORMAT = [
  'This is a WORLD-BIBLE page, authored as named `## Section` blocks (typically `## Profile`, `## Description`/`## Overview`, `## Relationships`, `## Notes`, plus kind-specific ones like `## Personality`, `## Arc`).',
  'Keep the existing sections; write Markdown inside them — paragraphs, `-` lists, `### Sub-headings`, `**bold**`/`*italic*`.',
  'To reference another person/place, link it as a Markdown link to its id: `[Display Name](page-id)` — copy these verbatim from the "people in this work" list below. NEVER write `@name`, a bare name, or invent someone who isn’t in that list; if a relationship is with someone not listed, describe them in prose without a link.'
].join('\n')

/** The format spec for the page kind — the heart of getting a conforming reformat/edit. */
export function kindDirective(kind: string): string {
  return kind === 'scene' ? SCENE_FORMAT : WORLD_FORMAT
}

/**
 * The AI-provenance note folded into a GENERATION edit's applied text (same family as the createPage stamp).
 * It rides inside the single editor transaction (so undo removes it too) and is injected by the app — never
 * the model. For `append` it precedes the new block; for `replace` it heads the rewritten page.
 */
export function provenanceNote(mode: PageEditMode, at: Date = new Date()): string {
  const when = at.toLocaleString()
  return mode === 'replace'
    ? `> 🤖 AI-rewrote this page on ${when}. Review and edit it.`
    : `> 🤖 AI-drafted this section on ${when}. Review and edit it.`
}

/** The per-mode directive: append (new text only) vs replace (full revised page). */
export function modeDirective(mode: PageEditMode): string {
  return mode === 'replace'
    ? 'Return the FULL revised page — the complete replacement, nothing else.'
    : 'Return ONLY the new text to append to the page — not the existing content.'
}

/** The system framing for the one-shot page-agent: persona + the page kind's format + what to return. */
export function pageAgentSystem(mode: PageEditMode, kind: string): string {
  return [...PAGE_AGENT_PERSONA, kindDirective(kind), modeDirective(mode), OUTPUT_LINE].join('\n')
}

/** Mode/kind-agnostic framing for the warm Plan session (kind + mode are restated per message instead). */
export function pageAgentBaseSystem(): string {
  return [...PAGE_AGENT_PERSONA, OUTPUT_LINE].join('\n')
}

/** Prompt categories. maintenance/generation EDIT the open page (the `/agent` composer → Tasks); analysis
 *  prompts READ the work and run in CHAT (the read tools answer in the transcript — `mode` is ignored). */
export type PromptCategory = 'maintenance' | 'generation' | 'analysis'

/** True for categories that run in chat (read the work) rather than editing the page. */
export function isAnalysis(category: PromptCategory): boolean {
  return category === 'analysis'
}

export interface BuiltinPrompt {
  id: string
  label: string
  directive: string // the instruction fragment handed to the agent (or sent to chat for analysis)
  mode: PageEditMode // applies to maintenance/generation; ignored for analysis
  category: PromptCategory
}

/** Seeded into the global library on first run (see src/main/prompts.ts). */
export const BUILTIN_PROMPTS: BuiltinPrompt[] = [
  // ── Maintenance — fix/clean the page ──
  { id: 'reformat', label: 'Reformat', category: 'maintenance', mode: 'replace',
    directive: 'Convert this page INTO the conventions above so it parses cleanly into the preview. Do NOT assume the page already follows them and do NOT preserve its current shape — it may have been pasted from another source (a transcript, a screenplay, a chat log, a messaging export) in a completely different notation. Recognise what each part IS — dialogue, narration, headings, action/transition markers — and re-express it in the target conventions, whatever prefix or layout the source used. The result should be well-structured NVS Fountain, not a lightly-touched copy of the input. Change only the formatting and structure — keep every word, its order, and its meaning exactly.' },
  { id: 'placeholders', label: 'Placeholders', category: 'maintenance', mode: 'append',
    directive: 'Add clearly-marked placeholder scaffolding (e.g. “TODO: …”) for any missing or incomplete sections, so the page has a complete skeleton to fill in.' },
  { id: 'custody-records', label: 'Structure custody records', category: 'maintenance', mode: 'replace',
    directive: 'This is a CUSTODY TOPIC page (a possession/revelation timetable). Convert any freeform notes about who holds or learns things into the fenced ```custody block: a YAML list of records, each {scene, event, who, note?}. GRAMMAR (v2): event \u2208 gain | lost | public \u2014 EVENTS ONLY, never status ("still secret" is silence). The topic kind gives the verb meaning: on an ITEM topic, gain = who now HOLDS it (the record\u2019s who REPLACES the holder set \u2014 usually one; several who = joint possession; a handoff is one record, prior holders\u2019 loss implied) and lost with no who = destroyed/vanished; on an INFORMATION topic, gain = who now KNOWS it and lost = who forgets it. public = everyone in-world knows; lost [public] = a GLOBAL event (destruction or mass amnesia \u2014 everyone in-world loses it, the reader remembers). who uses real character names or the special audience (the reader \u2014 a gain [audience] record declares WHEN the reader learns it; on an item topic audience/public mean the reader/world learn OF it \u2014 they never hold it). The audience gain goes at the FIRST scene where the reader can know \u2014 the scene that SHOWS it happening \u2014 not the later scene where it is fully explained (a reveal shown on-page in scene 1 means the reader knows from scene 1). If a CHARACTER learns an item\u2019s contents WITHOUT holding it, do NOT fake a gain \u2014 note in ## Notes that a separate information topic for the contents is warranted. scene must be a real scene id from the work, or the word start for things true before page one. Merge into the existing block in scene order; keep Overview/Truth/Notes prose intact; put the WHY of each checkpoint in its note. STRICT YAML: the fence contains ONLY the record list (no headings/prose inside it); every note value MUST be double-quoted (unquoted colons break the parse and the whole chart with it); who entries are PLAIN ids \u2014 `who: [ophelia, audience]`, NEVER markdown links like [Ophelia](ophelia) (links belong in prose sections only); one fenced block per page.' },
  // NOTE: 'sync-links' retired — scene cast/location/item frontmatter is reference-only (analysis reads the
  // PROSE, not these tags), so an AI preset that spends tokens filling fields nothing reads was pure busywork.
  // ── Generation — create new content ──
  { id: 'next-beat', label: 'Draft next beat', category: 'generation', mode: 'append',
    directive: 'Continue the scene: draft the next beat in the same voice and format, picking up exactly where the page leaves off. If the page is EMPTY, draft an OPENING beat instead, grounded in the frontmatter (title, cast, beat) and the listed canon — NEVER ask for content, apologize, or explain that the page is empty: your output is inserted into the page verbatim, so it must be story text and nothing else.' },
  // ── Analysis — read the work, answer in chat ──
  { id: 'threads', label: 'Open threads', category: 'analysis', mode: 'append',
    directive: 'Call listThreads. List the threads still OPEN or REOPENED (skip closed), grouped by type. For each: its description (the promise/question it raises), where it opened (openedAt) and how many beats it has developed, and its resolutionCondition — what would pay it off. Order longest-running / most beats first. If nothing is open, say so plainly. One line per thread.' },
  { id: 'arcs', label: 'Character arcs', category: 'analysis', mode: 'append',
    directive: 'Call listCharacterArcs. Cover the 4–5 MOST-developed characters (most windows/events) in 2–3 lines each: their through-line across the windows (lean on each window’s summary), the most significant state change or two (a gain/loss/expose, naming the value), and their biggest still-open goal or conflict. Then list any remaining characters that have events by name in a single line. Lead with the most developed; skip walk-ons with no events. Keep the whole answer tight enough to fit in one response (don’t let it get truncated).' },
  { id: 'coherence', label: 'Coherence flags', category: 'analysis', mode: 'append',
    directive: 'Call listCoherenceFindings. List only the open PROBLEMS — kinds drift, gap, hole, contradiction (ignore confirmations) — highest severity first. For each: who it’s about, the trait, what’s declared vs what the scenes show (declared → observed), the checkpoint (asOf), and the suggestion. If there are none, say the work reads as coherent.' },
  { id: 'next-scene', label: 'What to write next', category: 'analysis', mode: 'append',
    directive: 'Call listThreads and listStoryTree. Recommend the next 1–2 scenes to write. For each: the open thread it advances (toward its resolutionCondition), the beat it should hit, who is likely in it, and where it slots into the reading order. Favor threads open longest or most central. Be concrete enough to start drafting.' },
  // ── Analysis · planning + drafting (more generative) ──
  { id: 'outline', label: 'Story outline', category: 'analysis', mode: 'append',
    directive: 'Call listThreads, listStoryTree and listScenes. Sketch the story’s outline as it stands: the spine (the central thread and its turns), the act/chapter shape, and where each open thread sits along it. Then give me your read — 2–3 concrete moves to tighten the arc or land a promise that’s drifting. Have an opinion. Link scenes/pages by title.' },
  { id: 'chapter-plan', label: 'Plan a chapter', category: 'analysis', mode: 'append',
    directive: 'Call listStoryTree, listScenes and listThreads. Plan the next chapter (or, if I name one, that chapter) as a 3–6 scene beat sheet: for each beat give a working title, a one-line purpose, the thread it advances, and the cast. Build escalation and land a turn at the chapter’s end. Link existing scenes/pages by title; flag which beats are new vs already drafted.' },
  { id: 'scene-plan', label: 'Plan a scene', category: 'analysis', mode: 'append',
    directive: 'Plan one scene — if it’s unclear which, ask me for the beat or thread first. Give: goal · conflict · outcome; who’s in it and what each wants; the turn (what’s different by the end); and the beat it sets up next. Pull cast from listWorldPages and the thread from listThreads, and link them by title. Concrete enough to draft straight from.' },
  { id: 'sample-dialogue', label: 'Sample exchange', category: 'analysis', mode: 'append',
    directive: 'Write a short sample exchange (6–12 lines) for the beat or scene I name, to feel out the voice — in this work’s style, using the real characters (their ALL-CAPS cues) and the NVS Fountain dialect (ALL-CAPS cue then their lines below, `> ` for action). Pull the cast from listWorldPages. Keep it a taste, not a finished scene, and say one line about what you were going for.' }
]

/** Compose the free-text instruction with any chained prompts into one directive + the effective mode.
 *  Accepts anything with `{ directive, mode }` — the built-in presets or Prompt-Library entries. */
export function composeInstruction(freeText: string, presets: { directive: string; mode: PageEditMode }[]): { instruction: string; mode: PageEditMode } {
  const parts = [freeText.trim(), ...presets.map((p) => p.directive)].filter(Boolean)
  // Replace wins: a reformat in the chain rewrites the whole page.
  const mode: PageEditMode = presets.some((p) => p.mode === 'replace') ? 'replace' : 'append'
  return { instruction: parts.join('\n'), mode }
}

/** The live-canon block appended to a SCENE edit — the work's real names so the model doesn't invent any.
 *  Takes raw names (characters get upper-cased to their speaker cue). Empty for non-scenes / empty works. */
export function canonBlock(kind: string, characterNames: string[], locationNames: string[]): string {
  if (kind !== 'scene') return ''
  const cast = characterNames.map((n) => n.toUpperCase())
  if (!cast.length && !locationNames.length) return ''
  const lines = ['\n\n---\nThis work’s canon — use these exact names, don’t invent new ones:']
  if (cast.length) lines.push(`Characters (ALL-CAPS = the speaker cue for their dialogue/thoughts): ${cast.join(', ')}.`)
  if (locationNames.length) lines.push(`Locations: ${locationNames.join(', ')}.`)
  return lines.join('\n')
}

/** The canonical `## Section` set for a WORLD-page kind, read live from the shared schema (no mirror), so a
 *  world edit keeps the page's structure and doesn't invent headings. Empty for scenes / unknown kinds. */
export function worldSectionsBlock(kind: string): string {
  if (kind === 'scene') return ''
  const headings = sectionHeadings(kind)
  if (!headings.length) return ''
  return (
    `\n\n---\nA ${kind} page is organized into these standard sections: ${headings.map((h) => `## ${h}`).join(', ')}. ` +
    'Keep the page’s existing sections and their order; add a missing standard section only if the instruction calls for it, and don’t invent new section names.'
  )
}

/** The linkable cast for a WORLD page — the real people/places with their exact `[Name](id)` link form, so
 *  the model references existing pages instead of inventing names (and never drifts to `@name`). */
export function worldCanonBlock(entities: { name: string; id: string }[]): string {
  if (!entities.length) return ''
  const list = entities.map((e) => `[${e.name}](${e.id})`).join(', ')
  return (
    '\n\n---\nPeople & places in this work — when you reference one, link it with the EXACT markdown link ' +
    `shown (its id), and NEVER invent anyone not in this list:\n${list}`
  )
}

/** The per-kind context block appended to a page edit: scene → cast cues; world → its section schema + the
 *  linkable cast (so relationships link real pages, not invented names). */
function contextBlock(kind: string, characters: { name: string; id: string }[], locations: { name: string; id: string }[]): string {
  if (kind === 'scene') return canonBlock(kind, characters.map((c) => c.name), locations.map((l) => l.name))
  // CUSTODY: the generic world block says "link everyone as [Name](id)" — which is exactly the prose
  // dialect that keeps leaking into the YAML fence (who: [Ophelia](ophelia) broke real runs). Custody
  // pages get a PLAIN roster instead: bare ids inside the fence, links confined to prose sections.
  if (kind === 'custody') {
    const all = [...characters, ...locations]
    if (!all.length) return ''
    const list = all.map((e) => `${e.id} — ${e.name}`).join('\n')
    return (
      '\n\n---\nPeople & places in this work (id — name). Inside the ```custody fence use the BARE id only ' +
      `(who: [ophelia, audience]); [Name](id) markdown links belong in the prose sections, never in the fence:\n${list}`
    )
  }
  return worldSectionsBlock(kind) + worldCanonBlock([...characters, ...locations])
}

/** A UNIVERSAL prompt template — the static framing verbatim, with the per-run inputs as `{{ … }}`
 *  placeholders. The world-section schema is deterministic per kind, so it's shown for real (not a `{{}}`). */
export function pagePromptTemplate(p: { mode: PageEditMode; kind: string; instruction: string }): { system: string; user: string } {
  const ctx =
    p.kind === 'scene'
      ? '\n\n{{ this work’s canon — characters as ALL-CAPS cues + locations }}'
      : worldSectionsBlock(p.kind) + '\n\n{{ the work’s people & places — each as [Name](id) to link; never invent anyone not listed }}'
  const user = `Current page:\n\n{{ the page’s current content }}\n\n---\nInstruction:\n${p.instruction || '{{ your instruction }}'}` + ctx
  return { system: pageAgentSystem(p.mode, p.kind), user }
}

/** Assemble the EXACT { system, user } the page-agent sends. One source of truth so the in-editor
 *  "preview full prompt" matches what actually runs (no drift between the preview and the real call). */
export function buildPagePrompt(p: {
  pageText: string
  instruction: string
  mode: PageEditMode
  kind: string
  pageTitle?: string
  characters: { name: string; id: string }[]
  locations: { name: string; id: string }[]
}): { system: string; user: string } {
  const system = pageAgentSystem(p.mode, p.kind)
  // Anchor a world page on its own subject so the model writes ABOUT this entity by its real name — it
  // must not invent a personal name for the page's subject (the "who is Kyle?" failure).
  const subject = p.kind !== 'scene' && p.pageTitle ? `\n\nThis page is the ${p.kind} page for **${p.pageTitle}** — write about ${p.pageTitle}, always referring to them by this name (or an alias already on the page). Do NOT give the subject a different personal name.` : ''
  const user = `Current page:\n\n${p.pageText || '(empty page)'}\n\n---\nInstruction:\n${p.instruction}${subject}` + contextBlock(p.kind, p.characters, p.locations)
  return { system, user }
}
