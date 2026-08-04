/**
 * Renderer watchdog — the CORE safety net so a runaway renderer (an infinite render/effect loop, a pathological
 * graph layout, a memory balloon) can RECOVER instead of pegging the CPU and thrashing/OOM-killing the machine.
 * It doesn't prevent the loop — it stops one from taking the whole computer down:
 *   • 'unresponsive'        — a synchronous CPU surge blocks the renderer THREAD. The MAIN process is still alive,
 *                             so we can offer Wait / Reload (reload drops the wedged action; saved files are safe).
 *   • 'render-process-gone' — the renderer already crashed / was OOM-killed → reload to a live window instead of a
 *                             dead one, with a crash-loop guard so a load-time crash can't reload forever.
 *   • memory ceiling        — a leak that grows WITHOUT pegging the thread never fires 'unresponsive'; sample the
 *                             renderer's working set and, past a hard ceiling, reload before the OS has to.
 * Thresholds are env-tunable (NVS_MEM_SOFT_MB / NVS_MEM_HARD_MB / NVS_MEM_SAMPLE_MS). Normal NVS renderers sit at
 * a few hundred MB, so the GB-scale defaults only ever trip on a genuine runaway.
 */
import { app, dialog, type BrowserWindow } from 'electron'

const SOFT_MB = Number(process.env.NVS_MEM_SOFT_MB) || 3072 // log a warning past here (early smoke)
const HARD_MB = Number(process.env.NVS_MEM_HARD_MB) || 6144 // recover (reload) past here, before the OS thrashes
const SAMPLE_MS = Number(process.env.NVS_MEM_SAMPLE_MS) || 5000

/** The renderer process's working-set size in MB (0 if it can't be read). */
function rendererMemMB(win: BrowserWindow): number {
  try {
    const pid = win.webContents.getOSProcessId()
    const m = app.getAppMetrics().find((x) => x.pid === pid)
    return m ? Math.round((m.memory?.workingSetSize ?? 0) / 1024) : 0 // workingSetSize is in KB
  } catch {
    return 0
  }
}

export function attachRendererWatchdog(win: BrowserWindow, opts: { interactive: boolean }): void {
  const wc = win.webContents

  // A synchronous surge (an infinite loop in a render/effect/layout) wedges the renderer thread. The main process
  // is unaffected, so a modal here reaches the user while the renderer is stuck.
  wc.on('unresponsive', () => {
    console.error('[nvs] renderer UNRESPONSIVE — a heavy operation may be looping')
    if (!opts.interactive || win.isDestroyed()) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep waiting', 'Reload'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'Novel Visual Studio stopped responding',
      message: 'A heavy operation seems to be looping.',
      detail: 'Keep waiting, or reload the window to recover. Reloading discards the in-progress action — your saved files on disk are safe.'
    })
    if (choice === 1 && !win.isDestroyed()) wc.reloadIgnoringCache()
  })
  wc.on('responsive', () => console.warn('[nvs] renderer responsive again'))

  // Crash / OOM recovery, with a loop guard: reload, but if the window keeps dying on load, stop and surface it.
  let crashes = 0
  wc.on('did-finish-load', () => (crashes = 0)) // a clean load clears the streak
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[nvs] renderer gone: ${details.reason} (exit ${details.exitCode})`)
    if (win.isDestroyed() || details.reason === 'clean-exit') return
    if (++crashes > 3) {
      if (opts.interactive) dialog.showErrorBox('Novel Visual Studio', 'The window keeps crashing on load. Please restart the app.')
      return
    }
    wc.reload()
  })

  // Memory ceiling: catch a balloon that never blocks the thread. Soft = warn once; hard = reload to reclaim.
  let softWarned = false
  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(timer)
      return
    }
    const mb = rendererMemMB(win)
    if (mb > HARD_MB) {
      console.error(`[nvs] renderer memory ${mb}MB over hard ceiling ${HARD_MB}MB — reloading to recover before the OS thrashes`)
      wc.reloadIgnoringCache()
    } else if (mb > SOFT_MB && !softWarned) {
      softWarned = true
      console.error(`[nvs] renderer memory ${mb}MB over soft ceiling ${SOFT_MB}MB — possible leak/runaway`)
    } else if (mb < SOFT_MB) {
      softWarned = false
    }
  }, SAMPLE_MS)
  win.on('closed', () => clearInterval(timer))
}
