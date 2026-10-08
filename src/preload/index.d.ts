import type { ZeroIptvApi } from './index'

declare global {
  interface Window {
    api: ZeroIptvApi
  }
}

export {}
