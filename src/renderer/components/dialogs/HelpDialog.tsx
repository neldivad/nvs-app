import { Dialog } from '@/components/ui/dialog'
import { HelpSection as Section, HelpTable as Table } from '@/components/ui/help'
import { HOTKEYS, modLabel } from '@/config/hotkeys'

import type { JSX } from "react";

/** Quick reference — the Fountain dialect, slash palette, and shortcuts. Opened from the rail's ? button. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog region="helpDialog" open={open} onClose={onClose} title="Help & reference" size="detail">
      <div className="space-y-5">
        <Section title="Scene format — the Fountain dialect">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Scenes are plain text. The block editor reads and writes this dialect, so what you type
            in Source round-trips with the Write view.
          </p>
          <Table
            rows={[
              ['ALL CAPS line', 'Speaker cue — the next line(s) become their dialogue'],
              ['(THINKING) after a cue', 'Inner monologue instead of spoken dialogue'],
              ['(mood) after a cue', 'Delivery/mood tag, e.g. (angry) — show/hide via Settings'],
              ['[00:01:23 → 00:01:27] line', 'Timing tag — a beat’s start → end timecodes (subtitle / transcript)'],
              ['> line', 'Action beat (stage direction)'],
              ['= line', 'Transition (e.g. "Two weeks earlier")'],
              ['plain line', 'Narration'],
              ['**bold**  *italic*', 'Inline emphasis, in any block']
            ]}
          />
        </Section>

        <Section title="Settings — global toggles">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Per-user preferences (the gear in the status bar). The first two change only what the{' '}
            <span className="text-foreground/80">Write</span> view shows — your prose and the Source view always
            keep the tags.
          </p>
          <Table
            rows={[
              ['Show mood tags', 'Delivery (mood) parentheticals in Write — for visual-novel-style writing'],
              ['Show timing tags', '[start → end] timecodes in Write — for subtitle / transcript work'],
              ['Edit source directly', 'Advanced: makes Source editable, saved to the file verbatim — lets you change form-locked frontmatter (like a page’s id). Off by default; a bad edit is written as-is.']
            ]}
          />
        </Section>

        <Section title="Slash palette — type / in a block">
          <Table
            rows={[
              ['/sp', 'Speech'],
              ['/th', 'Thinking'],
              ['/na', 'Narration'],
              ['/ac', 'Action'],
              ['/tr', 'Transition'],
              ['@name', 'Convert to speech and set the speaker']
            ]}
          />
        </Section>

        <Section title="World pages">
          <ul className="space-y-1 text-[12px] text-muted-foreground">
            <li>Add a page from the World sidebar — hover a group and click +.</li>
            <li>
              <span className="text-foreground/80">Properties</span> edits the page's fields and its{' '}
              <span className="text-foreground/80">phase</span> (draft → developing → canon → archived).
            </li>
            <li>
              <span className="text-foreground/80">Phase</span> is editorial maturity;{' '}
              <span className="text-foreground/80">status</span> is in-world state (active, deceased…).
            </li>
            <li>Preview renders the wiki panel; Source is the raw Markdown an agent reads.</li>
          </ul>
        </Section>

        <Section title="AI assistant — the right rail">
          <Table
            rows={[
              ['Chat', 'Ask about the open work — it reads scenes/world pages and can queue page edits for you'],
              ['Tasks', 'Background page edits (from Chat or /agent) — run while you keep writing; review & apply each'],
              ['/agent (in a page)', 'Describe a change to the open page — it’s queued as a Task, not applied inline'],
              ['Prompt library', 'Saved, reusable instructions (Reformat, Placeholders, your own) — the picker in /agent']
            ]}
          />
        </Section>

        <Section title="Page edits — append vs replace">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Every saved prompt (and queued edit) is one of two kinds. Applying a finished edit is a single
            step, so one <span className="text-foreground/80">Cmd/Ctrl+Z</span> undoes it.
          </p>
          <Table
            rows={[
              ['Append', 'The AI returns only new text, added to the end of the page — for drafting / scaffolding'],
              ['Replace', 'The AI returns the whole page rewritten — for reformatting / revising existing text']
            ]}
          />
        </Section>

        <Section title="Shortcuts">
          {/* Registry-backed rows read their key from HOTKEYS (config/hotkeys.ts) so the hint can never drift from
              the real binding. The rest are component-local keys (block nav, tree rename) not in that registry. */}
          <Table
            rows={[
              [HOTKEYS.search.display, 'Search & jump to any page'],
              [HOTKEYS.pageTab.display, 'Switch the view tab — Write · Preview · Source (custody: Chart · Records · Write · Preview · Source)'],
              [HOTKEYS.save.display, 'Save the open page'],
              [HOTKEYS.undo.display, 'Undo the last applied edit — add Shift to redo'],
              [modLabel('F'), 'Find in the open page'],
              [HOTKEYS.projectConfig.display, 'Open Project Structure'],
              [HOTKEYS.compose.display, 'Composition mode — hide all chrome (Esc exits)'],
              [HOTKEYS.paneHelp.display, 'Open this pane’s help'],
              ['↑ / ↓', 'Move between blocks'],
              ['Enter', 'Split the block at the caret (new block below)'],
              ['Tab / Enter (in palette)', 'Commit the selected block type'],
              ['F2 (in a sidebar)', 'Rename the scene or folder']
            ]}
          />
        </Section>

        <Section title="Corkboard">
          <Table
            rows={[
              ['Double-click a card', 'Open it as a post — add notes, attach pages'],
              ['C, then click a card', 'Connect all selected cards to that target'],
              ['X', 'Disconnect all selected cards'],
              ['Backspace / Delete', 'Remove the selected card(s)'],
              ['Hover → ×', 'Delete a single card']
            ]}
          />
        </Section>
      </div>
    </Dialog>
  )
}
