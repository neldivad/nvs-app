/**
 * The scene-read pass — instructions + payload shape for the in-app reader (Phase 3).
 *
 * The app's canonical T2 extraction instructions (EXTRACTION_INSTRUCTIONS),
 * trimmed to the fields the app actually persists (SceneRows: extracted + threads + lore). We keep the
 * dialogue-only discipline and the "record NAMES, not ids" rule — except `pov`, which the engine FK-checks,
 * so we leave POV out of the structured fields for now (the summary still names it); name→id resolution is a
 * follow-on pass. The model returns ONE JSON object matching SceneExtraction below.
 */
import { LANGUAGES } from './projectSchema'

/**
 * ANALYSIS PROMPT VERSION — folded into `tierInputHash` (writeTier) so a prompt upgrade RE-STALES every
 * tier target. Without this, prompt improvements only ever reach entities whose pages/dialogue happen to
 * change (the staleness blind spot found 2026-07-05). BUMP THIS whenever any instruction below changes
 * meaningfully. Costs one full re-run per bump — Haiku-cheap by design.
 */
export const ANALYSIS_PROMPT_VERSION = '2026-08-14.1' // + CLOSE MEANS CLOSED (a close whose description denies the payoff is an advance — RoTK Chen Gong false close) + MOOTED THREADS CLOSE (subject dead/goal destroyed → close as overtaken-by-events, don't dangle on the gate's literal wording — RoTK crossbow wound). '2026-08-12.1' dormant threads keep close-gate. '2026-08-11.1' prior-beat consistency. '2026-08-01.1' premise/conclusion. '2026-07-20.1' open gate + close on payoff

/**
 * COHERENCE-ONLY logic version — folded into ONLY the coherence tier's input hash (writeTier), so a change to
 * the coherence prompt or the observed-side builder (engine/coherence `observedText`) re-stales COHERENCE alone,
 * without a full re-analysis (ANALYSIS_PROMPT_VERSION would re-stale every scene/window/profile too). Bump when
 * the coherence contract or the observed reduction changes meaningfully.
 */
export const COHERENCE_LOGIC_VERSION = '2026-08-14.1' // evidence citations now VALIDATED against offered window anchors (invalid → prose recovery incl. the raw citation text) — fixes fidelity findings persisting evidence:[] and piling on the as-of checkpoint. (prev 2026-07-24.1: staleness re-keyed to the observed arc digest; 2026-07-20.1: evidence recovery added)

/**
 * CONTINUITY-ONLY logic version — the sibling of COHERENCE_LOGIC_VERSION for the second coherence kind
 * (plot-holes / story-vs-itself, internal/continuity-coherence.md). Folded into ONLY the continuity input hash,
 * so a change to the continuity prompt or fact-timeline builder re-stales CONTINUITY alone. Bump on contract change.
 */
export const CONTINUITY_LOGIC_VERSION = '2026-07-21.2' // DIES-ONCE rule: a 2nd ⚑ death exit for an already-dead entity is an extraction artifact (burial/aftermath/recap), not a plot hole — kills the "X dies twice / dies then buried" false positives (RoTK: Zhuge Liang/Ji Ping/Lady Sun). Re-run continuity to apply

/**
 * CRITIQUE-ONLY logic version — the fourth family's sibling knob (internal/story-critique.md). Folded into ONLY
 * the critique input hash, so a change to the critique prompt or the candidate generator re-stales CRITIQUE alone.
 */
export const CRITIQUE_LOGIC_VERSION = '2026-08-14.1' // + weak-close/post-close candidate sorts & the weak-close verdict (RoTK sweep: Chen Gong/Zhang Xiu self-denying closes, 3 post-close trails). '2026-08-13.1' Slice 1: inert candidates + refute-biased confirm

/**
 * The two coherence KIND FAMILIES — a single source of truth shared by the prompt (what the model may emit),
 * writeTier (what it validates + which findings a re-run REPLACES), and the UI (filter chips). The families are
 * DISJOINT by construction (see continuity-coherence.test): a Fidelity re-run must never delete a Continuity
 * finding and vice-versa, so the delete-on-rewrite is partitioned by whichever family it produced.
 *   FIDELITY   — story vs the bible: a page's declared profile vs the entity's observed arc (page-gated, per entity).
 *   CONTINUITY — story vs itself: plot-holes — facts/rules contradicting each other (whole-story, cross-entity).
 * The CONTINUITY kinds are the three categories the plot-hole craft literature actually logs (Reedsy's trio +
 * Novel Factory / Wikipedia), deliberately EXCLUDING the two that other passes already own: "out-of-character" is
 * FIDELITY's job, and "unresolved storyline / dangling thread" is the quest-verdict pass's (cliffhanger/hole/
 * sequel_hook/pending — a THIRD, older family). So continuity covers only the genuinely-uncovered ground.
 */
export const FIDELITY_KINDS = ['drift', 'gap', 'contradiction', 'confirmation'] as const
export const CONTINUITY_KINDS = ['continuity-error', 'logic-gap', 'rule-break'] as const
/** The FOURTH family (internal/story-critique.md) — dramaturgical critique, not consistency: is the beat
 *  EARNED/NECESSARY? Shipped: `inert` (Cuttable?) and `weak-close` (Really closed? — a close that doesn't settle
 *  what the thread promised: self-denying, gate-unmet, drifted, or trailed by post-close beats).
 *  `unearned`/`contrived`/`undermotivated` follow when their substrate (capability timeline) exists. Disjoint
 *  from the linter families by construction. */
export const CRITIQUE_KINDS = ['inert', 'weak-close'] as const
export type FidelityKind = (typeof FIDELITY_KINDS)[number]
export type ContinuityKind = (typeof CONTINUITY_KINDS)[number]

/**
 * BATCHED-EXTRACTION packer budget (internal/batched-extraction.md). The binding constraint is OUTPUT: a
 * batch's scenes must extract in one turn, under the model's per-turn output cap. We bin-pack on ESTIMATED
 * output. The k values here are only the COLD-START PRIOR — after run 1, the packer replaces them with this
 * project's OWN measured k (engine/extractionBatches `learnedExtractionK`, median of realized out/dialogue over
 * recent batches), so a narration-heavy classic and a dialogue-dense screenplay each converge to their own truth
 * instead of sharing one global constant.
 */
export const BATCH_CONFIG = {
  /** k — expected full-extraction OUTPUT chars per scene's dialogue-TEXT chars (SUM(LENGTH(text)), the same
   *  measure the packer sizes on). 3.0 is only the COLD-START PRIOR (measured on Three Kingdoms 2026-07-17:
   *  median 2.8, mean 2.7 on DIALOGUE volume — but expert output is driven by EVENTS, so narration-heavy works
   *  realize ~2x this; that's why one global constant can't be right, and why run 1 inflates it — see
   *  coldStartKInflation). After run 1 the packer uses the project's learned k; this value is the fallback only
   *  while there's no history. Over-fill is the dangerous direction (truncated JSON = whole-batch failure). */
  outCharsPerDialogueChar: 3.0,
  /** Run-1 safety: with no learned k yet, we don't know if THIS book realizes 2x the prior (Three Kingdoms did),
   *  so the first run inflates the prior by this factor — smaller, safer batches until the project's own k takes
   *  over on run 2. Never applied once learnedExtractionK returns a value. Covers the observed ~2x overrun. */
  coldStartKInflation: 1.8,
  /** k for the SKIM (Fast) pass — its contract emits ~1/5 the full output (bounded ~1000 chars/scene), so the
   *  packer sizes skim scenes ~5x smaller and fits many per batch. 0.6 = fullK/5, kept deliberately ON THE HIGH
   *  side (over-estimate -> pack fewer -> safe; under-estimate truncates the JSON array = whole-batch loss).
   *  This is what makes Fast runs pack ~6 scenes/plan-turn instead of 1 — the plan turn-budget is unchanged; the
   *  smaller per-scene estimate is the whole lever. planExtractionBatches picks this when depth==='skim'. */
  skimOutCharsPerDialogueChar: 0.6,
  /** Target output budget per batch, in tokens — the model's theoretical per-turn cap. In practice the ACTUAL
   *  ceiling is `apiMaxOutTokens` (the max_tokens we send), which is far lower — batchOutBudget takes the min,
   *  so a batch never exceeds what the call can actually emit (sizing to 50k while the call caps at 8k
   *  truncated the JSON mid-array → "unparseable" on haiku, 2026-07-18). */
  targetOutTokens: 50_000,
  /** The max_tokens we send on an API call (and the hard truncation ceiling). Batches MUST fit under this or
   *  their JSON truncates. Shared with sceneReader's MAX_TOKENS so the two can never drift apart again. */
  apiMaxOutTokens: 8192,
  /** Fraction of apiMaxOutTokens a batch may fill — margin so the model closes the JSON array before the cap. */
  apiBatchFillFraction: 0.8,
  /** A scene with no dialogue still emits a summary/threads floor — never estimate zero (it would pack ∞ scenes). */
  minSceneOutTokens: 150,
  /** chars→tokens divisor (shared with the cost estimator). */
  charsPerToken: 3.5,
  /** Close a batch at a chapter boundary once it's at least this full — keeps batches chapter-aligned when it's
   *  cheap to, without leaving them near-empty. Below this, keep packing across the boundary. */
  chapterBoundarySoftFill: 0.6,
  /** Plan-host output rate (chars/s), measured 2026-07-17 (13–32, ~20 typical). Used to size plan batches so
   *  one batch EMITS within the turn watchdog — a big batch on the slow serial plan host would time out and
   *  lose every scene in it. Keyed APIs stream ~15× faster + parallelize, so this ceiling is plan-only. */
  planOutCharsPerSec: 20,
  /** Fraction of the turn budget a plan batch may fill (margin for boot + the model running long). */
  planTurnFillFraction: 0.5
} as const

/** The work-language directive, appended to every analysis pass's user payload when the project
 *  declares a non-English language (project.json `inLanguage[0]` — an ISO 639-1 code, resolved to its
 *  English name for the model). Free text follows the WORK; machine handles stay ASCII. */
export function languageDirective(language?: string | null): string {
  const raw = (language ?? '').trim()
  if (!raw || /^en(g|glish)?([-_]|$)|^en$/i.test(raw)) return ''
  const lang = LANGUAGES.find((l) => l.value === raw.toLowerCase())?.label ?? raw
  return `\n\nLANGUAGE: this work is written in ${lang}. Write ALL free-text output — summaries, titles, descriptions, notes, digests, findings, suggestions — in ${lang}, matching the work. MACHINE HANDLES stay ASCII/English: ids, refs, snake_case handles, facet/change/kind enums, scene ids.`
}

