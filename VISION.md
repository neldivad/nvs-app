# VISION.md — Novel Visual Studio

> The north star: our vision, our mission, and the bet underneath them. `README.md` is what NVS does
> today; `DESIGN.md` is what it looks like; `AGENTS.md` is how it's built. **This is what it's for** —
> and the tie-breaker when a product decision is ambiguous.

---

**Novel Visual Studio is a plain-text screenplay studio with an AI reader built in** — an editor for
dialogue-driven work where the machine holds the whole story so you don't have to.

## Vision

A world where anyone making dialogue-shaped content — a game, a film, a series, a podcast — writes it
**with** an AI that never loses the plot, in a format the next machine can already read. The story lives
in the tool's memory, not the maker's head; the screenplay you finish is one step from the video model,
the analysis pass, or the channel that comes next.

## Mission

Give every dialogue-driven creator a screenplay studio where an **AI does the tracking and a human does
the steering** — surfacing the one thing that matters right now out of a story too big to hold in your
head. Built agent-first, so you can operate it by simply saying what you want; built human-familiar, so
you can always open it up and check the work yourself.

## The shift we're built for

The content the world makes now is **dialogue-shaped, not prose-shaped.** The novel was the dominant
long-form container for a century; it isn't anymore. The formats that carry story today — **games, films,
YouTube scripts, podcasts** — are lines of dialogue and direction, not paragraphs of narration. Fountain,
the plain-text screenplay format, already fits that shape. NVS makes it the native unit instead of bending
a dialogue-first world into a prose-first tool.

We're not building a better novel editor. We're building the editor for what people actually write now.

## Why the AI is the substrate, not a feature

Three reasons the intelligence isn't bolted on — it's what the format is chosen for:

- **Transcription is a dead end.** An `.srt` is a byproduct nobody ships, edits, or builds on. The path
  from raw recording to a *workable* document runs through a model — so NVS starts where that path lands:
  a clean, structured screenplay, not a wall of captions.

- **The signal is buried in the noise.** Speech and prose are padded with hedges and flourish; the value
  is what was *actually said and done.* Cutting the noise down to the load-bearing line is exactly what a
  model is good at, and exactly what a dialogue-first format is built to hold.

- **A screenplay is already a video prompt.** Video generation is arriving fast, and the prompts that
  drive it are — structurally — screenplay: a shot, a line, an action, a cut. Write in Fountain and your
  work **converts to a video-AI prompt** with almost no translation. The editor is a step on that pipeline
  by construction, not by integration.

## Why a human stays in the loop

Because a human and an AI get lost in **opposite** ways — and the interface is where they cover for each
other.

**A human can't hold the whole forest.** Past a certain size nobody keeps every open thread, every
character's drift, every unpaid setup in their head. So the reader holds the forest and surfaces the one
tree that matters right now — the promise left hanging, the fact she shouldn't know yet, the beat that
contradicts an earlier one. **Keep the plot in the machine's memory, not yours.**

**But an agent loses the forest too.** When the story outgrows the context window, a straight-through read
stops working for the model just as it stopped working for the person. So the human UI — rails, timelines,
a relationship graph, jump-to-character — is a **non-linear map of the story**: a reading *strategy* made
visible. A person navigates by it to skim, pivot, and drill; an agent navigates by the same map to read a
work too large to hold all at once. The interface isn't the concession to human comfort. It's the shared
workspace where a bounded reader — human or model — moves through a story neither can hold in one pass.

That shared surface is also what makes the AI's work **auditable**: open a rail, see who's present, what's
promised, who drifted, and check the machine's account of the story against your own. Same page, same truth.

## The ambition

The place dialogue-driven content gets **written, checked, and handed off** — by humans and agents working
the same page. You operate it by describing what you want; it keeps the story straight so you can focus on
the choices only you can make; and what you finish flows onward to whatever machine needs it next.

Not a better word processor. The authoring surface for the dialogue-shaped century.
