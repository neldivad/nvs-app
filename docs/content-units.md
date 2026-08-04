# Units of Content Across Media

Before NVS commits to a schema, it should speak the writer's language — not invent one
convenient for agents and databases. This page surveys how prose, comics, games, and film each
divide a story into units, what tools/standards already exist, and how those map onto NVS. The
goal is empathy: a novelist, a showrunner, and a game writer should each recognize their own
craft in the tool.

The throughline of the survey: **the *scene* is the near-universal atomic authoring unit**, and
the **beat** is the near-universal sub-scene dramatic unit. Everything above the scene is
medium-specific containers; everything below is medium-specific rendering.

---

## Prose / Manuscript (novels, short fiction)

```
Work (Book)  →  Part / Volume  →  Chapter  →  Scene  →  Beat  →  Paragraph  →  Sentence
```

- **Atomic authoring unit:** the **scene** — a continuous stretch of action in one place/time,
  usually separated by a chapter break or a blank-line "scene break" (`* * *`).
- **Beat:** a single shift in value or intention within a scene (Robert McKee, *Story*).
- **Tools & standards:**
  - **Scrivener** — a *Binder* of folders and "text documents" (one per scene), each with a
    *synopsis card* on a corkboard, *Section Types*, *labels*, and *status*. Compile assembles
    the manuscript.
  - **yWriter** — Project → Chapter → **Scene**, where every scene carries
    **goal / conflict / outcome** + POV + character/location tags. (NVS borrows this triad.)
  - **Beat sheets** — *Save the Cat!*, the *three-act* and *Hero's Journey* templates.
- **Throughlines:** "plot threads," "arcs," "setups and payoffs." A dropped setup is a plot hole.

---

## Comics / Graphic novels / Manga

```
Series  →  Volume (tankōbon)  →  Issue / Chapter  →  Page  →  Tier (row)  →  Panel  →  Balloon / Caption
                                                                         └─ Gutter (the space between panels)
```

- **Atomic authoring unit (writing):** still the **scene**, but it renders down to **pages and
  panels**, and the **page-turn** is a deliberate dramatic beat (the reveal on the turn).
- **Panel / Gutter:** the panel is the rendered shot; the *gutter* is where the reader's mind
  fills in motion and time (Scott McCloud, *Understanding Comics*).
- **Script formats:**
  - **Full script** — panel-by-panel ("PAGE 4, PANEL 2: …" + dialogue), the writer specifies
    every panel.
  - **Marvel method** — plot-first prose; the artist breaks it into panels, dialogue added after.
- **Throughlines:** issue-level arcs nested in a series arc; the cliffhanger is structural.

---

## Game development (narrative)

```
Game  →  Act / Chapter  →  Quest (main / side / world)  →  Objective / Stage  →  Scene / Cutscene  →  Dialogue node / Branch  →  Line (bark)
```

- **Atomic authoring unit:** the **dialogue scene / cutscene**, but the organizing spine is the
  **quest** — a unit of *interactive obligation* with an explicit open/closed state in a quest log.
- **Branching:** dialogue is a graph, not a line — *nodes*, *choices*, *conditions*.
- **Tools & standards:**
  - **Twine** — *passages* linked by `[[choices]]`.
  - **Ink** (Inkle), **Yarn Spinner** — *knots / stitches / diverts*, conditional choices.
  - **Articy:Draft** — flow graphs of dialogue + entities for large RPGs.
  - **Genshin (our import)** — Quest → SubQuest → **Talk** → Dialog node.
- **Throughlines:** the **quest** *is* the thread — an open quest is an open thread, a finished
  quest a closed one. (NVS makes this the `built_by: structural` thread source.)
- **The Quest Log** is a player-facing tally of open/closed obligations — a built-in
  cliffhanger/plot-hole tracker.

---

## Film / Television / Screenplay

```
Screenplay  →  Act  →  Sequence  →  Scene (slugline)  →  Beat  →  Shot  →  Frame
TV:  Series  →  Season  →  Episode  →  Act (between breaks)  →  Scene  →  ...
```

- **Atomic authoring unit:** the **scene**, defined by its **slugline / scene heading**:
  `INT./EXT. — LOCATION — TIME OF DAY` (e.g. `INT. THORNFIELD LIBRARY — NIGHT`). One location,
  continuous time. This is the single most standardized unit in any medium.