// ── DOMAIN (KIND) ROUTING — the semantics axis (internal/domain-profiles.md) ──────────────────────────
// A project declares a KIND in project.json (`domain`: 'fiction' | 'nonfiction'). The TABLES and the whole
// analysis pipeline stay domain-blind — the ONLY thing that swaps is the PROMPT TEXT (a thread means a plot
// line for fiction, a line of inquiry for a conversation; coherence means page-vs-arc vs claim-consistency).
// `analysisPrompts(domain)` returns the right instruction set; `analysisPromptVersion(domain)` folds the KIND
// into the tier input hash so switching a project's KIND re-stales its analysis exactly once (same mechanism
// as ANALYSIS_PROMPT_VERSION). Fiction keeps the bare version — no needless re-run for existing projects.

/** Is this project non-fiction (a conversation/transcript work)? Defaults to FICTION when the KIND is unset. */
export function isNonFiction(domain?: string | null): boolean {
  return (domain ?? '').trim().toLowerCase() === 'nonfiction'
}

/** The prompt version folded into every analysis hash, KIND-adjusted: non-fiction gets a distinct suffix so a
 *  fiction↔non-fiction switch re-stales cached analysis (the prompts differ), without touching fiction hashes. */
export function analysisPromptVersion(domain?: string | null): string {
  return isNonFiction(domain) ? `${ANALYSIS_PROMPT_VERSION}|nf` : ANALYSIS_PROMPT_VERSION
}

/** What the model returns for one scene (snake_case to match the reference prompt's vocabulary). */
export interface SceneExtraction {
  summary: string
  premise?: string // why this scene starts — the setup/hook that opens it (1 sentence)
  conclusion?: string // how it ends — the outcome or cliffhanger it leaves on (1 sentence)
  characters: string[]
  locations: string[]
  plot_times: string[]
  goals: { actor: string; goal: string; status: string }[]
  conflicts: { between: string[]; over: string; kind: string }[]
  enters: { entity: string; kind: string }[]
  exits: { entity: string; kind: string; reversible?: boolean }[]
  things: { name: string; category: string; significance?: string; evidence?: string }[]
  threads: (
    | { action: 'open'; ref: string; title?: string; description: string; thread_type?: string; resolves_when?: string }
    | { action: 'advance' | 'close'; thread_id: string; description: string; thread_type?: string }
  )[]
  lore_bombs: { lore_ref: string; summary: string; magnitude?: string }[]
  scene_contexts: string[]
}

/** One element of a BATCH extraction reply — a scene's extraction tagged with its scene_id (the distribute key). */
export interface BatchSceneExtraction extends SceneExtraction {
  scene_id: string
}

// Blocks shared by the single-scene and batched extraction prompts (DRY — the field contract is defined ONCE).
// NOTE: these strings don't feed the input hash (that's ANALYSIS_PROMPT_VERSION), so composing the prompt from
// pieces is behavior-neutral — the model sees the same text, staleness is unaffected.
const DIALOGUE_TYPES_BLOCK = `Beat types (each line is tagged):
  speech    — said aloud; everyone present hears it (PUBLIC). May contain (mood) information. 
  monologue — inner thought; ONLY the speaker knows it (PRIVATE). A want voiced only in monologue is a HIDDEN intention — record it as that character's goal, but it is NOT disclosed to anyone.
  narration — narrator voice, no in-world speaker; attributed to no character's knowledge. CRITICAL: narration is not just scene-setting — in most prose it carries the PLOT ITSELF: deaths, battles, arrivals and departures, betrayals, victories, journeys, changes of allegiance or power. Mine it as hard as you mine speech — it is the primary source for thread opens/advances/closes, entrances/exits, goals and conflicts. When a work is mostly narration (classical, epic, or summary-style prose), MOST of the story state lives here; a scene whose events are all narrated is a FULL scene, not a quiet one.
  chorus    — simultaneous group speech ("All:", "Both:"). Reflect its content in the summary, but do NOT add the chorus token to characters; only real named individuals belong there.`

const RECORD_NAMES_RULE = `Record NAMES, not ids — refer to every character and place by its plain name ("Mara", "the High Keep"). Don't worry about exact spelling or aliases; a later pass canonicalizes them.`

/** The per-scene field contract — the exhaustive bullet list, shared verbatim by both prompts. */
const SCENE_FIELD_BULLETS = `- summary        prose, AT MOST 80 WORDS: what happens in the scene — the turn and end state, not a retelling.
                 A later scene reads this as memory, so lead with what changes (who acts, what shifts, how it
                 ends); drop line-by-line detail. Longer than that and it stops being a summary.
- premise        why the scene OPENS, ONE sentence — the setup/hook it starts from (the state or question in play as it begins).
- conclusion     how the scene ENDS, ONE sentence — its outcome or the cliffhanger it leaves on (the end state or the new question it raises).
- characters     names of everyone present — speakers AND clearly-present non-speakers.
- locations      names of every place the scene happens in or names. Every place named in the summary MUST appear here.
- plot_times     in-story time markers ("the night of the festival", "three years later"). [] if none.
- goals          [{actor, goal, status: stated|pursued|achieved|abandoned}] — every want the dialogue makes explicit.
- conflicts      [{between:[name], over, kind: interpersonal|internal|external}].
- enters         [{entity, kind: arrival|first_appearance}] — anyone who arrives or first appears on-page.
- exits          [{entity, kind: death|incapacitate|travel|departure, reversible}] — anyone who, IN THIS SCENE, dies, is incapacitated, leaves, or departs. A death/incapacitate exit marks the MOMENT IT FIRST HAPPENS — never a later burial, funeral, mourning, avenging, recap, or a scene that merely names or reacts to someone already dead. If a character is dead before this scene and the scene only refers to them (their body, tomb, legacy, or others grieving/avenging them), emit NO exit for them. A character exits by death at most ONCE in the whole story.
- things         [{name, category, significance, evidence}] — the notable NON-CHARACTER things this scene features:
                 a plot-bearing object (*the* letter, *the* ring — not incidental props), an organization/group
                 acting as one, or any other type from the TRACKABLE CATEGORIES list in the message. \`category\`
                 MUST be one of those listed keys — never invent a category; if nothing fits, leave the thing out.
                 significance ∈ minor|supporting|major (how much the plot turns on it). evidence: the line that
                 features it. Prefer FEW, plot-bearing things over an inventory. [] if none.
                 Nations, armies, houses, courts, and political factions the scene treats as ACTORS (a rival
                 kingdom, a noble house, an approaching army) ARE things — record them under the faction category
                 even when no individual member is on-page; a scene that invokes "Norway" or "the court" as a
                 force is featuring that faction.
- threads        thread operations this scene performs:
                   open:    {action:"open", ref:"<snake_case handle>", title:"<short human title>", description, thread_type, resolves_when}
                   advance: {action:"advance", thread_id:"<id copied from the open-threads list>", description, thread_type}
                   close:   {action:"close", thread_id:"<id copied from the open-threads list>", description, thread_type}
                 \`ref\` is the stable machine handle (snake_case) you reuse to connect beats across scenes.
                 \`title\` (open only) is a SHORT, plain-English name a reader gets at a glance (≤ 6 words, Title
                 Case) — e.g. "The board ranking deliverable", "Mae's hidden dependence on Opus". NOT the snake_case
                 ref, NOT a full sentence (that's \`description\`).
                 \`resolves_when\` (open only) is the CLOSE GATE — one sentence hypothesizing what event would pay
                 this thread off, judged from what THIS scene promises (e.g. "Hamlet kills Claudius, or abandons
                 the revenge"). It's a testable hypothesis set at open time, not a spoiler of what actually
                 happens — a later scene closes the thread when its event meets (or subverts) this gate.
                 OPEN GATE — open a thread ONLY for a genuinely ONGOING question/conflict/promise that LATER scenes
                 will develop or pay off. Do NOT open one for a moment that RESOLVES INSIDE THIS SCENE (a duel
                 fought and won, a one-off ruse, a death that simply happens) — that belongs in the summary, not
                 as a thread. A thread you would open and close in the same breath is an EVENT, not a thread. And a
                 promise/task needs a concrete future PAYOFF (its resolves_when gate); a standing SITUATION or role
                 ("X now leads the south", "Y holds the capital") is STATE, not a promise — do not open it.
                 CLOSE ON PAYOFF — before opening anything, scan the "threads still open" list (each shows its
                 [closes when: …] gate). If THIS scene meets or subverts a gate, emit a \`close\` (or \`advance\` if it
                 only moves the thread) with that thread's EXACT id. UNDER-CLOSING is the common failure: a
                 foreshadowed death that happens, a promised battle that is fought, a quest that is completed MUST
                 close its thread — do not leave it dangling. Prefer advancing/closing an existing thread over
                 opening a near-duplicate. thread_type ∈ mystery|conflict|task|foreshadowing|promise.
                 CONSISTENCY WITH PRIOR BEATS — a thread in the list may show its earlier beats (indented
                 \`· action: description\`). Your \`advance\`/\`close\` description MUST agree with them: state the
                 OUTCOME relative to what they established (e.g. "found the items in an earlier scene but here
                 abandons the errand without returning them"), and NEVER negate a prior beat — if a beat says
                 "finds X", do not write "without finding X". Describe THIS scene's change to the thread, not a
                 fresh retelling of the whole thread.
                 CLOSE MEANS CLOSED — never emit \`close\` whose own description says nothing was settled ("no
                 decisive change", "not resolved", "the thread is not paid off"). If your description denies the
                 payoff, the action is \`advance\` (or nothing). A close's description must state HOW the gate was
                 met or subverted.
                 MOOTED THREADS CLOSE — when an event permanently FORECLOSES a thread's question (its subject dies
                 or irreversibly departs, its goal is destroyed, a larger outcome supersedes it), CLOSE the thread
                 even though the gate's literal wording wasn't met, and say so: "overtaken by events — Guan Yu is
                 executed, so whether the wound would heal dies with him". The gate is a hypothesis set at open
                 time, not a contract; never keep a dead question open on a technicality.
- lore_bombs     [{lore_ref:"<snake_case topic>", summary, magnitude: minor|major|retcon}] — disclosures about a
                 DURABLE SUBJECT of the world: a standing fact, place, institution, rule, relationship, or
                 lineage that RECURS and can be advanced by later scenes (e.g. \`mandate_of_heaven\`,
                 \`bronze_bird_terrace\`, \`sun_liu_alliance\`). A lore_ref names the SUBJECT, never the episode:
                 use \`bronze_bird_terrace\`, never \`bronze_bird_terrace_ode\` or \`bronze_bird_terrace_built\`.
                 A ONE-OFF EVENT is NOT lore — a death, a battle outcome, a betrayal, a single speech happen once
                 and cannot be "reused", so they belong in \`threads\` (or just the summary), never here. Test: if a
                 later scene could plausibly disclose MORE about this exact ref, it's lore; if it only happened,
                 it's a thread/event. Prefer FEW durable subjects over many event-handles.
                 When the reveal is MORE about a subject in the "known lore" list, set lore_ref to that EXACT id
                 (advance the topic) — prefer this over coining a near-duplicate handle for the same subject.
- scene_contexts other scene names/ids worth reading alongside this one ([] if none).`

