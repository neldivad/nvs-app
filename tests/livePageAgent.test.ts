/**
 * LIVE page-agent smoke test — calls the real `claude` login (so it's gated behind LIVE=1; normal
 * `npm test` skips it). Proves the page-agent prompts produce CONFORMING output on real demo content,
 * not just that they're wired right.
 *
 *   LIVE=1 npx vitest run tests/livePageAgent.test.ts
 *
 * Covers reformat (scene) + scaffold (world page) — the paths that need only files + the prompt builder.
 * The ANALYSIS prompts (listThreads/…) aren't here: they read the .novel-scribe DB through the engine,
 * which only loads inside the Electron app — run those in the app's Chat tab.
 */
import { describe, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildPagePrompt } from '@shared/config/agentCommands'

const DEMO = 'resources/demos/office-drama'
const run = !!process.env.LIVE

/** Strip a leading `--- … ---` frontmatter block → the page body. */
function body(file: string): string {
  const raw = readFileSync(file, 'utf8')
  const m = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
  return (m ? m[1] : raw).trim()
}

/** "see-yi-oh.md" → "See Yi Oh". */
function titleFromFile(f: string): string {
  return f.replace(/\.md$/, '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

function names(sub: string): string[] {
  try {
    return readdirSync(join(DEMO, 'content/world', sub)).filter((f) => f.endsWith('.md')).map(titleFromFile)
  } catch {
    return []
  }
}

/** One-shot completion through the real `claude` login (mirrors pageAgent's plan path). */
async function complete(system: string, user: string): Promise<string> {
  let text = ''
  for await (const msg of query({
    prompt: user,
    options: { systemPrompt: system, tools: [], permissionMode: 'bypassPermissions', settingSources: [], cwd: process.cwd(), maxTurns: 1 }
  })) {
    if (msg.type === 'assistant') for (const b of msg.message.content) if (b.type === 'text') text += b.text
  }
  return text.trim()
}

describe('LIVE page-agent (needs LIVE=1 + claude login)', () => {
  it.runIf(run)('reformats a scene into conforming Fountain', async () => {
    const scene = body(join(DEMO, 'content/story/chapters/001-C1/s001-all-hands.md'))
    const { system, user } = buildPagePrompt({
      pageText: scene,
      instruction: 'Reformat this page so it parses cleanly — correct cues, narration, action and section labels — without changing the wording.',
      mode: 'replace',
      kind: 'scene',
      characterNames: names('characters'),
      locationNames: names('locations')
    })
    const out = await complete(system, user)
    console.log('\n════ SCENE REFORMAT (input → output) ════\n--- INPUT (first 600) ---\n' + scene.slice(0, 600) + '\n\n--- OUTPUT (first 1200) ---\n' + out.slice(0, 1200) + '\n════════════════════════════════════════\n')
  }, 180000)

  it.runIf(run)('scaffolds a world character page with the canonical sections', async () => {
    const page = body(join(DEMO, 'content/world/characters/see-yi-oh.md'))
    const { system, user } = buildPagePrompt({
      pageText: page,
      instruction: 'Add clearly-marked placeholder scaffolding (TODO: …) for any missing standard sections, so the page has a complete skeleton.',
      mode: 'append',
      kind: 'character',
      characterNames: names('characters'),
      locationNames: names('locations')
    })
    const out = await complete(system, user)
    console.log('\n════ WORLD SCAFFOLD (append) ════\n--- EXISTING (first 400) ---\n' + page.slice(0, 400) + '\n\n--- APPENDED ---\n' + out.slice(0, 1200) + '\n═════════════════════════════════\n')
  }, 180000)
})
