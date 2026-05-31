/// <reference types="vite/client" />
import type { AssayApi } from '../shared/types'

declare global {
  interface Window {
    api: AssayApi
  }
}
