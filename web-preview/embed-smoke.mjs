import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:3644/preview'
const OUT = process.argv[3]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } })
const errors = []
page.on('pageerror', (e) => errors.push('page: ' + e.message.slice(0, 200)))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push('goto ' + e.message))
await page.waitForSelector('iframe', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(5500) // app boot inside the frame

const frame = page.frames().find((f) => f.url().includes('nvs-preview'))
let state = null
if (frame) {
  state = await frame.evaluate(() => {
    const s = globalThis.__ws?.getState?.()
    return s ? { workspace: s.workspace, scenes: s.scenes?.length, threads: s.threads?.length, characterArc: s.characterArc?.length } : null
  }).catch(() => null)
  await frame.evaluate(() => globalThis.__ws?.getState?.().setWorkspace('threads')).catch(() => {})
  await page.waitForTimeout(1600)
}
console.log('IFRAME_FOUND ' + !!frame)
console.log('APP_STATE ' + JSON.stringify(state))
console.log('ERRORS ' + errors.length)
errors.slice(0, 10).forEach((e) => console.log('  ' + e))
await page.screenshot({ path: OUT + '/embed-threads.png' })
await browser.close()
