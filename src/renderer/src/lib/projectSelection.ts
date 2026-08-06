export interface ProjectSelectionGate {
  readonly track: (selection: Promise<void>) => Promise<void>
  readonly wait: () => Promise<void>
}

/**
 * Keeps new-session commands behind the latest project selection. A stale
 * selection may finish after a newer one, so it must not clear the newer wait.
 */
export const createProjectSelectionGate = (): ProjectSelectionGate => {
  let pending: Promise<void> | null = null

  const track = (selection: Promise<void>) => {
    pending = selection
    void selection.then(
      () => {
        if (pending === selection) pending = null
      },
      () => {
        if (pending === selection) pending = null
      }
    )
    return selection
  }

  const wait = async () => {
    while (pending) {
      const selection = pending
      await selection
      if (pending === selection) return
    }
  }

  return { track, wait }
}
