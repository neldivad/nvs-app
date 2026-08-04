/**
 * App-level detail floats — the opened thread / character-arc sheets, rendered ONCE here (not inside
 * the views) so they (a) use the shared FloatWindow chrome everywhere they're opened from (the
 * Threads/Character maps, a scene's "on this scene" dock, the coherence panel) and (b) survive
 * switching rails: they're driven by the GLOBAL selection (`selectedThreadId` / `selectedArcId`),
 * which lives in the store and outlives any single view unmounting.
 */
import { useState, type JSX } from 'react';
import { useWorkspace } from '@/stores/workspace'
import { FloatWindow, type Box } from './FloatWindow'
import { ThreadDetail } from '@/components/features/threads/ThreadsPanel'
import { ArcDetail } from '@/components/features/arc/CharacterArcPanel'
import { EntityDetail } from '@/components/features/entity/EntityPanel'
import { CoherenceReview, CoherenceDetail } from '@/components/features/coherence/CoherencePanel'
import { LoreDetailFloat as LoreDetailCard } from '@/components/features/lore/LorePanel'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'

// A split-view-sized card: wide enough for the left feed + right detail, opening right-of-center but freely
// draggable/resizable (persisted per key). Resize ceiling is 80% of the viewport (see `cap`).
const box = (offset = 0): Box => {
  const width = Math.min(1080, Math.round(window.innerWidth * 0.72))
  const height = Math.min(760, Math.round(window.innerHeight * 0.8))
  return { left: Math.max(8, window.innerWidth - width - 12 - offset), top: 44 + offset, width, height }
}
/** Resize ceiling — up to ~92% of the viewport (a near-full workspace surface). Spread onto each FloatWindow. */
const cap = (): { maxWidth: number; maxHeight: number } => ({
  maxWidth: Math.round(window.innerWidth * 0.92),
  maxHeight: Math.round(window.innerHeight * 0.92)
})

/** The opened thread's detail — one global float; opening a thread anywhere sets `selectedThreadId`. */
export function ThreadDetailFloat(): JSX.Element | null {
  const threads = useWorkspace((s) => s.threads)
  const selectedId = useWorkspace((s) => s.selectedThreadId)
  const focus = useWorkspace((s) => s.threadFocus) // the scene it was opened FROM → pre-select that beat
  const select = useWorkspace((s) => s.setSelectedThread)
  const [preview, setPreview] = useState<{ path: string; title: string } | null>(null)
  const selected = threads?.find((t) => t.id === selectedId) ?? null

  if (!selected) return null
  return (
    <>
      <FloatWindow {...cap()} region="threadDetailFloat" persistKey="thread-detail" accent="var(--thread)" onEscape={() => select(null)} initial={() => box()}>
        <ThreadDetail thread={selected} onScene={setPreview} onClose={() => select(null)} focus={focus} />
      </FloatWindow>
      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </>
  )
}

/** The opened coherence finding's detail — one global float (keyed by `selectedFindingId`), so clicking a
 *  cell/row anywhere pops the same verify-first card without leaving the table. */
export function CoherenceDetailFloat(): JSX.Element | null {
  const findings = useWorkspace((s) => s.coherence)
  const selectedId = useWorkspace((s) => s.selectedFindingId)
  const select = useWorkspace((s) => s.setSelectedFinding)
  const selectThread = useWorkspace((s) => s.setSelectedThread)
  const [preview, setPreview] = useState<{ path: string; title: string } | null>(null)
  const selected = findings?.find((f) => f.id === selectedId) ?? null
  if (!selected) return null
  return (
    <>
      <FloatWindow {...cap()} region="coherenceDetailFloat" persistKey="coherence-detail" accent="var(--flag)" onEscape={() => select(null)} initial={() => box(72)}>
        {selected.entityId ? (
          // A character finding → show ALL of that character's findings (a cell with 2 shows both).
          (<CoherenceDetail entityId={selected.entityId} onScene={setPreview} onInspectThread={(id) => selectThread(id)} onClose={() => select(null)} />)
        ) : (
          // A thread-verdict finding (no entity) → the single card.
          (<CoherenceReview finding={selected} onScene={setPreview} onInspectThread={(id) => selectThread(id)} />)
        )}
      </FloatWindow>
      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </>
  );
}

/** The opened entity (item/faction) journey — one global float, keyed by `selectedEntityId`. */
export function EntityDetailFloat(): JSX.Element | null {
  const tracks = useWorkspace((s) => s.entityTracks)
  const arcs = useWorkspace((s) => s.entityArcs)
  const selectedId = useWorkspace((s) => s.selectedEntityId)
  const focus = useWorkspace((s) => s.entityFocus) // the scene it was opened FROM → pre-open/highlight
  const select = useWorkspace((s) => s.setSelectedEntity)
  const track = tracks?.find((t) => t.id === selectedId) ?? null
  if (!track) return null
  const arc = arcs?.find((a) => a.entityId === selectedId) ?? null
  return (
    <FloatWindow {...cap()} region="entityDetailFloat" persistKey="entity-detail" accent="var(--lore)" onEscape={() => select(null)} initial={() => box(54)}>
      <EntityDetail track={track} arc={arc} onClose={() => select(null)} focus={focus} />
    </FloatWindow>
  )
}

/** The opened character arc's detail — one global float (arc is keyed by `entityId`). */
export function ArcDetailFloat(): JSX.Element | null {
  const arcs = useWorkspace((s) => s.characterArc)
  const selectedId = useWorkspace((s) => s.selectedArcId)
  const focus = useWorkspace((s) => s.arcChapter) // the scene/window the arc was opened FROM (deep-link highlight)
  const select = useWorkspace((s) => s.setSelectedArc)
  const selected = arcs?.find((a) => a.entityId === selectedId) ?? null
  if (!selected) return null
  return (
    <FloatWindow {...cap()} region="arcDetailFloat" persistKey="arc-detail" accent="var(--character)" onEscape={() => select(null)} initial={() => box(36)}>
      <ArcDetail arc={selected} onClose={() => select(null)} focus={focus} />
    </FloatWindow>
  )
}

/** The opened lore topic's reveal-progression detail — one global float (keyed by `selectedLoreId`), so a Lore-rail
 *  row OR a scene inspector's Lore section opens the same sheet. Resolves the topic + its authored page like LorePanel. */
export function LoreDetailFloat(): JSX.Element | null {
  const selectedId = useWorkspace((s) => s.selectedLoreId)
  const select = useWorkspace((s) => s.setSelectedLore)
  const topics = useWorkspace((s) => s.loreView?.topics)
  const worldPages = useWorkspace((s) => s.worldPages)
  const [preview, setPreview] = useState<{ path: string; title: string } | null>(null)
  const topic = topics?.find((t) => t.loreId === selectedId) ?? null
  if (!topic) return null
  const nn = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const lore = worldPages.filter((p) => p.kind === 'lore')
  const page = lore.find((p) => p.id === topic.loreId) ?? lore.find((p) => nn(p.name) === nn(topic.label)) ?? null
  return (
    <>
      <LoreDetailCard topic={topic} page={page ? { path: page.path, name: page.name, kind: page.kind } : null} onClose={() => select(null)} onScene={setPreview} />
      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </>
  )
}
