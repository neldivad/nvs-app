---
name: nvs-graphics
description: Produce shareable graphics from a Novel Visual Studio project — for marketing or analysis. Two lanes — native NVS rail screenshots (cast, timeline, threads, density) captured headlessly, and discrete on-brand data cards (Speaking Share, Avg Characters Per Turn, Discussed top-terms, Density) drawn from the project's numbers. Use when the user wants images of who speaks / how much / when / about what, or a picture of a rail.
---

# NVS graphics

Two ways to make a shareable image. Both follow the **nvs-sandbox** contract — captures happen in a hidden
sandbox, never the author's live window.

- **Lane A — native rail capture** (pixel-perfect NVS rails: cast, timeline, threads, gantt/density). Use when
  the user wants "a picture of the <rail>".
- **Lane B — branded data cards** (discrete, self-branded graphics you draw from the numbers). Use when the user
  wants clean, standalone marketing/analysis cards — especially for transcript-style projects.

---

## Lane A — native rail capture (via the sandbox)

1. `openSandbox({ projectPath })` — the hidden instance (see nvs-sandbox). Defaults to the open `--work`.
2. `captureAsset({ view, theme, region, maxPx })` — renders the real rail to a PNG and returns it. `view` =
   `cast` / `timeline` / `threads` / `coherence` / …; `theme:'light'` reads as manuscript paper (cleaner for
   slides); `region` (from `listRegions`) captures one panel un-clipped. One call → one PNG.
3. `closeSandbox` when done.

`captureAsset` is the right tool (hidden, DOM-to-PNG). Do **not** reach for the live window.

---

## Lane B — branded data cards (deterministic, no AI)

Discrete, self-branded NVS cards from a transcript-style project (podcast / interview / hearing / group chat).
Each card is a **standalone graphic** the user can grab and share on its own. You **FILL the template** below —
you do NOT design your own page. Everything is **deterministic (T1)**: never run or include AI analysis
(threads, coherence, "insights") — the numbers speak.

### Flow

1. **Target the project.** `currentProject`; if not the one meant, `openWork("<abs path>")`. `listCast` for the
   speaker names (you need surnames for the stop dictionary).
2. **Speaker stats** via `queryDb`:
   ```sql
   SELECT speaker_name, COUNT(*) AS turns, SUM(LENGTH(text)) AS chars
   FROM dialog_nodes GROUP BY speaker_name ORDER BY chars DESC
   ```
   Volume is **characters** (a long answer outweighs many short questions). Drop the `Narration` pseudo-speaker.
   Per speaker: **% of total chars**, **chars per turn** (`chars ÷ turns`). Header: speaker count, total turns,
   total words (`≈ chars ÷ 5.7`).
3. **Topics — deterministic n-grams** (the "Discussed" card; ~30 ms, no AI):
   ```sql
   SELECT speaker_name, text FROM dialog_nodes WHERE speaker_name != 'Narration'
   ```
   Lowercase → tokenize on `[a-z']+` (keep tokens length > 2) → count **unigrams + bigrams + trigrams** → **drop
   any n-gram containing a stopword** → keep the **top ~8 by frequency**, deduping fragments (prefer the trigram
   "wong kim ark" over its "wong kim"/"kim ark" pieces). Bigrams/trigrams carry the signal.

### The four cards

| Card | encoding |
|---|---|
| **Speaking Share** | bar = chars ÷ max · label = % of total |
| **Avg Characters Per Turn** | bar = cpt ÷ max · label = raw chars/turn |
| **Discussed · top terms** | bar = count ÷ max · label = raw count |
| **Density · who speaks when** | heatmap — rows = speakers (SAME sort as Speaking Share), cols = scenes in READING order; cell fill = `√(cellChars ÷ globalMaxCell)` of `--accent` (perceptual, so faint questions stay visible) |

**Density data** — `queryDb`:
```sql
SELECT unit_id, speaker_name, SUM(LENGTH(text)) AS chars
FROM dialog_nodes WHERE speaker_name != 'Narration' GROUP BY unit_id, speaker_name
```
**Order the scene columns NUMERICALLY** — sort scene ids by their trailing integer; a plain `ORDER BY unit_id` is
lexicographic (`s10` before `s2`). Per cell: fill% = `round(sqrt(cellChars/globalMaxCell)*100)`; `0 → empty`.

