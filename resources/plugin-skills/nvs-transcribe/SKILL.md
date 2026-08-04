---
name: nvs-transcribe
description: Turn dirty plaintext (a raw transcript, pasted chat log, messy interview dump) into an NVS-ready project — clean it, structure it into speaker-attributed scenes, and ingest it so the cast / density / analysis tools light up. Use when the user has unstructured text they want to load into Novel Visual Studio.
---

# Dirty plaintext → an NVS project

Take messy text and hand back a clean, ingested NVS project. Follows the **nvs-sandbox** contract: do the work in
a sandbox or headless, never the author's live window, and **ask before running analysis** (ingest into the T1
DB is cheap and fine; the deeper AI analysis passes cost tokens — confirm first).

## 1. Read the mess, find the structure

Identify, from the raw text: **who speaks**, **turn boundaries**, and **scene/section breaks** (topic shifts, a
new segment, an interviewer resetting). Normalize speaker names (one canonical label per person — "Q"/"Interviewer"
→ the real name if known; collapse "JOHN"/"John:" variants). Strip timestamps, page numbers, `[crosstalk]`,
boilerplate — keep the words.

## 2. Structure it into the NVS on-disk shape

An NVS project is plain Markdown scenes under `content/`, analysis co-located beside them. Mirror the **bundled
`resources/sample-project/`** for the exact layout and scene frontmatter (don't invent a shape — copy the one that
ingests cleanly). One scene per section; within a scene, one dialogue turn per speaker attribution, in order.

For anything non-trivial or high-volume, prefer the **nvs-parser** converter (its whole job is dirty-source →
NVS format, with a canonical format + oracle) rather than hand-rolling the parse — this skill is the lightweight,
in-agent path for a quick paste.

## 3. Ingest and verify (in a sandbox)

1. `openWork("<the new project's absolute path>")` — the folder you just wrote.
2. `ingestWork` — reads the Markdown into the analysis DB (T1). This is deterministic and cheap.
3. Verify: `listCast` (are the speakers right and attributed?), `listScenes` (right count + order?),
   `queryDb("SELECT speaker_name, COUNT(*), SUM(LENGTH(text)) FROM dialog_nodes GROUP BY speaker_name")`.
   If a speaker is split or misattributed, fix the scene Markdown and re-ingest.

Stop here unless the author asks for more. The project is now NVS-ready — they can open it, and the
**nvs-query** / **nvs-graphics** skills work on it immediately. Deeper AI analysis (`runAnalysis` /
`startIngestRun`) is a separate, paid step — offer it, state the cost, and wait for a yes.
