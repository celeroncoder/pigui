import { execFile } from "node:child_process"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cwd = root
const execFileAsync = promisify(execFile)
const gitOutput = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 512 * 1024 })
    return stdout
  } catch {
    return ""
  }
}
const numericStat = (value) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}
const gitBranch = (await gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim()
const gitTotals = (await gitOutput(["diff", "--numstat", "--no-ext-diff", "--no-renames", "HEAD", "--"])).split("\n")
  .reduce((totals, line) => {
    const [added, deleted] = line.split("\t")
    return { additions: totals.additions + numericStat(added), deletions: totals.deletions + numericStat(deleted) }
  }, { additions: 0, deletions: 0 })
const gitTrackedFiles = (await gitOutput(["diff", "--name-only", "-z", "--no-ext-diff", "--no-renames", "HEAD", "--"])).split("\0").filter(Boolean)
const gitUntrackedFiles = (await gitOutput(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean)
const gitChangedFiles = gitTrackedFiles.length + gitUntrackedFiles.length
const infos = await SessionManager.list(cwd)
const preferred = infos.find((info) => !info.name?.startsWith("subagent:")) ?? infos[0]
const orderedInfos = preferred ? [preferred, ...infos.filter((info) => info.path !== preferred.path)] : infos
const modelRuntime = await ModelRuntime.create()
const availableModels = await modelRuntime.getAvailable()

const stringify = (value) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const textFromContent = (content) => {
  if (typeof content === "string") return content
  return content.flatMap((block) => block.type === "text" && block.text ? [block.text] : []).join("\n")
}

const thinkingLevelsForModel = (model) => {
  if (!model?.reasoning) return ["off"]
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    return level !== "xhigh" && level !== "max" || mapped !== undefined
  })
}

const project = {
  id: `e2e-${Buffer.from(cwd).toString("base64url").slice(0, 12)}`,
  path: cwd,
  name: basename(cwd),
  addedAt: Date.now(),
  ...(gitBranch ? { git: { branch: gitBranch, ...gitTotals, changedFiles: gitChangedFiles } } : {})
}

const parentCandidates = new Map()
const childInfos = infos.filter((info) => info.name?.toLocaleLowerCase().startsWith("subagent:"))
for (const parent of infos) {
  try {
    const manager = SessionManager.open(parent.path, undefined, parent.cwd || cwd)
    for (const entry of manager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue
      for (const block of entry.message.content) {
        const args = block.arguments
        if (block.type !== "toolCall" || block.name !== "subagent_spawn" || typeof args?.name !== "string" || typeof args?.prompt !== "string") continue
        if (args.harness !== undefined && args.harness !== "pi") continue
        const expectedName = `subagent: ${args.name.trim()}`.toLocaleLowerCase()
        const expectedPrompt = args.prompt.trim()
        const parentCwd = parent.cwd || cwd
        const expectedCwd = typeof args.working_dir === "string" ? resolve(parentCwd, args.working_dir) : parentCwd
        const spawnedAt = new Date(entry.timestamp).getTime()
        const candidates = childInfos.filter((child) => {
          const distance = child.created.getTime() - spawnedAt
          return child.name?.trim().toLocaleLowerCase() === expectedName
            && child.firstMessage.trim() === expectedPrompt
            && resolve(child.cwd || cwd) === expectedCwd
            && distance >= -2_000
            && distance <= 60_000
        })
        if (candidates.length === 1 && candidates[0]) parentCandidates.set(candidates[0].path, { parentPath: parent.path })
      }
    }
  } catch {
    // Ignore a session being concurrently appended while the fixture is generated.
  }
}

const summaries = orderedInfos.map((info) => ({
  id: info.id,
  path: info.path,
  name: info.name || info.firstMessage || "Untitled session",
  firstMessage: info.firstMessage,
  updatedAt: info.modified.getTime(),
  messageCount: info.messageCount,
  ...(parentCandidates.get(info.path)?.parentPath ? { parentSessionPath: parentCandidates.get(info.path).parentPath } : {})
}))

