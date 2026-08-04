---
scene_id: ch01-a01-s001       # chapter-act-sequence, e.g. C1.1-s001
title: ""

# ── Structure ─────────────────────────────────────────────────────────────────
chapter: chapter-01            # chapter-code this scene belongs to
leads_to: []                   # scene_ids this scene leads to (timeline edges; many-to-many)

# ── Scene spec (the task card) ────────────────────────────────────────────────
# These three fields define what the scene must accomplish.
# Human: fill before writing. Agent: write to satisfy all three.
goal: ""        # what the POV character (or scene) is trying to achieve
conflict: ""    # what opposes that goal
outcome: ""     # how it resolves — success / failure / mixed / deferred

# ── Mode ──────────────────────────────────────────────────────────────────────
# dialogue   — scene is primarily conversation (default)
# prose      — descriptive passage, no dialogue
# mixed      — both dialogue and prose blocks
# monologue  — one character's extended speech or internal thought
# cutscene   — action/event, no speakers; third-person description only
# system     — world-state change, time jump, chapter break narration
mode: dialogue

# ── Status ────────────────────────────────────────────────────────────────────
# outline → draft → revised → final
status: outline

# ── Context ───────────────────────────────────────────────────────────────────
location: location-id
characters_present: []   # [character-id, ...] — everyone who speaks or is named
pov: null                # character-id — whose perspective filters this scene

# ── Plot threads ──────────────────────────────────────────────────────────────
plot_threads:
  opens: []              # thread-ids introduced for the first time in this scene
  advances: []           # thread-ids active and moved forward, but not resolved
  closes: []             # thread-ids resolved by the end of this scene
---

## Beat
<!-- One sentence: what changes and why it matters to the story. -->

## Notes
<!-- Planning notes — not exported to manuscript. Visible to agents. -->

## Scene

<!-- ── Content conventions ────────────────────────────────────────────────
     DIALOGUE      **Character Name:** Spoken line.
     STAGE DIR     *Minimal action or setting. Only when essential.*
     NARRATION     Bare prose paragraph. (mode: prose or mixed only)
     SYSTEM TEXT   [[Time passes. Three hours later.]]
     ─────────────────────────────────────────────────────────────────── -->

<!-- *The library. Late afternoon. The body has not been moved.* -->

<!-- **Detective Morgan:** "When was he found?" -->

<!-- **Butler Harwick:** "This morning, sir. Half past seven." *(a pause)* -->

<!-- **Detective Morgan:** "And no one entered between then and now?" -->

<!-- **Butler Harwick:** "No one." *(quietly)* "That we know of." -->
