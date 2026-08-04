/**
 * Writing Sprint Timer — the sample NVS extension (a deliberate throwaway that proves the seam).
 *
 * This is everything a third-party extension is: a plain out-of-process program speaking newline-JSON
 * over stdio. It NEVER touches the disk or the database — when it wants project data it asks the HOST
 * over the pipe (`call`), and the host only answers methods covered by the capabilities this extension's
 * manifest declared and was granted (here: read:scenes/1). No SDK required — any language that can read
 * lines from stdin can be an NVS extension.
 *
 * Protocol (one JSON object per line):
 *   host → ext : {type:"hello", engineApi, granted[], work}    then  {type:"start", seconds}
 *                {type:"ping"}                                        {type:"stop"}
 *   ext → host : {type:"ready"}  {type:"pong"}
 *                {type:"call", id, method, args}   → host replies {type:"result", id, data} | {type:"error", id, message}
 *                {type:"event", payload}           (live UI line — the countdown)
 *                {type:"done", payload}            (final result; exit 0 after)
 */
const readline = require('node:readline')

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

let nextCallId = 1
const pending = new Map()
/** Ask the host to run an engine method on our behalf (only granted capabilities are answered). */
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = nextCallId++
    pending.set(id, { resolve, reject })
    out({ type: 'call', id, method, args })
  })
}

async function countWords() {
  const scenes = await call('listScenes', {})
  let words = 0
  for (const s of scenes) {
    const doc = await call('readScene', { path: s.path })
    words += (doc.body.match(/\S+/g) || []).length
  }
  return { scenes: scenes.length, words }
}

let timer = null
async function sprint(seconds) {
  const before = await countWords()
  out({ type: 'event', payload: { kind: 'started', seconds, wordsAtStart: before.words } })
  let remaining = seconds
  timer = setInterval(async () => {
    remaining -= 1
    if (remaining > 0) {
      out({ type: 'event', payload: { kind: 'tick', remaining } })
      return
    }
    clearInterval(timer)
    const after = await countWords()
    out({ type: 'event', payload: { kind: 'alarm', message: '🔔 Sprint over!' } })
    out({ type: 'done', payload: { wordsAtStart: before.words, wordsAtEnd: after.words, wordsWritten: after.words - before.words, scenes: after.scenes } })
    process.exit(0)
  }, 1000)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'hello') out({ type: 'ready' })
  else if (msg.type === 'ping') out({ type: 'pong' })
  else if (msg.type === 'start') void sprint(msg.seconds ?? 20)
  else if (msg.type === 'stop') process.exit(0)
  else if (msg.type === 'result') pending.get(msg.id)?.resolve(msg.data), pending.delete(msg.id)
  else if (msg.type === 'error') pending.get(msg.id)?.reject(new Error(msg.message)), pending.delete(msg.id)
})
