export const toggleProjectCollapse = (collapsedProjectIds: ReadonlySet<string>, projectId: string): Set<string> => {
  const next = new Set(collapsedProjectIds)
  if (next.has(projectId)) next.delete(projectId)
  else next.add(projectId)
  return next
}

export const isProjectExpanded = (
  activeProjectId: string | null,
  projectId: string,
  collapsedProjectIds: ReadonlySet<string>
): boolean => activeProjectId === projectId && !collapsedProjectIds.has(projectId)
