import { BrowserWindow } from "electron"
import { Context, Effect, Layer } from "effect"
import type { SessionEvent } from "../../shared/contracts"
import { IpcChannels } from "../../shared/contracts"

export class WindowBus extends Context.Service<WindowBus, {
  readonly emit: (event: SessionEvent) => Effect.Effect<void>
}>()("WindowBus") {}

export const WindowBusLive = Layer.succeed(WindowBus)({
  emit: Effect.fn("WindowBus.emit")(function*(event: SessionEvent) {
    yield* Effect.sync(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IpcChannels.sessionEvent, event)
      }
    })
  })
})