const findAskUserFixture = () => {
  for (const info of orderedInfos) {
    const manager = SessionManager.open(info.path)
    for (const entry of manager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue
      for (const block of entry.message.content) {
        const args = block.arguments
        if (block.type !== "toolCall" || block.name !== "ask_user" || typeof args?.question !== "string" || !Array.isArray(args.options) || args.options.length < 2 || args.options.length > 5) continue
        if (!args.options.every((option) => typeof option?.label === "string" && (option.description === undefined || typeof option.description === "string"))) continue
        return {
          sessionPath: info.path,
          request: {
            requestId: `fixture-${block.id}`,
            toolCallId: block.id,
            question: args.question,
            options: args.options.map((option) => option.description === undefined
              ? { label: option.label }
              : { label: option.label, description: option.description })
          }
        }
      }
    }
  }
  return undefined
}

const interaction = findAskUserFixture() ?? (process.env.PI_E2E_ASK_USER === "1" && preferred
  ? {
      sessionPath: preferred.path,
      request: {
        requestId: "fixture-ask-user",
        toolCallId: "fixture-ask-user",
        question: "Which surface should Pi change next?",
        options: [
          { label: "The renderer", description: "Update the React workspace" },
          { label: "The main process", description: "Update Electron lifecycle code" }
        ]
      }
    }
  : undefined)

const appendProjectedMessage = (output, message, id) => {
  if (message.role === "user") {
    output.push({ id, role: "user", blocks: [{ type: "text", text: textFromContent(message.content) }], timestamp: message.timestamp })
  } else if (message.role === "assistant") {
    const blocks = []
    for (const block of message.content) {
      if (block.type === "text") blocks.push({ type: "text", text: block.text })
      else if (block.type === "toolCall") blocks.push({ type: "tool-call", id: block.id, name: block.name, input: stringify(block.arguments) })
    }
    output.push({ id, role: "assistant", blocks, timestamp: message.timestamp, model: message.model, provider: message.provider })
  } else if (message.role === "toolResult") {
    const diff = typeof message.details?.diff === "string" ? message.details.diff : undefined
    const result = { type: "tool-result", id: message.toolCallId, name: message.toolName, output: textFromContent(message.content), isError: message.isError, ...(diff ? { diff } : {}) }
    const assistantIndex = output.findLastIndex((candidate) => candidate.role === "assistant" && candidate.blocks.some((block) => block.type === "tool-call" && block.id === message.toolCallId))
    if (assistantIndex >= 0) output[assistantIndex].blocks.push(result)
    else output.push({ id, role: "tool", blocks: [result], timestamp: message.timestamp })
  } else if (message.role === "bashExecution") {
    output.push({ id, role: "system", blocks: [{ type: "tool-result", id, name: "bash", output: message.output, isError: (message.exitCode ?? 0) !== 0 }], timestamp: message.timestamp })
  } else if (message.role === "branchSummary") {
    output.push({ id, role: "system", blocks: [{ type: "text", text: message.summary }], timestamp: message.timestamp })
  } else if (message.role === "compactionSummary") {
    output.push({ id, role: "system", blocks: [{ type: "compaction", status: "compacted" }], timestamp: message.timestamp })
  } else if (message.role === "custom" && message.display) {
    output.push({ id, role: "system", blocks: [{ type: "text", text: textFromContent(message.content) }], timestamp: message.timestamp })
  }
}

const projectEntries = (entries) => {
  const output = []
  for (const entry of entries) {
    if (entry.type === "message") appendProjectedMessage(output, entry.message, entry.id)
    else if (entry.type === "compaction") output.push({ id: entry.id, role: "system", blocks: [{ type: "compaction", status: "compacted" }], timestamp: new Date(entry.timestamp).getTime() })
  }
  return output
}

