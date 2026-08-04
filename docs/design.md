# NovelVisualStudio — Design Rationale

This document explains the decisions behind NVS: what we built, why, and what alternatives we considered.
It doubles as a user manual for understanding how the pieces fit together.

---

## 1. The problem with existing writing software

**yWriter** and **Scrivener** are the two dominant purpose-built tools. Both are good. Neither is designed for AI-assisted writing.

**yWriter's strengths:**
- The scene as atomic unit (not the chapter, not the document)
- The goal/conflict/outcome triad — every scene must declare what it's trying to accomplish
- Explicit character and location tagging per scene

**yWriter's limitations:**
- Desktop-only, Windows-native, no API
- No machine-readable format — the project file is opaque
- Export is manuscript-only (no structured data output)

**Scrivener's strengths:**
- Everything-is-a-document (infinite nesting, drag to reorder)
- Research lives alongside story but compiles separately
- The compile step as a deliberate transform (workspace ≠ manuscript)
- 30-day non-consecutive free trial

**Scrivener's limitations:**
- Also desktop-only
- No structured metadata beyond labels/status
- No API, no machine-readable format
- Expensive for what is still essentially a rich text editor

**The shared problem:** both are optimised for a human opening an application.
Neither is designed to be traversed by an AI agent that reads files and writes content.

---

## 2. The design principles behind NVS

### 2.1 Files are the product

The story lives in text files. Not in a database, not in a proprietary format. A writer who stops using NVS still has their story — it's just Markdown files in a folder.

This matters because:
- Version control works out of the box (`git diff` on a scene = readable diff)
- Any text editor works
- The AI reads the same files the human reads — no sync issues, no export step

### 2.2 The scene is the atomic unit

Borrowed directly from yWriter. The chapter is a container. The act is a container. The **scene** is where writing happens.

A scene has:
- A goal, a conflict, and an outcome (the task spec)
- A mode (what kind of content it contains)
- A status (where it is in the workflow)
- Explicit character and location references (not inferred from prose)

### 2.3 The file structure is the project management system

Scene files are task cards. Their `status` field tracks workflow. Their `goal/conflict/outcome` fields are the agent's brief. Their `follows/leads_to` fields form the narrative graph.

An AI agent reading the `content/story/` folder can see:
- Which scenes are unwritten (status: outline, empty body)
- What each scene needs to accomplish (goal/conflict/outcome)
- What context to load (characters_present, location, follows)

No separate task management needed. The files are the queue.

### 2.4 World and story are separated

```
content/
  story/     ← what happens (narrative events)
  world/     ← what exists (characters, places, lore)
```

Borrowed from Scrivener's research/story split. The `world/` files are the context library — they're read before writing but rarely written during. The `story/` files are the workspace.

This separation also maps cleanly to the analytics pipeline: `story/` files become dialog_nodes and narrative_units; `world/` files become entities and location metadata.

### 2.5 Dialogue-first, but not dialogue-only

NVS began as a dialogue-first format — characters reveal themselves through what they say, not through description. This works well for:
- Game dialogue
- Visual novel scripts
- Screenplay-adjacent fiction
- AI-written content (dialogue is structurally unambiguous)

But real stories also need:
- Stage direction (what characters do, not say)
- Prose passages (description, atmosphere)
- System narration (time jumps, chapter breaks)
- Monologue (internal thought, extended single-speaker)

The `mode:` field in scene frontmatter declares which applies. Inline conventions handle the rest:

| Type | Convention |
|---|---|
| Dialogue | `**Character:** Line.` |
| Stage direction | `*Italics. One clause. Essential only.*` |
| Prose block | Bare paragraph (in `mode: prose` or `mode: mixed`) |
| System / narration | `[[Double brackets.]]` |

Writers never need to declare a type per line — the mode field sets the expectation for the whole scene.

---

## 3. The goal/conflict/outcome triad

This is the most important structural decision in NVS, borrowed from yWriter.

Every scene has three declared fields:

```yaml
goal: ""       # what the POV character / scene is trying to achieve
conflict: ""   # what opposes that goal
outcome: ""    # how it resolves
```

**Why this matters for human writers:**
A scene without a declared goal produces wandering dialogue. Filling in these three fields before writing forces the writer to know what they're doing before they do it. The scene plan takes 30 seconds; the scene takes 30 minutes. The plan prevents the most common failure mode — scenes that are pleasant to write but accomplish nothing.

