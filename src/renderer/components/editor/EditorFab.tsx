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

/** The per-scene export menu. Scenes only — world pages stay Markdown (they're prose, not a beat table). */
const SCENE_EXPORTS = [
  { format: 'json' as const, best: 'another app · re-import' },
  { format: 'csv' as const, best: 'spreadsheets' },
  { format: 'md' as const, best: 'the raw scene file' },
  { format: 'srt' as const, best: 'subtitles · captions' }
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
                    title: 'Export this scene',
                    onClick: () => setExportOpen(true)
                  }
                ]
              : []),
            { icon: <HelpCircle className="size-4" />, title: 'Page help', onClick: () => setHelp(true) },
            { icon: <ArrowUp className="size-4" />, title: 'Back to top', onClick: backToTop }
          ]}
        />
        <Dialog open={help} onClose={() => setHelp(false)} title={kind === 'scene' ? 'Scene help' : 'World page help'} size="detail">
          {kind === 'scene' ? <SceneHelp /> : <WorldHelp kind={kind} />}
        </Dialog>
        <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Export this scene" size="confirm">
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              One scene, in the same shape as a full project export — small enough for another app to actually consume.
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
                  <span className="min-w-0 flex-1 text-[12px] text-muted-foreground"><span className="text-faint">Best for:</span> {f.best}</span>
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
  return (
    <div className="space-y-5">
      <HelpSection title="Write — the Fountain dialect">
        <HelpTable
          rows={[
            ['plain line', 'Narration'],
            ['ALL CAPS line', 'Speaker cue — following line(s) are their dialogue'],
            ['(THINKING) after a cue', 'Inner monologue instead of spoken'],
            ['> line', 'Action beat (stage direction)'],
            ['= line', 'Transition (e.g. "Two weeks earlier")'],
            ['**bold**  *italic*', 'Inline emphasis, any block']
          ]}
        />
      </HelpSection>
      <HelpSection title="Slash palette — type / in a block">
        <HelpTable
          rows={[
            ['/sp', 'Speech'],
            ['/th', 'Thinking'],
            ['/na', 'Narration'],
            ['/ac', 'Action'],
            ['/tr', 'Transition'],
            ['@name', 'Convert to speech and set the speaker']
          ]}
        />
      </HelpSection>
      <HelpSection title="Properties & the timeline">
        <HelpList
          items={[
            <>
              Open <b className="text-foreground/80">Properties</b> for the beat (goal · conflict · outcome),
              cast, and content-phase.
            </>,
            <>
              The first <b className="text-foreground/80">Media</b> image becomes the scene&apos;s cover on the
              timeline.
            </>,
            <>
              The scene&apos;s <b className="text-foreground/80">phase</b> tints its timeline card; connections
              there write <span className="font-mono">leads_to</span>.
            </>
          ]}
        />
      </HelpSection>
      <HelpSection title="Views & shortcuts">
        <HelpTable
          rows={[
            ['Write / Preview / Source', 'Compose · rendered · raw Fountain'],
            ['Cmd / Ctrl + S', 'Save the open scene'],
            ['↑ / ↓', 'Move between blocks'],
            ['Enter', 'New narration block below']
          ]}
        />
      </HelpSection>
    </div>
  )
}

function WorldHelp({ kind }: { kind: string }): JSX.Element {
  return (
    <div className="space-y-5">
      <HelpSection title={`${cap(kind)} page — writing`}>
        <HelpList
          items={[
            <>
              Start a section with <span className="font-mono">##</span> (or type{' '}
              <span className="font-mono">/</span> for the section palette).
            </>,
            <>Write in Markdown; Preview renders the wiki panel; Source is the raw file an agent reads.</>
          ]}
        />
      </HelpSection>
      <HelpSection title="Properties">
        <HelpList
          items={[
            <>
              <b className="text-foreground/80">Properties</b> edits the page&apos;s fields, media gallery, and
              phase.
            </>,
            <>
              <b className="text-foreground/80">Phase</b> is editorial maturity (draft → developing → canon →
              archived); <b className="text-foreground/80">status</b> is in-world state (active, deceased…).
            </>,
            <>The first Media image is the page&apos;s avatar used across lists.</>
          ]}
        />
      </HelpSection>
      <HelpSection title="Shortcuts">
        <HelpTable
          rows={[
            ['Write / Preview / Source', 'Compose · wiki panel · raw Markdown'],
            ['Cmd / Ctrl + S', 'Save the open page']
          ]}
        />
      </HelpSection>
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
