/**
 * Throwaway perf bench for the Timeline canvas (DEV only).
 *
 * Injects N synthetic scene nodes straight into a React Flow canvas — no files, no
 * dragging — so we can feel where the DOM-based renderer falls over (see the scale
 * study in internal/timeline-design.md). Reuses the REAL SceneNode (NODE_TYPES from
 * TimelinePanel) so the numbers reflect production rendering. Delete once the scale
 * strategy (collapse / boards / LOD) is settled.
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NODE_TYPES } from '@/components/features/timeline/TimelinePanel'
import { cn } from '@/lib/utils'

const PHASES = ['draft', 'developing', 'canon', 'archived']
const COUNTS = [500, 2000, 5000, 10000]
const COL_W = 260
const ROW_H = 130

/** A square-ish grid of synthetic scene nodes (occupies real space so culling is exercised). */
function makeNodes(n: number): Node[] {
  const cols = Math.ceil(Math.sqrt(n))
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    type: 'scene',
    position: { x: (i % cols) * COL_W, y: Math.floor(i / cols) * ROW_H },
    data: {
      title: `Scene ${i}`,
      subPath: `bench · row ${Math.floor(i / cols)}`,
      phase: PHASES[i % PHASES.length],
      missing: false
    }
  }))
}

/** Chain each node to the next — n-1 edges, to gauge edge-render cost alongside nodes. */
function makeEdges(n: number): Edge[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
    id: `be${i}`,
    source: `b${i}`,
    target: `b${i + 1}`,
    markerEnd: { type: MarkerType.ArrowClosed }
  }))
}

/** Rolling FPS readout (rAF sampled every 500ms) — the "is it janking" signal. */
function FpsMeter(): JSX.Element {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let raf = 0
    let frames = 0
    let last = performance.now()
    const loop = (t: number): void => {
      frames++
      if (t - last >= 500) {
        setFps(Math.round((frames * 1000) / (t - last)))
        frames = 0
        last = t
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const tone = fps >= 50 ? 'text-ok' : fps >= 30 ? 'text-warn' : 'text-flag'
  return <span className={cn('font-mono tabular-nums', tone)}>{fps} fps</span>
}

function Btn({
  active,
  onClick,
  children
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded border px-2 py-0.5 text-[11px] transition-colors',
        active ? 'border-thread bg-thread/15 text-foreground' : 'border-border text-muted-foreground hover:bg-panel-soft'
      )}
    >
      {children}
    </button>
  )
}

function BenchCanvas(): JSX.Element {
  const { t } = useTranslation('timeline')
  const [count, setCount] = useState(2000)
  const [withEdges, setWithEdges] = useState(false)
  const [cull, setCull] = useState(true)
  const { fitView } = useReactFlow()

  const seedNodes = useMemo(() => makeNodes(count), [count])
  const seedEdges = useMemo(() => (withEdges ? makeEdges(count) : []), [count, withEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState(seedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(seedEdges)
  useEffect(() => setNodes(seedNodes), [seedNodes, setNodes])
  useEffect(() => setEdges(seedEdges), [seedEdges, setEdges])
  // Re-fit after a count change so "all visible" (the worst case) is what you see.
  useEffect(() => {
    const t = setTimeout(() => void fitView({ duration: 200 }), 60)
    return () => clearTimeout(t)
  }, [count, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onlyRenderVisibleElements={cull}
      minZoom={0.02}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} color="var(--border)" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable bgColor="var(--panel)" nodeColor="var(--faint)" nodeStrokeColor="var(--border)" />
      <Panel
        position="top-left"
        className="flex flex-col gap-2 rounded-lg border border-border bg-panel/95 p-2.5 text-[11px] shadow-xl"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('bench.enter')}</span>
          <FpsMeter />
        </div>
        <div className="flex items-center gap-1">
          {COUNTS.map((c) => (
            <Btn key={c} active={count === c} onClick={() => setCount(c)}>
              {c >= 1000 ? `${c / 1000}k` : c}
            </Btn>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Btn active={cull} onClick={() => setCull((v) => !v)}>
            {t(cull ? 'bench.cullingOn' : 'bench.cullingOff')}
          </Btn>
          <Btn active={withEdges} onClick={() => setWithEdges((v) => !v)}>
            {t(withEdges ? 'bench.edgesOn' : 'bench.edgesOff')}
          </Btn>
          <Btn onClick={() => void fitView({ duration: 200 })}>{t('bench.fit')}</Btn>
        </div>
        <div className="text-faint">
          {t('bench.count', { nodes: nodes.length.toLocaleString(), edges: edges.length.toLocaleString() })}
        </div>
        <div className="max-w-44 text-[10px] leading-snug text-faint">
          {t('bench.hint')}
        </div>
      </Panel>
    </ReactFlow>
  )
}

export { BenchCanvas }