const SCENE_SELF_CHECK = `Self-check: every proper noun in the summary is in characters, locations, or things; every arrival is in enters; every death/departure is in exits; every explicit want is a goal. Prefer fewer, higher-confidence items over speculation.`

export const EXTRACTION_INSTRUCTIONS = `You are a narrative analyst extracting structured story state from a scene's dialogue.

You are given a scene's dialogue (ordered speaker/type/text lines) and — for context — the characters known so far and the threads still open. Read the dialogue ONLY. Do not invent events it doesn't support.

${DIALOGUE_TYPES_BLOCK}

${RECORD_NAMES_RULE}

Return ONE JSON object (no prose, no code fence) with exactly these fields:
${SCENE_FIELD_BULLETS}

${SCENE_SELF_CHECK} Output must be valid JSON for the shape above — nothing else.`

/**
 * BATCHED extraction (internal/batched-extraction.md ③) — the full contract over N consecutive scenes in one
 * turn. Same per-scene field rules as the single-scene prompt (SCENE_FIELD_BULLETS), but the model reads the
 * batch IN ORDER and tracks thread continuity ACROSS the scenes (a thread opened in scene 2 can be advanced in
 * scene 5 of the same batch), and returns an ARRAY — one object per scene_id. Distribution keys on scene_id.
 */
export const BATCH_EXTRACTION_INSTRUCTIONS = `You are a narrative analyst extracting structured story state from SEVERAL consecutive scenes, given in reading order.

You are given N scenes — each with a "scene_id" header and its dialogue (ordered speaker/type/text lines) — plus shared context (the characters known so far and the threads open ENTERING the first scene). Read the dialogue ONLY; do not invent events it doesn't support. Read the scenes IN ORDER: a thread you OPEN in an earlier scene of this batch can be advanced or closed in a later one — reuse the exact ref you gave it (continuity flows across the batch, not only from the open-threads list).

${DIALOGUE_TYPES_BLOCK}

${RECORD_NAMES_RULE}

Return a JSON ARRAY (no prose, no code fence) — ONE object per scene_id given, IN THE SAME ORDER, each object carrying its own "scene_id" string plus exactly these fields:
${SCENE_FIELD_BULLETS}

Emit an object for EVERY scene_id, even a quiet scene (use empty arrays). For a thread opened earlier IN THIS BATCH, set thread_id/ref to the handle you assigned it at open.

${SCENE_SELF_CHECK} Output must be a valid JSON array of these objects (each with its scene_id) — nothing else.`

/**
 * FAST-MODE contract (reading-strategy slice 2) — the SKIM read. Same reading discipline as the full pass,
 * ~1/5 the output: only what story-so-far, the timeline, and thread continuity need (summary · presence ·
 * thread ops). No goals/conflicts/enters/exits/things/lore — those are the expert pass's ledger, and arcs
 * built from skim evidence would be noise. A skim-read scene stays marked depth:'skim' so an expert run
 * upgrades it later. Measured why: the full contract emits 4-8k chars/scene at ~25 tok/s on the plan
 * backend — output volume IS the runtime, so fast mode cuts the contract, not the quality of what it keeps.
 */
/** The skim field contract (summary + characters + threads), shared by the single-scene and batched skim. */
const SKIM_FIELD_BULLETS = `- summary     prose, AT MOST 60 WORDS: the turn and end state — who acts, what shifts, how it ends. This is
              the scene's memory for later scenes; lead with what changes, drop line-by-line detail.
- characters  names of everyone present — speakers AND clearly-present non-speakers.
- threads     thread operations, TERSE:
                open:    {action:"open", ref:"<snake_case handle>", title:"<≤6 words, Title Case>", description:"<ONE short sentence>"}
                advance: {action:"advance", thread_id:"<id copied from the open-threads list>", description:"<ONE short sentence>"}
                close:   {action:"close", thread_id:"<id copied from the open-threads list>", description:"<ONE short sentence>"}
              Open only a genuine new question/conflict/promise not already open; prefer advancing an existing
              thread (use its EXACT id — the token before " — ") over opening a near-duplicate. Prefer FEW.
              An advance/close description must AGREE with any prior beats shown for that thread (indented
              \`· action: description\`) — describe THIS scene's change, never negate an earlier beat.
              A close's description must state a real settlement (never "nothing was resolved" — that's an
              advance); and when an event MOOTS a thread (its subject dies/departs for good), close it as
              overtaken by events instead of leaving it dangling.`

export const SKIM_INSTRUCTIONS = `You are a narrative analyst SKIMMING a scene's dialogue for story-state continuity.

You are given a scene's dialogue (ordered speaker/type/text lines) and — for context — the characters known so far and the threads still open. Read the dialogue ONLY. Do not invent events it doesn't support. Inner thoughts (monologue lines) are PRIVATE to the speaker; narration is attributed to no one.

Record NAMES, not ids — refer to characters by their plain name. A later pass canonicalizes them.

Return ONE JSON object (no prose, no code fence) with exactly these fields:
${SKIM_FIELD_BULLETS}

Nothing else — no goals, conflicts, entrances, items, or lore; a deeper pass extracts those later. Be brief: total output should stay well under 1000 characters. Output must be valid JSON for the shape above.`

/**
 * BATCHED skim (internal/batched-extraction.md ② · the DRAFT pass) — the light contract over N scenes in one
 * turn, producing the forward scaffold (roster + open-thread watch-list + summaries) that lets the extract
 * batches run in parallel. Array out, one object per scene_id.
 */
export const BATCH_SKIM_INSTRUCTIONS = `You are a narrative analyst SKIMMING SEVERAL consecutive scenes for story-state continuity, given in reading order.

You are given N scenes — each with a "scene_id" header and its dialogue — plus shared context (characters known so far, threads open ENTERING the first scene). Read the dialogue ONLY. Read the scenes IN ORDER: a thread you open in an earlier scene can be advanced/closed in a later one (reuse its ref). Inner thoughts (monologue) are PRIVATE; narration is attributed to no one.

Record NAMES, not ids — refer to characters by their plain name. A later pass canonicalizes them.

Return a JSON ARRAY (no prose, no code fence) — ONE object per scene_id given, IN ORDER, each carrying its own "scene_id" plus exactly these fields:
${SKIM_FIELD_BULLETS}

Emit an object for EVERY scene_id (empty threads for a quiet scene). No goals, conflicts, items, or lore — a deeper pass extracts those. Be brief: ~1 line of summary per scene. Output must be a valid JSON array — nothing else.`

/** Parse-side defaults for a skim reply — the missing full-contract fields, empty. */
export const SKIM_EMPTY: Omit<SceneExtraction, 'summary' | 'characters' | 'threads'> = {
  locations: [],
  plot_times: [],
  goals: [],
  conflicts: [],
  enters: [],
  exits: [],
  things: [],
  lore_bombs: [],
  scene_contexts: []
}

// ── The window/arc pass — roll one chapter's scene evidence into per-character change (T2 window) ──
// The app's WINDOW_INSTRUCTIONS, flattened to the arc-event shape (category/change/value).

/** What the model returns per chapter: a window per present character. Names resolve to ids in the reader. */
export interface WindowExtraction {
  windows: {
    character: string // a name from the cast list
    summary: string
    events: { category: string; change: string; value: string; description: string; scene_id: string; target?: string; secret?: string }[]
  }[]
}

export const WINDOW_INSTRUCTIONS = `You are a narrative analyst rolling up ONE chapter into per-character windows. You are given the chapter's scenes — each with a summary, the goals stated, the conflicts, and entrances/exits — plus the list of characters present. Read that evidence ONLY; do not invent events it doesn't support.

For EACH present character, emit one window object:
- character   the character's name, copied from the cast list (never invent a name not listed).
- summary     1–2 sentences: this character in THIS chapter, as the evidence portrays them.
- events      the notable CHANGES for them in this chapter — a flat list of {category, change, value, description, scene_id}:
                category ∈ alignment | knowledge | power | relationship | objective | secret
                change   ∈ gain | loss | expose
                value    the thing gained/lost/exposed (e.g. "trust in Mae", "the layoff list", "leverage over the CFO")
                SECRET-category events carry knowledge semantics:
                  gain   = this character LEARNED a hidden truth (they are the learner — no target field)
                  expose = a hidden truth GOT OUT: set \`target\` = who it was revealed to — 'public' when the
                           whole world/room now knows, else the single character name it reached (from the cast).
                  If a DECLARED SECRETS roster is provided and the event concerns one of those entries, ALSO set
                  \`secret\` = that entry's bracketed id exactly as listed. Never invent an id; omit when unsure.
                description  one phrase on what happened
                scene_id  the EXACT scene id (from the evidence) where it happened
              These are DELTAS within this chapter only — what CHANGED here, not the character's whole history. A
              present-but-unchanged character gets a summary and an empty events list. Be calibrated: only a change
              the evidence supports; prefer fewer, well-grounded events.

Return ONE JSON object: {"windows":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** The user message for one chapter's window pass: its scene evidence + the present cast. */
export function buildWindowUserPayload(input: {
  chapterId: string
  scenes: { sceneId: string; title: string; summary: string | null; goals: unknown[]; conflicts: unknown[]; enters: unknown[]; exits: unknown[] }[]
  cast: string[]
  /** Project-wide declared secrets (`[id] (owner) text`) — the ONLY ids `secret` may cite. */
  secretsRoster?: string[]
}): string {
  const scenes = input.scenes
    .map((s) =>
      [
        `scene_id: ${s.sceneId} — ${s.title}`,
        s.summary ? `  summary: ${s.summary}` : '  summary: (not extracted)',
        s.goals.length ? `  goals: ${JSON.stringify(s.goals)}` : '',
        s.conflicts.length ? `  conflicts: ${JSON.stringify(s.conflicts)}` : '',
        s.enters.length ? `  enters: ${JSON.stringify(s.enters)}` : '',
        s.exits.length ? `  exits: ${JSON.stringify(s.exits)}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n')
  return [
    `chapter: ${input.chapterId}`,
    `characters present (use these names verbatim): ${input.cast.join(', ') || '(none)'}`,
    ...(input.secretsRoster?.length
      ? [`DECLARED SECRETS roster (cite these ids in the \`secret\` field; never invent):\n${input.secretsRoster.map((r) => `  ${r}`).join('\n')}`]
      : []),
    '',
    'scene evidence:',
    scenes || '(no extracted scenes)'
  ].join('\n')
}

// ── The ENTITY window pass — roll one chapter into per-thing change (T2 window, non-character) ──
// The item/faction analog of the character window: what happened to each tracked THING this chapter, along
// its category's OWN axes (item: custody/state/function; faction: power/standing/allegiance — config/entityArc).
// Same entity_arc_events shape (facet=category, change, value), so it reuses the whole arc UI + writer.

