import { Effect } from "effect"
import { AppError } from "./AppError"

export class PiSessionLifecycleGate {
  private closed = false

  ensureAvailable(operation: string): Effect.Effect<void, AppError> {
    return this.closed
      ? Effect.fail(AppError.make({ operation, message: "Pi Desktop is shutting down" }))
      : Effect.void
  }

  close(): void {
    this.closed = true
  }
}

export const releaseInactiveEntriesExcept = async <T>(
  entries: Map<string, T>,
  keepKey: string,
  shouldRetain: (entry: T) => boolean,
  release: (entry: T) => Promise<void>
): Promise<void> => {
  const releases: Array<Promise<void>> = []
  for (const [key, entry] of entries) {
    if (key === keepKey || shouldRetain(entry)) continue
    entries.delete(key)
    releases.push(Promise.resolve().then(() => release(entry)))
  }
  const results = await Promise.allSettled(releases)
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to release inactive Pi sessions: ${failures.map(String).join("; ")}`)
  }
}

interface SessionResources {
  readonly disposeInteraction: () => void
  readonly unsubscribe: () => void
  readonly disposeRuntime: () => Promise<void>
  readonly disposeSession: () => void
}

/** Ensures host-owned cleanup cannot prevent the Pi runtime from being disposed. */
export const releaseSessionResources = async (resources: SessionResources): Promise<void> => {
  const failures: unknown[] = []
  try {
    resources.disposeInteraction()
  } catch (cause) {
    failures.push(cause)
  }
  try {
    resources.unsubscribe()
  } catch (cause) {
    failures.push(cause)
  }
  try {
    await resources.disposeRuntime()
  } catch (cause) {
    failures.push(cause)
    try {
      resources.disposeSession()
    } catch (fallbackCause) {
      failures.push(fallbackCause)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to release Pi session resources: ${failures.map(String).join("; ")}`)
  }
}

export const releaseAllEntries = async <T>(
  entries: Map<string, T>,
  release: (entry: T) => Promise<void>
): Promise<void> => {
  const active = [...entries.values()]
  entries.clear()
  const results = await Promise.allSettled(active.map((entry) => Promise.resolve().then(() => release(entry))))
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to dispose Pi sessions: ${failures.map(String).join("; ")}`)
  }
}