**Why this matters for AI agents:**
The triad is a self-contained task spec. An agent given `goal`, `conflict`, and `outcome` can write a scene without ambiguity about what it's producing. Compare:
- "Write the next scene" — ambiguous, requires inference
- "Write a scene where Morgan tries to search the east wing (goal), the butler physically blocks access (conflict), and Morgan finds an alternative route but loses time (outcome)" — complete brief

The agent is a writer-for-hire. The three fields are the brief. The brief determines quality.

**Outcome values:**
- `success` — goal achieved
- `failure` — goal blocked
- `mixed` — partial success with cost
- `deferred` — outcome unclear, tension carries to next scene
- `revelation` — the goal becomes irrelevant because of what was discovered

---

## 4. The analytics connection (novel-scribe)

NVS files are the input format for the novel-scribe analytics pipeline.

```
content/story/ scenes  →  dialog_nodes, narrative_units, entity_presence
content/world/ chars   →  entities
                       ↓
              novel-scribe SQLite DB
                       ↓
              T1: presence snapshots, co-presence
              T2: AI-generated arc events, thread analysis (planned)
                       ↓
              notebooks: character heatmaps, density charts, co-presence matrix
```

This means a writer using NVS gets — for free — the same analytics we built for Genshin Impact:
- Which characters dominate which chapters (potential overweighting)
- Co-presence maps (are there unexplored character relationships?)
- Scene density per chapter (pacing analysis)
- Open thread count over time (plot hole detection)

The analytics don't require the writer to do anything extra. They write scenes. The pipeline reads frontmatter (characters_present, plot_threads) and generates the analysis.

**T2 placement:**
T1 (statistical aggregates) stays in the DB — numbers, no human-readable value.
T2 (AI-generated analysis) writes to `derived/` — a gitignored directory mirroring `content/` that the writer can read but doesn't need to manage. T2 never overwrites `content/`.

---

## 5. The agentic workflow

The intended AI-assisted writing experience:

**Planning phase (human):**
1. Set up world files (characters, locations)
2. Write the story outline
3. Create scene files with frontmatter only — goal, conflict, outcome, mode, status: outline

**Writing phase (agent):**
1. Agent reads CLAUDE.md (traversal instructions)
2. Agent reads the skill file for the genre
3. Agent picks an `outline` scene from the queue
4. Agent loads context: previous scene, characters, location
5. Agent writes the scene body to satisfy goal/conflict/outcome
6. Agent sets status to `draft`

**Revision phase (human + agent):**
1. Human reads drafts, marks notes in `## Notes` section
2. Agent revises on request, targets `draft` scenes with notes
3. Human sets `final` when satisfied

The agent never makes creative decisions about story structure — those are locked into the frontmatter by the human. The agent executes the plan. The human designs the plan.

---

## 6. What NVS is not

**Not a manuscript tool.** NVS doesn't compile to a formatted Word document or PDF. That's a separate export step (planned for `app/`). The files are a workspace, not a finished product.

**Not a prose fiction tool (fully).** NVS is optimised for dialogue-heavy, game-adjacent writing. Long descriptive passages, stream of consciousness, and poetry are not what the format is designed for. Use Scrivener for those.

**Not a wiki.** The `content/world/` files look like a wiki, but they're not — they're a context library for writing. They exist to inform scene-writing, not to document a fictional world for its own sake. World files should earn their existence through scene appearances.

**Not a database.** The analytics come from novel-scribe, not from NVS itself. NVS is file-in, file-out. The pipeline is a separate concern.

---

## 7. File naming conventions

| File | Convention | Example |
|---|---|---|
| Scene | `sNNN-kebab-title.md` | `s001-body-in-library.md` |
| Chapter folder | `chapter-N/` or chapter code | `C1.1/` |
| Character | `kebab-name.md` | `detective-morgan.md` |
| Location | `kebab-name.md` | `thornfield-manor-library.md` |
| Item | `kebab-name.md` | `locked-iron-box.md` |
| Lore | descriptive kebab | `magic-system.md` |

IDs in YAML frontmatter always use `snake_case`. File names use `kebab-case`.

---

## 8. Influences and prior art

| Concept | Borrowed from |
|---|---|
| Scene as atomic unit | yWriter |
| Goal / conflict / outcome triad | yWriter |
| Scene status workflow | yWriter + Scrivener |
| Research/story separation | Scrivener |
| Everything-is-a-file | Obsidian |
| Markdown + YAML frontmatter | Jekyll / Hugo / Obsidian |
| Dialogue format | Screenplay convention |
| `CLAUDE.md` traversal | Claude Code project conventions |
| Analytics pipeline | novel-scribe (this repo's sibling) |
| Scene-as-quest mapping | Genshin Impact data extraction (GSE) |
