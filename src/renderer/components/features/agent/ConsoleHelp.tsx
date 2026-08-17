/**
 * Console & AI help — a centered popup dialog (the shared "Help & reference" look),
 * opened from the console's ? button. Same primitives as the rail/timeline help.
 */
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/ui/dialog'
import { HelpSection as Section, HelpTable as Table, HelpMd } from '@/components/ui/help'
import { ExternalLink } from '@/components/ui/ExternalLink'

import type { JSX, ReactNode } from "react";

/** A `{ k, v }` catalog row → the `[key, value]` tuple HelpTable renders — so BOTH columns are translatable. */
type KV = { k: string; v: string }
const kvRows = (rows: KV[]): [string, ReactNode][] => rows.map((r) => [r.k, r.v] as [string, ReactNode])

export function ConsoleHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('consoleHelp')
  return (
    <Dialog open={open} onClose={onClose} title={t('title')} size="detail">
      <div className="space-y-5">
        <Section title={t('tabs.title')}>
          <Table rows={kvRows(t('tabs.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('canon.title')}>
          <Table rows={kvRows(t('canon.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('sources.title')}>
          <Table rows={kvRows(t('sources.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <p className="text-[12px] text-muted-foreground">
          <HelpMd>{t('engineNote')}</HelpMd>
        </p>

        <p className="text-[12px] text-faint">
          <ExternalLink href="https://console.anthropic.com/settings/keys">{t('links.getKey')}</ExternalLink>
          {' · '}
          <ExternalLink href="https://docs.anthropic.com/en/docs/claude-code">{t('links.claudeCodeDocs')}</ExternalLink>
        </p>
      </div>
    </Dialog>
  )
}
