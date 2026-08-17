import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/ui/dialog'
import { HelpSection as Section, HelpTable as Table, HelpList as List, HelpMd } from '@/components/ui/help'
import { HOTKEYS, modLabel } from '@/config/hotkeys'

import type { JSX, ReactNode } from "react";

/** A `{ k, v }` catalog row → the `[key, value]` tuple HelpTable renders — so BOTH columns are translatable. */
type KV = { k: string; v: string }
const kvRows = (rows: KV[]): [string, ReactNode][] => rows.map((r) => [r.k, r.v] as [string, ReactNode])

/** Quick reference — the Fountain dialect, slash palette, and shortcuts. Opened from the rail's ? button. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('helpDialog')
  return (
    <Dialog region="helpDialog" open={open} onClose={onClose} title={t('title')} size="detail">
      <div className="space-y-5">
        <Section title={t('sceneFormat.title')}>
          <p className="mb-2 text-[12px] text-muted-foreground">
            <HelpMd>{t('sceneFormat.intro')}</HelpMd>
          </p>
          <Table rows={kvRows(t('sceneFormat.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('settings.title')}>
          <p className="mb-2 text-[12px] text-muted-foreground">
            <HelpMd>{t('settings.intro')}</HelpMd>
          </p>
          <Table rows={kvRows(t('settings.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('slash.title')}>
          <Table rows={kvRows(t('slash.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('worldPages.title')}>
          <List items={t('worldPages.items', { returnObjects: true }) as string[]} />
        </Section>

        <Section title={t('ai.title')}>
          <Table rows={kvRows(t('ai.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('pageEdits.title')}>
          <p className="mb-2 text-[12px] text-muted-foreground">
            <HelpMd>{t('pageEdits.intro')}</HelpMd>
          </p>
          <Table rows={kvRows(t('pageEdits.rows', { returnObjects: true }) as KV[])} />
        </Section>

        <Section title={t('shortcuts.title')}>
          {/* Registry-backed rows read their key from HOTKEYS (config/hotkeys.ts) so the hint can never drift from
              the real binding. The rest are component-local keys (block nav, tree rename) not in that registry. */}
          <Table
            rows={[
              [HOTKEYS.search.display, t('shortcuts.search')],
              [HOTKEYS.pageTab.display, t('shortcuts.pageTab')],
              [HOTKEYS.save.display, t('shortcuts.save')],
              [HOTKEYS.undo.display, t('shortcuts.undo')],
              [modLabel('F'), t('shortcuts.find')],
              [HOTKEYS.projectConfig.display, t('shortcuts.projectConfig')],
              [HOTKEYS.compose.display, t('shortcuts.compose')],
              [HOTKEYS.paneHelp.display, t('shortcuts.paneHelp')],
              ['↑ / ↓', t('shortcuts.blockNav')],
              ['Enter', t('shortcuts.split')],
              ['Tab / Enter (in palette)', t('shortcuts.commit')],
              ['F2 (in a sidebar)', t('shortcuts.rename')]
            ]}
          />
        </Section>

        <Section title={t('corkboard.title')}>
          <Table rows={kvRows(t('corkboard.rows', { returnObjects: true }) as KV[])} />
        </Section>
      </div>
    </Dialog>
  )
}