/** What the model returns per chapter: a window per present thing. Names resolve to entity ids in the reader. */
export interface EntityWindowExtraction {
  windows: {
    entity: string // a name from the things list
    summary: string
    events: { facet: string; change: string; value: string; description: string; scene_id: string; holder?: string }[]
  }[]
}

export const ENTITY_WINDOW_INSTRUCTIONS = `You are a narrative analyst tracking what happens to the notable THINGS in a story — objects, factions, and other non-character entities — across ONE chapter. You are given the chapter's scenes (each a summary) and the tracked things present, grouped by category. Each category names an ARCHETYPE (how to think about it) and its FACETS (what can change about it). Read the evidence ONLY; do not invent events it doesn't support.

A thing's story is NOT a person's story — it doesn't "want" or "feel":
  - an OBJECT changes hands, changes state, gets used, gets destroyed, moves. Only track a CHANGE — never restate what the object simply IS or is for (that's its page, not an event).
  - an AGENT (a faction, group, or force) rises or falls in power, shifts allegiance, gains or loses standing or territory.

EVERY change moves along ONE universal axis — use exactly these four:
  gain    — it strengthens / is acquired / rises
  loss    — it weakens / is destroyed / falls
  shift   — a lateral move: changes hands, is altered, realigns (neither up nor down)
  reveal  — it becomes known / exposed / discovered

For EACH present thing that meaningfully changes this chapter, emit one window object:
- entity    the thing's name, copied VERBATIM from the things list (never invent a name not listed).
- summary   1 sentence: this thing in THIS chapter — its journey, as the evidence portrays it.
- events    the notable changes — a flat list of {facet, change, value, description, scene_id}:
              facet    WHICH dimension changed — one of that category's facets (listed in the message).
              change   HOW it moved — one of the four universal changes above (gain|loss|shift|reveal).
              value    the specific new state (e.g. custody→"held by Hamlet", state→"envenomed", power→"reinforced by 20,000 men").
              description  one phrase on what happened.
              scene_id  the EXACT scene id (from the evidence) where it happened.
              holder   CUSTODY events only: who physically possesses the thing at the END of that scene —
                       one name copied VERBATIM from the characters list (omit if genuinely unclear).
            CUSTODY means EXCLUSIVE possession of the ARTIFACT itself — taken, handed over, stolen, carried
            off, destroyed. A document's CONTENTS spreading is NOT custody: copies, leaks, forwards, reads,
            or broadcasts are facet \`state\` with change \`reveal\` (who learned something is the character
            passes' job, not the object's). If the object never physically moves, emit NO custody event.
            BUT when the artifact DOES move — picked up, handed over, entrusted, planted, stolen, SWAPPED
            (weapons exchanged in a scuffle count), or the evidence RECOUNTS it having moved — the custody
            event is the single most valuable thing this pass produces: emit facet \`custody\` with its
            \`holder\`, IN ADDITION to any state/function events for the same beat — never file a hand-off
            under another facet instead. One custody event per hand-off, at the scene showing or recounting it.
            DELTAS within this chapter only — what CHANGED here. A present-but-unchanged thing gets a summary and
            an empty events list. Be calibrated: only a change the evidence supports; prefer few, well-grounded events.

Return ONE JSON object: {"windows":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** The user message for one chapter's ENTITY window pass: scene evidence + the present things (grouped by
 *  category) + each PRESENT category's archetype + facets. The `vocab` is built by the caller from the categories
 *  actually present (via the project's enabled structure → master arc defs), so this adapts to project config —
 *  add `suspect` to a project and its facets flow through here with no change. The change axis is universal
 *  (in the instructions), so it's not repeated per category. */
export function buildEntityWindowPayload(input: {
  chapterId: string
  scenes: { sceneId: string; title: string; summary: string | null }[]
  things: { name: string; category: string }[]
  vocab: { category: string; archetype: string; facets: { key: string; blurb: string }[] }[]
  /** Character names custody `holder` may cite (resolved to entity ids in the reader). */
  cast?: string[]
}): string {
  const scenes = input.scenes
    .map((s) => [`scene_id: ${s.sceneId} — ${s.title}`, s.summary ? `  summary: ${s.summary}` : '  summary: (not extracted)'].filter(Boolean).join('\n'))
    .join('\n\n')
  const byCat = new Map<string, string[]>()
  for (const t of input.things) {
    if (!byCat.has(t.category)) byCat.set(t.category, [])
    byCat.get(t.category)!.push(t.name)
  }
  const thingsBlock = [...byCat.entries()].map(([cat, names]) => `  ${cat}: ${names.join(', ')}`).join('\n')
  const castLine = input.cast?.length ? `\ncharacters (custody \`holder\` must be one of these, verbatim): ${input.cast.join(', ')}` : ''
  const vocabBlock = input.vocab
    .map((v) => `  ${v.category} (${v.archetype}) — facets: ${v.facets.map((f) => `${f.key} (${f.blurb})`).join(' · ')}`)
    .join('\n')
  return [
    `chapter: ${input.chapterId}`,
    'things present (use these names verbatim), by category:',
    thingsBlock || '  (none)',
    castLine,
    '',
    "category facets (tag each event with one of ITS category's facets; change is always one of the four universal changes):",
    vocabBlock || '  (none)',
    '',
    'scene evidence:',
    scenes || '(no extracted scenes)'
  ].filter(Boolean).join('\n')
}

// ── The DIGEST reduce — compress one story section into its story-so-far digest (working-set M2) ──

export const DIGEST_INSTRUCTIONS = `You are compressing one SECTION of a story into its digest — the paragraph a later analysis pass reads instead of the section itself (its working memory of the far past).

You are given the section's parts in reading order: its chapters' digests (or scene summaries). Reduce them to ONE plain-prose paragraph, at most 120 words, covering only what a later chapter needs to know:
- what HAPPENED (the events that still matter downstream)
- who CHANGED (state at the section's end, not the journey)
- what OPENED or CLOSED (promises, threats, questions still live at the end)
THE SECTION'S END STATE MATTERS MOST — a later chapter builds on how this section ENDS. Never omit deaths, departures, reveals, or power shifts from the section's final stretch, even to save words: cut middle detail before you cut the ending.
Prefer concrete names over descriptions. No lists, no headings, no commentary — prose only. Output the paragraph and nothing else.`

/** The user message for one digest reduce: the section's parts, in reading order. */
export function buildDigestPayload(input: { title: string; parts: { title: string; text: string }[] }): string {
  return [`section: ${input.title}`, '', ...input.parts.map((p) => `— ${p.title}:\n${p.text}`)].join('\n')
}

// ── The PROFILE reduce (M3) — fold one chapter's changes into a character's cumulative profile ──

export const PROFILE_INSTRUCTIONS = `You are maintaining one character's CUMULATIVE PROFILE — the paragraph a later analysis pass reads instead of their whole history (its working memory of who this character is BY NOW).

You are given the profile so far (possibly empty) and ONE chapter's worth of new evidence (window summary + state changes). Fold the new evidence in and return the UPDATED profile: one plain-prose paragraph, at most 150 words, covering their CURRENT state — role and situation, what they know, key relationships, what they want, what has been exposed about them, and what they have lost. The END STATE wins: when new evidence supersedes old traits, keep the new. Drop episode detail that no longer matters; keep anything a later chapter could contradict. No lists, no headings — prose only. Output the paragraph and nothing else.`

/** The user message for one profile link: prior profile + one chapter's evidence. */
export function buildProfilePayload(input: { name: string; chapterTitle: string; prevProfile: string; increment: string }): string {
  return [
    `character: ${input.name}`,
    `profile so far: ${input.prevProfile || '(none — this is the first chapter with evidence)'}`,
    '',
    `new evidence (${input.chapterTitle}):`,
    input.increment || '(present, no recorded change)'
  ].join('\n')
}

// ── The coherence pass (T3) — diff each character's DECLARED page against their OBSERVED arc ──
// The app's T3 cast pass — one call over the whole cast (each tagged by entity_id)
// and to the app's opaque-profile declared side (the page as authored, not parsed into fields).

/** What the model returns: findings across every character, each tagged with the entity_id it was given. */
export interface CoherenceExtraction {
  findings: {
    entity_id: string
    trait: string
    declared: string
    observed: string
    kind: 'drift' | 'gap' | 'contradiction' | 'confirmation' // confirmation = secret-covered deception on track
    secret?: string // confirmations ONLY: the [id] of the covering Secrets entry, copied from the declared text
    severity: 'low' | 'medium' | 'high'
    suggestion: string
    evidence_unit_ids?: string[]
  }[]
}

