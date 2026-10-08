import type { IpcChannel, IpcEventName, IpcEvents, IpcRequest, IpcResponse } from '@shared/ipc'

/** Thin typed wrapper so components never touch `window.api` directly. */
export function invoke<C extends IpcChannel>(channel: C, payload?: IpcRequest<C>): Promise<IpcResponse<C>> {
  return window.api.invoke(channel, payload as IpcRequest<C>)
}

export function subscribe<E extends IpcEventName>(
  event: E,
  listener: (payload: IpcEvents[E]) => void
): () => void {
  return window.api.on(event, listener)
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // Electron prefixes rejections from ipcMain.handle with this noise.
    return error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
  }
  return String(error)
}
