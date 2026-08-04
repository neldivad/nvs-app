/**
 * guard/ — universal hang guards.
 *
 * Rule: any await on an EXTERNAL dependency (a subprocess, the network, another process's stream) must FAIL,
 * never hang — a wedged dependency should surface as a labeled, retryable step failure, not a stuck run. This
 * came from the plan-host hangs (the orphaned "arcs · c1" step that sat 30 minutes with no error): the warm
 * path got its watchdog in planSession; THIS is the importable version every other call-site uses.
 *
 * Guarantees:
 *   • The returned promise ALWAYS settles by the deadline — even if the wrapped work ignores its abort signal
 *     (hard Promise.race, not just cooperative cancellation).
 *   • The work receives an AbortController wired to the caller's signal + the deadline, so cooperative callees
 *     (fetch, the agent SDK's abortController option) stop doing work instead of leaking.
 *   • Timeouts throw `<label> timed out after Ns` — greppable in logs/telemetry.
 */
export interface GuardOpts {
  ms: number
  label: string
  signal?: AbortSignal // the caller's cancellation — wired through to the work's controller
}

export async function withTimeout<T>(work: (ac: AbortController) => Promise<T>, { ms, label, signal }: GuardOpts): Promise<T> {
  const ac = new AbortController()
  const onAbort = (): void => ac.abort()
  if (signal?.aborted) ac.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort() // cooperative stop for well-behaved callees…
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)) // …and a hard settle for wedged ones
    }, ms)
  })
  try {
    return await Promise.race([work(ac), deadline])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
