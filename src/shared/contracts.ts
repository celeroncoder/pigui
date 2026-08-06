import type { AskUserInteractionAnswer, AskUserInteractionRequest } from "./interaction"

export type { AskUserInput, AskUserInteractionAnswer, AskUserInteractionRequest, AskUserOption } from "./interaction"

export interface GitStatus {
  readonly branch: string
  readonly additions: number
  readonly deletions: number
  readonly changedFiles: number
}

export type GitDiffStatus = "added" | "untracked" | "modified" | "deleted"

export interface GitDiffFile {
  readonly path: string
  readonly status: GitDiffStatus
  readonly oldContents: string | null
  readonly newContents: string | null
  readonly binary: boolean
}

export interface GitDiff {
  readonly files: ReadonlyArray<GitDiffFile>
  readonly truncated: boolean
  readonly omittedFiles: number
}

export interface Project {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly addedAt: number
  readonly git?: GitStatus
}

export interface SessionSummary {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly firstMessage: string
  readonly updatedAt: number
  readonly messageCount: number
  readonly parentSessionPath?: string
}

export type MessageRole = "user" | "assistant" | "tool" | "system"

export interface TextBlock {
  readonly type: "text"
  readonly text: string
}

export interface ThinkingBlock {
  readonly type: "thinking"
  readonly text: string
}

export interface CompactionBlock {
  readonly type: "compaction"
  readonly status: "compacting" | "compacted"
}

export interface ToolCallBlock {
  readonly type: "tool-call"
  readonly id: string
  readonly name: string
  readonly input: string
}

export interface ToolResultBlock {
  readonly type: "tool-result"
  readonly id: string
  readonly name: string
  readonly output: string
  readonly isError: boolean
  readonly diff?: string
}

export type MessageBlock = TextBlock | ThinkingBlock | CompactionBlock | ToolCallBlock | ToolResultBlock

export interface ChatMessage {
  readonly id: string
  readonly role: MessageRole
  readonly blocks: ReadonlyArray<MessageBlock>
  readonly timestamp: number
  readonly model?: string
  readonly provider?: string
}

export interface ImageAttachment {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly mimeType: string
  readonly dataUrl: string
}

export interface AttachmentPreview {
  readonly name: string
  readonly mimeType: string
  readonly dataUrl: string
}

