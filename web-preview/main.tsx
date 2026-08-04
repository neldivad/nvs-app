/**
 * Tier-A spike web entry. Install the snapshot-backed window.nvs shim BEFORE the real renderer boots, then
 * hand off to the app's own entry (src/renderer/main.tsx via the '@' alias) — which mounts <App/> unchanged.
 */
import { makeShim } from './shim'

async function boot(): Promise<void> {
  const snap = await fetch('./snapshot.json').then((r) => r.json())
  ;(window as unknown as { nvs: unknown }).nvs = makeShim(snap)
  const { useWorkspace } = await import('@/stores/workspace')
  ;(window as unknown as { __ws: unknown }).__ws = useWorkspace // preview harness: jump to a rail
  await import('@/main') // the unmodified renderer entry — window.nvs is already shimmed
}

void boot()
