/**
 * chatPrompts — every UI-triggered PRELOADED prompt in one place, beside the SYSTEM_PROMPT + tool catalog
 * (aiTools.ts): prompts are agent contracts, standardized from shared/config, never hidden inside components.
 * Each is a template the UI drops into the chat composer via setChatDraft — the author reviews and sends; nothing
 * here auto-runs. Task INSTRUCTIONS composed from live data + user input (e.g. custody grounding) stay at their
 * call sites; only reusable templates live here.
 */

/** Shared tail for prompts that hand the agent scene references. readScene resolves a scene by the short [id]
 *  shown (or its title) — no need to carry full paths in the prompt. */
export const READ_HINT = 'If you need a scene in full, call readScene with the [id] shown below (its title works too) — don’t guess.'

/** Timeline sidebar → "Build with AI": route the active variant, propose-then-confirm, batch-wire. */
export function buildNewTimelinePrompt(): string {
  return (
    `Help me build a NEW timeline variant (a fresh alternate reading order — leave my current one untouched).\n\n` +
    `First read my folder/scene structure with listStoryTree so you understand the content. Then ask me what this ` +
    `new timeline should be — a different ordering, a branch that converges, parallel POVs, an alternate route? ` +
    `Once we agree, create the variant with createVariant (give it a descriptive name; it becomes active), then ` +
    `wire the whole route in one connectScenesBatch call. Connections live in the tree variant, not frontmatter.`
  )
}

export function buildTimelinePrompt(variantName: string): string {
  return (
    `Help me wire the connections for my timeline (the active variant, "${variantName}").\n\n` +
    `First read my folder/scene structure with listStoryTree so you understand the content. ` +
    `Then ask me how the scenes should flow — one linear reading order, or are there branches/merges ` +
    `(e.g. parallel POVs that converge)? Once we agree, propose the exact connections and wait for my ` +
    `confirmation. Then wire them ALL AT ONCE with connectScenesBatch (one call with every edge — it also ` +
    `places the scenes on the canvas so I can see the route). Connections live in the tree variant, not frontmatter.`
  )
}

/** Console → "Analysis readiness": a read-only preflight audit before paying for an analysis run. Verdict-only
 *  (report-only ruling 2026-07-18): it never blocks the run — it tells the author what a run will and won't
 *  produce, so THEY decide. The dock still hard-disables the genuinely broken cases (cycle / no connection /
 *  empty frontier). Rubric mirrors internal/batched-extraction.md's readiness tiers. */
export function analysisReadinessPrompt(): string {
  return (
    `Run an ANALYSIS READINESS check on this project — a READ-ONLY preflight before I pay for an analysis run. ` +
    `The core question for every check: will this run produce SIGNAL, NOISE, or NOTHING? Use your tools, give me ` +
    `concrete numbers, tag each finding BLOCK / WARN / OK, then a one-line verdict. This is ADVISORY — you do NOT ` +
    `start or stop anything; I decide whether to run.\n\n` +
    `FIRST call listStructuralIssues — the AUTHORITATIVE deterministic structural check. Do NOT eyeball the tree ` +
    `for duplicate ids; this returns them exactly. Treat any DUPLICATE scene_id as a BLOCK (two files sharing an ` +
    `id collide their analysis — classic converter/parser debris; the author must give each file a unique ` +
    `scene_id or delete the duplicate). Fold its dangling/self leads_to, missing-id, and orphan findings into the ` +
    `checks below.\n\n` +
    `BLOCK (a run would do nothing or produce garbage — say so plainly):\n` +
    `• DUPLICATE scene_ids (from listStructuralIssues) — analysis collides; list the offending paths.\n` +
    `• NO CANON PROSE — analysis only reads canon scenes with actual prose/dialogue. How many scenes are canon vs ` +
    `draft/archived (listTierStatus/listScenes show phase), and do the canon ones have content? Spot-check a couple ` +
    `with readScene or queryDb (SELECT COUNT(*) FROM dialog_nodes WHERE unit_id=…). Zero canon-with-prose = nothing to do.\n` +
    `• EMPTY FRONTIER — is there actually stale/unread work? (listTierStatus fresh/stale/pending.) If everything is ` +
    `already fresh at the current depth, tell me "nothing to run" — not a failure, just no-op.\n` +
    `• BROKEN TIMELINE — with readTree/timelineStatus, is there a leads_to CYCLE on the active variant? Analysis ` +
    `can't walk a loop.\n\n` +
    `WARN (the run works, but I won't get something I might expect — name exactly what's lost):\n` +
    `• ISOLATED SCENES — readTree adjacency on the ACTIVE variant: how many scenes have no connections, and does the ` +
    `graph split into disconnected islands? Isolated scenes read with no story-so-far → weak threads/arcs.\n` +
    `• FLAT STRUCTURE — listStoryTree: are scenes grouped into chapters/folders, or flat at the root? Flat = NO ` +
    `character-arc rollups (the fold needs a chapter tree). Runs fine for threads/coherence; suggest grouping.\n` +
    `• REDUNDANT NESTING — any folder whose only child is a single scene? That's confusing structure; arcs rolling ` +
    `up to a folder-of-one are pointless. List them; suggest flattening.\n` +
    `• NO WORLD PAGES — listWorldPages: how many character pages exist, are any empty stubs? Coherence diffs pages ` +
    `vs observed arcs — with no pages, the coherence pass is a no-op (analysis still runs).\n` +
    `• MOSTLY DRAFT — if most scenes are draft (excluded), warn me my drafts won't be analyzed.\n` +
    `• MULTIPLE TIMELINES — more than one tree variant? Say which is ACTIVE; analysis follows the active one only.\n` +
    `• SCALE — how many scenes will this run read, and roughly how long on the current connection? Flag a big corpus ` +
    `on the keyless plan backend (output-bound, slow) so I can consider an API key.\n\n` +
    `Finish with: the frontier size (what a run does NOW), the top thing to fix if any, and a plain verdict — ` +
    `"ready", "runs but limited (…)", or "nothing to run". Read-only: do not write or change anything.`
  )
}

