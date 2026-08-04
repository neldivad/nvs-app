import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@engine': resolve('src/engine'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node'
  }
})