export interface ModelOption {
  readonly provider: string
  readonly id: string
  readonly name: string
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/** Pi's native runtime delivery queues. */
export type QueueDelivery = "steer" | "follow-up"

export interface QueuedMessage {
  readonly id: string
  readonly delivery: QueueDelivery
  readonly text: string
}

export type BackgroundProcessStatus = "running" | "done" | "failed" | "killed" | "stopped"

export interface BackgroundProcess {
  readonly id: string
  readonly title: string
  readonly command?: string
  readonly cwd?: string
  readonly pid?: number
  readonly status: BackgroundProcessStatus
  readonly output?: string
  readonly exitCode?: number
  readonly signal?: string
  readonly startedAt: number
  readonly updatedAt: number
}

export interface SessionDetail {
  readonly summary: SessionSummary
  readonly messages: ReadonlyArray<ChatMessage>
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly availableThinkingLevels: ReadonlyArray<ThinkingLevel>
  readonly backgroundProcesses: ReadonlyArray<BackgroundProcess>
  readonly queuedMessages: ReadonlyArray<QueuedMessage>
  readonly interactionRequest?: AskUserInteractionRequest
  readonly isStreaming: boolean
  readonly isCompacting: boolean
}

export interface ToolActivity {
  readonly id: string
  readonly name: string
  readonly input?: string
  readonly output?: string
  readonly status: "running" | "success" | "error"
  readonly startedAt: number
}

export type SessionEvent =
  | { readonly type: "session-state"; readonly sessionPath: string; readonly detail: SessionDetail }
  | { readonly type: "assistant-start"; readonly sessionPath: string; readonly messageId: string; readonly timestamp: number }
  | { readonly type: "user-message"; readonly sessionPath: string; readonly message: ChatMessage }
  | { readonly type: "queue-update"; readonly sessionPath: string; readonly messages: ReadonlyArray<QueuedMessage> }
  | { readonly type: "text-delta"; readonly sessionPath: string; readonly messageId: string; readonly delta: string }
  | { readonly type: "thinking-delta"; readonly sessionPath: string; readonly messageId: string; readonly delta: string }
  | { readonly type: "tool-start"; readonly sessionPath: string; readonly tool: ToolActivity }
  | { readonly type: "tool-update"; readonly sessionPath: string; readonly toolId: string; readonly output: string }
  | { readonly type: "tool-end"; readonly sessionPath: string; readonly toolId: string; readonly output: string; readonly isError: boolean; readonly diff?: string }
  | { readonly type: "agent-status"; readonly sessionPath: string; readonly isStreaming: boolean }
  | { readonly type: "compaction-status"; readonly sessionPath: string; readonly isCompacting: boolean }
  | { readonly type: "background-processes"; readonly sessionPath: string; readonly processes: ReadonlyArray<BackgroundProcess> }
  | { readonly type: "project-git"; readonly projectPath: string; readonly git?: GitStatus }
  | { readonly type: "interaction-request"; readonly sessionPath: string; readonly request: AskUserInteractionRequest }
  | { readonly type: "interaction-cleared"; readonly sessionPath: string; readonly requestId: string }
  | { readonly type: "error"; readonly sessionPath?: string; readonly message: string }

export interface PiDesktopApi {
  readonly projects: {
    readonly list: () => Promise<ReadonlyArray<Project>>
    readonly add: () => Promise<Project | null>
    readonly remove: (projectId: string) => Promise<void>
    readonly refreshGit: (projectPath: string) => Promise<GitStatus | undefined>
    readonly diff: (projectPath: string) => Promise<GitDiff | undefined>
  }
  readonly attachments: {
    readonly save: (bytes: Uint8Array, name?: string, mimeType?: string) => Promise<ImageAttachment>
    readonly preview: (path: string) => Promise<AttachmentPreview>
  }
  readonly sessions: {
    readonly list: (projectPath: string) => Promise<ReadonlyArray<SessionSummary>>
    readonly create: (projectPath: string) => Promise<SessionDetail>
    readonly open: (projectPath: string, sessionPath: string) => Promise<SessionDetail>
    readonly inspect: (projectPath: string, parentSessionPath: string, sessionPath: string) => Promise<SessionDetail>
    readonly prompt: (sessionPath: string, text: string, delivery?: QueueDelivery, attachmentPaths?: ReadonlyArray<string>) => Promise<void>
    readonly editQueuedMessage: (sessionPath: string, messageId: string, text: string) => Promise<void>
    readonly removeQueuedMessage: (sessionPath: string, messageId: string) => Promise<void>
    readonly steerQueuedMessage: (sessionPath: string, messageId: string) => Promise<void>
    readonly abort: (sessionPath: string) => Promise<void>
    readonly models: (sessionPath: string) => Promise<ReadonlyArray<ModelOption>>
    readonly setModel: (sessionPath: string, provider: string, modelId: string) => Promise<SessionDetail>
    readonly setThinkingLevel: (sessionPath: string, level: ThinkingLevel) => Promise<SessionDetail>
    readonly answerInteraction: (sessionPath: string, requestId: string, answer: AskUserInteractionAnswer) => Promise<void>
  }
  readonly onSessionEvent: (listener: (event: SessionEvent) => void) => () => void
}

export const IpcChannels = {
  listProjects: "projects:list",
  addProject: "projects:add",
  removeProject: "projects:remove",
  refreshProjectGit: "projects:refresh-git",
  gitDiff: "projects:git-diff",
  listSessions: "sessions:list",
  createSession: "sessions:create",
  openSession: "sessions:open",
  inspectSession: "sessions:inspect",
  promptSession: "sessions:prompt",
  editQueuedMessage: "sessions:queue-edit",
  removeQueuedMessage: "sessions:queue-remove",
  steerQueuedMessage: "sessions:queue-steer",
  abortSession: "sessions:abort",
  listModels: "sessions:models",
  setModel: "sessions:set-model",
  setThinkingLevel: "sessions:set-thinking-level",
  answerInteraction: "sessions:answer-interaction",
  saveAttachment: "attachments:save",
  previewAttachment: "attachments:preview",
  sessionEvent: "sessions:event"
} as const
