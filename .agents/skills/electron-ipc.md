# Skill: electron-ipc

The renderer↔main seam. Get this right and the app stays secure and type-safe.

## The rule

The renderer is sandboxed: **no Node, no engine imports**. The only path to the engine is `window.nvs`,
exposed by the preload `contextBridge`. Three files move together and are derived from one contract so they
cannot drift:

```
src/shared/ipc.ts   NvsApi (methods) + CHANNELS (dotted names)  ← source of truth, no Node/DOM
src/preload/index.ts  builds `api: NvsApi` forwarding each method to ipcRenderer.invoke(CHANNELS.x)
src/main/index.ts     ipcMain.handle(CHANNELS.x, …) calling the engine
src/renderer/env.d.ts declares window.nvs: NvsApi   ← renderer gets full types
```

## Adding a capability (the only correct order)

1. **Contract first** — add the method to `NvsApi` and a channel to `CHANNELS` in `src/shared/ipc.ts`.
   Keep request/response small and structured-cloneable (no class instances, functions, or Node objects).
2. **Preload** — add one line forwarding it: `foo: (a) => ipcRenderer.invoke(CHANNELS.foo, a)`.
   Because `api` is typed `NvsApi`, a missing/renamed method fails to compile.
3. **Main handler** — `ipcMain.handle(CHANNELS.foo, (_e, a) => engine.foo(a))`. Do real work in `@engine/*`,
   not in the handler; the handler is glue + validation.
4. **Renderer** — call `await window.nvs.foo(a)`, ideally wrapped in a `lib/` hook.

## Conventions

- Channel names are `domain:verb` (`project:open`, `engine:questlog`). The `CHANNELS` map is
  `satisfies Record<keyof NvsApi, string>`, so every method must have a channel.
- All calls are `invoke`/`handle` (request/response). For push (file-watch, extraction progress) add an
  event channel and `webContents.send` + a `nvs.on*` subscription — keep these few and explicit.
- Validate untrusted input (paths, user strings) in the main handler with zod before touching the engine.
- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`. `sandbox: false` only because the
  preload needs `require` for the bridge — the renderer itself stays isolated.

## Don't

- Don't `ipcRenderer.invoke` from the renderer directly, and don't widen the bridge to expose arbitrary
  channels. Every capability is an explicit, typed method on `NvsApi`.
- Don't pass the engine's DB handle or any non-serializable object across the boundary.
