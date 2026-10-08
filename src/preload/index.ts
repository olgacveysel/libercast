import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEventName, type IpcEvents, type IpcRequest, type IpcResponse } from '@shared/ipc'

/**
 * The renderer gets exactly one object: `invoke` limited to declared channels
 * plus a typed event subscription. No node, no fs, no ipcRenderer itself.
 */
const api = {
  invoke<C extends IpcChannel>(channel: C, payload?: IpcRequest<C>): Promise<IpcResponse<C>> {
    if (!IPC_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>
  },

  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
    if (!IPC_EVENTS.includes(event)) return () => undefined
    const wrapped = (_e: Electron.IpcRendererEvent, payload: IpcEvents[E]): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },

  platform: process.platform
}

export type ZeroIptvApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Only reachable if contextIsolation is turned off, which this app never does.
  ;(globalThis as unknown as { api: ZeroIptvApi }).api = api
}
