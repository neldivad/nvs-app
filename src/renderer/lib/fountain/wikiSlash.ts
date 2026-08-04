/**
 * Slash-command items for the world-page Write tab.
 *
 * Maps the kind's section modules (from worldSchema) to SlashItems the shared SlashMenu
 * renders. Selecting one inserts the module's Markdown template; `/agent` is a stub for
 * the future AI-populate path. The detection + insertion live in SceneEditor (CodeMirror).
 */

import { Hash, Sparkles } from 'lucide-react'
import { createElement } from 'react'
import { sectionModules } from '@/config/worldSchema'
import { bodyHeadings } from '@/lib/fountain/wikiSerializer'
import type { SlashItem } from '@/components/editor/SlashMenu'

/** Slash items for a kind, marking sections already present in `body` as added. */
export function sectionSlashItems(kind: string, body = ''): SlashItem[] {
  const present = new Set(bodyHeadings(body).map((h) => h.toLowerCase()))
  const items: SlashItem[] = sectionModules(kind).map((s) => ({
    id: s.id,
    label: s.heading,
    command: `/${s.id}`,
    insert: s.template.trimEnd() + '\n',
    description: s.description,
    icon: createElement(Hash, { className: 'size-4' }),
    present: present.has(s.heading.toLowerCase())
  }))
  items.push({
    id: 'agent',
    label: 'Ask AI',
    command: '/agent',
    insert: '', // not a static insert — SceneEditor opens the agent composer instead
    description: 'Write or reshape this page with AI',
    icon: createElement(Sparkles, { className: 'size-4' })
  })
  return items
}
