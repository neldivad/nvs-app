# Skill: engine-bindings

Porting and wiring the narrative engine (the TS half of novel-scribe) in `src/engine/`.

## What the engine is

A TypeScript port of the **deterministic** novel-scribe pipeline, running in Electron's main process:

```
ingest      .md (gray-matter frontmatter + dialogue) → dialog_nodes, narrative_units, entities
T1 counters presence snapshots, co-presence, density (pure SQL aggregates)
T3 queries  questlog, context, revelations — reductions computed on demand (read-only)
T2 extract  (P3) the AI read — behind a Producer abstraction, not part of the deterministic core
```

The AI step (T2) is **not** the deterministic core — it sits behind `Producer` (see
`internal/decisions.md` L4) and lands in P3. P1 is everything that needs no API key.

## Source of truth & the schema

The **published Python novel-scribe is the reference.** Port behavior to match it; when in doubt, read its
`src/lib/pipeline/*` and `docs/objects/`. The SQL migrations in `src/engine/schema/` are **vendored verbatim**
(001..NNN) — do not edit the copies; if the schema changes upstream, re-vendor. A project's
`.novel-scribe/novel-scribe.db` must stay readable by both engines.

## Wiring

- `db.ts` opens better-sqlite3 (lazy `require` — keep the native binding off the hot path) and applies any
  unapplied migrations in order, tracked in `schema_migrations`.
- `index.ts` is the facade the IPC handlers call: `openProject`, `currentProject`, `questlog`, … It grows
  one function per capability. Keep it pure and synchronous where better-sqlite3 allows; push async only for
  the Producer/AI path.
- Co-location: a work's DB lives at `<project>/.novel-scribe/novel-scribe.db`. Derive the path from the
  project root; never write analysis into the author's `content/`.

## Discipline

- **Read-only first.** ingest/T1/queries before any AI. Reductions (questlog, revelations, significance) are
  computed on demand — store LLM outputs + user triage state; reduce everything else (mirrors the Python
  store-vs-reduce principle).
- **Never mutate the author's `.md`.** The engine is advisory; canon is the file on disk.
- Define engine I/O shapes as zod schemas (`contracts.ts`) so IPC payloads validate at the boundary.
- Incremental ingest uses per-file `sha256` (the `source_files` table, migration 008): unchanged scenes skip.

## P1 порядok (the port milestone)

1. `ingest(root)` — walk `content/story` + `content/world`, parse frontmatter + dialogue, write base tables.
2. `aggregate(workId)` — T1 counters.
3. `questlog/threads/cast/timeline` queries → back the panels.
4. Validate against `novel-scribe-datasets/office-drama` and Hamlet (counts/threads should match the
   published benchmarks). Only then move to P2 (editor) / P3 (extraction).
