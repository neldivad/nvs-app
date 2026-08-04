---
name: nvs-plan
description: Build a writing plan for a Novel Visual Studio project — read both the manuscript state (structure, threads, cast, coherence gaps) AND the author's corkboard (their hand-drawn intent), then propose an outline or the next scenes at the intersection of what's planned and what's written. Use when the user asks "what should I write next", "what am I planning / what have I planned", "help me outline", or "where are the gaps".
---

# Build a writing plan

Turn what the analysis knows into a concrete plan for what to write next. Follows the **nvs-sandbox** contract:
reading is free; **writing structure is only on explicit request**; and you **never auto-run analysis** (it costs
tokens — ask first, see nvs-sandbox).

There are **two inputs**, and the good plan lives at their intersection:
- the **manuscript state** (analysis) — *what's written*, backward-looking (threads, coherence, arcs);
- the **author's intent** (the corkboard) — *what they mean to write*, forward-looking (hand-drawn idea cards +
  the connections they drew). Nobody derived it; the author authored it. **This is the literal answer to "what am
  I planning / what have I planned."**

## 1. Read the manuscript state (no writes)

- `listStoryTree` / `listScenes` — the shape and order of what exists.
- `listThreads` + `listCharacterArcs` — open threads, where arcs stall or resolve.
- `listCoherenceFindings` + `listStructuralIssues` — gaps, contradictions, plot-holes to address.
- `listTierStatus` — which scenes are unanalyzed (a thin analysis means a thinner plan; flag it).
- `readScene` on the latest scenes to feel the current momentum.

## 2. Read the author's plan — the corkboard (no writes)

The corkboard is where the author sketches intent by hand. Skim → drill, never dump:
- `listBoards` — the boards + their sizes. Pick the active / largest as the working plan (say which).
- `readBoard(boardId)` — the idea graph. Rank signal by `refs` / `noteCount` / `degree`; **ignore empty untitled
  orphans** (a freeform canvas is noisy — scribbles are not the plan).
- `readCard(boardId, cardId)` — only for the few high-signal cards, to read the full note thread + neighbours.

**Then classify each meaningful card by intent-vs-written** — cross-reference its `refs` (scene paths / thread ids)
against step 1:
- **Done** — a `ref` points at a scene that exists and is analyzed. The plan is on the page.
- **Seeded** — attached to an *open* thread but has no scene yet. Promised, not delivered.
- **Frontier** 🎯 — a card wired (an edge) downstream of a **written** card but with **no scene of its own**. The
  author drew that edge, so the edge *is* the intended order: this is the next-scene candidate.
- **Loose** — no refs, no live neighbours. Note it exists; don't build on it.

The author's edges are the intended sequence — trust them over generic gap-filling.

## 3. Propose the plan (this is the deliverable)

Synthesize, don't dump. A good plan names:
- **What you've planned** — reflect the board back: the working board's idea-clusters and how far each has been
  written (the Done / Seeded / Frontier split). Authors forget their own scattered boards; this alone is useful.
- **The next N scenes** — lead with the **Frontier** cards (intent the manuscript hasn't caught up to). For each: a
  one-line purpose, the corkboard card + the thread/character it advances, why it's *ready* (its upstream card is
  written), and where it slots in the tree. Refer to everything by human title.
- **Repairs** — coherence findings worth fixing, and the scene(s) that would fix them.

The strongest recommendation is a scene that is **both** on the author's Frontier **and** pays off an open thread /
closes a coherence gap without creating a new one. If the corkboard is empty, fall back to a pure analysis plan
(step 1 only) and say so. Present it as an outline the author can act on; offer to go deeper before creating anything.

## 4. Only if asked — lay down structure

If the author says "yes, create those", you may scaffold: `createFolder`, `createSceneInFolder` /
`createScene` (empty stubs with frontmatter), `setOrder`. Keep prose to the author — create the slots, not the
writing. Never `moveStoryPaths` / `setPhase` / delete without an explicit instruction.

Do **not** kick off `runAnalysis` / `startIngestRun` to "refresh" first — if the plan needs fresher analysis,
tell the author what it would cost and let them start it.
