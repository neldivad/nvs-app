---
version: alpha
name: NovelVisualStudio
description: Novel Visual Studio presents itself as a calm screenplay studio for dialogue-driven work — a manuscript surface with a tireless reader working in the margins. The visual language is warm paper and ink: a low-glare canvas (default dark "focus", optional light "manuscript"), hairline borders over shadows, and a single decorative system — archetype color-coding by narrative object (threads=indigo, characters=teal, lore=amber, coherence-flags=rose). Prose and UI are set in Geist Sans; scene codes, IDs, counts, and any numeric metadata are set in Geist Mono. The chrome recedes so the writing leads; color appears only where it carries narrative meaning.

# Two modes, both pinned here.
# dark  = the default, low-glare warm-dark canvas for drafting — the "focus" mood (html.dark)
# light = the warm "manuscript" paper for review/print (html :root)
# Every token below carries BOTH values so globals.css mirrors, never improvises.
colors:
  # ── canvas & chrome (warm neutrals) ──────────────────────────────────────
  canvas:           { dark: "#1b1714", light: "#faf7f2" }
  panel:            { dark: "#221d19", light: "#f3efe7" }
  panel-soft:       { dark: "#2a241f", light: "#ece7dc" }
  border:           { dark: "#332c26", light: "#e4ddd0" }
  border-soft:      { dark: "#2a241f", light: "#ece7dc" }
  # ── text (warm ink) ──────────────────────────────────────────────────────
  foreground:       { dark: "#ece4d8", light: "#2b2723" }
  prose:            { dark: "#d6cdc0", light: "#3d3833" }
  muted-foreground: { dark: "#9a8f80", light: "#6f675c" }
  faint:            { dark: "#6b6258", light: "#a89e8f" }
  # ── archetype: threads (indigo) — plot obligations, also the primary accent ─
  thread:            { dark: "#818cf8", light: "#4f46e5" }
  thread-bg:         { dark: "#211f3d", light: "#eef2ff" }
  thread-foreground: { dark: "#16132b", light: "#ffffff" }
  # ── archetype: characters (teal) — cast / entities ───────────────────────
  character:            { dark: "#45c8c0", light: "#0e7490" }
  character-bg:         { dark: "#0e302f", light: "#ecfeff" }
  character-foreground: { dark: "#07201f", light: "#ffffff" }
  # ── archetype: lore (amber) — world / timeline ───────────────────────────
  lore:            { dark: "#fbbf24", light: "#b45309" }
  lore-bg:         { dark: "#33280c", light: "#fffbeb" }
  lore-foreground: { dark: "#241d06", light: "#ffffff" }
  # ── archetype: coherence flags (rose) — contradictions / drift ───────────
  flag:            { dark: "#fb7185", light: "#be123c" }
  flag-bg:         { dark: "#3a1620", light: "#fff1f2" }
  flag-foreground: { dark: "#240b11", light: "#ffffff" }
  # ── semantic (status) ────────────────────────────────────────────────────
  ok:    { dark: "#4ade80", light: "#16a34a" }
  warn:  { dark: "#fbbf24", light: "#b45309" }
  ring:  { dark: "#818cf8", light: "#4f46e5" }

typography:
  app-title:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.3px
  panel-heading:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
  card-title:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  prose:
    # the manuscript reading surface — generous measure, serif for paper feel
    fontFamily: "Geist, ui-serif, Georgia, serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.5px
    textTransform: uppercase
  mono-sm:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-xs:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4

rounded:
  xs: 3px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 10px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  xxxl: 32px

components:
  archetype-badge-thread:
    backgroundColor: "{colors.thread-bg}"
    textColor: "{colors.thread}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  archetype-badge-character:
    backgroundColor: "{colors.character-bg}"
    textColor: "{colors.character}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  archetype-badge-lore:
    backgroundColor: "{colors.lore-bg}"
    textColor: "{colors.lore}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  archetype-badge-flag:
    backgroundColor: "{colors.flag-bg}"
    textColor: "{colors.flag}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  rail-item:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  rail-item-active:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.foreground}"
  scene-code-chip:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.mono-sm}"
  stat-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "1px solid {colors.border}"
  primary-button:
    backgroundColor: "{colors.thread}"
    textColor: "{colors.thread-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  ghost-button:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  editor-surface:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.prose}"
    typography: "{typography.prose}"
    maxWidth: 680px
---

## Overview

