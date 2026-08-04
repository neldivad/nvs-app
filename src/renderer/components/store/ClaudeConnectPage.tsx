/**
 * ClaudeConnectPage — the "Claude" Store tab: how to use your novel FROM Claude. Deliberately NOT a developer
 * page. The whole surface is three human steps — download the plugin, add it to Claude, type /nvs — carried by
 * real screenshots of Claude's own install flow (assets/claude/*.png). Everything technical (Claude Code, the
 * live-app connection, hand-written config) is folded into one "Advanced" disclosure at the bottom, because the
 * 99% path is the button. Paths come from mcpHeadlessInfo (correct for this install: dev vs packaged).
 */
import { useEffect, useState, type JSX } from 'react'
import { Copy, Check, TriangleAlert, Download, Camera, Sparkles, Lock, ChevronRight } from 'lucide-react'
import type { McpHeadlessInfo } from '@shared/ipc'
import stepUpload from '@/assets/claude/step-upload.png'
import stepPickZip from '@/assets/claude/step-pick-zip.png'
import stepInstalled from '@/assets/claude/step-installed.png'

/** Shows a REDACTED command (screenshot-safe: no live token, home shown as ~) but copies the REAL working one. */
function Copyable({ display, copy }: { display: string; copy: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-stretch gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-panel/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">{display}</pre>
      <button
        onClick={() => void navigator.clipboard.writeText(copy).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) })}
        className="flex shrink-0 items-center gap-1 self-start rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
      >
        {copied ? <><Check className="size-3 text-ok" /> Copied</> : <><Copy className="size-3" /> Copy</>}
      </button>
    </div>
  )
}