### Rules — do not deviate

- **COLORLESS.** Every bar is the ONE hue `--accent`; never colour-by-speaker. Identity = label + sorted position;
  magnitude = bar length.
- **Sort descending.** Fold crowds: >8 speakers → top 8 + one italic `+K others` row (sum the tail's chars). ≤8:
  show all.
- **Graphs + titles only.** No prose, no insights, **no descriptive sub-line under a title**.
- **Each card self-brands minimally:** footer `◆ Novel Visual Studio · <project name>`. That's the ONLY annotation.
- **Keep the NVS tokens + both-theme CSS exactly** — that's what makes it read as NVS.

### Stop dictionary

Static English function words + **every speaker's surname** (from `listCast`, so "Justice Alito" → drop "justice"
AND "alito") + procedural/register words + spoken filler:
```
function: a an the of to and in is it that this for on as with was are be by at or from not but we you i he she
  they them his her their our your my me us do does did have has had will would can could should if then so
content-noise (procedural): justice court counsel argument honor question case brief page mr ms general chief
  respectfully agree disagree think thing point
filler (spoken): you-know sort-of kind-of i-mean i-think you-re we-re it-s that-s there-s going-to
speakers: <inject each surname from listCast>
```

### Delivery — PNG-first, Artifact fallback

Same HTML is the source; how you hand it over depends on the session:
- **If a headless browser is available** (`google-chrome` / `chromium` / `playwright`, or code-execution that can
  rasterize HTML): render **each card to its own PNG** and **return the PNGs in the chat** — grabbable, no URL
  indirection. Preferred.
  ```
  google-chrome --headless=new --no-sandbox --hide-scrollbars --force-color-profile=srgb \
    --screenshot=card1.png --window-size=500,540 "file://<abs>/card1.html"
  ```
  (One small HTML per card: the shared `<style>` + a `.frame{width:452px;margin:14px auto}` wrapper + that one
  `.card`. Window height ≈ 540 for an 11-row card, ≈ 430 for ~8 rows.)
- **Otherwise** publish the whole gallery as **one Artifact** (universal — needs no rasterizer).

These cards are Claude-drawn HTML — the NVS capture tools (Lane A) are for native *rails*, not these. Don't
capture the cards with `captureAsset`; rasterize them yourself.

### Template (publish verbatim; swap header + `.row` blocks; one `.row` per item)