Novel Visual Studio is a desktop **screenplay studio** for dialogue-driven work (games, film, video,
podcasts, fiction). The author writes scenes as plain-text Fountain/Markdown; an in-process engine (a
TypeScript port of novel-scribe) reads them and
keeps the books — who's present, what's promised and paid off, who's drifting from their page, what's
been revealed. The interface should feel like a quiet, well-set manuscript with an attentive reader in
the margin — **not** a dashboard.

The dominant aesthetic is **warm paper and ink**. Unlike a civic data product (white canvas, light-only),
a drafting tool is used for hours, so the **default is the low-glare `dark` canvas** (the warm "focus" mood,
`{colors.canvas}` dark); the `light` mode (the warm "manuscript" paper, `{colors.canvas}` light) is the
review/print companion. Both
are warm — never the cold blue-grey of an IDE; the canvas should read as paper, lit dim or bright.

The sole expressive system is **archetype color-coding by narrative object**: indigo for threads, teal for
characters, amber for lore, rose for coherence flags. These four colors appear only on archetype badges,
panel icons, and the matching data they label. Nowhere else. Everything else is paper, ink, and hairlines.

**Key characteristics:**
- Two modes, both pinned in the frontmatter (`dark` / `light`); `globals.css` mirrors them verbatim.
- Archetype color is meaning, not decoration — it marks *what kind of narrative object* something is.
- Geist Sans for all UI and prose; Geist Mono for scene codes (`S001`), IDs, beat counts, line counts.
- Hairline borders over shadows; elevation only for overlays (command palette, dialogs).
- The editor surface is the hero: a centered ~680px measure, generous line-height, chrome dimmed around it.
- **One prose measure** — every write + preview column (block-write, markdown write/source via `cmTheme`, and the
  rendered previews) is `max-w-[var(--measure)]` (`--measure: 42rem` in globals.css), so switching Write↔Preview or
  scene↔world never reflows the column. Change the width in ONE place. (Dialogs keep their own `max-w-*`.)

## Modes

| Mode | Mood | When | Canvas | Selector |
|---|---|---|---|---|
| **dark** (default) | "focus" | drafting, long sessions | warm dark | `html.dark` |
| **light** | "manuscript" | review, reading a chapter whole, print | warm paper | `html` (`:root`) |

`:root` holds the light (manuscript) values so shadcn/ui primitives get a conventional light base; the
app boots with `.dark` applied (the dark/focus canvas). The toggle flips the class — every token resolves
through CSS variables, so no component re-styles.

## Colors

### Canvas & chrome
- **canvas** — the writing surface and app background. The single most important color; it must read as paper.
- **panel** — rails, header, footer, cards. One step off the canvas.
- **panel-soft** — hover, active rail item, subtle fills.
- **border / border-soft** — hairline separators. Borders, never shadows, divide data.

### Text (warm ink)
- **foreground** — primary UI text and headings.
- **prose** — the manuscript body in the editor; slightly softer than `foreground` for long reading.
- **muted-foreground** — secondary text, metadata, inactive rail labels.
- **faint** — tertiary: footer notes, placeholder, disabled.

### Archetype encoding (the only color system)
Each narrative object has a solid + a soft-background pair. Used on badges, the panel icon that owns that
object, and counts/dots for that object — never as a page background or a generic accent.
- **threads** → `{colors.thread}` / `{colors.thread-bg}` (indigo). Also doubles as the primary action accent.
- **characters** → `{colors.character}` / `{colors.character-bg}` (teal).
- **lore** → `{colors.lore}` / `{colors.lore-bg}` (amber).
- **coherence flags** → `{colors.flag}` / `{colors.flag-bg}` (rose).

### Semantic
- **ok** — resolved thread, passing state. **warn** — open/at-risk. **ring** — focus outline (= thread indigo).

## Typography

**Geist Sans** for everything UI and prose. **Geist Mono** for identifiers and numbers only — scene codes
(`S001`), thread ids, beat/line counts, hashes. Never use mono for prose emphasis.

| Token | Size / weight | Use |
|---|---|---|
| `{typography.app-title}` | 18 / 600 | product name, window title bar |
| `{typography.panel-heading}` | 15 / 600 | panel `<h2>` (Threads, Cast…) |
| `{typography.card-title}` | 14 / 600 | stat card / list row title |
| `{typography.prose}` | 16 / 400, lh 1.7 | the editor manuscript surface |
| `{typography.body-md}` | 14 / 400 | panel body copy |
| `{typography.body-sm}` | 13 / 400 | dense list rows, controls |
| `{typography.caption}` | 12 / 400 | fine metadata |
| `{typography.label}` | 11 / 600 caps | section headers above lists, badge text |
| `{typography.micro}` | 10 / 400 | dense chip/meta text under a row (the tightest tier) |
| `{typography.mono-sm}` | 12 mono | scene codes, ids inline |
| `{typography.mono-xs}` | 11 mono | counts in tight rows |

