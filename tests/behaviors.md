# tests/behaviors.md — expected behaviors (the "if the user does X, expect Y" log)

Companion to the vitest suite (`npm test`) and [internal/decisions.md](../internal/decisions.md). **Unit tests**
lock the pure functions; **this file** locks the behaviors that span the DB / filesystem / Electron engine
(which can't run in vitest — the engine's `better-sqlite3` is built against Electron's ABI, not node's). When
you change one of these areas, re-read the matching entry and verify by hand in the app; if a behavior here
becomes false, either the code regressed or this log is stale — fix whichever is wrong.

Legend: ✅ has unit-test coverage · 📋 spec-only (verify in-app).

---

## Identity & the contract (decisions.md **D2** — enforce the contract, not the cosmetics)

### scene_id is guaranteed, unique, stable
- 📋 **Create a scene in the app** → it gets `scene_id = slugify(title)`, disambiguated work-wide
  (`the-platform`, then `the-platform-2`). ✅ `uniqueId` + `slugify` covered in `contract.test.ts`.
- 📋 **Open a project containing an imported scene with NO `scene_id`** → ingest **stamps a unique id into
  its frontmatter, once** (`ingest.ts`), then leaves it alone forever. Verify: the `.md` gains a `scene_id:`
  line on first open; a second open doesn't rewrite it.
- 📋 **Rename / move a scene file** → its `scene_id` does NOT change → links + analysis stay attached. (The
  old filename-fallback id was the source of the `FOREIGN KEY constraint failed` orphan crash.)
- 📋 A **read-only** scene file that lacks an id → ingest uses the id in-memory, does NOT crash, leaves the
  file untouched (re-stamps next time it's writable).

### phase defaults (the canon-status contract)
- ✅ **A scene with no `phase`** counts as **canon** (the analysis gate reads it); **a world page with no
  `phase`** counts as **draft**. `defaultPhase` covered in `contract.test.ts`.
- 📋 Every surface agrees on that default — sidebar spine, Properties dialog, timeline rail, PageReadDialog
  badge, the Ingest dock's canon gate. (The bug class: one surface saying draft while another says canon.)
- 📋 **Create a NEW scene** (incl. AI `createPage`) → it's **`phase: draft`** (outside analysis until the
  author marks it canon). An explicit `phase` in the payload wins over the default.

### analysis references are canonical
- ✅ The **reader** resolves any evidence/asOf shape — scene-id, `c:`-prefixed unit-id, bare chapter name —
  to a chapter key (`buildChapterIndex.resolveKey`, `chapterIndex.test.ts`). This is the legacy/import net.
- 📋 The **writer** (`writeTier`) canonicalizes `evidence_json` on write: each ref is resolved to a real
  `narrative_units` unit-id, and **unresolvable refs are dropped**. So a NEW coherence write can't persist a
  non-canonical reference. (Every other ref — `as_of_unit_id`, `entity_id`, scene ids — is FK-enforced.)
- 📋 KNOWN-FRAGILE (Gap 3, deferred): a **chapter** unit-id is its folder path (`c:chapters/005-act-v`), so
  **reorganizing folders** changes it and orphans that chapter's analysis. The FK-cascade prevents the crash,
  but the analysis is lost until re-run. `work_id` is likewise path-based (`sha1(path)`) — both need stable
  ids before the gallery/export epic.

---

## Coherence — what a finding means + the fix path

- 📋 A finding compares a **world page's profile** ("declared") against the **prose/scenes** ("observed").
  The card names the page (`"Queen's page says"`), shows **Where** (the chapter(s) from `evidence` — the real
  location) distinct from **Analyzed through** (the uniform analysis checkpoint), and offers **Open <page>**
  (edit the profile) vs **Verify in scenes** (check the prose).
- 📋 A *gap* where the **profile is behind** the prose → fix the **world page**. A *contradiction* where the
  **prose is wrong** → fix the **scene**. The Suggestion says which; the AI never edits the page for you.
- 📋 **Edit + save a character's world page** → its coherence goes **stale** and the dock's "Check coherence
  (N)" increments. Why: coherence's input-hash already includes the page bytes (`writeTier` `tierInputHash`),
  so a profile edit changes the hash → `coherenceStatus` reports `stale`; every world-page edit path
  (`saveScene` · `setPagePhase` · `renameWorldPage`) bumps freshness so the dock re-reads. (Cheap half of
  OP1 — world-page → coherence staleness.)