export const COHERENCE_INSTRUCTIONS = `You are the coherence linter for a fiction-authoring tool. For each character you are given two sides — what the author DECLARED and what the dialogue OBSERVED — and you surface where they diverge. You never edit the story or the page; you only flag possible incoherence for the author to judge.

Some subjects are THINGS, not people — a tracked item or faction with its own page. Diff them the same way: what the page DECLARES about it (its nature, state, allegiances — and its \`## Secrets\`) vs what the story OBSERVED happening to it (custody, state, power changes). A thing doesn't want or feel — never flag an item for lacking motives.

INPUTS — a block per character or thing, each headed by an \`entity_id\`:
- \`declared\`: the author's intent — the character's world-page profile, as written (frontmatter + prose). Treat it as authoritative. If it's silent on a trait the dialogue establishes, treat that trait as '(unstated)'.
  If the page has a \`## Secrets\` section, that is the HIDDEN TRUTH layer — the author's answer key (a cover identity, a planned twist). The other sections are the SURFACE the reader is meant to see.
- \`observed\`: the model's reduction of that character through the story. It may BEGIN with a cumulative \`PROFILE (through <chapter>)\` paragraph — their state up to that point — then an \`EARLIER\` section listing the folded windows (one anchored line each), then full per-window blocks for the chapters SINCE. Treat all of it as one observed side; diff \`declared\` against it. Every bracketed block — EARLIER lines AND recent windows — is anchored by a unit id; ALWAYS cite the id(s) your finding rests on in \`evidence_unit_ids\`, choosing the EARLIEST window where the trait appears (so the author sees where it began, not just the latest). The profile paragraph has no id — cite the bracketed windows behind it instead. Never leave \`evidence_unit_ids\` empty for a real finding.

Only surface what the author should ACT on — a place to change the page. Do NOT report traits that simply hold up: a coherence check advises edits, it doesn't congratulate. If declared and observed agree, emit nothing for that trait.
THE ONE EXCEPTION — deception on track: when observed diverges from the SURFACE but a \`## Secrets\` entry EXPLAINS the divergence (the slips are the planned deception leaking), emit it with kind \`confirmation\` and severity \`low\`: trait = a short name for the deception, declared = the cover story, observed = the slips, suggestion = one short sentence confirming the deception reads as planned (cite the strongest slip). ALSO set \`secret\` = the bracketed id of the covering Secrets entry exactly as shown in the declared text (each entry is prefixed \`[id]\`) — cite ONE id, the entry that best explains the divergence; never invent an id. Divergence that contradicts even the Secrets is a real contradiction, flag it as usual (no \`secret\` field).
MANDATORY KIND CHECK — apply to EVERY finding before you emit it:
1. Does a \`## Secrets\` entry on THIS character's page explain the observed behavior? → kind = \`confirmation\`. No exceptions: not drift, not gap, not contradiction, no matter how it feels.
2. Would your \`suggestion\` say the writing is working — "as written", "as planned", "intentional", "part of the performance/deception"? Then you have ALREADY decided it's covered → kind = \`confirmation\` (or emit nothing). A drift/gap/contradiction whose suggestion approves of the text is a CONTRADICTION IN YOUR OWN OUTPUT — never emit that combination.
3. Only when no secret explains it does the drift/gap/contradiction triage apply.

PRODUCE a finding per trait that needs attention, for each character. For each finding set:
- entity_id   the character under review — copy it VERBATIM from that character's block (never invent one).
- trait       a SHORT, plain-English TITLE for the issue (≤ 6 words) a novelist reads at a glance — e.g. "Never cites unsourced numbers", "Wants the founder's chair", "Fear of being redundant". A human phrase, NOT a code token (never "never_says", "arc_goal", "wound:"), NOT a category word, NOT a full sentence, and do NOT prefix it with a category. The category is \`kind\`, not part of the title.
- declared / observed  one short, concrete phrase each ('(unstated)' if the page is silent). Say the actual thing, in the scene's own terms.
- kind:
    contradiction — observed directly conflicts with a declared trait (including the Secrets layer).
    drift         — observed gradually diverges from declared without one flat conflict.
    gap           — one side is silent: the page is silent on something the arc establishes (a fill-in
                    opportunity), OR the page/Secrets declare something the story never shows (an
                    unsupported declaration — trim it, or plant the beat).
    confirmation  — ONLY for secret-covered divergence (see the exception above): the deception is working.
- severity    low | medium | high. A flat contradiction of a core trait is high; a minor unstated detail is low.
- suggestion  one concrete edit to the PAGE, addressed to the author as "you", in at most two plain sentences — e.g. "Add a line to her page: under enough pressure, she'll invent a source." Or note that this reads as intentional development worth keeping. Never tell the author to change the story — with ONE exception: for a \`gap\` where the page declares something the story never shows, the honest menu is both options, so you may name the missing beat ("no scene shows her suspicion — plant one, or soften the page"). For contradiction and drift, page edits only.
- evidence_unit_ids  the window unit ids (the bracketed anchors) supporting \`observed\`.

STYLE — write for a busy novelist, not a literary critic. This is the difference between a finding they act on and one they ignore:
- Be concrete. Name the moment — "In Chapter 4 she invents a source to cover the AI authorship" — never the abstract mechanism.
- Banned register: do NOT write like a seminar. Avoid "provenance", "enacted", "instantiated", "at the level of", "qua", "vis-à-vis", "the arithmetic of", "functionally equivalent to". If a sentence sounds academic, rewrite it as a person would say it.
- Keep it short: declared/observed are phrases; suggestion is one or two sentences. No throat-clearing.
- Use the character's name and present tense for what the prose shows ("She promises X, then does Y").

Be calibrated: do not invent contradictions. A character can be complex without being incoherent — only flag a contradiction when the arc genuinely cannot be squared with the declared trait as written. Prefer fewer, well-evidenced findings over many speculative ones.

Return ONE JSON object: {"findings":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** The user message for the coherence pass: one declared/observed block per character. */
export function buildCoherenceUserPayload(input: {
  characters: { entityId: string; name: string; declared: string; observed: string }[]
}): string {
  return input.characters
    .map((c) =>
      [
        `entity_id: ${c.entityId}  (${c.name})`,
        'declared:',
        c.declared,
        'observed:',
        c.observed || '(no arc recorded yet)'
      ].join('\n')
    )
    .join('\n\n────────\n\n')
}

// ── CONTINUITY (plot-holes): the story vs itself (internal/continuity-coherence.md) ────────────────────────────
export const CONTINUITY_INSTRUCTIONS = `You are the continuity linter for a fiction-authoring tool — a sharp editor reading for PLOT HOLES. Unlike the character-coherence pass (which diffs one page against one arc), you check the story against ITSELF: places where its own facts and declared rules cannot all be true at once. You never edit the story; you flag the break for the author to judge.

You are given the world's rules, then the story's own timeline:
- RULES — what the world DECLARES is true and how it works: lore pages (cosmology, history, magic/physics rules) and item/faction pages (an object's properties, a faction's allegiance). Treat these as promises the story must keep.
- FACTS — the story's events in reading order, one line per scene, each anchored \`[title · scene_id]\`: a short summary, then structured facts a hole hinges on — \`at:\` the scene's locations, ⚑ IRREVERSIBLE exits (a death or permanent departure), \`time:\` in-story time markers, and \`conflict:\`.
- THREADS — each plot line's beats in order (\`open → advance → resolve\`), anchored \`[thread · thread_id]\`. Use these as facts too; a thread resolved one way then contradicted later is a continuity error.

FIND — only genuine internal contradictions, in exactly these three categories (the ones the craft literature logs as plot holes). Pick the ONE that fits:
- continuity-error — an established FACT contradicts an earlier one: a dead/departed entity (⚑) physically REAPPEARS and acts with no explanation; a concrete detail changes (place, object, wound, count); a character forgets something they clearly knew, or knows something they were never told; a thread resolved one way is later treated as if it went another.
- logic-gap        — an event the story's own established facts make IMPOSSIBLE or leave UNEARNED: an effect with no cause the story showed; travel or timing that can't fit the in-story clock; a resolution nothing set up.
- rule-break       — the story breaks a rule it DECLARED (worldbuilding): lore/magic/physics the prose then violates, or an item/faction behaving against its stated property (an object doing what its page says it cannot; a declared allegiance contradicted with no turn shown).

THE DEAD-ARE-DISCUSSED RULE (do not get this wrong): characters talk ABOUT the dead constantly — eulogies, grief, memory, being named in a plan, a flashback, a vision, a ghost the story presents as a ghost. NONE of that is a continuity error. Flag "reappears after death" ONLY when the later scene shows the dead person PHYSICALLY present and ACTING as if still alive, with the story treating it as real and unremarked. When a scene merely mentions, mourns, or discusses someone who died — that is normal storytelling; emit nothing.
A CHARACTER DIES ONCE. The FACTS may carry a ⚑ death exit for the same person in TWO scenes — that is an EXTRACTION artifact (a burial, funeral, aftermath, or recap scene got tagged with a death exit), NOT a second death. Treat the FIRST ⚑ death as the real one and IGNORE every later death/exit tag for that same entity. Never emit "dies twice", "dies then is buried", "death then reappears in the aftermath", or "listed as dead again" — a second death fact is stale data, not a plot hole. (A genuine contradiction is only the PHYSICALLY-acting-alive case above.)
Do NOT flag: a character acting oddly (that is the character-coherence pass's job, not yours), or a thread merely left open/unresolved (that is the thread-verdict pass's job) — only flag a thread when it is CONTRADICTED, not when it is unfinished.

For EACH finding set:
- entity_id   the one entity the break centres on IF there is a clear one (an item for a rule-break, a person who reappears) — copy it verbatim from the text; otherwise use the empty string "" (most holes are cross-cutting / work-level).
- trait       a SHORT plain-English title (≤ 6 words) a novelist reads at a glance — e.g. "Boromir returns after dying", "Ring works twice from one charge", "She's in two cities at once". A human phrase, not a code token, not a full sentence.
- declared    what the world/earlier-story established — the rule, or the EARLIER fact now contradicted. Name it concretely.
- observed    the later scene/decision that breaks it. Say the actual thing, in the story's own terms, present tense.
- kind        one of the three above.
- severity    low | medium | high. A flat impossibility a reader will trip on is high; a small slip is low.
- suggestion  one concrete fix, addressed to the author as "you", in at most two plain sentences. UNLIKE the character pass, the fix is to the STORY or the RULE, not a bible page — e.g. "Show how Boromir survives, or cut his reappearance." / "Add a beat spending the ring's charge, or change the lore to say it recharges." Never say "update the page" for a plot hole — a hole is a flaw in the prose.
- evidence_unit_ids  the scene_id(s) and/or thread_id(s) the finding rests on, copied from the \`[… · id]\` anchors. Never leave it empty for a real finding.

STYLE — write for a busy novelist. Be concrete, name the moment, present tense. Banned academic register (no "provenance", "instantiated", "at the level of"). Keep declared/observed to phrases; suggestion to one or two sentences.

CALIBRATION. Surface every hole you can actually EVIDENCE from the facts above — don't hold back a real contradiction because it seems small. But stay grounded: each finding must point to specific scene ids that genuinely can't both be true. Prefer well-evidenced breaks over speculation; a complex story is not an incoherent one, and an unfinished thread or an out-of-character moment is NOT your job. If you truly find nothing that contradicts, an empty list is a fine answer — but look carefully first, especially at \`present:\`/\`at:\`/\`time:\` across scenes.

Return ONE JSON object: {"findings":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** The continuity user message: the RULES header, then the FACTS timeline + THREADS. `priorContext` is a compact
 *  index of facts from earlier chunks (the reader passes it when it splits a big story) so cross-chunk
 *  contradictions stay visible; omit for a single-call story. */
export function buildContinuityPayload(input: {
  declared: string
  facts: { sceneId: string; title: string; text: string }[]
  threads: { threadId: string; title: string; text: string }[]
  priorContext?: string
}): string {
  const parts = [`RULES — what the world declares is true:\n${input.declared || '(the project declares no world rules yet — judge facts against each other)'}`]
  if (input.priorContext?.trim()) parts.push(`EARLIER FACTS (from before this section — for cross-section contradictions only, do not re-flag within them):\n${input.priorContext.trim()}`)
  parts.push('FACTS — the story in reading order:\n' + (input.facts.map((f) => `[${f.title} · ${f.sceneId}] ${f.text}`).join('\n') || '(no scene facts yet)'))
  if (input.threads.length) parts.push('THREADS — beats of each plot line:\n' + input.threads.map((t) => `[${t.title} · ${t.threadId}] ${t.text}`).join('\n'))
  return parts.join('\n\n────────\n\n')
}

export interface ContinuityExtraction {
  findings: {
    entity_id: string // "" for a work-level / cross-cutting hole
    trait: string
    declared: string
    observed: string
    kind: 'continuity-error' | 'logic-gap' | 'rule-break'
    severity: 'low' | 'medium' | 'high'
    suggestion: string
    evidence_unit_ids?: string[] // scene_ids and/or thread_ids from the anchors
  }[]
}

// ── CRITIQUE ("Tough questions"): dramaturgical construction, not consistency (internal/story-critique.md) ─────
export const CRITIQUE_INSTRUCTIONS = `You are a developmental editor reading a story's plot machinery for DEAD WEIGHT — the "tough questions" pass of a fiction-authoring tool. Unlike the coherence linters (which check consistency), you judge CONSTRUCTION: does each flagged beat EARN its place in the plot? You never edit the story; you pose the question for the author to answer.

