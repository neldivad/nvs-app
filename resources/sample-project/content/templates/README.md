# content/templates/

Copy these to start any new file. Never write the templates themselves — they stay clean.

## Template index

| Template | Copy to | Purpose |
|---|---|---|
| `scene.md` | `content/story/chapters/chN/actN/sNNN-title.md` | Atomic writing unit — beat + dialogue |
| `act.md` | `content/story/chapters/chN/actN/_act.md` | Act metadata — purpose, scene list, threads |
| `chapter.md` | `content/story/chapters/chN/_chapter.md` | Chapter metadata — change statement, thread accounting |
| `arc.md` | `content/story/chapters/_arc-name.md` | Major arc — spans multiple chapters |
| `character.md` | `content/world/characters/name.md` | Character wiki page |
| `location.md` | `content/world/locations/name.md` | Location encyclopedia entry |
| `item.md` | `content/world/items/name.md` | Plot-relevant object register |
| `lore.md` | `content/world/lore/topic.md` | Magic system, faction, technology, religion |

## Naming conventions

- Files use `kebab-case`
- IDs in YAML frontmatter use `snake_case`
- Scene files: `s001-title.md`, `s002-title.md` (zero-padded, sequential per act)
- Chapter folders: `chapter1/`, `chapter2/` (no zero-padding needed at this level)
