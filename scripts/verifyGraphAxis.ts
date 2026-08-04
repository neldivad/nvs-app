/**
 * Headless verify for timeline slice 1 — the leads_to DAG ancestry gate in rollups.storySoFar. Runs under
 * Electron-as-node (better-sqlite3 ABI) since it opens a real DB. Seeds a Baccano-shaped merge fixture and
 * asserts: merge sees BOTH branches; a branch scene does NOT see the parallel branch; unwired = linear fallback.
 *   npm run verify:graph
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/engine/data/db'
import { storySoFar, stampTimelineVersion, timelineStatus, pruneOrphans, sceneAncestryHash, activeAncestryHashes, backfillThreadAncestry } from '../src/engine/analysis/rollups'
import { writeTrees, readTrees, connectScenes, disconnectScenes, connectScenesBatch, createVariant } from '../src/engine/content/trees'
import { listThreads } from '../src/engine/data/queries'
import { tierInputHash } from '../src/engine/data/writeTier'

function makeWork(withLeadsTo: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'nvs-graph-'))
  mkdirSync(join(root, '.nvs'), { recursive: true })
  const db = openDb(join(root, '.nvs', 'nvs.db'))
  const lt = (t: string): string | null => (withLeadsTo ? JSON.stringify({ leads_to: t }) : null)
  db.prepare(`INSERT INTO works (work_id,title,type,lang,imported_at) VALUES ('w','W','novel','en','now')`).run()
  const u = db.prepare(`INSERT INTO narrative_units (unit_id,work_id,parent_id,type,title,sort_order,metadata_json) VALUES (?,?,?,?,?,?,?)`)
  const o = db.prepare(`INSERT INTO unit_order (unit_id,linear_pos) VALUES (?,?)`)
  const es = db.prepare(`INSERT INTO extracted_scenes (scene_id,work_id,summary,input_hash,created_at) VALUES (?,?,?,'h','now')`)
  const rows: Array<[string, string | null, string, string, number, string | null]> = [
    ['book', null, 'book', 'Book', 0, null],
    ['chA', 'book', 'chapter', 'Chapter A', 1, null],
    ['a1', 'chA', 'scene', 'A1', 2, lt('m1')],
    ['chB', 'book', 'chapter', 'Chapter B', 3, null],
    ['b1', 'chB', 'scene', 'B1', 4, lt('m1')],
    ['chM', 'book', 'chapter', 'Merge', 5, null],
    ['m1', 'chM', 'scene', 'Merge1', 6, null],
  ]
  let pos = 0
  for (const [id, parent, type, title, so, md] of rows) {
    u.run(id, 'w', parent, type, title, so, md)
    o.run(id, pos++)
  }
  es.run('a1', 'w', 'AAA'); es.run('b1', 'w', 'BBB'); es.run('m1', 'w', 'MMM')
  db.close()
  return root
}

const soFar = (root: string, s: string): string => storySoFar(root, s).blocks.map((b) => b.text).join(' ')
let fails = 0
const check = (name: string, cond: boolean): void => {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}`)
  if (!cond) fails++
}

const wired = makeWork(true)
check('merge scene sees branch A (AAA)', soFar(wired, 'm1').includes('AAA'))
check('merge scene sees branch B (BBB) — UNION', soFar(wired, 'm1').includes('BBB'))
check('branch scene b1 does NOT see parallel branch A (no false adjacency)', !soFar(wired, 'b1').includes('AAA'))

const linear = makeWork(false)
check('linear fallback: b1 DOES see the earlier chapter (unchanged)', soFar(linear, 'b1').includes('AAA'))

// stamp: the version is recorded + applied
const v = stampTimelineVersion(wired)
const db0 = openDb(join(wired, '.nvs', 'nvs.db'))
const versionRows = (db0.prepare('SELECT COUNT(*) c FROM timeline_versions').get() as { c: number }).c
db0.close()
check(`stampTimelineVersion returns an id (${v.slice(0, 8)}…) + records it`, !!v && versionRows > 0)

// ── slice 2: timelineStatus (staleness + cycle) ──
const stRoot = makeWork(true)
{
  const db = openDb(join(stRoot, '.nvs', 'nvs.db'))
  db.prepare(`INSERT INTO coherence_findings (finding_id, work_id, kind, created_at, timeline_version) VALUES ('f1','w','drift','now','OLDVER')`).run()
  db.close()
}
let st = timelineStatus(stRoot)
check('status: analysis stamped OLDVER is STALE vs the current graph', st.hasAnalysis && st.stale && st.ranVersion === 'OLDVER')
stampTimelineVersion(stRoot) // re-run → re-stamp to the current version
st = timelineStatus(stRoot)
check('status: after a run, ran == current → NOT stale', !st.stale && st.ranVersion === st.currentVersion)
{
  const db = openDb(join(stRoot, '.nvs', 'nvs.db'))
  db.prepare(`UPDATE narrative_units SET metadata_json = ? WHERE unit_id = 'a1'`).run(JSON.stringify({ leads_to: 'b1' })) // edit the graph
  db.close()
}
check('status: editing leads_to makes the analysis STALE (offer re-run)', timelineStatus(stRoot).stale)

// cycle: a leads_to loop is surfaced, not walked
const cycRoot = mkdtempSync(join(tmpdir(), 'nvs-cyc-'))
mkdirSync(join(cycRoot, '.nvs'), { recursive: true })
{
  const db = openDb(join(cycRoot, '.nvs', 'nvs.db'))
  db.prepare(`INSERT INTO works (work_id,title,type,lang,imported_at) VALUES ('w','W','novel','en','now')`).run()
  const u = db.prepare(`INSERT INTO narrative_units (unit_id,work_id,parent_id,type,title,sort_order,metadata_json) VALUES (?,?,?,?,?,?,?)`)
  u.run('x', 'w', null, 'scene', 'X', 0, JSON.stringify({ leads_to: 'y' }))
  u.run('y', 'w', null, 'scene', 'Y', 1, JSON.stringify({ leads_to: 'x' })) // x→y→x
  db.close()
}
check('status: a leads_to cycle is detected', timelineStatus(cycRoot).cycle !== null)

// ── R1 (seed + routes): the analysis reads the ACTIVE route's edges, not just frontmatter ──
// Four chapters A/B/D/M, scene per chapter, NO frontmatter leads_to → the SEED is empty; routes supply every edge.
function makeRouteWork(): string {
  const root = mkdtempSync(join(tmpdir(), 'nvs-route-'))
  mkdirSync(join(root, '.nvs'), { recursive: true })
  const db = openDb(join(root, '.nvs', 'nvs.db'))
  db.prepare(`INSERT INTO works (work_id,title,type,lang,imported_at) VALUES ('w','W','novel','en','now')`).run()
  const u = db.prepare(`INSERT INTO narrative_units (unit_id,work_id,parent_id,type,title,sort_order,metadata_json) VALUES (?,?,?,?,?,?,?)`)
  const o = db.prepare(`INSERT INTO unit_order (unit_id,linear_pos) VALUES (?,?)`)
  const es = db.prepare(`INSERT INTO extracted_scenes (scene_id,work_id,summary,input_hash,created_at) VALUES (?,?,?,'h','now')`)
  const rows: Array<[string, string | null, string, string, number]> = [
    ['book', null, 'book', 'Book', 0],
    ['chA', 'book', 'chapter', 'Chapter A', 1], ['a1', 'chA', 'scene', 'A1', 2],
    ['chB', 'book', 'chapter', 'Chapter B', 3], ['b1', 'chB', 'scene', 'B1', 4],
    ['chD', 'book', 'chapter', 'Prologue D', 5], ['d1', 'chD', 'scene', 'D1', 6],
    ['chM', 'book', 'chapter', 'Merge', 7], ['m1', 'chM', 'scene', 'Merge1', 8]
  ]
  let pos = 0
  for (const [id, parent, type, title, so] of rows) { u.run(id, 'w', parent, type, title, so, null); o.run(id, pos++) }
  es.run('a1', 'w', 'AAA'); es.run('b1', 'w', 'BBB'); es.run('d1', 'w', 'DDD'); es.run('m1', 'w', 'MMM')
  db.close()
  return root
}
// variantB = D merges into M (+A); variantC = same scenes, B merges into M, no D. Two TREE VARIANTS in trees.json;
// exclusion is now CONNECTIVITY (an unconnected scene isn't an ancestor) — no scope needed. Toggle which is active.
const setActive = (root: string, id: string): void =>
  writeTrees(root, {
    version: 1,
    activeId: id,
    variants: [
      { id: 'vb', name: 'variantB', adjacency: { a1: ['m1'], d1: ['m1'] } },
      { id: 'vc', name: 'variantC', adjacency: { b1: ['m1'] } }
    ]
  })

const routeRoot = makeRouteWork()
check('seed (no active route): m1 sees A, B, D (folder-order fallback, empty seed)', ['AAA', 'BBB', 'DDD'].every((x) => soFar(routeRoot, 'm1').includes(x)))
setActive(routeRoot, 'vb')
check('variantB active: m1 sees D (route-owned merge) + A', soFar(routeRoot, 'm1').includes('DDD') && soFar(routeRoot, 'm1').includes('AAA'))
check('variantB active: m1 does NOT see B (off this route)', !soFar(routeRoot, 'm1').includes('BBB'))
setActive(routeRoot, 'vc')
check('variantC active (SAME scenes): m1 sees B', soFar(routeRoot, 'm1').includes('BBB'))
check('variantC active: m1 does NOT see D or A (route-specific merge, frontmatter untouched)', !soFar(routeRoot, 'm1').includes('DDD') && !soFar(routeRoot, 'm1').includes('AAA'))
// stamp keys per route: variantB vs variantC produce different versions
setActive(routeRoot, 'vb'); const vB = stampTimelineVersion(routeRoot)
setActive(routeRoot, 'vc'); const vC = stampTimelineVersion(routeRoot)
check('stamp is per-route: variantB and variantC yield different timeline_versions', !!vB && !!vC && vB !== vC)

// ── T4 (ancestry-scoped staleness): a scene's tierInputHash folds in its ANCESTOR-SET under the active variant,
// so a structure change re-stales ONLY the scenes whose ancestry changed — not the whole story. ──
const t4Root = makeRouteWork()
setActive(t4Root, 'vb') // m1 ancestry = {a1, d1}
const hM_vb = tierInputHash(t4Root, 'scene', 'm1', null)
const hA_vb = tierInputHash(t4Root, 'scene', 'a1', null)
setActive(t4Root, 'vc') // m1 ancestry = {b1}; a1 is isolated (ancestry {} in BOTH)
const hM_vc = tierInputHash(t4Root, 'scene', 'm1', null)
const hA_vc = tierInputHash(t4Root, 'scene', 'a1', null)
check('T4: m1 RE-STALES when its ancestry changes (variantB {a1,d1} → variantC {b1})', hM_vb !== hM_vc)
check("T4: a1 does NOT re-stale — its ancestry {} is unchanged (ancestry-SCOPED, not whole-graph)", hA_vb === hA_vc)

// ── T5 (delete GC): pruneOrphans drops dead scene_ids from trees.json + GCs their analysis rows; live ones intact ──
const t5Root = makeRouteWork()
setActive(t5Root, 'vb') // adjacency { a1:[m1], d1:[m1] }
{
  const db = openDb(join(t5Root, '.nvs', 'nvs.db'))
  db.prepare(`INSERT INTO thread_events (event_id, work_id, thread_id, action, scene_id, created_at) VALUES ('e1','w','t','open','a1','now')`).run()
  db.prepare(`INSERT INTO thread_events (event_id, work_id, thread_id, action, scene_id, created_at) VALUES ('e2','w','t','open','d1','now')`).run()
  db.close()
}
pruneOrphans(t5Root, new Set(['b1', 'd1', 'm1'])) // a1 deleted (still on disk: b1, d1, m1)
{
  const db = openDb(join(t5Root, '.nvs', 'nvs.db'))
  const cnt = (sql: string): number => (db.prepare(sql).get() as { c: number }).c
  const a1Events = cnt(`SELECT COUNT(*) c FROM thread_events WHERE scene_id='a1'`)
  const d1Events = cnt(`SELECT COUNT(*) c FROM thread_events WHERE scene_id='d1'`)
  const a1Unit = cnt(`SELECT COUNT(*) c FROM narrative_units WHERE unit_id='a1'`)
  db.close()
  const vb = readTrees(t5Root).variants.find((v) => v.id === 'vb')!
  check('T5: deleted scene’s analysis rows GC’d (a1 thread_events)', a1Events === 0)
  check('T5: a live scene’s rows survive (d1 thread_events)', d1Events === 1)
  check('T5: deleted scene’s narrative_unit removed', a1Unit === 0)
  check('T5: trees.json drops a1→m1, keeps d1→m1 (live edges intact)', !vb.adjacency['a1'] && !!vb.adjacency['d1']?.includes('m1'))
}

// ── T6 (agent-read/write): connectScenes/disconnectScenes edit the ACTIVE variant's adjacency, cycle-guarded ──
const t6Root = makeRouteWork()
setActive(t6Root, 'vb') // { a1:[m1], d1:[m1] }
const adjVb = (): Record<string, string[]> => readTrees(t6Root).variants.filter((v) => v.id === 'vb')[0].adjacency
check('T6: connectScenes adds an edge to the active variant', connectScenes(t6Root, 'b1', 'm1').ok && (adjVb()['b1'] ?? []).includes('m1'))
check('T6: connectScenes refuses a self-link', !connectScenes(t6Root, 'a1', 'a1').ok)
check('T6: connectScenes refuses a cycle (m1→a1 when a1→m1 exists)', !connectScenes(t6Root, 'm1', 'a1').ok)
check('T6: connectScenes refuses a duplicate', !connectScenes(t6Root, 'a1', 'm1').ok)
check('T6: disconnectScenes removes the edge', disconnectScenes(t6Root, 'b1', 'm1').ok && !(adjVb()['b1'] ?? []).includes('m1'))

// ── T12: connectScenesBatch — wire many at once, skip bad edges, auto-place the mentioned scenes ──
const batch = connectScenesBatch(t6Root, [
  { from: 'a1', to: 'b1' }, // fresh
  { from: 'a1', to: 'm1' }, // already connected → skipped
  { from: 'a1', to: 'a1' }, // self-link → skipped
  { from: 'm1', to: 'a1' }  // cycle (a1→m1 exists) → skipped
], undefined, true, [])
const vbAfter = (): TreeVariant => readTrees(t6Root).variants.filter((v) => v.id === 'vb')[0]
check('T12: batch added only the valid edge (1 of 4)', batch.added === 1 && (vbAfter().adjacency['a1'] ?? []).includes('b1'))
check('T12: batch skipped self-link, duplicate, and cycle (3)', batch.skipped.length === 3)
check('T12: batch auto-placed the mentioned scenes on the canvas', (vbAfter().nodes ?? []).some((n) => n.kind === 'scene' && n.sceneId === 'b1'))

// ── T15: createVariant — a NEW timeline, blank or cloned; activate flag; cap enforced ──────────────────
const countVars = (): number => readTrees(t6Root).variants.length
const beforeN = countVars()
const blank = createVariant(t6Root, { name: 'Fresh', from: 'empty', activate: true })
check('T15: createVariant returns ok + id + activated', blank.ok && !!blank.id && blank.activated === true)
check('T15: the new variant is appended', countVars() === beforeN + 1)
check('T15: activate:true made it the active variant', readTrees(t6Root).activeId === blank.id)
const blankV = (): TreeVariant => readTrees(t6Root).variants.filter((v) => v.id === blank.id)[0]
check('T15: from:empty starts with a blank graph', Object.keys(blankV().adjacency).length === 0)
// give the active (blank) variant an edge, then clone it — the clone should carry that edge, without stealing focus.
connectScenesBatch(t6Root, [{ from: 'a1', to: 'b1' }], blank.id, false, [])
const cloned = createVariant(t6Root, { name: 'Clone', from: 'active', activate: false })
check('T15: from:active clones the active variant’s graph', (readTrees(t6Root).variants.filter((v) => v.id === cloned.id)[0].adjacency['a1'] ?? []).includes('b1'))
check('T15: activate:false leaves the active variant unchanged', cloned.ok && readTrees(t6Root).activeId === blank.id)
// cap: fill to MAX then expect a refusal
let capHit = false
for (let i = 0; i < 30; i++) { const r = createVariant(t6Root, {}); if (!r.ok) { capHit = true; break } }
check('T15: createVariant refuses past MAX_TIMELINE_VARIANTS', capHit)

// ── T11: per-variant canvas survives the write→read round-trip (migrateTrees must NOT strip nodes/collapsed) ──
const t11Root = mkdtempSync(join(tmpdir(), 'nvs-t11-'))
writeTrees(t11Root, {
  version: 1,
  activeId: 'v1',
  variants: [
    { id: 'v1', name: 'Timeline 1', adjacency: {}, nodes: [{ kind: 'scene', sceneId: 'a1', x: 10, y: 20 }], collapsed: ['liyue'] },
    { id: 'v2', name: 'Timeline 2', adjacency: {}, nodes: [{ kind: 'folder', folderRel: 'mond', x: 0, y: 0 }], collapsed: [] }
  ]
})
const rt = readTrees(t11Root)
const rv1 = rt.variants.find((v) => v.id === 'v1')!
const rv2 = rt.variants.find((v) => v.id === 'v2')!
check('T11: variant v1 canvas nodes survive reopen (per-variant, not project-wide)', rv1.nodes?.length === 1 && rv1.nodes[0].kind === 'scene')
check('T11: variant v1 collapsed set survives reopen', (rv1.collapsed ?? []).includes('liyue'))
check('T11: variant v2 has its OWN distinct canvas (a folder node, no collapse)', rv2.nodes?.[0].kind === 'folder' && (rv2.collapsed ?? []).length === 0)

// ── T14: per-variant thread analysis — rows keyed by ancestry coexist; reads filter to the active variant ──────
const t14Root = makeRouteWork() // scenes a1,b1,d1,m1; variant vb: {a1,d1}→m1 · variant vc: {b1}→m1 (m1 differs)
{
  const db = openDb(join(t14Root, '.nvs', 'nvs.db'))
  const scenes = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type='scene'`).all() as Array<{ id: string; metadata_json: string | null }>
  setActive(t14Root, 'vb'); const hVb = sceneAncestryHash(t14Root, scenes, 'm1')
  setActive(t14Root, 'vc'); const hVc = sceneAncestryHash(t14Root, scenes, 'm1')
  check('T14: m1 gets a DIFFERENT ancestry hash under vb vs vc', hVb !== hVc)

  // m1 analyzed under BOTH variants → two thread rows, distinct ancestry (the coexistence the clobber-fix enables).
  db.prepare(`INSERT INTO thread_events (event_id, work_id, thread_id, action, scene_id, created_at, ancestry_hash) VALUES ('m1:vb','w','t','open','m1','now',?)`).run(hVb)
  db.prepare(`INSERT INTO thread_events (event_id, work_id, thread_id, action, scene_id, created_at, ancestry_hash) VALUES ('m1:vc','w','t','open','m1','now',?)`).run(hVc)

  // Mirror the read shadow-view filter for the active variant: NULL passes, else must match the active ancestry.
  const visibleFor = (variantId: string): string[] => {
    setActive(t14Root, variantId)
    const active = activeAncestryHashes(t14Root, scenes)
    return (db.prepare(`SELECT event_id AS e, scene_id AS s, ancestry_hash AS h FROM thread_events`).all() as Array<{ e: string; s: string; h: string | null }>)
      .filter((r) => r.h == null || r.h === active.get(r.s))
      .map((r) => r.e)
  }
  check('T14: active vb shows ONLY vb’s m1 thread row', JSON.stringify(visibleFor('vb').filter((e) => e.startsWith('m1'))) === JSON.stringify(['m1:vb']))
  check('T14: switch to vc shows ONLY vc’s row (vb’s is retained, not clobbered)', JSON.stringify(visibleFor('vc').filter((e) => e.startsWith('m1'))) === JSON.stringify(['m1:vc']))
  check('T14: switch BACK to vb is a cache hit (row still there)', visibleFor('vb').includes('m1:vb'))

  // Write-partition: re-analyzing m1 under vb (scoped delete) must NOT wipe vc’s row.
  setActive(t14Root, 'vb'); const hVbNow = sceneAncestryHash(t14Root, scenes, 'm1')
  db.prepare('DELETE FROM thread_events WHERE scene_id = ? AND (ancestry_hash = ? OR ancestry_hash IS NULL)').run('m1', hVbNow)
  const afterVb = (db.prepare(`SELECT event_id AS e FROM thread_events WHERE scene_id='m1'`).all() as Array<{ e: string }>).map((r) => r.e)
  check('T14: scoped re-analysis under vb preserves vc’s thread row', afterVb.includes('m1:vc') && !afterVb.includes('m1:vb'))

  // The scoped read path itself must not throw — the shadow VIEW must expose rowid etc. (regression: the first
  // shadow view lacked rowid → `ORDER BY te.rowid` failed → EVERY scene analysis step failed instantly).
  let scopedReadOk = true
  try { listThreads(t14Root) } catch { scopedReadOk = false }
  check('T14: the scoped thread read (shadow view incl. rowid) does not throw', scopedReadOk)

  // Backfill: a legacy NULL row gets stamped with the active variant’s ancestry.
  db.prepare(`INSERT INTO thread_events (event_id, work_id, thread_id, action, scene_id, created_at, ancestry_hash) VALUES ('m1:legacy','w','t','open','m1','now',NULL)`).run()
  db.close()
  const stamped = backfillThreadAncestry(t14Root) // active = vb
  const db2 = openDb(join(t14Root, '.nvs', 'nvs.db'))
  const legacyHash = (db2.prepare(`SELECT ancestry_hash AS h FROM thread_events WHERE event_id='m1:legacy'`).get() as { h: string | null }).h
  db2.close()
  check('T14: backfill stamped the legacy NULL row with the active variant’s ancestry', stamped >= 1 && legacyHash === hVbNow)
}

for (const r of [wired, linear, stRoot, cycRoot, routeRoot, t4Root, t5Root, t6Root, t11Root, t14Root]) rmSync(r, { recursive: true, force: true })
console.log(fails ? `\n✗ ${fails} check(s) failed` : '\n✓ all checks passed')
process.exit(fails ? 1 : 0)
