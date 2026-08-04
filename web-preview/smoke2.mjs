import { chromium } from 'playwright'

const URL = process.argv[2] || 'http://localhost:4399/'
const OUT = process.argv[3]
const rails = ['threads', 'timeline', 'cast', 'coherence', 'corkboard']

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message).slice(0, 400)))

await page.goto(URL, { waitUntil: 'networkidle' }).catch((e) => errors.push('goto: ' + e.message))
await page.waitForTimeout(3500)

const mounted = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? -1)
const state = await page.evaluate(() => {
  const s = globalThis.__ws?.getState?.()
  return s ? { workspace: s.workspace, project: s.project?.name, scenes: s.scenes?.length, threads: s.threads?.length, characterArc: s.characterArc?.length, entityTracks: s.entityTracks?.length, coherence: s.coherence?.length, worldPages: s.worldPages?.length, loreTopics: s.loreView?.topics?.length } : null
})
console.log('ROOT_CHILDREN ' + mounted)
console.log('HYDRATED_STATE ' + JSON.stringify(state))
console.log('ERRORS ' + errors.length)
for (const e of errors.slice(0, 25)) console.log('  ' + e)

await page.screenshot({ path: OUT + '/00-boot.png' }).catch(() => {})
if (mounted > 0 && state) {
  for (const r of rails) {
    await page.evaluate((w) => globalThis.__ws?.getState?.().setWorkspace(w), r).catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/rail-${r}.png` }).catch(() => {})
  }
}
await browser.close()
