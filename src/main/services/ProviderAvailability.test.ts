import { describe, expect, it } from "vitest"
import { ProviderAvailability } from "./ProviderAvailability"

const deferred = <A,>() => {
  let resolve: (value: A) => void = () => undefined
  const promise = new Promise<A>((next) => { resolve = next })
  return { promise, resolve }
}

describe("ProviderAvailability", () => {
  it("returns Pi's cached models while its provider health check is pending", async () => {
    const health = deferred<ReadonlyArray<{ provider: string; id: string; name: string }>>()
    const availability = new ProviderAvailability({
      getAvailableSnapshot: () => [{ provider: "openai", id: "cached", name: "Cached model" }],
      getAvailable: () => health.promise
    })
    const updates: string[] = []
    availability.setOnUpdate((next) => updates.push(next.status))

    const refresh = availability.refresh()

    expect(availability.current).toEqual({
      models: [{ provider: "openai", id: "cached", name: "Cached model" }],
      status: "pending"
    })
    expect(updates).toEqual([])

    health.resolve([{ provider: "openai", id: "fresh", name: "Fresh model" }])
    await refresh

    expect(availability.current).toEqual({
      models: [{ provider: "openai", id: "fresh", name: "Fresh model" }],
      status: "ready"
    })
    expect(updates).toEqual(["ready"])
  })

  it("keeps cached models visible when a background health check fails", async () => {
    const availability = new ProviderAvailability({
      getAvailableSnapshot: () => [{ provider: "anthropic", id: "cached", name: "Cached model" }],
      getAvailable: async () => Promise.reject(new Error("provider offline"))
    })

    await availability.refresh()

    expect(availability.current).toEqual({
      models: [{ provider: "anthropic", id: "cached", name: "Cached model" }],
      status: "error"
    })
  })

  it("does not notify a released session after its health check settles", async () => {
    const health = deferred<ReadonlyArray<{ provider: string; id: string; name: string }>>()
    const availability = new ProviderAvailability({
      getAvailableSnapshot: () => [],
      getAvailable: () => health.promise
    })
    const updates: string[] = []
    availability.setOnUpdate((next) => updates.push(next.status))

    const refresh = availability.refresh()
    availability.dispose()
    health.resolve([{ provider: "openai", id: "fresh", name: "Fresh model" }])
    await refresh

    expect(updates).toEqual([])
  })
})
