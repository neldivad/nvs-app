/**
 * Tool-calling eval harness — measures how reliably a model routes a natural request to the RIGHT tool call,
 * against the failure modes we kept hitting (find-folder, reformat-folder, "who speaks most", existence checks,
 * greeting-should-not-call-tools). Turns "it feels unreliable" into a success-rate number, and lets you compare
 * models + reasoning-on/off + tooling changes.
 *
 * It runs the REAL tool catalog + system prompt (from @shared/config/aiTools) against a live model, but MOCKS
 * tool execution with a canned fixture world — so it isolates the thing under test (the model's tool SELECTION
 * and args), needs no engine/Electron, and is deterministic on the tool side.
 *
 * Run:  OPENROUTER_API_KEY=sk-... EVAL_MODELS="openai/gpt-4o-mini,deepseek/deepseek-r1" npm run eval:tools
 *   (EVAL_MODELS is comma-separated OpenRouter ids; reasoning is auto-enabled per model that supports it.)
 */
import { z } from 'zod'
import { TOOL_CATALOG, IN_APP_TOOLS, SYSTEM_PROMPT } from '../src/shared/config/aiTools'
import { normLoose } from '../src/shared/textMatch'

const BASE = 'https://openrouter.ai/api/v1'
const KEY = process.env.OPENROUTER_API_KEY ?? ''
const MODELS = (process.env.EVAL_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// ── fixture world (what the mocked tools "know") ──────────────────────────────
const FOLDERS = [
  'Story Quest/2-liyue/1.2 Ganyu',
  'Story Quest/2-liyue/1.3 Hutao',
  'Story Quest/2-liyue/1.0 Xingqiu',
  'Story Quest/2-liyue/2.7 Yelan',
  'Story Quest/2-liyue/3.6 Baizhu', // a LATE-region folder — the truncation-false-negative case
  'Story Quest/1-mondstadt/1.0 Kaeya'
]
const CHARACTERS = ['Hu Tao', 'Ganyu', 'Xingqiu', 'Yelan', 'Baizhu', 'Kaeya']
const matchFolder = (q: string): string | null => {
  const nq = normLoose(q)
  return FOLDERS.find((f) => normLoose(f.split('/').pop()!).includes(nq) || nq.includes(normLoose(f.split('/').pop()!))) ?? null
}

// Canned tool results — mirror the SHAPE the real tools return (bounded envelopes, `partial`, etc.).
function mockTool(name: string, args: Record<string, unknown>): unknown {
  const q = String(args.query ?? args.folder ?? args.path ?? args.name ?? '')
  switch (name) {
    case 'search': {
      const nq = normLoose(q)
      const hits = [
        ...FOLDERS.filter((f) => normLoose(f).includes(nq)).map((f) => ({ kind: 'folder', ref: f, name: f.split('/').pop(), matchedOn: 'name', sceneCount: 3 })),
        ...CHARACTERS.filter((c) => normLoose(c).includes(nq)).map((c) => ({ kind: 'character', ref: `content/world/characters/${normLoose(c)}.md`, name: c, matchedOn: 'name' }))
      ].slice(0, 25)
      return { hits, total: hits.length, truncated: false }
    }
    case 'listStoryTree': // the LARGE-project shape: partial + redirect (tests "absence ≠ doesn't exist")
      return { folders: FOLDERS.slice(0, 3), totalFolders: FOLDERS.length, totalScenes: 18, partial: true, note: 'PARTIAL — use search to locate a folder; never conclude absence from this list.' }
    case 'queuePageEdit': {
      if (args.folder) { const f = matchFolder(String(args.folder)); return f ? { ok: true, queued: 3, taskIds: ['t1', 't2', 't3'] } : { error: `no folder matching "${args.folder}"`, } }
      return { ok: true, taskId: 't1' }
    }
    case 'createPage': return { ok: true, path: `content/world/characters/${normLoose(q)}.md` }
    case 'listCast': return CHARACTERS.map((c, i) => ({ name: c, scenes: 20 - i }))
    case 'listThreads': return [{ threadId: 'th1', title: 'The Wangsheng contract', status: 'open' }]
    case 'listCoherenceFindings': return [{ entityId: 'hu-tao', trait: 'age', kind: 'drift', severity: 'low' }]
    case 'currentProject': return { root: '/fixture', id: 'genshin', scenes: 18 }
    case 'projectInfo': return { domain: 'fiction', medium: 'game', title: 'Genshin Story Quests' }
    default: return { ok: true } // any other read → benign stub; the eval scores tool CHOICE, not deep execution
  }
}

// ── tasks: prompt → predicate over the recorded tool calls + final text ────────
type Call = { name: string; args: Record<string, unknown> }
interface Task { id: string; prompt: string; check: (calls: Call[], text: string) => { pass: boolean; why: string } }
const has = (calls: Call[], name: string): Call | undefined => calls.find((c) => c.name === name)
const folderResolves = (c: Call | undefined, want: string): boolean => !!c && !!matchFolder(String(c.args.folder ?? '')) && normLoose(String(c.args.folder ?? '')).includes(normLoose(want))

const TASKS: Task[] = [
  { id: 'find-folder-simple', prompt: 'reformat every scene in the Hutao folder', check: (c) => ({ pass: folderResolves(has(c, 'queuePageEdit'), 'hutao') && !has(c, 'queryDb'), why: 'queuePageEdit(folder~hutao), no queryDb' }) },
  { id: 'find-folder-late', prompt: 'queue a reformat for 3.6 Baizhu', check: (c) => ({ pass: folderResolves(has(c, 'queuePageEdit'), 'baizhu'), why: 'resolves a LATE-region folder, no false "absent"' }) },
  { id: 'no-queryDb-for-find', prompt: 'find the Ganyu folder for me', check: (c) => ({ pass: (!!has(c, 'search') || !!has(c, 'queuePageEdit')) && !has(c, 'queryDb'), why: 'search/queuePageEdit, NOT queryDb' }) },
  { id: 'existence-absent', prompt: 'is there a folder for Xiangling?', check: (c, t) => ({ pass: !!has(c, 'search') && /\bno\b|not|doesn|isn|couldn/i.test(t), why: 'search first, then answers no (not from a dump)' }) },
  { id: 'cast', prompt: 'who speaks the most in this story?', check: (c) => ({ pass: !!has(c, 'listCast'), why: 'listCast' }) },
  { id: 'threads', prompt: "what plot threads are still open?", check: (c) => ({ pass: !!has(c, 'listThreads') || !!has(c, 'listCoherenceFindings'), why: 'listThreads' }) },
  { id: 'coherence', prompt: 'are there any plot holes or contradictions?', check: (c) => ({ pass: !!has(c, 'listCoherenceFindings'), why: 'listCoherenceFindings' }) },
  { id: 'create-page', prompt: 'make a character page for Yelan', check: (c) => ({ pass: !!has(c, 'createPage') && !has(c, 'queuePageEdit'), why: 'createPage, not queuePageEdit' }) },
  { id: 'greeting-no-tools', prompt: 'hey! how are you today?', check: (c) => ({ pass: c.length === 0, why: 'NO tool calls on a greeting' }) }
]

// ── model capability (reasoning) — one /models fetch, memoized ─────────────────
let capsCache: Map<string, Set<string>> | null = null
async function supportsReasoning(model: string): Promise<boolean> {
  if (!capsCache) {
    capsCache = new Map()
    try {
      const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } })
      const j = (await r.json()) as { data?: { id: string; supported_parameters?: string[] }[] }
      for (const m of j.data ?? []) capsCache.set(m.id, new Set(m.supported_parameters ?? []))
    } catch { /* leave empty */ }
  }
  return capsCache.get(model)?.has('reasoning') ?? false
}