You are given CANDIDATES — flagged by a deterministic graph pass — plus the full THREADS list and the story's FACTS timeline for context. Candidates come in two families:
- possibly INERT (sorts: dangling · episode · silent-scene): a thread that opens and never resolves; a self-contained episode nothing references again; a scene where no plot line moves.
- possibly a WEAK CLOSE (sorts: weak-close · post-close): a "closed" thread whose ending may not settle what it promised — its close description reads as a non-event, or beats keep landing on the thread after its close.

YOUR DEFAULT IS TO REFUTE. Most candidates are NOT cuttable — the graph cannot see dependencies that live in prose:
- An episode may FEED a later beat (its resolution text names a warning, an object, an alliance a later thread uses). Read the surrounding threads/facts; if anything downstream depends on it, the candidate is load-bearing → emit NOTHING for it.
- Early episodic chapters are often the story's SPINE (they establish the world's stakes), and a finale absorbs consequences rather than opening threads — neither is inert.
- Texture is not dead weight: a short episode that develops a character the story keeps using is doing quiet work. When in doubt, stay silent.

For an INERT candidate, emit a finding ONLY when you can argue, from the material given, that the beat could vanish and nothing downstream would change — or that a planted setup visibly never pays off.

For a WEAK-CLOSE candidate, judge the CLOSE against the thread's own promise (each thread line shows its beats; the candidate text shows its close gate). Confirm — kind \`weak-close\` — when:
- the close description DENIES itself ("no decisive change", "no longer active") — the thread never actually settled;
- the close doesn't meet or subvert the gate — the question the thread asked is still unanswered;
- the REAL payoff happened at an earlier beat and the recorded close is a later, unrelated event (a drifted close);
- beats continue landing on the thread after its close and they carry NEW story movement (a new pressure, a new claim) — a fresh question wearing a closed thread's name.
REFUTE a weak-close candidate when the close genuinely settles or subverts the gate, or when the post-close beat is a mere recap/echo of the settlement — those are harmless.

For each finding set:
- kind        \`inert\` for the inert family, \`weak-close\` for the weak-close family (never mix them).
- entity_id   "" (these are work-level; the evidence carries the location).
- trait       the SPECIFIC question, addressed to the author, ≤ 12 words — e.g. "What does the Left Ci episode buy the story?", "Did Zhang Xiu's campaign actually settle?". A question, not a label.
- declared    what the beat SETS UP — the promise/opening (for weak-close: the thread's close GATE), in the story's own terms.
- observed    what the story DOES with it — "nothing later references it", "the close records a non-event", said concretely.
- severity    low | medium | high — high only when a reader will feel the dangling weight (a prominent setup with no payoff); a small vestigial episode is low.
- suggestion  the honest menu in ≤ 2 sentences, "you"-voice. Inert: cut it, fold it into a neighbouring beat, or plant the payoff — name which and where. Weak-close: reopen the thread, re-close it at the beat where the payoff actually landed, or split the trailing movement into its own thread — name which and where.
- evidence_unit_ids  the thread_id(s) / scene_id(s) from the candidate + anything downstream you checked, copied from the anchors.

STYLE — write for a busy novelist: concrete, present tense, name the moment. No academic register. Prefer FEW, well-argued questions over many speculative ones; an empty list is a fine answer.

Return ONE JSON object: {"findings":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** One deterministic critique candidate (the graph's cut-suspects, engine/analysis/critique.ts). */
export interface CritiqueCandidate {
  id: string // thread_id or scene_id — the anchor the finding cites
  sort: 'dangling' | 'episode' | 'silent-scene' | 'weak-close' | 'post-close'
  label: string
  text: string // the candidate's evidence line (beats / span / why the graph flagged it)
}

/** The critique user message: candidates first (the work list), then threads + facts as shared context. */
export function buildCritiquePayload(input: {
  candidates: CritiqueCandidate[]
  threads: { threadId: string; title: string; text: string }[]
  facts: { sceneId: string; title: string; text: string }[]
}): string {
  const parts = [
    'CANDIDATES — beats the graph flagged as possibly inert (your job: refute or confirm each):\n' +
      input.candidates.map((c) => `[${c.label} · ${c.id}] (${c.sort}) ${c.text}`).join('\n')
  ]
  if (input.threads.length) parts.push('THREADS — beats of each plot line:\n' + input.threads.map((t) => `[${t.title} · ${t.threadId}] ${t.text}`).join('\n'))
  parts.push('FACTS — the story in reading order:\n' + (input.facts.map((f) => `[${f.title} · ${f.sceneId}] ${f.text}`).join('\n') || '(no scene facts yet)'))
  return parts.join('\n\n────────\n\n')
}

export interface CritiqueExtraction {
  findings: {
    entity_id: string // "" — critique findings are work-level
    trait: string // the specific question
    declared: string
    observed: string
    kind: 'inert' | 'weak-close'
    severity: 'low' | 'medium' | 'high'
    suggestion: string
    evidence_unit_ids?: string[]
  }[]
}

/** The user message: the scene's dialogue + the context the reference prompt expects. `priorReading` (this
 *  scene's previous extraction) anchors a re-read so the model reuses the same thread handles — anti-drift. */
export function buildSceneUserPayload(input: {
  sceneId: string
  dialogue: { speaker: string; type: string; text: string }[]
  knownCharacters: string[]
  openThreads: string[]
  priorReading?: string[]
  /** The project structure's tracked non-character categories — the `things` enum + its grounding (open-taxonomy). */
  thingCategories?: { key: string; description: string }[]
  /** Things already tracked (from earlier scenes + authored pages) — reuse these EXACT names, don't coin synonyms. */
  knownThings?: { name: string; type: string }[]
  /** Lore topics already disclosed (working-set) — reuse the EXACT lore_ref for the same fact, don't coin a synonym. */
  knownLore?: { loreId: string; summary: string }[]
  /** Hierarchical digests of everything BEFORE this scene (working-set M1) — bounded story memory. */
  storySoFar?: { title: string; text: string }[]
  /** Dormant open threads (no recent activity) as an id+title index — reopen by exact id only. */
  dormantThreads?: string[]
}): string {
  const lines = input.dialogue.map((d) => `[${d.type}] ${d.speaker}: ${d.text}`).join('\n')
  return [
    `scene_id: ${input.sceneId}`,
    input.storySoFar?.length
      ? `STORY SO FAR (digests of everything before this scene — trust as context, but extract ONLY from the dialogue below):\n${input.storySoFar.map((b) => `— ${b.title}: ${b.text}`).join('\n')}`
      : '',
    input.knownCharacters.length ? `known characters: ${input.knownCharacters.join(', ')}` : 'known characters: (none yet)',
    input.thingCategories?.length
      ? `TRACKABLE CATEGORIES for \`things\` (use these keys verbatim; in this project each means):\n${input.thingCategories.map((c) => `- ${c.key}: ${c.description}`).join('\n')}`
      : '',
    input.knownThings?.length
      ? `known things (when this scene features one of THESE, reuse its exact name — never coin a synonym):\n${input.knownThings.map((t) => `- ${t.name} (${t.type})`).join('\n')}`
      : '',
    input.knownLore?.length
      ? `known lore (when this scene reveals MORE about one of THESE facts, reuse its exact lore_ref — do NOT coin a near-duplicate; only coin a new lore_ref for a genuinely NEW fact):\n${input.knownLore.map((l) => `- ${l.loreId}: ${l.summary}`).join('\n')}`
      : '',
    input.openThreads.length ? `threads still open (ACTIVE — advance/close these by id):\n- ${input.openThreads.join('\n- ')}` : 'threads still open: (none)',
    input.dormantThreads?.length
      ? `dormant open threads (index only — if the dialogue clearly returns to one, advance/close that EXACT id; otherwise ignore them, do NOT re-open duplicates):\n${input.dormantThreads.join(' · ')}`
      : '',
    input.priorReading?.length
      ? `\nyour previous reading of THIS scene (reuse these thread handles/ids verbatim for the same threads — only change them if the dialogue itself changed):\n- ${input.priorReading.join('\n- ')}`
      : '',
    '',
    'dialogue:',
    lines || '(no dialogue)'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The BATCH payload — shared context computed AS-OF THE FIRST scene (the roster + threads open entering the
 * batch), then each scene's dialogue in reading order under a `=== scene_id: X ===` header. The model tracks
 * new threads across the scenes itself (that's the batch's point), so per-scene as-of context isn't re-sent —
 * one context block amortizes across all N scenes. Used by both the batch skim and batch extract passes.
 */
