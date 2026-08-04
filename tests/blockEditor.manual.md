# BlockEditor — Manual Test Cases

Test scene: `Office Drama (demo) › 001-C1 › s000-fountain-block-test`

---

## Slash palette (`/`)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Type `/` in a narration block | Palette appears with all 5 block types |
| 2 | Type `/sp` | List filters to Speech only |
| 3 | Press `↓` to move selection, `Tab` or `Enter` to commit | Block kind changes, `/ ` text clears, speaker picker opens for speech/thinking |
| 4 | Press `Escape` | Palette closes, `/` text clears |
| 5 | Click an item with the mouse | Same result as Enter |

## `@` mention (`@`)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Type `@` in any block | AtPalette appears with all scene speakers first, then character list |
| 2 | Type `@see` | List filters to candidates containing "see" |
| 3 | Press `↓ ↑` to navigate, `Enter`/`Tab` to commit | Block converts to speech, speaker set, `@see` text cleared |
| 4 | Press `Escape` | Palette hides; block stays in original kind; `@see` text remains for editing |
| 5 | Delete the `@` text after Escape | Palette does not reappear until user types `@` again |

## Speaker picker (badge)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Click the speaker badge on a speech/thinking block | Picker portal opens below badge; editor retains focus (arrow keys still navigate blocks) |
| 2 | Type in filter input | List narrows to matching names |
| 3 | Press `↑ ↓` to navigate list | Highlighted item moves |
| 4 | Press `Enter` or `Tab` | Speaker updated, picker closes, editor focused |
| 5 | Press `Escape` | Picker closes, editor focused, speaker unchanged |
| 6 | Click outside the picker | Picker closes |
| 7 | Click badge again while picker is open | Picker toggles closed |
| 8 | Open picker on block A, then click badge on block B | Block A's picker closes, block B's opens |

## Keyboard navigation

| # | Steps | Expected |
|---|-------|----------|
| 1 | `↑ ↓` in a narration block | Cursor moves between blocks freely |
| 2 | `↑` from first line of speech block (picker closed) | Cursor moves to previous block, not trapped by badge div |
| 3 | `Enter` at end of any block | New narration block inserted below; cursor moves into it |
| 4 | `Enter` in `@name` pattern (e.g. `@HUGH ARR`, palette dismissed) | Block converts to speech with that speaker, text cleared |

## Preview pane

| # | Steps | Expected |
|---|-------|----------|
| 1 | Switch to Preview with the test scene open | All 5 block types render (narration, speech bubbles, thinking bubbles, action italic, transition pill) |
| 2 | Inline `**bold**` and `*italic*` in narration | Renders as formatted text, not raw `**` |
| 3 | Click a speaker name | Inspector dialog opens with character info |
| 4 | Click "Open character page" in inspector | Character wiki page opens in a new tab |

## Save / round-trip

| # | Steps | Expected |
|---|-------|----------|
| 1 | Edit text in the block editor, wait 400ms | Source view shows updated Fountain text |
| 2 | `Cmd+S` / `Ctrl+S` | File saved (dot in tab title disappears) |
| 3 | Close and reopen the scene | Content loads correctly, all block kinds preserved |
| 4 | Switch to Source, edit raw Fountain, switch back to Write | Block editor reflects the source changes |
