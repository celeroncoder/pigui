import { describe, expect, it, vi } from "vitest"
import { ShutdownCoordinator } from "./ShutdownCoordinator"

const deferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("ShutdownCoordinator", () => {
  it("waits for session and runtime disposal before exiting", async () => {
    const sessions = deferred()
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({
      disposeSessions: async () => {
        order.push("sessions-start")
        await sessions.promise
        order.push("sessions-end")
      },
      disposeRuntime: async () => {
        order.push("runtime")
      },
      exit: (code) => order.push(`exit-${code}`),
      logError: vi.fn()
    })

    const shutdown = coordinator.shutdown("application-quit", 0)
    await Promise.resolve()
    expect(coordinator.isShuttingDown).toBe(true)
    expect(order).toEqual(["sessions-start"])

    sessions.resolve()
    await shutdown
    expect(order).toEqual(["sessions-start", "sessions-end", "runtime", "exit-0"])
  })

  it("runs one cleanup flight and preserves a later fatal exit code", async () => {
    const sessions = deferred()
    const disposeSessions = vi.fn(() => sessions.promise)
    const disposeRuntime = vi.fn(async () => undefined)
    const exit = vi.fn()
    const coordinator = new ShutdownCoordinator({ disposeSessions, disposeRuntime, exit, logError: vi.fn() })

    const normalQuit = coordinator.shutdown("application-quit", 0)
    const crash = coordinator.shutdown("renderer-crash", 1)
    expect(crash).toBe(normalQuit)

    sessions.resolve()
    await normalQuit
    expect(disposeSessions).toHaveBeenCalledOnce()
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it("logs session cleanup failures and still disposes the Effect runtime", async () => {
    const sessionFailure = new Error("session cleanup failed")
    const logError = vi.fn()
    const disposeRuntime = vi.fn(async () => undefined)
    const exit = vi.fn()
    const coordinator = new ShutdownCoordinator({
      disposeSessions: async () => Promise.reject(sessionFailure),
      disposeRuntime,
      exit,
      logError
    })

    await coordinator.shutdown("SIGTERM", 143)

    expect(logError).toHaveBeenCalledWith(
      "[pi-desktop] failed to dispose Pi sessions during SIGTERM",
      sessionFailure
    )
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(143)
  })

  it("logs runtime disposal failures and still exits", async () => {
    const runtimeFailure = new Error("runtime cleanup failed")
    const logError = vi.fn()
    const exit = vi.fn()
    const coordinator = new ShutdownCoordinator({
      disposeSessions: async () => undefined,
      disposeRuntime: async () => Promise.reject(runtimeFailure),
      exit,
      logError
    })

    await coordinator.shutdown("uncaught-exception", 1)

    expect(logError).toHaveBeenCalledWith(
      "[pi-desktop] failed to dispose the Effect runtime during uncaught-exception",
      runtimeFailure
    )
    expect(exit).toHaveBeenCalledWith(1)
  })
})
