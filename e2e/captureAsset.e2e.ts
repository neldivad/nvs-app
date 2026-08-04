import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'

/**
 * captureAsset e2e — the automated version of "eyeball a screenshot". It launches the REAL built app, opens the
 * bundled sample project, and drives the whole hidden-window capture path (create off-screen window → load
 * renderer → hydrate the project → DOM-to-PNG → teardown), then asserts the PNG is real and NON-BLANK.
 *
 * The blank check is the point: a never-shown window that failed to render would still return a valid,
 * correctly-sized PNG — just a flat/solid one. Eyeballing catches that; a per-shot assertion catches it at scale.
 *
 * captureAsset is reached through a gated main-process hook (globalThis.__nvsTest, attached only when NVS_E2E=1),
 * so the test drives the exact function the MCP tool calls — no MCP round-trip needed.
 */
const ROOT = join(__dirname, '..')
const SAMPLE = join(ROOT, 'resources', 'sample-project')

let app: ElectronApplication

test.beforeAll(async () => {
  app = await electron.launch({
    args: [ROOT, '--no-sandbox'], // launch via package.json "main"; --no-sandbox for containers/CI
    env: { ...process.env, NVS_E2E: '1' } // gate the test hook
  })
  await app.firstWindow() // wait until the main window exists
})

test.afterAll(async () => {
  await app?.close()
})

test('captureAsset returns a real, non-blank PNG of the open project', async () => {
  const result = await app.evaluate(async (_electronMod, sample) => {
    const hook = (globalThis as unknown as {
      __nvsTest?: {
        openWork: (p: string) => unknown
        captureAsset: (o: Record<string, unknown>) => Promise<{ image?: Electron.NativeImage; error?: string }>
      }
    }).__nvsTest
    if (!hook) return { error: '__nvsTest hook missing — NVS_E2E not honored by the built main?' }
    if (!hook.openWork(sample)) return { error: `openWork(${sample}) returned null — fixture is not a work?` }

    const r = await hook.captureAsset({ view: 'editor', theme: 'light', width: 1200, height: 800 })
    if (!r.image) return { error: r.error ?? 'captureAsset returned no image' }

    const { width, height } = r.image.getSize()
    const bytes = r.image.toPNG().length
    // Blank-detector: sample the BGRA bitmap sparsely; a rendered UI has real luminance spread, a solid frame ~0.
    const bmp = r.image.toBitmap()
    let min = 255
    let max = 0
    for (let i = 0; i < bmp.length; i += 4 * 1009) {
      const v = bmp[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
    return { width, height, bytes, spread: max - min }
  }, SAMPLE)

  expect(result.error, result.error).toBeUndefined()
  expect(result.width).toBeGreaterThan(100)
  expect(result.height).toBeGreaterThan(100)
  expect(result.bytes).toBeGreaterThan(2000) // a real PNG, not an empty stub
  expect(result.spread).toBeGreaterThan(15) // NOT a flat/blank frame — the assertion eyeballing can't scale
})
