import { describe, expect, it } from "vitest"
import { createProjectSelectionGate } from "./projectSelection"

const deferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("project selection gate", () => {
  it("waits for the latest selection before allowing a new session", async () => {
    const gate = createProjectSelectionGate()
    const first = deferred()
    const latest = deferred()
    gate.track(first.promise)

    let waited = false
    const waiting = gate.wait().then(() => {
      waited = true
    })
    gate.track(latest.promise)
    first.resolve()
    await Promise.resolve()
    expect(waited).toBe(false)

    latest.resolve()
    await waiting
    expect(waited).toBe(true)
  })

  it("does not let a stale selection clear the latest pending selection", async () => {
    const gate = createProjectSelectionGate()
    const first = deferred()
    const latest = deferred()
    gate.track(first.promise)
    gate.track(latest.promise)

    first.resolve()
    await Promise.resolve()

    let waited = false
    const waiting = gate.wait().then(() => {
      waited = true
    })
    await Promise.resolve()
    expect(waited).toBe(false)

    latest.resolve()
    await waiting
  })
})
