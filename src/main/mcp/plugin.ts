/**
 * Generates a Claude Desktop PLUGIN (.zip) that registers NVS's headless MCP server — the one-click alternative to
 * hand-editing `claude_desktop_config.json` (most users have no idea what that file is, which is the whole reason
 * this exists). The user picks a save location, then drops the .zip into Claude Desktop → Plugins → Upload local plugin.
 *
 * VERIFIED against Claude Desktop 2026-07-21: the upload accepts **.zip / .plugin only** (a folder is rejected),
 * there's no trust prompt, and the bundled skills surface in-app (e.g. `/nvs-sandbox`, `/nvs-graphics`).
 *
 * Layout inside the zip (the Claude plugin spec — a single top-level folder, as tested):
 *   nvs/.claude-plugin/plugin.json   the manifest (name, version, description)
 *   nvs/.mcp.json                    the local stdio MCP server (mcpServers)
 *   nvs/skills/<name>/…              every skill folder under resources/plugin-skills (nvs-sandbox + the job skills)
 *
 * TWO HALVES, DIFFERENT HOMES:
 *  - The command/args in `.mcp.json` are BAKED IN at generate time because they're install-specific (this Electron
 *    binary + this app's mcp.cjs + this user's `--work`) — which is exactly why this can't be a static download
 *    from GitHub. This half is private + generated per install.
 *  - The SKILLS are install-INDEPENDENT files under resources/plugin-skills/ — the public, inspectable half. No
 *    skill is special-cased in code; each is just a `<name>/SKILL.md` folder there (nvs-sandbox is the foundation
 *    every job skill points back to).
 */
import AdmZip from 'adm-zip'
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import * as engine from '@engine/index'

/** File-based plugin skills — packaged → extraResources/plugin-skills; dev → resources/plugin-skills. Each
 *  `<name>/SKILL.md` ships as `nvs/skills/<name>/SKILL.md`, so a new skill is added by dropping a folder. No skill
 *  is hardcoded here — `nvs-sandbox` (the foundation) + the job skills are each just a `<name>/` folder there. */
function pluginSkillsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'plugin-skills') : join(app.getAppPath(), 'resources', 'plugin-skills')
}

/** Where this build's headless entry lives (packaged → extraResources; dev → the esbuild output). */
function headlessScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'headless', 'mcp.cjs') : join(app.getAppPath(), 'out', 'headless', 'mcp.cjs')
}

/**
 * Write the plugin zip to `outFile`. Bakes in this install's Electron binary + headless script, and the currently
 * open work as the default `--work` (omitted when no project is open — the agent can still call `openWork`).
 */
export function buildClaudePlugin(outFile: string): { ok: boolean; file?: string; error?: string } {
  const script = headlessScript()
  if (!existsSync(script)) {
    return { ok: false, error: 'The headless server isn’t built yet — run `npm run mcp:build` in the NVS repo (shipped builds include it).' }
  }
  try {
    const work = engine.currentProject()?.root
    const manifest = {
      name: 'nvs',
      displayName: 'Novel Visual Studio',
      version: app.getVersion() || '0.1.0',
      description: 'Drive Novel Visual Studio from Claude — read a dialogue-driven project’s analysis (threads, cast, coherence findings, plot-holes) or build it from markdown.',
      author: { name: 'Novel Visual Studio' }
    }
    // ISOLATION (the agent never touches the author's live app — see internal/render-sandbox.md): there is no
    // live-handoff, so no `--live`. `--work` is the project the headless engine reads; the agent opens its OWN
    // hidden sandbox for anything needing a window. `--launch-entry` is how that sandbox boots in dev (execPath is
    // electron → needs the app main); packaged, execPath IS the app so it's omitted. The zip carries no secret.
    const mcp = {
      mcpServers: {
        nvs: {
          command: process.execPath,
          args: [script, ...(work ? ['--work', work] : []), ...(app.isPackaged ? [] : ['--launch-entry', join(app.getAppPath(), 'out', 'main', 'index.js')])],
          env: { ELECTRON_RUN_AS_NODE: '1' }
        }
      }
    }
    const zip = new AdmZip()
    zip.addFile('nvs/.claude-plugin/plugin.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    zip.addFile('nvs/.mcp.json', Buffer.from(JSON.stringify(mcp, null, 2)))
    // Every file-based skill under resources/plugin-skills/<name>/ — nvs-sandbox + nvs-query / nvs-plan /
    // nvs-graphics / nvs-transcribe. A valid skill is a folder with a SKILL.md; ship the WHOLE folder (scripts,
    // templates, assets — not just the .md), preserving each file's path under nvs/skills/<name>/, intact.
    const skillsDir = pluginSkillsDir()
    if (existsSync(skillsDir)) {
      const addDir = (absDir: string, zipPrefix: string): void => {
        for (const entry of readdirSync(absDir)) {
          const abs = join(absDir, entry)
          const zipPath = `${zipPrefix}/${entry}`
          if (statSync(abs).isDirectory()) addDir(abs, zipPath)
          else zip.addFile(zipPath, readFileSync(abs))
        }
      }
      for (const name of readdirSync(skillsDir)) {
        const dir = join(skillsDir, name)
        if (statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'))) addDir(dir, `nvs/skills/${name}`)
      }
    }
    zip.writeZip(outFile)
    return { ok: true, file: outFile }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
