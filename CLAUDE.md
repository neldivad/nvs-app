# CLAUDE.md — Novel Visual Studio

This repo is the **Novel Visual Studio app**: an Electron desktop screenplay studio for dialogue-driven work (games, film, video, podcasts, fiction).

**Working on the app? Read [AGENTS.md](AGENTS.md)** — architecture (main / preload / engine / renderer),
the IPC seam, the stack, conventions, and the phased plan. Then the skills in
[.agents/skills/](.agents/skills/) (building-components · ui-component-patterns · electron-ipc · engine-bindings)
and the visual system in [DESIGN.md](DESIGN.md).

## Orientation in one breath

The author writes Markdown scenes; an in-process TypeScript engine reads them and keeps narrative ledgers —
threads, cast presence, coherence, reveals — surfaced as panels.
Stories stay as plain files; analysis lives co-located in a `.nvs/` folder beside the work.

```
src/main      Electron main (Node): windows, dialogs, safeStorage, file-watch, IPC handlers
src/preload   contextBridge → window.nvs (the only UI→engine path)
src/engine    the TS narrative engine + vendored SQL schema (app-owned — decision D1)
src/shared    ipc.ts — the typed renderer↔main contract
src/renderer  the React SPA (no Node; calls window.nvs)
DESIGN.md     visual system — source of truth, pins both modes (focus dark / manuscript light)
internal/     working notes + locked decisions
resources/sample-project/   a bundled example NVS project — the first-run seed / on-disk shape demo
```

## Not in this repo

- **Dataset conversion** — turning transcript-like sources into NVS-format projects lives in **nvs-parser**
  (a converter + agentic conversion skills + the quality oracle). The **runtime schema + ingest enforcement**
  are owned **here** (see [internal/decisions.md](internal/decisions.md) D1/D2); the **descriptive on-disk
  convention** is `nvs-parser/references/nvs-format.md` (see
  [internal/conversion-and-docs-architecture.md](internal/conversion-and-docs-architecture.md)).
- **Authoring a story** is the *end-user's* activity, done inside their own project folder. The bundled
  example at `resources/sample-project/` carries its own `CLAUDE.md` + skills showing how that works — that
  guidance is sample content, not instructions for building this app.
