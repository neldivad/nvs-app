/**
 * Tier-A spike — a browser stand-in for the Electron `window.nvs` bridge, backed entirely by the static
 * snapshot.json (baked by bake.ts). READ methods answer from the snapshot; event subscriptions no-op; every
 * write/dialog/agent/capture method is an async no-op so the read-only rails render without the engine.
 *
 * The snapshot's `reads` keys MATCH window.nvs method names, so most methods are a one-line lookup.
 */
type Snapshot = { meta: unknown; reads: Record<string, unknown>; docs: Record<string, unknown> }

export function makeShim(snap: Snapshot): Record<string, unknown> {
  const reads = snap.reads
  const meta = snap.meta as { root?: string } | null

  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined
        const p = prop

        // Event subscriptions — `onXxx(cb) => unsubscribe`. The push channel has no browser source, so the
        // callback is never invoked; return a no-op unsubscribe so mount effects don't throw.
        if (p.startsWith('on') && p.length > 2 && p[2] === p[2].toUpperCase()) return () => () => {}

        switch (p) {
          case 'ping':
            return async () => ({ version: 'web-preview', platform: 'web' })
          case 'bootOpenWork':
            return async () => meta?.root ?? '/demo' // triggers the store's openWork on mount
          case 'openWork':
            return async () => snap.meta // store checks truthiness, then pulls the reads below
          case 'readScene':
            return async (path: string) => snap.docs[path] ?? { path, frontmatter: {}, body: '' }
          case 'listIngestSessions':
            return async () => ({ sessions: [], current: null }) // store destructures {sessions,current}
          // Runtime status reads (freshness / AI wiring) — no engine in the browser, so report a clean idle state.
          case 'aiConnections':
            return async () => ({ connections: [], activeId: null })
          case 'coherenceStatus':
            return async () => [] // ConsoleDock does cohRows.filter(...)
          case 'timelineStatus':
            return async () => ({ stale: false, cycle: [] })
        }

        // Baked list/read reductions (listScenes, timelineGraph, listThreads, …) — return the snapshot value.
        if (p in reads) return async () => reads[p]

        // Everything else — writes, file dialogs, agent/chat, captures, storage, extensions, window controls.
        // Shape-aware empty defaults so an un-gated read the store/components consume doesn't crash on
        // undefined.filter: list* → [], read*/get* → {}, else a bare async no-op.
        return async () => {
          if (import.meta.env.DEV) console.warn(`[web-preview] no-op window.nvs.${p}`)
          if (p.startsWith('list')) return []
          if (p.startsWith('read') || p.startsWith('get')) return {}
          return undefined
        }
      }
    }
  ) as Record<string, unknown>
}
