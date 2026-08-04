# Skill: ui-component-patterns

Recurring UI patterns specific to this app. Build these the same way each time.

## App shell

Fixed left **rail** (icon-only workspaces, `config/nav.ts`) · top **header** (project name + actions) ·
**main** panel (routed) · thin **status footer**. The rail's active item fills `panel-soft` and tints its
icon in the workspace's archetype color. The editor route dims the chrome so the manuscript leads.

## Archetype badge

One component, color pair from `archetype(kind)`:
```tsx
<span className={cn('rounded-sm px-1.5 py-0.5 text-[11px] font-semibold tracking-wide',
  s.bg, s.badgeText)}>{label}</span>
```
where `const s = archetype('thread')`. Only the pair changes between kinds; padding/type are constant.

## Stat card

`panel` bg + hairline; a mono number in the object's archetype color over a `caption` label. Counts and IDs
are **always** Geist Mono (`font-mono`). See `App.tsx` → `Stat`.

## Data row

Flat: `flex items-center gap-3 border-b border-border py-2 text-[13px]`. No card chrome. A scene code
(`S001`) leads in `font-mono text-muted-foreground`. Hover = `hover:bg-panel-soft`.

## Panel scaffold

Every analysis panel (Threads, Cast, Coherence, Questlog, Timeline) follows:
1. a `panel-heading` title row,
2. a body that renders one of: data list · empty state · "lands in P_n" placeholder,
3. data fetched via a `lib/` hook that calls `window.nvs.*` (never the engine directly).

Until P1 wires real reductions, panels render the honest "soon" placeholder — don't fake data.

## Buttons

- **Primary** (one per view): `bg-thread text-thread-foreground rounded-md`. The only saturated fill.
- **Ghost**: `border border-border hover:bg-panel-soft`. Default for toolbar/header actions.
- Rectangular `rounded-md` — never pills.

## Overlays

Command palette / dialogs are the only elevated surfaces (`shadow` level 1). Everything else is flat.
