import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Main process: Electron + the Node-side engine (better-sqlite3, @anthropic-ai/sdk, chokidar).
    // externalizeDepsPlugin keeps native/Node deps out of the bundle so they load from node_modules.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@engine': resolve('src/engine'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    // The contextBridge contract. Externalize Electron; everything else can bundle.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    // The React SPA. No Node here — it talks to the engine only through the preload bridge.
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