const OA_TOOLS = IN_APP_TOOLS.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: z.toJSONSchema(z.object(t.input)) } }))

// ── run one task against one model (mocked tool loop) ──────────────────────────
async function runTask(model: string, task: Task, reasoning: boolean): Promise<{ calls: Call[]; text: string; error?: string }> {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: task.prompt }]
  const calls: Call[] = []
  let text = ''
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: OA_TOOLS, tool_choice: 'auto', ...(reasoning ? { reasoning: { effort: 'medium' } } : {}) })
    })
    if (!res.ok) return { calls, text, error: `${res.status}: ${(await res.text()).slice(0, 160)}` }
    const j = (await res.json()) as { choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] }
    const msg = j.choices?.[0]?.message
    if (!msg) return { calls, text, error: 'no message' }
    text += msg.content ?? ''
    const tcs = msg.tool_calls ?? []
    if (!tcs.length) break
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: tcs })
    for (const tc of tcs) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* ignore */ }
      calls.push({ name: tc.function.name, args })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(mockTool(tc.function.name, args)) })
    }
  }
  return { calls, text }
}

async function main(): Promise<void> {
  if (!KEY || !MODELS.length) {
    console.log('Set OPENROUTER_API_KEY and EVAL_MODELS (comma-separated OpenRouter model ids), e.g.:')
    console.log('  OPENROUTER_API_KEY=sk-... EVAL_MODELS="openai/gpt-4o-mini,deepseek/deepseek-r1" npm run eval')
    console.log(`\n${TOOL_CATALOG.length} tools in catalog · ${TASKS.length} eval tasks defined.`)
    process.exit(0)
  }
  for (const model of MODELS) {
    const reasoning = await supportsReasoning(model)
    console.log(`\n=== ${model}${reasoning ? '  (reasoning: medium)' : '  (no reasoning)'} ===`)
    let pass = 0
    for (const task of TASKS) {
      const { calls, text, error } = await runTask(model, task, reasoning)
      if (error) { console.log(`  ✗ ${task.id.padEnd(22)} ERROR ${error}`); continue }
      const r = task.check(calls, text)
      if (r.pass) pass++
      const seq = calls.map((c) => c.name).join('→') || '(no calls)'
      console.log(`  ${r.pass ? '✓' : '✗'} ${task.id.padEnd(22)} ${String(calls.length).padStart(2)} calls  [${seq}]${r.pass ? '' : `  — want: ${r.why}`}`)
    }
    console.log(`  ── ${pass}/${TASKS.length} (${Math.round((pass / TASKS.length) * 100)}%)`)
  }
}

void main()