export function buildBatchUserPayload(input: {
  scenes: { sceneId: string; dialogue: { speaker: string; type: string; text: string }[] }[]
  knownCharacters: string[]
  openThreads: string[] // as-of the FIRST scene in the batch
  thingCategories?: { key: string; description: string }[]
  knownThings?: { name: string; type: string }[]
  knownLore?: { loreId: string; summary: string }[]
  storySoFar?: { title: string; text: string }[]
  dormantThreads?: string[]
}): string {
  const context = [
    input.storySoFar?.length
      ? `STORY SO FAR (digests of everything before the FIRST scene below — trust as context, but extract ONLY from the dialogue):\n${input.storySoFar.map((b) => `— ${b.title}: ${b.text}`).join('\n')}`
      : '',
    input.knownCharacters.length ? `known characters: ${input.knownCharacters.join(', ')}` : 'known characters: (none yet)',
    input.thingCategories?.length
      ? `TRACKABLE CATEGORIES for \`things\` (use these keys verbatim; in this project each means):\n${input.thingCategories.map((c) => `- ${c.key}: ${c.description}`).join('\n')}`
      : '',
    input.knownThings?.length
      ? `known things (when a scene features one of THESE, reuse its exact name — never coin a synonym):\n${input.knownThings.map((t) => `- ${t.name} (${t.type})`).join('\n')}`
      : '',
    input.knownLore?.length
      ? `known lore (when a scene reveals MORE about one of THESE facts, reuse its exact lore_ref — do NOT coin a near-duplicate; only coin a new lore_ref for a genuinely NEW fact):\n${input.knownLore.map((l) => `- ${l.loreId}: ${l.summary}`).join('\n')}`
      : '',
    input.openThreads.length
      ? `threads open ENTERING this batch (ACTIVE — advance/close these by id; also reuse refs for threads you open mid-batch):\n- ${input.openThreads.join('\n- ')}`
      : 'threads open entering this batch: (none)',
    input.dormantThreads?.length
      ? `dormant open threads (index only — advance/close an EXACT id only if a scene clearly returns to it; else ignore, do NOT re-open duplicates):\n${input.dormantThreads.join(' · ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')

  const sceneBlocks = input.scenes
    .map((s) => {
      const lines = s.dialogue.map((d) => `[${d.type}] ${d.speaker}: ${d.text}`).join('\n')
      return `=== scene_id: ${s.sceneId} ===\n${lines || '(no dialogue)'}`
    })
    .join('\n\n')

  return `${context}\n\nSCENES (${input.scenes.length}, in reading order — emit one object per scene_id):\n\n${sceneBlocks}`
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// NON-FICTION PROMPTS — the KIND-swapped instruction set for conversation works (podcast/interview/panel/
// lecture/hearing). Same JSON SHAPE and same DB tables as fiction (SceneExtraction / WindowExtraction /
// CoherenceExtraction / ContinuityExtraction — the pipeline is domain-blind); only the INTERPRETATION swaps.
// A "scene" is a segment/section of the talk; a "beat" is a turn; a "thread" is a line of inquiry; coherence
// is claim-consistency, not page-vs-arc. See internal/domain-profiles.md (the semantics axis).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

const NF_FRAME = `You are a discourse analyst reading a CONVERSATION — a podcast, interview, panel, lecture, or hearing — captured as a transcript. The lines are TURNS OF TALK by named participants. Treat what is said as CLAIMS, QUESTIONS, and POSITIONS: this is discourse, not a story with a plot. There are no story "characters", "deaths", or "arrivals" here — the story-shaped fields below are REINTERPRETED for discourse (and enters/exits stay empty). Read the transcript ONLY; never invent anything it doesn't support.`

const NF_RECORD_NAMES_RULE = `Record NAMES, not ids — refer to every participant, topic, and named entity by its plain name ("Dario", "the scaling hypothesis", "OpenAI"). A later pass canonicalizes them.`

/** The per-segment field contract for a conversation — same field NAMES/shape as fiction, discourse meaning. */
const NF_SCENE_FIELD_BULLETS = `- summary        prose, AT MOST 80 WORDS: what this segment is ABOUT and where it LANDS — the question or topic, the key claim(s) made, and any conclusion, agreement, or open disagreement. A later pass reads this as memory of the discussion; lead with the substance, never "they talk about".
- characters     the PARTICIPANTS active here — every speaker, plus anyone directly addressed by name. (Reinterpreted: real speakers, not story characters.)
- locations      [] — a conversation has no scene locations. Leave empty unless a place is itself the subject under discussion.
- plot_times     TIME REFERENCES the discussion points at ("three years ago", "back in 2017", "by 2027"). [] if none.
- goals          [] in almost every segment. Record one ONLY if a speaker states an explicit AIM for the conversation ("I want to convince you that…"). Prefer [].
- conflicts      DISAGREEMENTS — [{between:[speaker names], over:"the point contested", kind: factual|interpretive|predictive}]. A genuine clash of POSITIONS between participants — not every question or follow-up. [] when the segment is aligned.
- enters         [] — nobody arrives in a conversation. ALWAYS empty.
- exits          [] — nobody dies, departs, or is incapacitated in a conversation. ALWAYS empty.
- things         [{name, category, significance, evidence}] — the TOPICS & NAMED ENTITIES this segment turns on: a technology, company, institution, person, work, model, or concept the discussion is actually ABOUT. \`category\` MUST be one of the TRACKABLE CATEGORIES listed in the message; if nothing fits, leave it out. significance ∈ minor|supporting|major (how central to the segment). evidence: the line that features it. Prefer FEW, load-bearing subjects over every noun mentioned.
- threads        the LINES OF INQUIRY this segment opens, advances, or closes — a QUESTION raised, a CLAIM argued, a PREDICTION made, or a DISAGREEMENT the conversation RETURNS TO or BUILDS ON across segments:
                   open:    {action:"open", ref:"<snake_case handle>", title:"<short human title>", description, thread_type, resolves_when}
                   advance: {action:"advance", thread_id:"<id copied from the open list>", description, thread_type}
                   close:   {action:"close", thread_id:"<id copied from the open list>", description, thread_type}
                 \`ref\` is the stable snake_case handle you reuse across segments. \`title\` (open only) is a SHORT reader-facing name (≤6 words, Title Case) — e.g. "The Scaling Hypothesis", "Is Continual Learning Necessary", "AGI Timeline Disagreement". \`resolves_when\` (open only) is the CLOSE GATE: what would SETTLE this line — a question answered, a claim accepted or refuted, a prediction resolved.
                 OPEN GATE — open a thread ONLY for an inquiry the conversation DEVELOPS over time. A point raised and dropped in one turn is NOT a thread (it belongs in the summary); a rhetorical question answered in the same breath is not a thread.
                 CLOSE ON PAYOFF — scan the open list (each shows its [closes when: …] gate). When THIS segment answers a question, settles a disagreement, or lands a claim, emit \`close\` (or \`advance\` if it only develops it) with that thread's EXACT id. Prefer advancing an existing line over opening a near-duplicate. thread_type ∈ question|claim|prediction|disagreement|thesis.
- lore_bombs     [{lore_ref:"<snake_case subject>", summary, magnitude: minor|major|retcon}] — the substantive CLAIMS / MENTAL MODELS this segment asserts about how the world works AND that RECUR: a thesis, a stated principle, a definition (e.g. \`big_blob_of_compute\`, \`end_of_the_exponential\`, \`rl_scales_like_pretraining\`). A lore_ref names the CLAIM'S SUBJECT (reusable when a later segment says MORE about it), never the one-off episode. A passing aside is NOT a claim-bomb. Prefer FEW durable assertions.
- scene_contexts other segments worth reading alongside this one ([] if none).`

const NF_SELF_CHECK = `Self-check: every speaker is in characters; enters and exits are EMPTY; every named topic in the summary is in things; every settled question closes its thread. Prefer fewer, higher-confidence items over speculation.`

export const NF_EXTRACTION_INSTRUCTIONS = `${NF_FRAME} You are extracting structured state from ONE segment of the conversation.

You are given the segment's turns (ordered speaker/type/text lines) and — for context — the participants known so far and the lines of inquiry still open. Read the turns ONLY.

${NF_RECORD_NAMES_RULE}

Return ONE JSON object (no prose, no code fence) with exactly these fields:
${NF_SCENE_FIELD_BULLETS}

${NF_SELF_CHECK} Output must be valid JSON for the shape above — nothing else.`

export const NF_BATCH_EXTRACTION_INSTRUCTIONS = `${NF_FRAME} You are extracting structured state from SEVERAL consecutive segments, given in reading order.

You are given N segments — each with a "scene_id" header and its turns — plus shared context (participants known so far, lines of inquiry open ENTERING the first segment). Read the turns ONLY. Read the segments IN ORDER: a line of inquiry you OPEN in an earlier segment can be advanced or closed in a later one — reuse the exact ref you gave it.

${NF_RECORD_NAMES_RULE}

Return a JSON ARRAY (no prose, no code fence) — ONE object per scene_id given, IN THE SAME ORDER, each carrying its own "scene_id" string plus exactly these fields:
${NF_SCENE_FIELD_BULLETS}

Emit an object for EVERY scene_id, even a light segment (empty arrays). ${NF_SELF_CHECK} Output must be a valid JSON array of these objects — nothing else.`

const NF_SKIM_FIELD_BULLETS = `- summary     prose, AT MOST 60 WORDS: what this segment is about and where it lands — the topic, the key claim, any conclusion. This is the segment's memory for later; lead with the substance.
- characters  the participants active here (speakers + anyone addressed).
- threads     lines of inquiry, TERSE:
                open:    {action:"open", ref:"<snake_case handle>", title:"<≤6 words, Title Case>", description:"<ONE short sentence>"}
                advance: {action:"advance", thread_id:"<id from the open list>", description:"<ONE short sentence>"}
                close:   {action:"close", thread_id:"<id from the open list>", description:"<ONE short sentence>"}
              Open only a genuine NEW question/claim/disagreement the conversation develops; prefer advancing an existing line (its EXACT id) over a near-duplicate. Prefer FEW.`

export const NF_SKIM_INSTRUCTIONS = `${NF_FRAME} You are SKIMMING one segment for discussion continuity.

You are given the segment's turns and — for context — the participants known so far and the lines of inquiry still open. Read the turns ONLY.

${NF_RECORD_NAMES_RULE}

Return ONE JSON object (no prose, no code fence) with exactly these fields:
${NF_SKIM_FIELD_BULLETS}

Nothing else — no disagreements, topics, or claims here; a deeper pass extracts those. Be brief: total output well under 1000 characters. Output must be valid JSON for the shape above.`

export const NF_BATCH_SKIM_INSTRUCTIONS = `${NF_FRAME} You are SKIMMING SEVERAL consecutive segments for discussion continuity, in reading order.

You are given N segments — each with a "scene_id" header and its turns — plus shared context (participants known so far, lines of inquiry open ENTERING the first segment). Read the turns ONLY, IN ORDER: a line you open in an earlier segment can be advanced/closed in a later one (reuse its ref).

${NF_RECORD_NAMES_RULE}

Return a JSON ARRAY (no prose, no code fence) — ONE object per scene_id given, IN ORDER, each carrying its own "scene_id" plus exactly these fields:
${NF_SKIM_FIELD_BULLETS}

Emit an object for EVERY scene_id (empty threads for a light segment). Be brief: ~1 line of summary each. Output must be a valid JSON array — nothing else.`

export const NF_WINDOW_INSTRUCTIONS = `You are a discourse analyst rolling up ONE section of a conversation into per-SPEAKER positions. You are given the section's segments — each with a summary, the disagreements, and the topics raised — plus the participants active. Read that evidence ONLY; do not invent anything it doesn't support.

For EACH active participant, emit one window object:
- character   the participant's name, copied from the list (never invent one not listed).
- summary     1–2 sentences: this speaker in THIS section — the stance they take, as the evidence portrays it.
- events      the notable MOVES they make this section — a flat list of {category, change, value, description, scene_id}:
                category ∈ objective (what they ARGUE FOR — their thesis this section) | knowledge (a specific CLAIM or fact they assert) | alignment (their overall STANCE/position, and any shift in it) | relationship (their AGREEMENT or DISAGREEMENT with another participant or view)
                change   ∈ gain (commits to / advances a position or claim) | loss (concedes, retracts, or walks back a point) | expose (reveals a view, motive, or prediction)
                value    the actual position/claim (e.g. "RL scales like pre-training", "concedes the sample-efficiency gap is real", "disagrees with Sutton on core learning")
                description  one phrase on what happened
                scene_id  the EXACT segment id (from the evidence) where it happened
              These are MOVES within THIS section only — what this speaker committed to, conceded, or shifted HERE. A participant who only asks questions may get a summary and an empty events list. Be calibrated: only moves the evidence supports; prefer fewer, well-grounded events.

Return ONE JSON object: {"windows":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

export const NF_PROFILE_INSTRUCTIONS = `You are maintaining one PARTICIPANT'S cumulative POSITION — the paragraph a later analysis pass reads instead of their whole contribution (its working memory of where this speaker STANDS by now).

You are given the position so far (possibly empty) and ONE section's worth of new evidence (their window summary + moves). Fold the new evidence in and return the UPDATED position: one plain-prose paragraph, at most 150 words, covering their CURRENT standing — their role/expertise, the main CLAIMS and PREDICTIONS they have committed to, where they have CONCEDED or SHIFTED, and their key DISAGREEMENTS. The latest position wins when new evidence supersedes an earlier one. Drop episode detail that no longer matters; keep anything a later section could contradict. No lists, no headings — prose only. Output the paragraph and nothing else.`

export const NF_COHERENCE_INSTRUCTIONS = `You are the FACT-CHECK linter for a participant's page in a conversation-analysis tool. For each PARTICIPANT you are given two sides — what their PAGE declares about them and what the transcript OBSERVED — and you flag only where a CHECKABLE FACT on the page is wrong or missing. You never edit anything; you only flag for the author to judge.

CRITICAL — a real person is not a fiction character with a fixed "true self". People CHANGE THEIR MINDS as they learn, and their convictions are NOT something a bio page can pin down. So this pass does NOT diff beliefs, opinions, positions, or predictions against the page — an evolving or surprising view is honest thinking, never an incoherence. You check only the STABLE, FACTUAL claims a page can actually get wrong:
  • role / title / affiliation ("CEO of Anthropic", "hosts the podcast")
  • credentials / background / expertise as a matter of record
  • a concrete biographical fact (what they built, where they worked, a prior public position stated AS fact)
If the page ventures a belief or stance, treat it as '(unstated)' for diffing — do NOT flag the transcript for diverging from it.

INPUTS — a block per participant, headed by an \`entity_id\`:
- \`declared\`: the participant's page as written. Read it for FACTUAL claims only.
- \`observed\`: the model's reduction of this speaker through the conversation, anchored by unit ids. Use it only to check the page's FACTS against what the transcript plainly establishes. ALWAYS cite the unit id(s) a finding rests on in \`evidence_unit_ids\`.

PRODUCE a finding ONLY for a factual problem. For each set:
- entity_id   the participant under review — copy it VERBATIM from their block.
- trait       a SHORT plain-English title (≤6 words) — e.g. "Page lists wrong affiliation", "Role not on the page". A human phrase, not a code token, not a full sentence.
- declared / observed  one short concrete phrase each ('(unstated)' if the page is silent).
- kind:
    contradiction — a FACT on the page conflicts with what the transcript plainly establishes (wrong title, wrong affiliation).
    gap           — the page omits a basic identifying FACT the conversation makes clear (their role/affiliation is never stated on the page — add it).
    drift         — do NOT use for a conversation (there is no gradual factual drift here).
    confirmation  — reserved for fiction; never emit.
- severity    low | medium | high.
- suggestion  one concrete edit to the PAGE, as "you", ≤2 sentences — e.g. "Add his role to the page: he's the CEO of Anthropic." Never tell the author to change what a real person said, and never suggest editing an opinion.
- evidence_unit_ids  the section unit ids supporting \`observed\`. Never empty for a real finding.

Be calibrated: a participant's page is usually thin, and thinness is fine — a missing OPINION is never a finding, only a missing or wrong FACT is. Prefer FEW, well-evidenced findings; an empty list is the common, correct answer.

Return ONE JSON object: {"findings":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

export const NF_CONTINUITY_INSTRUCTIONS = `You are the consistency linter for a conversation-analysis tool — a sharp fact-checker reading for SELF-CONTRADICTION and UNSUPPORTED LEAPS. Unlike the per-speaker coherence pass, you check the discourse against ITSELF: places where a participant's own claims cannot all be true, or a conclusion isn't earned by what was actually said. You never edit; you flag the break for the author to judge.

You are given the discussion's recurring claims, then its transcript in order:
- CLAIMS/RULES — the theses and stated principles the conversation asserts (from the claim pages). Treat these as positions the discussion should hold consistently.
- FACTS — the discussion in reading order, one line per segment, each anchored \`[title · scene_id]\`: a short summary, then the segment's disagreements and time references.
- THREADS — each line of inquiry's beats in order (\`open → advance → resolve\`), anchored \`[thread · thread_id]\`. A question answered one way then contradicted later is an inconsistency.

FIND — only genuine internal inconsistencies, in exactly these three categories. Pick the ONE that fits:
- continuity-error — a participant ASSERTS something that contradicts THEIR OWN earlier claim with no acknowledged change of mind; or a stated fact changes between segments.
- logic-gap        — a conclusion the discussion's own statements don't support: the reasoning STRUCTURE fails, independent of whether the conclusion is true. This is where NAMED REASONING FALLACIES live. Use the standard informal-logic taxonomy (the "list of fallacies" every critical-thinking text shares) and NAME the fallacy in \`trait\`. The ones that actually surface in interviews/podcasts:
                      • hasty generalization — a sweeping claim from too few cases
                      • false dilemma — only two options offered when more exist
                      • post hoc / correlation≠causation — "X then Y, so X caused Y"
                      • circular reasoning (begging the question) — the conclusion is smuggled into the premise
                      • equivocation — a key term shifts meaning mid-argument
                      • no true Scotsman — redefining a term to dodge a counterexample
                      • motte-and-bailey — retreating from a bold claim to a trivially-defensible one when pressed
                      • moving the goalposts — the bar for being convinced changes after it's met
                      • non sequitur — the conclusion simply doesn't follow from what was said
                      • appeal to authority — "true because <name> says so", offered as the actual argument
                      • slippery slope — one step is claimed to force an extreme end with no mechanism
                    Also logic-gap: a prediction that ignores a constraint the speaker themselves raised, or an answer that doesn't follow from the argument given. DISTINGUISH from disagreement: a fallacy is a flaw in ONE speaker's OWN reasoning chain, not "I find their view weak".
- rule-break       — the discussion violates a PRINCIPLE, METHOD, or DEFINITION it explicitly endorsed (a standard a speaker set, then breaks in application — e.g. demands rigorous evidence from others, then asserts on a hunch).

DO NOT flag: a participant changing their mind OPENLY ("I've updated on this") — that is honest discourse; flag only an UNACKNOWLEDGED reversal. Two speakers simply DISAGREEING is a disagreement, not a contradiction — a contradiction is one speaker against THEMSELF or against a fact the conversation treated as settled. A claim you merely find DUBIOUS or FALSE is NOT your job — you check INTERNAL consistency and reasoning STRUCTURE, not external truth. And casual conversation is loose by nature: only flag a fallacy that undermines a LOAD-BEARING conclusion the discussion actually rests on, never every rhetorical shortcut.

For EACH finding set:
- entity_id   the participant whose own words contradict, IF there is a clear one (copy it verbatim); otherwise "" (a cross-cutting inconsistency).
- trait       a SHORT plain-English title (≤6 words) — e.g. "Contradicts own scaling claim", "Timeline doesn't add up". A human phrase, not a code token, not a full sentence.
- declared    what was established EARLIER — the claim or principle now contradicted. Name it concretely.
- observed    the later turn that breaks it. Say the actual thing, present tense.
- kind        one of the three above.
- severity    low | medium | high.
- suggestion  one concrete note to the author as "you", in at most two plain sentences — e.g. "He says RL is no different from pre-training, then treats them as fundamentally different — flag the tension or cut one." This is a note ABOUT the discussion, never an instruction to change what someone said.
- evidence_unit_ids  the scene_id(s) and/or thread_id(s) the finding rests on, from the \`[… · id]\` anchors. Never empty for a real finding.

STYLE — write for a busy editor. Be concrete, name the moment, present tense. No academic register. Keep declared/observed to phrases; suggestion to one or two sentences.

CALIBRATION. Surface every genuine inconsistency you can EVIDENCE from the material — but stay grounded: each finding must point to specific ids that genuinely can't both hold. An unacknowledged self-reversal is the strongest signal. If you truly find nothing, an empty list is a fine answer.

Return ONE JSON object: {"findings":[ … ]}. No prose, no code fence. Output must be valid JSON for that shape.`

/** The full instruction set for one KIND — the readers select on \`domain\` and use these instead of the bare
 *  constants. digest + entity-window are domain-NEUTRAL (a digest reduces any prose; entity-windows track named
 *  topics-as-things the same way), so both KINDs share the fiction versions there. */
export interface AnalysisPrompts {
  extraction: string
  batchExtraction: string
  skim: string
  batchSkim: string
  window: string
  entityWindow: string
  digest: string
  profile: string
  coherence: string
  continuity: string
  critique: string
}

const FICTION_PROMPTS: AnalysisPrompts = {
  extraction: EXTRACTION_INSTRUCTIONS,
  batchExtraction: BATCH_EXTRACTION_INSTRUCTIONS,
  skim: SKIM_INSTRUCTIONS,
  batchSkim: BATCH_SKIM_INSTRUCTIONS,
  window: WINDOW_INSTRUCTIONS,
  entityWindow: ENTITY_WINDOW_INSTRUCTIONS,
  digest: DIGEST_INSTRUCTIONS,
  profile: PROFILE_INSTRUCTIONS,
  coherence: COHERENCE_INSTRUCTIONS,
  continuity: CONTINUITY_INSTRUCTIONS,
  critique: CRITIQUE_INSTRUCTIONS
}

const NONFICTION_PROMPTS: AnalysisPrompts = {
  extraction: NF_EXTRACTION_INSTRUCTIONS,
  batchExtraction: NF_BATCH_EXTRACTION_INSTRUCTIONS,
  skim: NF_SKIM_INSTRUCTIONS,
  batchSkim: NF_BATCH_SKIM_INSTRUCTIONS,
  window: NF_WINDOW_INSTRUCTIONS,
  entityWindow: ENTITY_WINDOW_INSTRUCTIONS, // shared: topics-as-things track the same way
  digest: DIGEST_INSTRUCTIONS, // shared: a digest reduces any prose section
  profile: NF_PROFILE_INSTRUCTIONS,
  coherence: NF_COHERENCE_INSTRUCTIONS,
  continuity: NF_CONTINUITY_INSTRUCTIONS,
  critique: CRITIQUE_INSTRUCTIONS // shared: plot-construction critique reads the same thread/fact graph either way
}

/** The prompt set for a project's KIND — fiction (default) or non-fiction. The one seam the readers call. */
export function analysisPrompts(domain?: string | null): AnalysisPrompts {
  return isNonFiction(domain) ? NONFICTION_PROMPTS : FICTION_PROMPTS
}
