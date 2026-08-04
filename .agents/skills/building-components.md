# Skill: building-components

How to add UI to Novel Visual Studio so it stays on-design and on-architecture.

## Before you write a component

1. **Tokens, not values.** Every color/space/radius comes from `DESIGN.md` (mirrored in
   `src/renderer/styles/globals.css`). Use Tailwind utilities backed by the tokens — `bg-canvas`,
   `bg-panel`, `text-foreground`, `text-muted-foreground`, `border-border`, `rounded-md`. Never a raw hex.
2. **Archetype color is meaning.** thread=indigo, character=teal, lore=amber, flag=rose. Use it *only* to
   mark that object's kind via the archetype tokens (`text-thread`/`text-character`/`text-lore`/`text-flag`),
   mapped per entity-kind in `src/renderer/config/entityVisual.ts` — never inline.
3. **Both modes for free.** Because everything resolves through CSS variables, a component built from tokens
   works in focus (dark) and manuscript (light) with no extra work. Don't write mode-specific styles.
4. **shadcn/ui is the primitive layer.** Add primitives with the shadcn CLI (new-york style, into
   `@/components/ui`). Compose app components inside their **feature** folder on top of them.

## Placement

The `components/` tree follows VS Code's layering — **primitives** (`ui`) · **shell parts** (`layout`) ·
**features** (`contrib`). A file's home is decided by *reuse*: used by one domain → that feature; used by
two or more → `layout` (shared kit) or `ui` (leaf widget).

| Kind | Folder |
|---|---|
| shadcn primitives (button, dialog, tooltip…) — no app knowledge | `src/renderer/components/ui/` |
| shell parts + shared rail/sidebar/panel kit (used by 2+ features) | `src/renderer/components/layout/` |
| a domain's panel + sidebar + views + its own dialogs/charts | `src/renderer/components/features/<domain>/` |
| editor surface + affordances | `src/renderer/components/editor/` |
| app-global modal dialogs (not owned by one feature) | `src/renderer/components/dialogs/` |
| hooks, IPC client, helpers — by kind | `src/renderer/lib/{fountain,timeline,analysis,editor}/` |

## Patterns

- Class merging: `cn(...)` from `@/lib/utils` (clsx + tailwind-merge). Never string-concatenate classes.
- Icons: `lucide-react`, `size-4`/`size-5`, colored by token (`text-muted-foreground`, or an archetype `fg`).
- Flat by default: hairline `border-border` separators, no shadow on data surfaces (shadow = overlay only).
- Density: list rows use `body-sm` (13px). The editor surface uses the `prose` token (16px / lh 1.7).
- Empty/loading/“soon” states are first-class — panels render honestly before P1/P3 wire their data.

## Don't

- Don't import Node or `@engine/*` into a renderer component — go through `window.nvs` (typed from
  `@shared/ipc`). See `engine-bindings.md` / `electron-ipc.md`.
- Don't add an archetype color as a background or generic accent (thread-on-primary-button is the one
  sanctioned exception).
- Don't emphasize with size — use weight (500/600). Don't introduce a 5th archetype color casually.
