import type { SessionManager } from "@earendil-works/pi-coding-agent"
import type { SessionForkMetadata } from "../../shared/contracts"

export const sessionForkMetadataType = "pi-desktop-session-fork"

const metadataFromUnknown = (value: unknown): SessionForkMetadata | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  if (
    !("sourceSessionId" in value) || typeof value.sourceSessionId !== "string"
    || !("sourceSessionPath" in value) || typeof value.sourceSessionPath !== "string"
    || !("sourceSessionName" in value) || typeof value.sourceSessionName !== "string"
    || !("sourceMessageId" in value) || typeof value.sourceMessageId !== "string"
    || !("sourceMessageIndex" in value) || typeof value.sourceMessageIndex !== "number"
    || !Number.isSafeInteger(value.sourceMessageIndex) || value.sourceMessageIndex < 1
  ) return undefined
  return {
    sourceSessionId: value.sourceSessionId,
    sourceSessionPath: value.sourceSessionPath,
    sourceSessionName: value.sourceSessionName,
    sourceMessageId: value.sourceMessageId,
    sourceMessageIndex: value.sourceMessageIndex
  }
}

export const sessionForkMetadata = (manager: SessionManager): SessionForkMetadata | undefined => {
  for (const entry of manager.getEntries().toReversed()) {
    if (entry.type === "custom" && entry.customType === sessionForkMetadataType) {
      return metadataFromUnknown(entry.data)
    }
  }
  return undefined
}

export const createSessionFork = (
  manager: SessionManager,
  sourceSessionName: string,
  sourceMessageId: string
): { readonly sessionPath: string; readonly metadata: SessionForkMetadata } => {
  const branch = manager.getBranch()
  const forkableEntries = branch.filter((entry) =>
    entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")
  )
  const sourceMessageIndex = forkableEntries.findIndex((entry) => entry.id === sourceMessageId)
  if (sourceMessageIndex < 0) throw new Error("The selected message is not a user or assistant turn on the active session branch")
  const selectedBranchIndex = branch.findIndex((entry) => entry.id === sourceMessageId)
  const selectedEntry = branch[selectedBranchIndex]
  let branchLeafId = sourceMessageId
  // A Pi assistant tool-call entry is not usable context until its tool results
  // are present. Retain those result/state entries, but stop before the next
  // user or assistant turn so the selected transcript turn remains the tip.
  if (selectedEntry?.type === "message" && selectedEntry.message.role === "assistant") {
    for (const entry of branch.slice(selectedBranchIndex + 1)) {
      if (entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")) break
      branchLeafId = entry.id
    }
  }

  const sourceSessionPath = manager.getSessionFile()
  if (!sourceSessionPath) throw new Error("The source session is not persisted")
  const metadata: SessionForkMetadata = {
    sourceSessionId: manager.getSessionId(),
    sourceSessionPath,
    sourceSessionName,
    sourceMessageId,
    sourceMessageIndex: sourceMessageIndex + 1
  }
  const sessionPath = manager.createBranchedSession(branchLeafId)
  if (!sessionPath) throw new Error("Pi could not persist the forked session")
  manager.appendCustomEntry(sessionForkMetadataType, metadata)
  return { sessionPath, metadata }
}
