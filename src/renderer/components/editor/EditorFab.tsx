/**
 * Floating expandable dock for the Scene/World editor: Back-to-top + Help.
 * Modeled on cloudscout-v2's fixed FAB stack, in our theme. Lives inside the
 * SceneEditor region; Back-to-top scrolls whichever container is actually scrolled
 * (the editor has different scroll hosts per view mode). Help is tailored to the
 * open page's kind (scene vs world), in the shared "Help & reference" style.
 */
import { useState, type JSX } from 'react';
import { regionAttrs, regionSelector } from '@/config/regions'
import { ArrowUp, Download, HelpCircle } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { Fab } from '@/components/ui/Fab'
import { useWorkspace } from '@/stores/workspace'
import { useTranslation } from 'react-i18next'

/** The per-scene export menu. Scenes only — world pages stay Markdown (they're prose, not a beat table). */
const SCENE_EXPORTS = [
  { format: 'json' as const },
  { format: 'csv' as const },
  { format: 'md' as const },
  { format: 'srt' as const }
]

/** Scroll any scrolled container inside the editor region back to the top. */
function backToTop(): void {
  const region = document.querySelector(regionSelector('sceneEditor'))
  if (!region) return
  region.querySelectorAll('*').forEach((el) => {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })
}

// The per-scene debt (threads + flags) now lives in the shared useSceneContext hook (lib/sceneContext), so the
// FAB popover and the SceneInspector aside read the same ledger. EditorFab uses only .isScene/.threads/.flags.

export function EditorFab(): JSX.Element {
  const { t } = useTranslation('editorFab')
  const kind = useWorkspace((s) => s.activePage?.kind ?? 'scene')
  const activePath = useWorkspace((s) => s.activePage?.path)
  const exportSceneStructured = useWorkspace((s) => s.exportSceneStructured)
  const [help, setHelp] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const isScene = kind === 'scene'
  // Threads & flags for the scene used to live in a FAB popover here; they now live in the SceneInspector aside
  // (one surface, resizable, always-on) — the FAB keeps only export + help + back-to-top.

  return (
    <>
      {/* Bounded to the pane (inset-y-4) and bottom-aligned, so an expanded panel + actions can never overflow
          past the top — it shrinks instead. Click-transparent: the column now spans the pane's full height, so
          without this it would swallow every click on the editor beneath it. */}
      <div
        {...regionAttrs('editorFab')}
        className="pointer-events-none absolute inset-y-4 right-4 z-20 flex flex-col items-end justify-end gap-2 *:pointer-events-auto"
      >
        <Fab
          actions={[
            ...(isScene
              ? [
                  {
                    icon: <Download className="size-4" />,
                    title: t('fab.export'),
                    onClick: () => setExportOpen(true)
                  }
                ]
              : []),
            { icon: <HelpCircle className="size-4" />, title: t('fab.help'), onClick: () => setHelp(true) },
            { icon: <ArrowUp className="size-4" />, title: t('fab.backToTop'), onClick: backToTop }
          ]}
        />
        <Dialog open={help} onClose={() => setHelp(false)} title={kind === 'scene' ? t('help.sceneTitle') : t('help.worldTitle')} size="detail">
          {kind === 'scene' ? <SceneHelp /> : <WorldHelp kind={kind} />}
        </Dialog>
        <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title={t('export.title')} size="confirm">
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              {t('export.lead')}
            </p>
            <div className="flex flex-col gap-1">
              {SCENE_EXPORTS.map((f) => (
                <button
                  key={f.format}
                  onClick={() => {
                    if (activePath) void exportSceneStructured(activePath, f.format)
                    setExportOpen(false)
                  }}
                  className="flex items-start gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-panel-soft"
                >
                  <span className="mt-0.5 font-mono text-[11px] text-thread">.{f.format}</span>
                  <span className="min-w-0 flex-1 text-[12px] text-muted-foreground"><span className="text-faint">{t('export.bestFor')}</span> {t(`export.best.${f.format}`)}</span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      </div>
    </>
  )
}

function SceneHelp(): JSX.Element {
  const { t } = useTranslation('editorFab')
  return (
    <div className="space-y-5">
      <HelpSection title={t('help.scene.write.title')}>
        <HelpTable rows={Object.entries(t('help.scene.write.rows', { returnObjects: true }) as Record<string, string>)} />
      </HelpSection>
      <HelpSection title={t('help.scene.slash.title')}>
        <HelpTable rows={Object.entries(t('help.scene.slash.rows', { returnObjects: true }) as Record<string, string>)} />
      </HelpSection>
      <HelpSection title={t('help.scene.properties.title')}>
        <HelpList items={t('help.scene.properties.items', { returnObjects: true }) as string[]} />
      </HelpSection>
      <HelpSection title={t('help.scene.views.title')}>
        <HelpTable rows={Object.entries(t('help.scene.views.rows', { returnObjects: true }) as Record<string, string>)} />
      </HelpSection>
    </div>
  )
}

function WorldHelp({ kind }: { kind: string }): JSX.Element {
  const { t } = useTranslation('editorFab')
  return (
    <div className="space-y-5">
      <HelpSection title={t('help.world.writing.title', { kind: cap(kind) })}>
        <HelpList items={t('help.world.writing.items', { returnObjects: true }) as string[]} />
      </HelpSection>
      <HelpSection title={t('help.world.properties.title')}>
        <HelpList items={t('help.world.properties.items', { returnObjects: true }) as string[]} />
      </HelpSection>
      <HelpSection title={t('help.world.shortcuts.title')}>
        <HelpTable rows={Object.entries(t('help.world.shortcuts.rows', { returnObjects: true }) as Record<string, string>)} />
      </HelpSection>
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
