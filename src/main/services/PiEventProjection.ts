const stringify = (value: unknown): string => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const recordValue = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : undefined

export const projectToolOutput = (value: unknown): string => {
  const record = recordValue(value)
  if (!record || !Array.isArray(record.content)) return stringify(value)
  const lines = record.content.flatMap((item) => {
    const block = recordValue(item)
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : []
  })
  return lines.length > 0 ? lines.join("\n") : ""
}
