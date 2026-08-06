import type { ModelAvailability, ModelOption } from "../../shared/contracts"

interface PiModel {
  readonly provider: string
  readonly id: string
  readonly name: string
}

export interface ModelAvailabilityRuntime {
  readonly getAvailableSnapshot: () => ReadonlyArray<PiModel>
  readonly getAvailable: () => Promise<ReadonlyArray<PiModel>>
}

const optionsFrom = (models: ReadonlyArray<PiModel>): ReadonlyArray<ModelOption> =>
  models.map((model) => ({ provider: model.provider, id: model.id, name: model.name }))

/** Keeps Pi's local model snapshot available while provider health checks run. */
export class ProviderAvailability {
  private availability: ModelAvailability
  private refreshInFlight: Promise<void> | undefined
  private onUpdate: ((availability: ModelAvailability) => void) | undefined

  constructor(private readonly runtime: ModelAvailabilityRuntime) {
    this.availability = { models: optionsFrom(runtime.getAvailableSnapshot()), status: "pending" }
  }

  get current(): ModelAvailability {
    return this.availability
  }

  setOnUpdate(listener: (availability: ModelAvailability) => void) {
    this.onUpdate = listener
  }

  refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = this.load()
    this.refreshInFlight = refresh
    void refresh.finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = undefined
    })
    return refresh
  }

  private async load() {
    try {
      this.update({ models: optionsFrom(await this.runtime.getAvailable()), status: "ready" })
    } catch {
      // A failed health check must not erase the cached Pi model snapshot.
      this.update({ ...this.availability, status: "error" })
    }
  }

  private update(next: ModelAvailability) {
    this.availability = next
    this.onUpdate?.(next)
  }
}