- **Sequence:** a run of scenes forming a mini-arc (~8–15 min) — the "sequence approach,"
  inherited from silent-film reels.
- **Beat / Shot / Frame:** beat = dramatic unit (in dialogue, a parenthetical-level turn);
  shot = one continuous camera take; frame = the still image.
- **The "cut":** an *edit point* between shots, or colloquially a *version* of the whole film
  (a "Director's Cut"). It is **not** a scene — a common misnomer.
- **Tools & standards:**
  - **Fountain** — the plain-text screenplay markup standard (sluglines, character cues,
    dialogue, parentheticals, `CUT TO:` transitions, `#` sections, `=` synopses). NVS `.md`
    scenes are Fountain-adjacent.
  - **Final Draft / Fade In / Celtx** — scene navigator, scene properties, the beat board.
  - **Breakdown sheet** — what a 1st AD tags per scene: scene #, INT/EXT, location, D/N, **cast**,
    background, props, notes. This is exactly a structured per-scene extraction.
  - **Shot list / storyboard** — the production layer below the scene.
- **Throughlines:** "setups & payoffs," "the A/B/C story," "throughlines" (Dramatica). A planted
  gun unfired is a plot hole (Chekhov).

---

## Cross-media mapping → NVS

| Concept | Prose | Comic | Game | Film/TV | NVS object |
|---|---|---|---|---|---|
| The whole work | Book | Series | Game | Screenplay/Series | `Work` |
| Major division | Part | Volume | Act/Chapter | Act / Season·Episode | `narrative_unit` (type: author's word) |
| Mid-tier (optional) | — | Issue/Chapter | Quest | Sequence | `narrative_unit` |
| **Atomic unit** | **Scene** | **Scene→Page/Panel** | **Talk/Cutscene** | **Scene (slugline)** | **`Scene` → `ExtractedScene`** |
| Sub-scene dramatic unit | Beat | Panel / page-turn | Dialogue node | Beat / Shot | `beat` (sub-scene) |
| Structured per-scene summary | Synopsis card | Panel breakdown | — | Breakdown sheet | **`ExtractedScene`** |
| The cast/world of a unit | Characters | Characters | Entities | Cast + tags | `entities` (character/location/item/lore) |
| Unresolved obligation | Plot thread | Arc/cliffhanger | **Quest** | Setup/payoff | `NarrativeThread` |
| Open/closed tally | — | — | **Quest Log** | — | `QuestLog` (T3) |
| Place·time of a scene | (prose) | establishing panel | scene trigger | **Slugline** | `slugline` (proposed) |

---

## Takeaways for the NVS schema

1. **Center the scene.** Every medium has an atomic authoring unit and it is some form of
   *scene*. NVS centering `ExtractedScene` is universally legible.
2. **Let the container word be the author's.** A "Chapter" (novel), "Issue" (comic), "Quest"
   (game), and "Act" (film) are the same structural role with different names — so
   `narrative_units.type` carries the **author's vocabulary**, and the engine treats them
   uniformly. The schema already does this; the UI should *show* the writer their own word.
3. **The beat is the universal sub-scene grain.** If/when NVS adds finer fidelity, "beat" is the
   term everyone shares — not "shot" (film-only) or "panel" (comic-only).
4. **The structured per-scene record has a name in every medium** — synopsis card, breakdown
   sheet, scene card. `ExtractedScene` is that artifact; framing it as a *breakdown sheet* makes
   it instantly legible to screen people and *scene card* to novelists.
5. **Quests are the most concrete model of a thread.** Games already solved open/closed tracking
   with the quest log; NVS generalizes it as `NarrativeThread` and inherits the quest log as the
   plot-hole/cliffhanger surface.
6. **Borrow the slugline.** `INT./EXT. — LOCATION — TIME` is the one piece of structured metadata
   every screenwriter writes by hand. Adopting it (place + time-of-day) is high-empathy and
   doubles as our location/time grounding.
7. **Don't impose ids on the writer.** No medium asks an author to think in entity ids; they
   write names. NVS extraction is name-first, with id resolution handled behind the scenes.
