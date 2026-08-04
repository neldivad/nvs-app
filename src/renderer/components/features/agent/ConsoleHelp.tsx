/**
 * Console & AI help — a centered popup dialog (the shared "Help & reference" look),
 * opened from the console's ? button. Same primitives as the rail/timeline help.
 */
import { Dialog } from '@/components/ui/dialog'
import { HelpSection as Section, HelpTable as Table } from '@/components/ui/help'
import { ExternalLink } from '@/components/ui/ExternalLink'

import type { JSX } from "react";

export function ConsoleHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Console & AI" size="detail">
      <div className="space-y-5">
        <Section title="Console tabs">
          <Table
            rows={[
              ['Ingest', 'Tracks which canon scenes are fresh / stale / pending and runs analysis bundles — the inferred layer (threads, arcs, coherence) the rails read.'],
              ['Database', 'Inspect the co-located nvs.db behind the panels. (Planned.)'],
              ['Agent', 'Mount an AI to produce that analysis for you — pick a source below.']
            ]}
          />
        </Section>

        <Section title="Canon — the analysis gate">
          <Table
            rows={[
              ['What it is', 'A scene is read by analysis (threads, arcs, coherence) only once you mark it canon — so drafts you’re still wrestling with don’t skew the ledgers.'],
              ['How to set it', 'Open the scene → Properties → set its phase to “canon” (it’s frontmatter — you can also write phase: canon in Source view).'],
              ['Who decides', 'You. Canon is your call about what counts as “real” in the story — the AI can create pages, but it never marks them canon for you.'],
              ['World pages', 'No canon gate — characters / locations / items / lore are always-live reference once they exist.']
            ]}
          />
        </Section>

        <Section title="AI sources — bring your key, or connect your plan">
          <Table
            rows={[
              ['Off', 'No AI — pure manual authoring.'],
              ['Key', 'Paste an Anthropic API key (console.anthropic.com → API Keys, stored encrypted on this machine). NVS runs the agent itself in a chat — pay-per-token. Not keyless: NVS holds your key.'],
              ['Plan', 'Use your Claude Pro/Max via Claude Code — run the connect command from the Agent tab. Keyless: the model runs in your agent, not NVS.']
            ]}
          />
        </Section>

        <p className="text-[12px] text-muted-foreground">
          Either way the AI calls the <em>same</em> engine tools the UI uses (read scenes, write analysis) — it
          can&apos;t corrupt your files; every write is validated and stamped with its producer.
        </p>

        <p className="text-[12px] text-faint">
          <ExternalLink href="https://console.anthropic.com/settings/keys">Get an API key</ExternalLink>
          {' · '}
          <ExternalLink href="https://docs.anthropic.com/en/docs/claude-code">Claude Code docs</ExternalLink>
        </p>
      </div>
    </Dialog>
  )
}
