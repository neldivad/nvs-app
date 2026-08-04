import { defineConfig } from '@playwright/test'

/**
 * E2E config for the Electron app. We drive the real app via Playwright's `_electron` launcher (it uses the
 * app's OWN Electron/Chromium — no bundled-browser download), so there are no browser `projects` here.
 *
 * The app must be BUILT first (out/main, out/preload, out/renderer) — the `test:e2e` npm script runs
 * `npm run build` before this. On headless Linux/CI, wrap the run in `xvfb-run` (Electron needs a display).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000, // launching Electron + booting the app + a hidden-window render is genuinely slow
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one Electron instance at a time
  retries: 0,
  reporter: 'list'
})