Emphasize with weight (500→600), not size. Section labels are uppercase-tracked, not larger.

**Implementation — one source of truth.** These tokens are the `.type-*` classes in `globals.css`
(`.type-panel-heading`, `.type-card-title`, `.type-body-sm`, `.type-caption`, `.type-label`, `.type-micro`, …).
Use the class, don't retype `text-[11px] font-semibold uppercase` per component — that ad-hoc route is how the
same section header ended up 10px in some panels and 11px in others. The classes carry SHAPE only
(size/weight/case/tracking); pick the ink separately (`text-foreground` / `-muted-foreground` / `-faint`).

## Layout

Base unit 4px; primary increment 8px (`{spacing.*}`). The app shell is a fixed left **rail** (workspaces),
a top **header** (project + actions), the **main** panel, and a thin **status footer**. Panels center their
content; the editor centers a ~680px measure. Data rows are flat: a row + `border-b` hairline, no card chrome.

## Elevation

Flat by default. No shadow on data surfaces; hairlines separate.

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | hairline border / row separator | rails, cards, rows, inputs |
| 1 (overlay) | `0 8px 24px rgba(0,0,0,0.35)` (dark) / `0 8px 24px rgba(0,0,0,0.12)` (light) | command palette, dialogs, menus |

## Shapes

`{rounded.sm}` badges · `{rounded.md}` buttons/inputs · `{rounded.lg}` cards/panels · `{rounded.full}`
status dots only. Buttons are rectangular `{rounded.md}` — never pills.

## Components

- **Archetype badge** — one variant per object; only the color pair changes (`archetype-badge-*`). Resolve
  the pair from the archetype tokens (`thread`/`character`/`lore`/`flag` + `-bg`); never inline a hex.
- **Rail item** — 40px target, icon only; active = `panel-soft` fill + the icon in its archetype color.
- **Stat card** — `panel` bg, hairline, a mono number in the relevant archetype color + a caption label.
- **Primary button** — `thread` (indigo) fill; the one saturated action. **Ghost button** — hairline + ink.
- **Scene-code chip** — bare mono text in `muted-foreground` (`S001`, thread ids); no background.
- **Editor surface** — `canvas` bg, `prose` ink, centered ≤680px; chrome around it dims to let it lead.
- **Gantt row-title** — every rail's frozen-gutter label (Threads · Cast · Lore · Coherence · Custody · Entity ·
  CharacterArc) is **11px / `foreground/80`**, from ONE const `GANTT_ROW_TITLE` (LifecycleGantt). Compose only
  *semantic* color overrides after it (e.g. Custody's audience=`lore`, public=`flag`) — never re-pick the size or
  a plain opacity, so the row names read identically across the shared gantt component.
- **Sidebar row** — every rail's roster item (Threads · Character-arc · Entity/Lore · Coherence) is one look, from
  ONE helper `sidebarRow(on)` (`lib/utils`): `rounded px-2 py-1 text-xs`, selection = **`bg-panel-soft` + foreground**
  (never a colored `border-l-2` accent), default = `text-muted-foreground hover:bg-panel-soft`. Meta/counts pair with
  `text-[10px] text-faint`; section labels are `px-2 pb-1 pt-2 text-[10px] font-semibold uppercase … text-faint`.
  Compose extra *state* after it (`cn(sidebarRow(on), off && 'opacity-50')`); semantic color lives in the row's
  icon/dot, not the row background. (CastSidebar is a toggle list, not a selection list — it borrows the geometry
  only.) CustodySidebar is the reference the rest match. **New rails must COMPOSE the kit, not re-roll a row:**
  `SidebarRow` / `SidebarLabel` (`components/layout/SidebarKit.tsx`) own the geometry + selection so a rail
  can't drift without explicitly opting out — `sidebarRow()` is just the class the kit wraps. Thread · Character ·
  Entity · Lore · Coherence · Cast · Library rosters are all on `SidebarRow` now. The kit also owns the **header**
  (`SidebarHeader` — `Title · N` in the `type-label` token) and the **scroll body** (`SidebarScroll` — `min-h-0
  flex-1 overflow-y-auto`); every sidebar's header + scroll go through them (h-9 header, so it aligns with the
  pane's `RailHeader`). Two rows stay deliberately distinct and are labelled with their own `data-comp` so the
  overlay names them honestly: the Relationship **`Roster`** (heat-tint + ring selection, not panel-soft) and the
  **`SequenceRow`** (a container with a nested pick button + hover-delete the `<button>`-based `SidebarRow` can't
  hold — it still borrows the row geometry via `sidebarRow()`). The
  **folder-like** navigators — Scene · World · Custody · Timeline — use the sibling **`DetailedRow`**: an optional
  phase colour-spine + a leading kind icon + `[label · faint sub-line]` + a trailing status (✓/count) + pixel
  indent. It's the richer navigator row (distinct from the flat `SidebarRow`) and owns the geometry so the four
  can't drift. Scene/World also get a **top search box** that filters the tree (folders whose descendants match
  stay, and searching force-expands so matches surface). One thing `DetailedRow` deliberately does NOT unify:
  **expandable folder rows**. Scene/World folders expand/collapse (chevron); Timeline's `PaletteRow` folders are
  **non-expandable atomic drop-units** (you drag a whole folder onto the canvas as one placeable unit) — different
  behaviour, so folder rows stay each navigator's own control while the leaf/item rows share `DetailedRow`.
