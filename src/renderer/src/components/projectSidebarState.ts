export type ProjectExpansionState = ReadonlyMap<string, boolean>

export const isProjectExpanded = (
  activeProjectId: string | null,
  projectId: string,
  expansionState: ProjectExpansionState
): boolean => expansionState.get(projectId) ?? activeProjectId === projectId

export const toggleProjectExpansion = (
  expansionState: ProjectExpansionState,
  activeProjectId: string | null,
  projectId: string
): Map<string, boolean> => {
  const next = new Map(expansionState)
  next.set(projectId, !isProjectExpanded(activeProjectId, projectId, expansionState))
  return next
}

export const preserveProjectExpansionOnSelection = (
  expansionState: ProjectExpansionState,
  activeProjectId: string | null,
  nextProjectId: string
): Map<string, boolean> => {
  const next = new Map(expansionState)
  if (activeProjectId && !next.has(activeProjectId)) next.set(activeProjectId, true)
  if (!next.has(nextProjectId)) next.set(nextProjectId, true)
  return next
}
