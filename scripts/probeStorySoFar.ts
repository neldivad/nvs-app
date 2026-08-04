// Deterministic storySoFar probe — prints the working-set "story so far" block sizes for given scenes,
// WITHOUT any LLM call (it's computed from the DB tree + stored summaries). Used to measure the
// container-altitude effect (flat 120 chapters vs 12 volumes) on the scene-read prompt directly.
//
//   npm run probe:storysofar -- "<projectDir>" <sceneId> [<sceneId> ...]
import * as engine from '../src/engine/index'

const dir = process.argv[2]
const scenes = process.argv.slice(3)
if (!dir || scenes.length === 0) {
  console.error('usage: probeStorySoFar <projectDir> <sceneId...>')
  process.exit(2)
}
engine.openWork(dir)
for (const s of scenes) {
  const sofar = engine.storySoFar(s)
  const total = sofar.blocks.reduce((n, b) => n + b.title.length + b.text.length, 0)
  console.log(`\n${s}: ${sofar.blocks.length} blocks · ${total} chars · hotCutoff=${sofar.hotCutoffPos}`)
  for (const b of sofar.blocks) console.log(`   [${String(b.text.length).padStart(5)}] ${b.title}`)
}