/** Console DB dock → "Check DB health": a read-only audit of the analysis database. The agent gets NO new
 *  write power here — fixes route through the already-gated tools (merge/runAnalysis) after explicit
 *  confirmation, and true deletions stay app-surface/author-only. */
export function dbHealthPrompt(): string {
  return (
    `Run a DATABASE HEALTH audit on this project's analysis DB — READ-ONLY first: inspect with your tools ` +
    `(queryDb, listCast, listThreads, listTierStatus, listCoherenceFindings), then report per section with ` +
    `concrete numbers and a severity (ok / noise / broken):\n\n` +
    `1. DUPLICATE ENTITIES — cast entries that are the same character/thing under different names or ids (listCast; spot-check with queryDb).\n` +
    `2. DUPLICATE / NOISE THREADS — threads describing the same plotline, plus singleton threads (one event, never touched again) that read as extraction noise (listThreads).\n` +
    `3. RESIDUE — junk entities/threads from extraction artifacts: markup fragments, "unknown"-style names, empty labels (queryDb).\n` +
    `4. ORPHANS — rows pointing at scenes that no longer exist in the story tree (compare scene ids in queryDb against listScenes).\n` +
    `5. STALENESS — tier rows out of date vs the current version (listTierStatus), and open coherence findings worth a ruling (listCoherenceFindings).\n\n` +
    `Then PROPOSE fixes — do not run them: dedup via mergeThreads / mergeEntities and rebuilds via runAnalysis ` +
    `only after I explicitly confirm each one. Anything that needs deletion or storage cleanup, point me to the ` +
    `app surface (Jobs → Storage, or a fresh analysis run) — you must not delete analysis rows yourself.`
  )
}

/** Lore rail → "Learn more" on a world-fact topic: pacing/consistency read of its reveals. */
export function loreTopicPrompt(label: string, context: string): string {
  return (
    `Audit the world-fact "${label}" in the open work from its reveals below. Give me three things, each concrete ` +
    `and citing the scene(s) by name:\n` +
    `1. CONSISTENCY — any reveal that contradicts another? Name the two scenes; say "consistent" if none.\n` +
    `2. PACING — one line: front-loaded, back-loaded, or evenly woven across the acts?\n` +
    `3. The single biggest GAP or next opportunity for this fact.\n` +
    `${READ_HINT}\nReveals:\n${context}`
  )
}

/** A page can cross-link to other world objects with `[Name](id)` (standard markdown; the id is the target's
 *  page id, or a discovered concept's entity id). We inject a ROSTER of the ids valid for THIS draft so the model
 *  links precisely instead of inventing bare `[Name]` brackets that don't resolve. Empty roster → no linking hint. */
export function linkRosterHint(roster: { name: string; id: string }[]): string {
  if (!roster.length) return ''
  const lines = roster.map((r) => `- ${r.name} (${r.id})`).join('\n')
  return (
    `\n\nCROSS-LINKS — when you first mention any of these known concepts, link it as [Name](id) using EXACTLY the ` +
    `id in parentheses below. Never invent an id; leave any concept NOT in this list as plain text (no brackets):\n${lines}`
  )
}

/** Lore rail → "Draft canon page" background task instruction. */
export function loreDraftPageInstruction(label: string, context: string, roster: { name: string; id: string }[] = []): string {
  return `Draft the canon page for "${label}" from what the story has revealed. ${READ_HINT}${linkRosterHint(roster)}\nReveals:\n${context}`
}