- **Rail header** — every rail-content pane's top bar is `RailHeader` (`components/ui/RailHeader.tsx`): fixed
  **`h-9`**, `border-b`, `px-3`. Tabs inside it use `RailTabs` — the ONE tab look, a segmented bordered-rounded
  group (the same one PageShell uses), so every rail's tabs read identically. Filter-chip rails (Coherence · Lore ·
  Entity · CharacterArc) drop their chips into the same `RailHeader`. The Relationship rail's portrait duo-header
  is a deliberate `h-24` **exception** (it shows the two character portraits) and keeps its own height.
- **Dev overlays** — `Ctrl/Cmd+Alt+D` outlines the layout: `[data-region]` rails (thread/dashed, top-left label)
  AND every shared **base component** — `[data-comp]` (`RailHeader` · `RailTabs` · `SidebarRow` · `SidebarHeader` ·
  `SidebarScroll` · `DetailedRow` …) in a green box with its name, so you can see at a glance which rails are built from
  the same base (two green "SidebarRow" boxes = unified; a bare un-boxed header = still hand-rolled). `Ctrl/Cmd+Alt+P`
  is the finer `[data-part]` overlay. When you add a new shared chrome component, give it a `data-comp="Name"`.

**Controls — no native form elements.** Never use a bare `<select>`, `<input type=checkbox/radio/range>`, or an
OS date/color picker: they render in the platform's chrome, ignore the tokens, and break both modes. Always use
the app's own primitives in `components/ui/` — `Select`, `Input`, `Button`, `Dialog`, the dual-range, etc. If a
control you need isn't there yet, ADD it to `components/ui/` (hand-rolled on the tokens, like the rest) rather
than reaching for the native element. A native form control in a diff is a review-blocker.

## Do's and Don'ts

**Do**
- Pull every value from a token; both modes are already pinned — never hardcode a hex in a component.
- Use archetype color only to mark that object's kind (badge, owning panel icon, its counts/dots).
- Use Geist Mono for scene codes, ids, and counts inline with prose.
- Keep data rows flat with a hairline separator; let the editor surface be the visual hero.

**Don't**
- Don't use an archetype color as a page/section background or a generic accent (thread-as-action is the
  one sanctioned exception, and only on the primary button / focus ring).
- Don't add a fifth archetype color casually — four objects, four colors; add the token here first.
- Don't reach for shadow to separate data; hairlines do that. Shadow is overlay-only.
- Don't switch the canvas to a cold blue-grey; both modes are *warm*. It must read as paper.
- Don't emphasize with size; use weight.

## Iteration guide

1. Tokens first — pick from `colors` / `typography` / `rounded` / `spacing` before any raw value.
2. Both modes ship together: when you add a color token, give it a `dark` **and** a `light` value here,
   then add both to `globals.css`. A token with one mode is a bug.
3. Archetype badge is the only colorful element; every other component defaults to paper/ink/hairline.
4. New narrative object → add its archetype token here (color pair, both modes), then map the entity kind in `config/entityVisual.ts`.
5. Status dots are a small fixed set (ok / warn) — resist adding a third casually.
