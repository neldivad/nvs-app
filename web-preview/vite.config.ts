import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tier-A spike — build the EXISTING renderer (src/renderer) as a plain browser app over the static snapshot.
// Same alias/plugins as electron.vite.config.ts's renderer section, but rooted at web-preview/ with the shim entry.
// Run from repo root: npx vite build --config web-preview/vite.config.ts  (or `vite` for dev).
export default defineConfig({
  root: resolve('web-preview'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@shared': resolve('src/shared')
    }
  },
  server: { port: 4322 },
  build: { outDir: resolve('web-preview/dist-web'), emptyOutDir: true, chunkSizeWarningLimit: 4000, sourcemap: true }
})
