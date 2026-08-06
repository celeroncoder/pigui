export type ShutdownReason =
  | "application-quit"
  | "renderer-crash"
  | "uncaught-exception"
  | "unhandled-rejection"
  | NodeJS.Signals

interface ShutdownCoordinatorOptions {
  readonly disposeSessions: () => Promise<void>
  readonly disposeRuntime: () => Promise<void>
  readonly exit: (code: number) => void
  readonly logError: (message: string, cause: unknown) => void
}

/** Owns the single terminal cleanup flight for the Electron main process. */
export class ShutdownCoordinator {
  private shutdownPromise: Promise<void> | undefined
  private exitCode = 0

  constructor(private readonly options: ShutdownCoordinatorOptions) {}

  get isShuttingDown(): boolean {
    return this.shutdownPromise !== undefined
  }

  shutdown(reason: ShutdownReason, exitCode: number): Promise<void> {
    this.exitCode = Math.max(this.exitCode, exitCode)
    if (this.shutdownPromise) return this.shutdownPromise

    this.shutdownPromise = this.performShutdown(reason)
    return this.shutdownPromise
  }

  private async performShutdown(reason: ShutdownReason): Promise<void> {
    try {
      await this.options.disposeSessions()
    } catch (cause) {
      this.options.logError(`[pi-desktop] failed to dispose Pi sessions during ${reason}`, cause)
    }

    try {
      await this.options.disposeRuntime()
    } catch (cause) {
      this.options.logError(`[pi-desktop] failed to dispose the Effect runtime during ${reason}`, cause)
    }

    this.options.exit(this.exitCode)
  }
}
