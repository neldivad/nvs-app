/// <reference types="vite/client" />
import type { NvsApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload bridge; the only path from UI to engine. */
    nvs: NvsApi
  }
}

export {}