```html
<title>{{TITLE}} — NVS graphics</title>
<style>
  :root{ --canvas:#faf7f2; --panel:#fffdf9; --border:#e4ddd0; --ink:#2b2723; --muted:#6b6153; --faint:#857b6b;
         --accent:#0e7490; --mark:#4f46e5; --track:#efe9df;
         --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         --mono:ui-monospace,"SF Mono","Geist Mono",Menlo,monospace; }
  @media (prefers-color-scheme:dark){ :root{ --canvas:#171310; --panel:#221d19; --border:#332c26; --ink:#ece4d8;
         --muted:#9b9082; --faint:#6b6258; --accent:#45c8c0; --mark:#818cf8; --track:#2a241f; } }
  :root[data-theme="light"]{ --canvas:#faf7f2; --panel:#fffdf9; --border:#e4ddd0; --ink:#2b2723; --muted:#6b6153; --faint:#857b6b; --accent:#0e7490; --mark:#4f46e5; --track:#efe9df; }
  :root[data-theme="dark"]{ --canvas:#171310; --panel:#221d19; --border:#332c26; --ink:#ece4d8; --muted:#9b9082; --faint:#6b6258; --accent:#45c8c0; --mark:#818cf8; --track:#2a241f; }
  *{ box-sizing:border-box } body{ margin:0; background:var(--canvas); color:var(--ink); font-family:var(--sans); -webkit-font-smoothing:antialiased; line-height:1.5 }
  .gallery{ max-width:1020px; margin:0 auto; padding:44px 24px 56px }
  .eyebrow{ font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--faint); font-weight:600 }
  header.collection h1{ font-size:26px; line-height:1.15; margin:.3rem 0 .45rem; font-weight:640; letter-spacing:-.01em; text-wrap:balance }
  .stats{ font-family:var(--mono); font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums }
  .grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:18px; margin-top:22px }
  .card{ background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:22px 22px 16px; display:flex; flex-direction:column }
  .card h2{ font-size:12px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); font-weight:600; margin:0 0 16px }
  .row{ display:grid; grid-template-columns:112px 1fr 48px; align-items:center; gap:11px; padding:3px 0 }
  .row.wide{ grid-template-columns:150px 1fr 40px }
  .name{ font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .name.lead{ font-weight:600 }
  .track{ height:10px; background:var(--track); border-radius:5px; overflow:hidden }
  .bar{ height:100%; background:var(--accent); border-radius:5px }
  .val{ font-family:var(--mono); font-size:11.5px; color:var(--muted); text-align:right; font-variant-numeric:tabular-nums }
  .brand{ display:flex; align-items:center; gap:7px; margin-top:16px; padding-top:12px; border-top:1px solid var(--border); font-size:11px; color:var(--faint) }
  .mark{ width:8px; height:8px; border-radius:2px; background:var(--mark); transform:rotate(45deg); flex:none }
  .brand b{ color:var(--ink); font-weight:600 } .brand .src{ margin-left:auto; font-family:var(--mono); color:var(--accent) }
  .heat .hm{ display:flex; flex-direction:column; gap:3px }
  .hrow{ display:grid; grid-template-columns:86px repeat(var(--cols,11),1fr); gap:3px; align-items:center }
  .heat .rl{ font-size:11px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right }
  .hl{ font-size:9px; color:var(--faint); text-align:center; font-family:var(--mono) }
  .cell{ aspect-ratio:1; border-radius:3px; background:color-mix(in oklab, var(--accent) var(--i,0%), var(--track)) }
</style>
<div class="gallery">
  <header class="collection">
    <div class="eyebrow">{{EYEBROW}}</div><h1>{{HEADLINE}}</h1>
    <div class="stats">{{N}} speakers · {{TURNS}} exchanges · ~{{WORDS}} words</div>
  </header>
  <div class="grid">
    <div class="card"><h2>Speaking Share</h2>
      <!-- one .row per speaker, sorted chars desc; width=chars÷max; val=pct% -->
      <div class="row"><span class="name lead">{{NAME}}</span><div class="track"><div class="bar" style="width:{{W}}%"></div></div><span class="val">{{PCT}}%</span></div>
      <div class="brand"><span class="mark"></span><b>Novel Visual Studio</b><span class="src">{{PROJECT}}</span></div>
    </div>
    <div class="card"><h2>Avg Characters Per Turn</h2>
      <div class="row"><span class="name">{{NAME}}</span><div class="track"><div class="bar" style="width:{{W}}%"></div></div><span class="val">{{CPT}}</span></div>
      <div class="brand"><span class="mark"></span><b>Novel Visual Studio</b><span class="src">{{PROJECT}}</span></div>
    </div>
    <div class="card"><h2>Discussed · top terms</h2>
      <div class="row wide"><span class="name">{{PHRASE}}</span><div class="track"><div class="bar" style="width:{{W}}%"></div></div><span class="val">{{COUNT}}</span></div>
      <div class="brand"><span class="mark"></span><b>Novel Visual Studio</b><span class="src">{{PROJECT}}</span></div>
    </div>
    <div class="card heat" style="--cols:{{NSCENES}}"><h2>Density · who speaks when</h2>
      <div class="hm">
        <div class="hrow hhead"><span class="rl"></span><!-- one .hl per scene, reading order --><span class="hl">{{S}}</span></div>
        <!-- one .hrow per speaker (Speaking-Share order): rl = name, then one .cell per scene, --i:{{FILL}}% -->
        <div class="hrow"><span class="rl">{{NAME}}</span><span class="cell" style="--i:{{FILL}}%"></span></div>
      </div>
      <div class="brand"><span class="mark"></span><b>Novel Visual Studio</b><span class="src">{{PROJECT}}</span></div>
    </div>
  </div>
</div>
```

Reference render (Trump v. Barbara SCOTUS, real numbers): https://claude.ai/code/artifact/f54c8136-b317-4039-9a73-666c797bef37
