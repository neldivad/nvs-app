# Skill: app-wide-patterns

Cross-cutting mechanisms with ONE owner each. Before adding a keyboard listener, a page header, a
modal, or an AI page-edit flow — check here: the mechanism almost certainly exists, and a private
re-implementation is how the app drifted before (five such bugs were found and fixed in one week).

## Pages render through PageShell (`components/page/`)

Any page-like surface (a thing with tabs over one document) uses `PageShell` — title/kind/badges in
the fixed 35–65% center band, tab strip LEFT, hint+actions RIGHT. Tabs come from the per-kind
registry (`components/page/registry.ts` → `PAGE_TABS[pageKindGroup(kind)]`). **Never hand-roll a page
header** — one edit in PageShell must restyle every page kind at once.

- The Source tab is the shared `components/page/SourceTab` and is **read-only by design** everywhere
  (structured tabs and AI jobs are the write paths; hand-edited source is how charts break).
- CodeMirror surfaces use the shared theme (`components/page/cmTheme.ts`), never a local copy.
- Scene/world write surfaces still live in `SceneEditor.tsx` pending adapter extraction — see
  `internal/pageshell-step3.md` before touching them (the `registerApply` identity is a known crash).

## Keyboard chords have ONE owner (`config/hotkeys.ts` + AppShell)

Never add a `window.addEventListener('keydown', …)` for a chord in a component. The stacks:

| chord | register with | notes |
|---|---|---|
| Escape | `useModalEscape(open, onClose)` (`lib/escapeStack.ts`) | stacked modals peel ONE layer per press; per-modal listeners dismissed whole stacks before |
| ⌘S | `useSaveTarget(active, save, isDirty?)` (`lib/saveTarget.ts`) | AppShell binds once, dispatches to the TOP registered target; `isDirty` feeds the exit guards (`anyDirty`) |
| ⌘Z / ⇧⌘Z / ⌘Y | `useUndoTarget(active, {undo, redo})` (same file) | dispatcher SKIPS editable targets — text editors keep native history |

The app menu deliberately uses `registerAccelerator: false` on Undo/Redo (main/index.ts) so ⌘Z
reaches the DOM at all — do not "fix" that back to `role: 'editMenu'`.

## Programmatic page writes go through pageHistory (store)

Any code that WRITES a page file outside the editor buffer (AI apply, records save, …) pushes the
prior body first: `pushPageHistory(path, prevBody, label, taskId?)`. That's what task-row Undo/Redo
reads (top-of-stack guarded — a stale undo is unofferable). Capped 10+10 per page, session-scoped.

## AI edits on structured pages: the custody pipeline is the template

ground → parse → gate → canonicalize → write → history:
1. **Ground** the instruction with the truth the model needs (scene-id roster, observed events) — a
   directive without grounding produces plausible fiction.
2. **Parse + gate**: never write a draft whose structured block doesn't parse (`parseCustodyBlock`-style
   IPC returns `{records, errors, canonical}`).
3. **Canonicalize on apply**: write the re-serialized canonical form, not the model's raw text — the
   read-side forgiveness (verb aliases, wiki-link who, legacy fields) is a safety net, not load-bearing.
4. Watch for OUR scaffolding fighting the format: the generic world context block teaches `[Name](id)`
   links — structured kinds need their own plain-id context (see `contextBlock` in agentCommands.ts).

## The 1000-test: every data→prompt / data→list flow needs a bound

This app's content scales QUADRATICALLY by default: every new world page / scene / topic tends to ride
along in every prompt, list, and tooltip built from the corpus (roster × pages, presence × scenes,
disclosures × facts). So before shipping any place content flows from DATA into a PROMPT or a rendered
LIST, answer "what happens at 1000 of these?" at build time — not after a user finds it.

The three bound shapes (pick by surface):
1. **Cap + honest tail** — slice N, then say what was dropped and how to get it
   ("…and 12 more reveals (use the read tools)" · "+40 more — narrow via search"). Never silently truncate.
2. **Working set** — rank by must-include (named on the page → correctness), then recency, then volume;
   the ancient tail sinks (pageAgent's `rankedCanon`, the extraction's hot/dormant threads).
3. **Render depth** — unit marks up to a threshold, then ONE aggregate with the count (lens D's tetris
   pixels → count chip). Clicks route to the drill-down surface instead of inflating the summary.

Known bounded examples to copy: CommandPalette (per-group slice), chat history (last 40 turns),
pageHistory (10+10), custody job roster (250, touched-first), Learn-more disclosures (20 + tail).

## Shared refresh ticks

Sibling panes that read the same files refresh on a STORE tick, not local state (`custodyTick` /
`bumpCustody` — the sidebar/panel staleness class). If two components fetch the same data, the tick
lives in the store.
