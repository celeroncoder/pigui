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
    releases.push(release(entry))
  }
  await Promise.allSettled(releases)
}
