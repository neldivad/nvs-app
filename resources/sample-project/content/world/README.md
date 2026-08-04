# content/world/

Worldbuilding reference files. Everything that exists before a scene is written.

## Structure

```
characters/
  character-name.md      ← identity, voice, arc, chapter development, relationships
items/
  item-name.md           ← Chekhov's gun register, ownership chain
locations/
  location-name.md       ← geography, history, culture, residents
lore/
  timeline.md            ← world history organized by era
  [topic].md             ← magic systems, factions, religions, technologies
```

## How to add a character

1. Copy `content/templates/character.md` → `content/world/characters/character-name.md`
2. Set `id:` to the snake_case name used in scene `characters_present` lists
3. Fill in voice section — this is what an AI uses to write them consistently
4. Leave `first_appearance: null` until they appear in a scene, then fill it in

## How to add a location

1. Copy `content/templates/location.md` → `content/world/locations/location-name.md`
2. Set `id:` to the snake_case name used in scene `location:` field
3. Fill in Description and History — the rest can grow over time

## Linking files

Scene files reference world files by `id`:
- `location: thornfield-manor-library`
- `characters_present: [detective-morgan, butler-harwick]`

World files reference each other by `id` in relationships and resident lists.

## The world grows with the story

Start with the minimum: a protagonist, one or two key locations, the premise.
Add files as they become necessary — don't over-design before writing.
A character file with no scenes is speculation. A character file earned by scenes is documentation.
