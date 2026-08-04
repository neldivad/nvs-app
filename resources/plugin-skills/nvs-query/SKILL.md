---
name: nvs-query
description: Answer questions about a Novel Visual Studio story project — cast, threads, coherence problems (plot holes / contradictions / drift), character arcs, scene content — read-only, over the local NVS analysis. Use when the user asks "what's going on in my story", "who appears most", "what's off", or anything factual about an NVS project.
---

# Query an NVS story

Read-only Q&A over a project's analysis. Follows the **nvs-sandbox** contract: reads are free and instant — no
sandbox, no permission, and you never touch the author's live window. **Never write** here (no `writeTier`,
`setRuling`, `runAnalysis`); if a question would need fresh analysis, say so and hand off to the author.

## Orient first

1. `currentProject` — confirm which project you're reading (say its name if there's any doubt).
2. If it's not the one the user means, `openWork("<absolute path>")`.

## Lead with the quick wins

These return immediately and answer most questions:

- `listCoherenceFindings` — drift, gaps, contradictions, plot-holes. **The best answer to "what's off in my story?"**
- `listCast` — characters ranked by presence; volume/scene counts.
- `listThreads` — narrative threads and their status.
- `listCharacterArcs` — how characters change across the arc.
- `listStoryTree` / `listScenes` — the structure; `readScene("<path>")` for actual prose.
- `queryDb("<read-only SQL>")` — anything the fixed tools don't cover (e.g. speaker stats:
  `SELECT speaker_name, COUNT(*) turns, SUM(LENGTH(text)) chars FROM dialog_nodes GROUP BY speaker_name ORDER BY chars DESC`).

## Answer well

- Use **human titles**, never raw ids — resolve via `listScenes` / `listCast` first.
- Ground claims in what the tools return; if the analysis is thin or missing (`listTierStatus` shows unanalyzed
  scenes), say the analysis is incomplete rather than guessing — and note that building it is the author's call
  (it costs tokens; see nvs-sandbox).
- If the user then wants a chart of what you found, switch to the **nvs-graphics** skill.