- 📋 Clicking a name inside a finding opens that character's **arc scoped to the finding's chapter** (a
  clearable pill); float filters (kind / facet) are **re-appliable toggle rows** in their own wrapping header
  row (they don't overflow, and a cleared filter can be put back).
- 📋 **Visual harmony** with the thread/arc rails: roster rows carry a **bordered severity badge** (circle
  matching the rail badges) and the standalone finding-card header gets a **severity wash** (`severityWash`:
  high=flag · medium=warn · low=neutral).
- 📋 **CoherenceDetail** (the per-character stacked findings) is now a **spine of collapsible cards** like the
  thread/arc sheets: a severity badge on the rail, a severity-tinted header (category + severity), collapsed =
  the trait + a 2-line clamp of what the scenes show, expand = the full `CoherenceReview` (its own top strip
  suppressed when `embedded`, since the card header owns category/severity) + a bottom **Collapse**. No
  "terminal" treatment — coherence is a triage list, so the rail is visual kinship, not a lifecycle.

---

## Threads — duplicate detection (detector-only; no merge yet)

- ✅ Two thread umbrellas that share a **slug-tail** (`thr:a1-s1:ghost` + `thr:a4-s2:ghost`) are flagged as a
  likely duplicate — one promise the scene pass re-opened under a new scene prefix. Unique slugs never fire.
  `duplicateThreadGroups` covered in `threadDups.test.ts`.
- ✅ A pair joined by **`succeeds`** (a deliberate recast) is still listed but **annotated `superseded`** so
  the UI softens it ("recast") instead of crying duplicate. Groups sort worst-split-first (most threads).
- 📋 The thread rail shows a quiet **"N possible duplicates"** nudge above the roster; each member is a chip
  (opening scene · beat count) you click to inspect. **Nothing is merged** — the author decides what's real.
- 📋 OUT OF SCOPE (the LLM's call): semantic near-dupes with *different* slugs (`find_heir` vs `locate_heir`).
- ✅ **`mergeThreads`** (engine, the action half) folds duplicates into one: CANONICAL = the **earliest opener**,
  positioned by **`narrative_threads.opened_unit_id`** (fallback: earliest beat) — NOT an `action='open'`
  thread_event. **Dogfood bug (fixed):** a thread can lack an `open` beat (e.g. the real Hamlet ghost thread had
  only a `resolve`); requiring one scored it LAST and let a *later* dupe win canonical, so the merge kept the
  wrong thread + its name. Now `opened_unit_id` (the umbrella's own opener record) drives it. Tie → smaller id
  (`pickCanonical`, `threadMerge.test.ts`). One transaction repoints `thread_events.thread_id` +
  `narrative_threads.succeeds` + `revelation_events.target_thread_id` → canonical, DELETEs the dupe umbrellas +
  the re-derivable quest-verdict findings (thread id is the `finding_id` suffix, matched via `instr`), then
  `refoldThread` recomputes status. `event_id`s stay unique (per scene-write) → no PK collision. Atomic;
  reversible via snapshot/version. **Verified live** on Hamlet (demo) with an injected dupe: kept the real Act-I
  thread, 0 orphans, 0 dangling refs.
- 📋 **Dupe-merge UI** lives on the ThreadSidebar nudge: each non-recast group shows a **Merge** button →
  inline confirm ("Keep ★ &lt;title&gt;, fold in the other N?") → `window.nvs.mergeThreads` → `refreshAnalysisViews`.
  The nudge lists threads **by title** (★ = kept/earliest, ↳ = folds in), so a dupe is findable in the roster/gantt
  and the merged result's name is traceable — NOT the slug (which doesn't appear elsewhere). `succeeds`-linked
  (recast) groups show the badge but aren't mergeable.
- 📋 The thread sheet's event log is a **chapter RAILWAY**: a single linear rail where each **chapter is a
  STATION** (the checkpoint, labeled once — `●` filled if it has events, `○` hollow + bare `··` dots for a quiet
  chapter the line passes, `◆ terminus` for the chapter a thread closes in). Events are **cards under their
  station**; because the chapter lives at the station, each card names just the **scene**. The card header is
  **wash-tinted by action** (open green · advance neutral · resolve/supersede muted) with the action label;
  closing cards keep the "✓ closed" cap. Collapsed = the tinted header + a 2-line **plain** clamp of the event's
  OWN description; **expanding** → full description with linked names, then nests deeper (evidence rail →
  "Scene context" sub-disclosure → cast pills → bottom Collapse). `buildStations` (group-by-chapter + quiet
  fills, true-quiet only, terminal mark) covered in `railGaps.test.ts`. Reference: GitHub = timeline (our shape);
  Reddit = tree (only the within-event nest). Label is **Events**, not "Beats" (collides with the dialogue
  `(beat)` pause). (Fix history: `sceneSummary` wall → led with description → spine of cards → chapter railway.)

---

## Character arc — the chapter railway

- 📋 The arc **Sheet** is the same **chapter railway** as the thread log: each chapter window is a **station**
  (`●`), the chapters this character doesn't change in are **hollow stations** (`○ ··`) the line passes (offstage
  / static stretches). The card under a station shows the change count; collapsed = a 2-line summary clamp,
  expanding → full summary (linked names) + **Wants · Tension · Changes** tables + bottom Collapse.
- 📋 Unlike thread events, the window card is **NOT tinted by type** — a window is **mixed** gain/loss, so the
  type-color stays in the **change dots** (↑ gain · ↓ loss · ◦ expose) inside the Changes table.

### The railway model (shared, thread + arc)

- ✅ `buildStations` turns the displayed items into chapter stations: consecutive same-chapter items group into
  one station; the genuinely-quiet chapters between two stations become **hollow stations** (only inside a span —
  never before the first / after the last); a chapter the timeline touches **elsewhere** (filtered out by
  strand/facet) is **not** ghosted; the closing chapter is marked `terminal`. Covered in `railGaps.test.ts`.
- 📋 Shared `ChapterStation` (rail node + label + connector) + rail-less `EventCard` / `WindowCard` (the chapter
  moved to the station, so cards drop it). Quiet chapters read as visible passage of time. **Coherence is
  excluded** — a triage list, not a timeline, so stations/gaps would be meaningless there.

---

## Cast — presence (speakers + the silent room)

- ✅ The **Silent presence** layer adds the extraction's prose-read cast (`extracted_scenes.characters_json`)
  who never spoke — resolved name→id via the `entities` registry, minus existing speakers, de-duped, unresolved
  names dropped. `silentPresenceIds` covered in `silentPresence.test.ts`. **Display-only**: `significantCast`
  (the arc/coherence gate) + the POV default both stay speaker-based (`lines > 0`), so analysis is untouched.
- 📋 The layer is **on by default**, a toggle in the Cast layer TOC (offered on all three tabs — it gates the
  shared `sceneCast`, so it affects presence · co-presence · graph · appearance counts alike).
- 📋 **Toggling the layer never reshuffles the speaking cast** — the roster ranks by *speaking* presence (a
  toggle-independent measure), so silent only **adds** hollow cells to existing rows + appends silent-only
  characters at the **bottom** (by name). (Bug fixed: it used to sort by total presence → rows jumped on toggle.)
- 📋 A **speaker** cell is filled by line count; a **present-but-silent** cell (0 lines) is a **hollow outline**
  ("present, silent" on hover) so "was there" never reads as "spoke". Turning the layer off → speakers only
  (the pre-analysis view). Because the source is T2, silent presence appears only **after analysis**.
- 📋 Consistent with the demotion: presence reads the **prose-cast**, NOT the author's `characters_present` tag
  (which stays a reference-only Cross-ref).

---

## Sidebar rails (Story + World standardized)

- 📋 **Archive a scene** → it leaves its folder in the tree and appears in a collapsed **Archived bin**
  (restoring returns it to its folder). The file stays put on disk (archive = a frontmatter view).
- 📋 A folder that still holds archived scenes shows a **🗄 N marker** (never looks empty), and **deleting**
  it names the archived scenes it will also delete. (Footgun: deleting an "empty"-looking folder used to
  silently `rm` archived scenes inside.)
- 📋 **Rename a character** → the old name is folded into the page's `aliases` so dialogue cues keep
  resolving (presence is matched by name/alias, not id); skipped + warned if another character already uses
  that name. The id/slug never changes.

---

## AI authoring

- 📋 A **generation** page-edit (e.g. "Draft next beat") stamps an AI-provenance note into the result;
  **maintenance** edits (Reformat, Placeholders) do not. ✅ `provenanceNote` wording covered in
  `contract.test.ts`. The note rides the same undoable transaction (one Ctrl+Z removes note + content).
- 📋 **Built-in prompts are read-only** — View + Duplicate-to-customize, never edit/delete; `savePrompt`
  refuses to mutate a built-in.
- 📋 Scene relation tags (`characters_present` / `location` / `items`) are **author cross-refs, NOT analysis
  inputs** — presence comes from prose dialogue cues; location is LLM-extracted from prose. `pov` IS an
  analysis input (single character id; defaults to the scene's dominant speaker — Phase 2 pending).
