---
name: nvs-sandbox
description: The working contract for driving Novel Visual Studio from Claude — how the agent reads a project, produces visuals, plans, and ingests WITHOUT ever touching the author's live writing window. Read this first; the nvs-query / nvs-plan / nvs-graphics / nvs-transcribe skills build on it.
---

# Working in Novel Visual Studio

Novel Visual Studio (NVS) analyzes dialogue-driven work — fiction, screenplays, podcasts, interviews, hearings,
transcripts. Its MCP tools read a project's analysis (cast, threads, coherence, scenes) and can build it from
markdown. This skill is the **contract every NVS task follows**; the four job skills below are the recipes.

## The one rule: the author's live app is off-limits

NVS may be open on the author's screen while they write. **You never touch that window** — you don't navigate it,
theme it, or screenshot it. The tools that used to do that are simply not available to you. Your work happens in
one of two places instead:

- **The headless engine** — for pure data reads and for building analysis from markdown (`--work`).
- **A hidden agent sandbox** — a throwaway NVS instance you own, for anything that needs a rendered window
  (captures/visuals). It never appears on screen and closes itself.

If you ever feel like you need to "show" or "capture" what the author has open, you don't — open your own sandbox
on the same project and work there.

## What's free, what needs a sandbox, what needs permission

| Kind | Tools | Rule |
|---|---|---|
| **Reads** (instant, safe) | `currentProject` · `listCast` · `listThreads` · `listCoherenceFindings` · `listScenes` · `listStoryTree` · `queryDb` · `readScene` … | Just call them. No sandbox, no permission. |
| **Visuals** (need a window) | `captureAsset` · `listRegions` | **`openSandbox` first**, then capture, then `closeSandbox`. |
| **Analysis / background work** (costs money + time, mutates) | `runAnalysis` · `startIngestRun` · `enqueueTask` · bulk `writeTier` | **Ask the author before running.** State the plan — how many scenes, roughly how long/expensive — and wait for a yes. |
| **Structure / status writes** | `createScene*` · `moveStoryPaths` · `setPhase` · `setRuling` · `mergeThreads` | Only on the author's explicit request. |

Reads are non-disruptive because they never touch the live window. Analysis and the in-app task queue are
different: they spend tokens and change the project — treat them like a purchase you confirm first.

## The sandbox, concretely

- `openSandbox({ projectPath })` — spins up the hidden instance on that project (defaults to this server's
  `--work`). Blocks ~10-30s on a cold start, then `captureAsset` / `listRegions` render from it. (`captureAsset` is
  the capture tool — DOM-to-PNG, works in the hidden window; there's no `captureView` here.)
- `closeSandbox` — tear it down when you're done. It also self-closes after ~5 min idle.
- One sandbox at a time; it renders **any** project (not just whatever the author has open).

## Pick your recipe

- **Answer questions about a story** → the **nvs-query** skill.
- **Plan what to write next** (outline, next scenes, gaps) → the **nvs-plan** skill.
- **Produce shareable graphics** (marketing / analysis) → the **nvs-graphics** skill.
- **Turn dirty plaintext into an NVS project** → the **nvs-transcribe** skill.

Always refer to scenes and characters by their human titles (resolve ids via `listScenes` / `listCast` first),
and if an answer looks like it's about the wrong project, call `currentProject` and say which one you're reading.