/** One numbered step: big number, headline, body, and an optional screenshot strip. */
function Step({ n, title, children, shots }: { n: number; title: string; children: React.ReactNode; shots?: Array<{ src: string; caption: string }> }): JSX.Element {
  return (
    <section className="flex gap-4">
      <div className="flex shrink-0 flex-col items-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-thread/15 text-sm font-semibold text-thread">{n}</span>
        <div className="mt-2 w-px flex-1 bg-border/60" />
      </div>
      <div className="min-w-0 flex-1 pb-8">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-muted-foreground">{children}</div>
        {shots && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {shots.map((s) => (
              <figure key={s.src} className="min-w-0">
                {/* Uniform box: the source shots are hand-captured at different ratios (1.32 / 1.38 / 1.57), and the
                    old `object-cover` never engaged because no height was set — so each rendered at its own height.
                    A fixed 3:2 frame + `object-contain` normalizes them without CROPPING (these are instructional
                    shots — a cover-crop could cut the very menu item being pointed at). */}
                <img
                  src={s.src}
                  alt={s.caption}
                  className="aspect-3/2 w-full rounded-lg border border-border bg-canvas object-contain p-1"
                />
                <figcaption className="mt-1.5 text-[11px] text-faint">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function ClaudeConnectPage(): JSX.Element {
  const [info, setInfo] = useState<McpHeadlessInfo | null>(null)
  const [plugin, setPlugin] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; error?: string }>({ state: 'idle' })
  useEffect(() => { void window.nvs.mcpHeadlessInfo?.().then(setInfo).catch(() => setInfo(null)) }, [])

  // Always resolve to a state — an old preload (app launched before this build) has no generateClaudePlugin, and a
  // bare call would throw synchronously and strand the button on "Generating…" forever.
  const genPlugin = async (): Promise<void> => {
    setPlugin({ state: 'busy' })
    try {
      if (!window.nvs.generateClaudePlugin) throw new Error('Restart NVS to pick up this feature.')
      const r = await window.nvs.generateClaudePlugin()
      setPlugin(r.ok ? { state: 'done' } : { state: r.error === 'cancelled' ? 'idle' : 'error', error: r.error })
    } catch (e) {
      setPlugin({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const cmd = info?.command ?? '<electron>'
  const script = info?.script ?? '<out/headless/mcp.cjs>'
  // `nvs-live` (not `nvs`) so this can coexist with the plugin's headless `nvs` server without colliding.
  const liveCmd = info?.httpUrl ? `claude mcp add nvs-live --transport http "${info.httpUrl}"` : null
  const headlessCmd = `claude mcp add nvs -- env ELECTRON_RUN_AS_NODE=1 "${cmd}" "${script}" --work "<your project folder>" --live "${info?.liveConfig ?? ''}"`
  const desktopJson = JSON.stringify({ mcpServers: { nvs: { command: cmd, args: [script, '--work', '<your project folder>', '--live', info?.liveConfig ?? ''], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2)

  // REDACTED display (screenshot-safe): hide the live auth token + the home path. Copy still yields the real command.
  const home = info?.home ?? ''
  const redact = (s: string): string =>
    (home ? s.split(home).join('~') : s).replace(/key=[^"&\s]+/g, 'key=••••••••••••')

  return (
    <div className="mx-auto max-w-3xl">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-foreground">Talk to Claude about your novel</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          Add NVS to Claude once, and you can ask Claude anything about your story — what threads are still open,
          where the plot holes are, what happens in a scene. It reads the same analysis you see in the rails.
        </p>
      </div>

      <Step n={1} title="Get the plugin file">
        <p>One file, made for this computer. Save it somewhere you can find it — your Desktop is fine.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void genPlugin()}
            disabled={plugin.state === 'busy' || (info != null && !info.built)}
            className="inline-flex items-center gap-2 rounded-lg bg-thread px-4 py-2.5 text-[14px] font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Download className="size-4" /> {plugin.state === 'busy' ? 'Saving…' : 'Download the plugin'}
          </button>
          {plugin.state === 'done' && <span className="flex items-center gap-1.5 text-[13px] text-ok"><Check className="size-4" /> Saved — now do step 2.</span>}
          {plugin.state === 'error' && <span className="text-[13px] text-warn">{plugin.error}</span>}
        </div>
        {info && !info.built && (
          <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Not ready in this dev build — run <code className="font-medium">npm run mcp:build</code> once. (Shipped copies include it.)</span>
          </div>
        )}
      </Step>

      <Step
        n={2}
        title="Add it to Claude"
        shots={[
          { src: stepUpload, caption: 'Claude → Settings → Plugins → Add → Upload plugin' },
          { src: stepPickZip, caption: 'Pick the file you just saved, then Upload' }
        ]}
      >
        <p>
          In <b className="text-foreground/90">Claude Desktop</b>, open <b className="text-foreground/90">Settings → Plugins</b>,
          click <b className="text-foreground/90">Add → Upload plugin</b>, and choose the file. That's it — no accounts, no keys.
        </p>
      </Step>

      <Step
        n={3}
        title="Type /nvs and ask"
        shots={[{ src: stepInstalled, caption: 'Installed — Claude now has an /nvs skill' }]}
      >
        <p>In any Claude chat, start your message with <code className="rounded bg-panel-soft px-1 text-foreground/90">/nvs</code> and ask in plain words:</p>
        <ul className="space-y-1.5">
          {['/nvs read scene 3 and tell me what it sets up', '/nvs what plot holes did you find?', '/nvs take a screenshot of my timeline — does it look tangled?'].map((p) => (
            <li key={p} className="flex items-start gap-2">
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-thread" />
              <span className="text-foreground/85">{p}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 rounded-md border border-border bg-panel/40 px-3 py-2 text-[12px] text-muted-foreground">
          <Camera className="mt-0.5 size-3.5 shrink-0 text-thread" />
          <span>
            <b className="text-foreground/90">While NVS is open</b>, Claude follows whatever project you have on screen and can
            screenshot your rails. Close the app and it still answers — from the project you had open when you made the file.
          </span>
        </p>
        <p className="text-faint">Claude works from the analysis in your project folder — your writing never leaves this computer.</p>
      </Step>

      {/* Everything technical, out of the way. */}
      <details className="mt-2 rounded-xl border border-border bg-panel/30 p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Advanced — Claude Code, and letting Claude see your screen</summary>
        <div className="mt-4 space-y-6">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-foreground"><Camera className="size-4 text-thread" /> Connect Claude Code to the open app</div>
            <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
              The plugin above already does this for you — it detects the running app and hands off to it. This is the direct
              connection for <b className="text-foreground/90">Claude Code</b> users who'd rather not install the plugin:
            </p>
            {liveCmd
              ? <>
                  <Copyable display={redact(liveCmd)} copy={liveCmd} />
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warn"><Lock className="size-3 shrink-0" /> Copy it — don't screenshot or share it. That token lets any local process drive your open project.</p>
                </>
              : <p className="text-[12px] text-faint">Open a project first — then this command appears.</p>}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-foreground">Claude Code, without the app running</div>
            <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
              Same engine, no window — it can also build the analysis for a folder of markdown from scratch. The
              {' '}<code>--live</code> path is what lets it hand off to the app whenever that's running.
            </p>
            <Copyable display={redact(headlessCmd)} copy={headlessCmd} />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-foreground">Claude Desktop by hand</div>
            <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
              The plugin above does this for you. If you'd rather edit config yourself: <b>Settings → Developer → Edit Config</b>
              {' '}(the <b>Developer</b> tab — not <b>Connectors</b>, which is for cloud servers and can't reach your machine).
            </p>
            <Copyable display={redact(desktopJson)} copy={desktopJson} />
          </div>
          <p className="flex items-center gap-2 text-[11px] text-faint">
            <Sparkles className="size-3.5 text-lore/70" />
            {info?.toolCount ?? 31} engine tools · local connection, not a cloud service.
          </p>
        </div>
      </details>
    </div>
  )
}
