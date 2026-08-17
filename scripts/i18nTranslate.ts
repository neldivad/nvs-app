/**
 * Build-time i18n translation — fills the zh/ja (and any future) catalogs from the English source using an LLM,
 * so UI strings are authored once (in config/i18n/en/*.json) and never hand-translated.
 *
 *   npm run i18n:translate                 # reads OPENROUTER_API_KEY from env or .env.local
 *   I18N_MODEL=anthropic/claude-opus-4.1 npm run i18n:translate   # override the model
 *
 * • Content-addressed: each English leaf is hashed; only NEW or CHANGED strings are sent — re-runs are near-free.
 * • Non-destructive: existing translations (incl. hand-authored ones) are seeded into the cache and kept.
 * • Format-safe: interpolation ({{bytes}}), slash-commands (/agent), bracket tokens ([00:01:23]), inline code,
 *   markdown **bold**, and product/format terms (NVS, .nvs, frontmatter, id) are kept verbatim by the prompt.
 *
 * Add a language: append it to TARGETS below, then register the namespace(s) in config/i18n/index.ts.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const I18N_DIR = resolve('src/renderer/config/i18n')
const EN_DIR = join(I18N_DIR, 'en')
const CACHE_PATH = join(I18N_DIR, '.translation-cache.json')
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.I18N_MODEL || 'openai/gpt-5.6-luna'
const BATCH = 40 // strings per model call

/** locale code → the language name the model translates into. */
const TARGETS: Record<string, string> = {
  zh: 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)'
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
type Leaves = Record<string, string>

/** Load KEY=VALUE pairs from .env.local (gitignored) so the key doesn't have to be exported. */
function loadEnvLocal(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

/** Flatten a catalog to `path -> string` (only string leaves; array indices become numeric path segments). */
function flatten(node: Json, prefix = '', out: Leaves = {}): Leaves {
  if (typeof node === 'string') out[prefix] = node
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

/** Rebuild a nested catalog (objects + arrays) from `path -> string`, following the English structure. */
function unflatten(leaves: Leaves): Json {
  const root: Json = {}
  for (const [path, val] of Object.entries(leaves)) {
    const parts = path.split('.')
    let cur: any = root
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i]
      if (i === parts.length - 1) { cur[key] = val; continue }
      if (cur[key] == null) cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {}
      cur = cur[key]
    }
  }
  return root
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

const SYSTEM = (lang: string): string =>
  `You are a professional software UI localizer. Translate the VALUES of the given JSON object from English into ${lang}. ` +
  `Return ONLY a JSON object with the SAME keys and the translated values — no prose, no markdown code fences.\n` +
  `Keep these VERBATIM (never translate): interpolation placeholders like {{bytes}}; slash-commands like /agent; ` +
  `bracketed tokens like [00:01:23 → 00:01:27]; inline code; and product/format terms (NVS, .nvs, frontmatter, Markdown, JSON, id). ` +
  `Preserve markdown emphasis exactly: **bold** stays **bold** and *italic* stays *italic* around the translated words. ` +
  `Preserve tag placeholders EXACTLY — numbered like <1>…</1> or named like <hl>…</hl>, <email>…</email> — keep the tag names/numbers and angle brackets; translate only the text between the tags. ` +
  `Match a concise, friendly UI tone.`

function extractJson(text: string): string {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b < 0) throw new Error(`no JSON object in model reply: ${text.slice(0, 200)}`)
  return text.slice(a, b + 1)
}

async function translateBatch(key: string, batch: Leaves, lang: string): Promise<Leaves> {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'NVS i18n translate'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM(lang) },
        { role: 'user', content: JSON.stringify(batch, null, 2) }
      ]
    })
  })
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`)
  const data: any = await resp.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  return JSON.parse(extractJson(text)) as Leaves
}

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY || loadEnvLocal().OPENROUTER_API_KEY
  if (!key) {
    console.error('No OPENROUTER_API_KEY (checked env + .env.local).')
    process.exit(1)
  }
  console.log(`model: ${MODEL}`)
  const cache: Record<string, Record<string, string>> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}
  const namespaces = readdirSync(EN_DIR).filter((f) => f.endsWith('.json'))

  for (const [locale, langName] of Object.entries(TARGETS)) {
    cache[locale] ??= {}
    const dir = join(I18N_DIR, locale)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    for (const file of namespaces) {
      const en = flatten(JSON.parse(readFileSync(join(EN_DIR, file), 'utf8')))
      const outPath = join(dir, file)

      // Seed the cache from any EXISTING translation (hand-authored or prior run) so we never re-translate it.
      if (existsSync(outPath)) {
        const prev = flatten(JSON.parse(readFileSync(outPath, 'utf8')))
        for (const [path, enStr] of Object.entries(en)) if (prev[path]) cache[locale][hash(enStr)] ??= prev[path]
      }

      // Which English strings still need a translation for this locale?
      const todo: Leaves = {}
      for (const [path, enStr] of Object.entries(en)) if (!cache[locale][hash(enStr)]) todo[path] = enStr
      const paths = Object.keys(todo)
      if (paths.length) {
        console.log(`  ${locale}/${file}: translating ${paths.length} string(s)…`)
        for (let i = 0; i < paths.length; i += BATCH) {
          const slice = Object.fromEntries(paths.slice(i, i + BATCH).map((p) => [p, todo[p]]))
          const out = await translateBatch(key, slice, langName)
          for (const [p, enStr] of Object.entries(slice)) if (out[p]) cache[locale][hash(enStr)] = out[p]
        }
      } else {
        console.log(`  ${locale}/${file}: up to date`)
      }

      // Rebuild the locale catalog from the English structure, filling each key from the cache (fallback: English).
      const filled: Leaves = {}
      for (const [path, enStr] of Object.entries(en)) filled[path] = cache[locale][hash(enStr)] ?? enStr
      writeFileSync(outPath, JSON.stringify(unflatten(filled), null, 2) + '\n')
    }
  }

  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n')
  console.log('i18n: catalogs updated. Register any new namespaces in config/i18n/index.ts.')
}

void main()
