# Skill: Detective Novel

Load this skill when writing or continuing a detective fiction project.
This file layers on top of `CLAUDE.md` — read CLAUDE.md first, then this.

---

## Genre conventions

**The locked-room contract:** The reader must have access to all the clues before the reveal. Nothing can be withheld from the scene record that the detective observes. Plant fairly, hide cleverly.

**The detective's method is character.** How they investigate reveals who they are. An obsessive notices what others ignore. A tired detective misses the first thing, catches the second. Their method has a flaw that almost costs them the case.

**Suspects speak in deflection, not confession.** Every interrogated character lies — about something. Not necessarily about the murder. Layer lies: the butler lied about the time, but not because he's the killer. The truth beneath the lie is its own revelation.

**Pacing rhythm:** clue → false lead → escalation → clue → revelation. Never two revelations in a row. Never three false leads in a row. The reader should always feel they are getting somewhere.

---

## Plot hole prevention

Before writing any scene, check `threads.yaml` for:
- Clues introduced but never explained
- Characters placed at a location with no alibi
- Objects introduced but never retrieved or used
- Promises of revelation not yet delivered

A detective novel with unresolved threads by the climax is a broken contract.

---

## Scene-type guide

**Discovery scene** — establish the crime. No character has context yet. Show, don't explain. The scene is what the detective's senses record, not what they conclude.

**Interrogation scene** — information asymmetry. The detective knows something. The suspect knows something. They negotiate. Neither reveals everything. What they don't say is the scene.

**Red herring scene** — a character who seems guilty isn't. Plant evidence, give motive, then undercut both. The undercut must be *in the scene record* — reviewable by a reader who goes back.

**Revelation scene** — the detective assembles. Use this scene sparingly. One per act maximum. The revelation changes the reader's understanding of *prior* scenes, not just future ones.

**Chase/pressure scene** — the antagonist acts to prevent discovery. Raises the cost. Forces the detective to choose between safety and truth.

---

## Repo traversal for detective projects

When asked to write the next scene, do this:

```
1. Read CLAUDE.md
2. Read .nvs/config.yaml — tone, period, constraints
3. Read threads.yaml — every open thread is a planted clue or a debt
4. Read the last 2 scenes in the current act — maintain momentum and voice
5. Read character files for everyone in the upcoming scene
6. Check: which open threads could this scene advance?
7. Write the scene. Advance at least one thread. Don't close more than one per act.
```

---

## Voice archetypes (common to the genre)

**The weary detective** — seen too much. Short sentences. Dry observations. Asks questions they already know the answer to, to see who lies.

**The suspect who did it** — overexplains. Provides alibis before asked. Talks about the victim in past tense too early.

**The suspect who didn't do it but is hiding something else** — deflects sideways. Answers questions about the crime accurately but won't look directly at the detective.

**The witness who knows more than they say** — answers minimally. Waits. Watches what the detective notices.

---

## What not to write

- The detective explaining their deductions mid-scene in monologue
- A character confessing without cornering
- A clue the detective found but the reader wasn't shown
- A murderer whose motive appears only in the confession scene
- Comic relief that undercuts the scene's tension