const projectBackgroundProcesses = (entries) => {
  const processes = new Map()
  const pending = new Map()
  const update = (id, patch, at) => {
    const current = processes.get(id)
    processes.set(id, {
      id,
      title: patch.title ?? current?.title ?? `Terminal ${id}`,
      status: patch.status ?? current?.status ?? "running",
      startedAt: current?.startedAt ?? at,
      updatedAt: at,
      ...(patch.command ?? current?.command ? { command: patch.command ?? current?.command } : {}),
      ...(patch.cwd ?? current?.cwd ? { cwd: patch.cwd ?? current?.cwd } : {}),
      ...(patch.pid ?? current?.pid ? { pid: patch.pid ?? current?.pid } : {}),
      ...(patch.output ?? current?.output ? { output: patch.output ?? current?.output } : {}),
      ...(patch.exitCode ?? current?.exitCode !== undefined ? { exitCode: patch.exitCode ?? current?.exitCode } : {}),
      ...(patch.signal ?? current?.signal ? { signal: patch.signal ?? current?.signal } : {})
    })
  }
  for (const entry of entries) {
    if (entry.type !== "message") continue
    const message = entry.message
    const at = new Date(entry.timestamp).getTime()
    if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "toolCall" && block.name.startsWith("bg_")) pending.set(block.id, block.arguments)
      continue
    }
    if (message.role === "custom" && message.customType === "background-terminal-result") {
      const id = message.details?.id
      if (typeof id === "string") update(id, { title: message.details?.title, status: message.details?.status, exitCode: message.details?.exitCode, signal: message.details?.signal, output: typeof message.content === "string" ? message.content : undefined }, at)
      continue
    }
    if (message.role !== "toolResult" || !message.toolName.startsWith("bg_")) continue
    const details = message.details ?? {}
    const args = pending.get(message.toolCallId) ?? {}
    const output = textFromContent(message.content)
    if (message.toolName === "bg_start" && typeof details.id === "string") {
      update(details.id, { title: details.title ?? args.title, command: args.command, cwd: details.cwd ?? args.working_dir, pid: details.pid, status: "running", output }, at)
    } else if (message.toolName === "bg_status" && typeof details.id === "string") {
      update(details.id, { status: details.status, pid: details.pid, exitCode: details.exitCode, signal: details.signal, output }, at)
    } else if (message.toolName === "bg_list" && Array.isArray(details.terminals)) {
      for (const terminal of details.terminals) if (typeof terminal.id === "string") update(terminal.id, terminal, at)
    } else if (message.toolName === "bg_kill" && Array.isArray(details.results)) {
      for (const terminal of details.results) if (typeof terminal.id === "string") update(terminal.id, { ...terminal, output }, at)
    }
  }
  return [...processes.values()]
    .map((process) => process.status === "running" ? { ...process, status: "stopped" } : process)
    .sort((left, right) => right.startedAt - left.startedAt)
}

const details = []
for (const [index, info] of orderedInfos.entries()) {
  const summary = summaries[index]
  if (!summary) continue
  const manager = SessionManager.open(info.path)
  const context = manager.buildSessionContext()
  const selectedModel = context.model
    ? availableModels.find((candidate) => candidate.provider === context.model.provider && candidate.id === context.model.modelId)
    : availableModels[0]
  const model = context.model
    ? `${context.model.provider}/${context.model.modelId}`
    : selectedModel
      ? `${selectedModel.provider}/${selectedModel.id}`
      : ""
  details.push({
    summary,
    messages: projectEntries(manager.getBranch()),
    model,
    thinkingLevel: context.thinkingLevel,
    availableThinkingLevels: thinkingLevelsForModel(selectedModel),
    backgroundProcesses: projectBackgroundProcesses(manager.getBranch()),
    queuedMessages: [],
    isStreaming: false,
    isCompacting: false
  })
}

const fixture = {
  generatedAt: Date.now(),
  projects: [project],
  sessions: summaries,
  details,
  models: availableModels.map((model) => ({ provider: model.provider, id: model.id, name: model.name })),
  ...(interaction ? { interaction } : {})
}

const outputPath = join(root, ".e2e-public/pi-e2e.json")
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(fixture)}\n`, "utf8")
await copyFile(join(root, "src/renderer/public/favicon.svg"), join(root, ".e2e-public/favicon.svg"))
console.log(`Generated Pi-backed E2E fixture: ${summaries.length} sessions, ${fixture.models.length} models${interaction ? ", ask_user preview included" : ""}`)
