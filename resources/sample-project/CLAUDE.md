# CLAUDE.md — NovelVisualStudio traversal guide

Read this before writing or editing anything in this repo.

---

## What this project is

A file-based authoring environment for dialogue-driven fiction. Scenes are the atomic writing unit. Every scene has a task specification — goal, conflict, outcome — that defines what it must accomplish. The agent writes to satisfy those three constraints.

The file system is the project management system. Scene files are task cards. World files are the context library.

---

## Repo structure

```
.agents/skills/          genre conventions and writing rules
app/                     frontend (served content, system-managed)
content/
  story/chapters/        scene files — the task queue
  world/                 character, location, item, lore files — the context library
  templates/             file templates — copy to create new content
docs/                    design rationale, user manual
```

---

## Traversal pattern

Before writing any scene, read in this order:

```
1. docs/design.md  (first time only)
   → understand the design philosophy and constraints

2. content/world/lore/timeline.md
   → world history, what has already happened before this scene

3. The scene file itself
   → read goal, conflict, outcome, mode, status, leads_to

4. the scene(s) that lead into this one
   → how they ended, what momentum to carry (see "Narrative order" below)

5. content/world/characters/{character-id}.md
   → for every character in characters_present

6. content/world/locations/{location-id}.md
   → the location's atmosphere, history, significance

7. Scan plot_threads.opens across recent scenes
   → open obligations that must eventually be resolved
```

Only after reading these: write the scene body.

---

## The task spec

Every scene frontmatter contains a three-field task spec:

```yaml
goal: ""       # what the POV character / scene is trying to achieve
conflict: ""   # what opposes that goal
outcome: ""    # how it resolves — success / failure / mixed / deferred
```

**Writing to the spec means:**
- The goal must be legible in the scene — a reader following along should feel the intention
- The conflict must create real resistance — not token opposition
- The outcome must be the actual ending state of the scene, not a summary

If any field is empty: fill it in before writing. An undeclared goal produces directionless dialogue.

---

## Content modes

The `mode:` field in frontmatter declares what kind of writing the scene contains.

| mode | content | convention |
|---|---|---|
| `dialogue` | conversation-led | `**Character:** Line.` |
| `prose` | descriptive passage | bare paragraph, no speaker format |
| `mixed` | both | alternate as needed |
| `monologue` | one character extended | `**Character:** Line.` throughout |
| `cutscene` | action/event, no speakers | *italic stage direction* only |
| `system` | world-state / time jump | `[[Double brackets.]]` |

Stage direction within any dialogue mode: `*italic, one clause, essential only.*`

---

## Status workflow

```
outline  →  draft  →  revised  →  final
```

- `outline`: frontmatter filled, ## Scene is empty or has notes only
- `draft`: scene is written, unedited
- `revised`: human or agent has reviewed and improved
- `final`: locked — do not rewrite without author instruction

**Only write to `outline` or `draft` scenes unless explicitly asked to revise a `revised` or `final` scene.**

---

## Narrative order lives in the TREE VARIANT — not frontmatter

**Scene connections are NOT in frontmatter.** The branch/merge graph — which scene leads into which — lives in the **active tree variant** (`.nvs/trees.json`), so a story can hold several alternate structures ("Timeline 1", "variantB"…) without any scene file colliding across them.

- To **see how scenes connect**, read the tree: call the **`readTree`** tool (or read `.nvs/trees.json` directly). Each variant is `adjacency = { sceneId: [out-edges] }`; `activeId` says which one drives the analysis + charts.
- To **wire a connection**, call **`connectScenes(fromSceneId, toSceneId)`** (active variant by default; pass `variantId` for another). Remove one with **`disconnectScenes`**. These refuse self-links, duplicates, and cycles. **Do NOT edit `leads_to` in scene frontmatter** to connect scenes.

A scene's own frontmatter (`goal`, `conflict`, `outcome`, `mode`, `pov`, `characters_present`, …) stays where it is — those describe the *scene's content* and belong with the prose. Only the *connections* moved out, because they're a property of the route, not the scene.

> Legacy note: older projects may still carry a frontmatter `leads_to`. On open it's mirrored once into a default tree variant; after that, edit the tree via the tools above, not the frontmatter.

---

## Thread discipline

- Any new mystery, promise, or conflict: add `scene_id` to the originating scene's `plot_threads.opens`
- When resolved: add `scene_id` to `plot_threads.closes` in the originating scene
- Threads with no `closes` entry are open obligations — surface these when asked for story health

---

## Loading a skill

For genre-specific conventions, read the skill file before writing:

```
.agents/skills/detective-novel.md
.agents/skills/scene-writing.md
```

Skill files layer on top of this CLAUDE.md — they add genre constraints, do not replace base conventions.

---

## After writing a scene

1. Update `status: draft`
2. Set `first_appearance` in character file if this is their first scene
3. Create a stub in `content/world/locations/` if the location has no file yet
4. Fill any thread entries opened in this scene
