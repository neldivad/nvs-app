# AGENTS.md — building Novel Visual Studio

This repo is **the Novel Visual Studio app** — an Electron desktop writing IDE. This file is for agents
working on the application code.

`resources/sample-project/` is **not** part of the app — it's a bundled example NVS project (the first-run
seed and an on-disk-shape demo) that ships with the app and gets copied into a user's chosen folder. It
carries its own `CLAUDE.md` + authoring skills as *sample content*; ignore it when building the app.

---

## What the app is

A local-first desktop screenplay studio for dialogue-driven work — games, film, video, podcasts, fiction.
The author writes plain-text (Fountain) scenes; an in-process TypeScript engine reads them and keeps
narrative ledgers — threads, cast presence, coherence, reveals — surfaced as panels. Stories stay as plain
files on disk; analysis lives co-located in a `.nvs/` folder beside the work.

## Architecture (three processes, one contract)

```
src/
  main/        Electron main (Node). Windows, dialogs, safeStorage(key), file-watch, IPC handlers.
    ipc/       channel handlers (P1+: open-project · ingest · extract · query)
  preload/     contextBridge — exposes window.nvs, the ONLY path from UI to engine
  engine/      the TS narrative engine (main-process side; Node-only)
    schema/    SQL migrations — the runtime schema canon, app-owned (decision D1)
    db.ts      better-sqlite3 open + migrate
    index.ts   engine facade (openProject, questlog, … grows through the phases)
  shared/      ipc.ts — the typed renderer<->main contract (no Node, no DOM)
  renderer/    the React SPA (no Node; talks to the engine only via window.nvs)
    components/  ui (primitives) · layout (shell + shared rail/panel kit) · features/<domain>
                 (threads, cast, timeline, coherence, custody, arc, entity, lore, relationships,
                 story, agent, analysis) · dialogs (app-global modals) · store · editor · page
    lib/         helpers by kind: fountain · timeline · analysis · editor (+ generic at root)
    stores/ config/ styles/ views/
```
The `components/` split mirrors VS Code's `base/ui` (primitives) · `parts` (layout) · `contrib` (features);
`engine/` is likewise foldered by kind: analysis · content · data · io (+ index/hostApi/contracts + schema/).

**The seam is sacred.** The renderer never imports Node or the engine directly. It calls `window.nvs.*`
(typed from `src/shared/ipc.ts`), the preload forwards to a channel, the main handler calls the engine.
Add a capability by editing `NvsApi` + `CHANNELS` in `shared/ipc.ts` first; preload and the renderer client
derive from it so they cannot drift. See `.agents/skills/electron-ipc.md`.

## Stack

- **Shell/build:** Electron + electron-vite (CJS main/preload, ESM renderer) + electron-builder.
- **UI:** React 19 + TanStack Router (client routing) + Tailwind v4 + shadcn/ui (new-york) + lucide + zod.
- **Editor:** CodeMirror 6 (markdown).  **Viz:** ECharts (heatmaps/timeline); Cytoscape/Sigma later (graph).
- **Engine (main):** better-sqlite3 + @anthropic-ai/sdk + gray-matter + chokidar, over the vendored schema.
- **Secrets:** Electron `safeStorage` (OS keychain). The API key never touches the project folder or disk.

## Design system

`DESIGN.md` is the **source of truth** for color/type/spacing — and it pins **both** modes
(`focus` dark default / `manuscript` light). `src/renderer/styles/globals.css` mirrors it verbatim; if you
change a token, change `DESIGN.md` first (with both mode values), then globals.css. Archetype color
(thread=indigo, character=teal, lore=amber, flag=rose) is the only decorative system — use the archetype
tokens (`text-thread` / `text-character` / `text-lore` / `text-flag` + their `-bg`), mapped per entity-kind
in `src/renderer/config/entityVisual.ts`; never inline a hex. See `.agents/skills/building-components.md`.

## Conventions

- Path aliases: `@/*` → renderer, `@engine/*`, `@shared/*`. Kebab-case files; PascalCase components.
- Keep IPC payloads small and structured-cloneable (they cross a process boundary).
- The engine is read-only first: deterministic ingest/T1/queries (P1) ship before any AI call (P3).
- Don't commit `out/`, `release/`, `node_modules`, or any opened project's `.nvs/`.
- **Cross-cutting mechanisms have ONE owner** — page headers (PageShell), Escape/⌘S/⌘Z (the
  dispatch stacks), page-write rollback (pageHistory), AI page-edit pipeline. Before adding any of
  those to a component, read [.agents/skills/app-wide-patterns.md](.agents/skills/app-wide-patterns.md);
  a private re-implementation is how features drift apart.

## Build & run

```bash
npm install            # postinstall rebuilds better-sqlite3 for Electron's ABI
npm run dev            # electron-vite dev — HMR renderer + main
npm run build          # typecheck + bundle
npm run dist           # electron-builder installers (win/mac/linux)
npm run typecheck | npm run lint | npm test
```

## The phased plan (where to add things)

- **P0** scaffold — shell boots, Open Folder counts scenes/world pages. ← current
- **P1** read-only analysis — port ingest → T1 → queries; light up Threads/Cast/Questlog/Timeline panels
  against `novel-scribe-datasets/office-drama` and Hamlet. *De-risks the engine port before any AI.*
- **P2** editor — CodeMirror on the `.md`; save → incremental ingest (file hashing) → panels refresh.
- **P3** extraction (AI) — a `Producer` abstraction (OpenRouter · MCP/keyless · Anthropic-direct · Ollama);
  T2/T3 populate Coherence + Reveals.
- **P4** IDE features — go-to-character, find-references, relationship graph, the coherence "Problems" panel.
- **P5** packaging — signing/notarization, CI matrix.

Decisions and their rationale are logged in internal/decisions.md.

## Where domain truth lives

Concepts (what a Thread / Window / coherence-finding *is*) are owned **here** now (decision D1); the
descriptive on-disk convention lives in `nvs-parser/references/nvs-format.md`, and the user handbook in the
**getqed-web** docs hub — link to those, don't re-document them here. This repo owns *app craft*: `DESIGN.md`,
the Electron/IPC architecture, frontend skills, and the end-user manual.
