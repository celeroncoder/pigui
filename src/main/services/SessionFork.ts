import { existsSync, writeFileSync } from "node:fs"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { Schema } from "effect"
import type { SessionForkMetadata } from "../../shared/contracts"

export const sessionForkMetadataType = "pi-desktop-session-fork"

const SessionForkMetadataSchema = Schema.Struct({
  sourceSessionId: Schema.String,
  sourceSessionPath: Schema.String,
  sourceSessionName: Schema.String,
  sourceMessageId: Schema.String,
  sourceMessageIndex: Schema.Number
})

const decodeForkMetadata = Schema.decodeUnknownOption(SessionForkMetadataSchema)

export const sessionForkMetadata = (manager: SessionManager): SessionForkMetadata | undefined => {
  for (const entry of manager.getEntries().toReversed()) {
    if (entry.type === "custom" && entry.customType === sessionForkMetadataType) {
      const decoded = decodeForkMetadata(entry.data)
      return decoded._tag === "Some" ? decoded.value : undefined
    }
  }
  return undefined
}

export type SessionForkResult = {
  readonly manager: SessionManager
  readonly sessionPath: string
  readonly metadata: SessionForkMetadata
}

export const createSessionFork = (
  manager: SessionManager,
  sourceSessionName: string,
  sourceMessageId: string
): SessionForkResult => {
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

  // Pi normally defers writing a user-only session until the first assistant
  // response. A fork from the first user turn must survive session switching,
  // so materialize the exact SDK-produced tree without fabricating context.
  // Reopening establishes Pi's normal flushed state for future appends.
  if (!existsSync(sessionPath)) {
    const header = manager.getHeader()
    if (!header) throw new Error("Pi did not create a forked session header")
    const contents = [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")
    writeFileSync(sessionPath, `${contents}\n`, { encoding: "utf8", flag: "wx" })
  }
  const forkedManager = SessionManager.open(sessionPath, manager.getSessionDir(), manager.getCwd())
  return { manager: forkedManager, sessionPath, metadata }
}
