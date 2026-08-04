# content/story/

Script files — the actual narrative. Organized by chapter and act.

## Structure

```
chapters/
  chapter1/
    act1/
      scene1.md        ← atomic writing unit (beat + dialogue)
      scene2.md
    act2/
      ...
    _chapter.md        ← chapter metadata (change, arc, thread accounting)
  chapter2/
    ...
```

## How to add a scene

1. Copy `content/templates/scene.md` into the right `chapters/chapterN/actN/` folder
2. Name it `sNNN-short-title.md` (zero-padded, e.g. `s001-body-in-library.md`)
3. Fill in the YAML frontmatter: `scene_id`, `location`, `characters_present`, `plot_threads`
4. Write the `## Beat` (one sentence: what changes)
5. Write `## Scene` (dialogue only)

## File naming

| File | Naming convention |
|---|---|
| Scene | `s001-kebab-title.md` |
| Act metadata | `_act.md` inside the act folder |
| Chapter metadata | `_chapter.md` inside the chapter folder |

## Conventions

- Every scene must have a beat — one thing that changes
- Dialogue-first: no prose description, minimal stage direction
- `characters_present` must list every character who speaks or is named
- `plot_threads.opens` must list any new mystery, conflict, or promise introduced
