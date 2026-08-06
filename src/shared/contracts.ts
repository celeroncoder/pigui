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

export type GitHubPullRequestState = "mergeable" | "conflict" | "pending" | "merged"

export interface GitHubBranchPullRequest {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly branch: string
  readonly state: GitHubPullRequestState
}

export interface GitHubWorktreeContext {
  readonly repository: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly path: string
  readonly worktreeKind: "local" | "linked"
  readonly changes: GitStatus
  readonly hasUpstream: boolean
  readonly ahead: number
  readonly pullRequest?: GitHubBranchPullRequest
}

export interface GitHubSyncResult {
  readonly action: "committed-and-pushed" | "pushed"
  readonly commit?: string
}

export interface ProjectWorktree {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly branch: string
  readonly addedAt: number
  /** Explicit Git ownership; optional only for persisted projects created before worktree support. */
  readonly kind?: "local" | "linked"
  readonly git?: GitStatus
}

export interface Project {
  readonly id: string
  readonly name: string
  readonly addedAt: number
  readonly worktrees: ReadonlyArray<ProjectWorktree>
}

export interface WorktreeContext {
  readonly projectId: string
  readonly worktreeId: string
}

export interface ProjectSelection {
  readonly project: Project
  readonly worktree: ProjectWorktree
}

export interface SessionDraftContext {
  readonly path: string
  readonly folderName: string
  readonly worktreeKind: "local" | "linked"
  readonly branch: string
  readonly baseBranches: ReadonlyArray<string>
  readonly defaultBaseBranch?: string
  readonly setupEnvironment?: {
    readonly name: string
    readonly configPath: string
  }
}

export interface SessionSummary {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly firstMessage: string
  readonly updatedAt: number
  readonly messageCount: number
  readonly parentSessionPath?: string
  readonly forkedFrom?: SessionForkMetadata
}

export interface SessionForkMetadata {
  readonly sourceSessionId: string
  readonly sourceSessionPath: string
  readonly sourceSessionName: string
  /** One-based position among the source branch's user and assistant entries. */
  readonly sourceMessageIndex: number
  readonly sourceMessageId: string
}

/** A concise, renderer-safe projection of Pi's current session lifecycle. */
export type SessionRuntimeStatus = "running" | "input-required" | "waiting" | "done" | "failed"

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
  readonly status?: "running" | "success" | "error"
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

/** Provider models known to Pi, with a non-blocking availability check status. */
export interface ModelAvailability {
  readonly models: ReadonlyArray<ModelOption>
  readonly status: "pending" | "ready" | "error"
}

/** A Pi-native command that AgentSession can execute from the composer. */
export interface PiCommand {
  readonly kind: "prompt" | "skill"
  readonly name: string
  readonly description: string
  readonly argumentHint?: string
  /** Project resources can be committed and shared with the team. */
  readonly scope: "user" | "project" | "other"
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/** Pi's native runtime delivery queues. */
export type QueueDelivery = "steer" | "follow-up"

export interface QueuedMessage {
  readonly id: string
  readonly delivery: QueueDelivery
  readonly text: string
}

export type SessionRecoveryAction = "resume" | "continue" | "restart"

export interface SessionRecovery {
  readonly reason: string
  readonly interruptedAt: number
  readonly lastPrompt?: string
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

/** Pi's current model-context measurement, if the selected model exposes one. */
export interface ContextUsage {
  /** Estimated tokens in context, or null until Pi can measure them after compaction. */
  readonly tokens: number | null
  readonly contextWindow: number
  /** Pi's context percentage, or null when token usage is temporarily unknown. */
  readonly percent: number | null
}

export interface SessionDetail {
  readonly summary: SessionSummary
  readonly messages: ReadonlyArray<ChatMessage>
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly availableThinkingLevels: ReadonlyArray<ThinkingLevel>
  readonly backgroundProcesses: ReadonlyArray<BackgroundProcess>
  readonly queuedMessages: ReadonlyArray<QueuedMessage>
  /** Present when Pi's last run ended before its transport completed normally. */
  readonly recovery?: SessionRecovery
  /** Omitted when no model with a context window is selected. */
  readonly contextUsage?: ContextUsage
  readonly interactionRequest?: AskUserInteractionRequest
  readonly runtimeStatus: SessionRuntimeStatus
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
  | { readonly type: "session-started"; readonly requestId: string; readonly context: WorktreeContext; readonly detail: SessionDetail }
  | { readonly type: "session-state"; readonly sessionPath: string; readonly detail: SessionDetail }
  | { readonly type: "runtime-status"; readonly sessionPath: string; readonly status: SessionRuntimeStatus }
  | { readonly type: "assistant-start"; readonly sessionPath: string; readonly messageId: string; readonly timestamp: number }
  | { readonly type: "user-message"; readonly sessionPath: string; readonly message: ChatMessage }
  | { readonly type: "queue-update"; readonly sessionPath: string; readonly messages: ReadonlyArray<QueuedMessage> }
  | { readonly type: "text-delta"; readonly sessionPath: string; readonly messageId: string; readonly delta: string }
  | { readonly type: "thinking-delta"; readonly sessionPath: string; readonly messageId: string; readonly delta: string }
  | { readonly type: "tool-start"; readonly sessionPath: string; readonly messageId: string; readonly tool: ToolActivity }
  | { readonly type: "tool-update"; readonly sessionPath: string; readonly toolId: string; readonly output: string }
  | { readonly type: "tool-end"; readonly sessionPath: string; readonly toolId: string; readonly output: string; readonly isError: boolean; readonly diff?: string }
  | { readonly type: "agent-status"; readonly sessionPath: string; readonly isStreaming: boolean }
  | { readonly type: "compaction-status"; readonly sessionPath: string; readonly isCompacting: boolean }
  | { readonly type: "context-usage"; readonly sessionPath: string; readonly contextUsage?: ContextUsage }
  | { readonly type: "background-processes"; readonly sessionPath: string; readonly processes: ReadonlyArray<BackgroundProcess> }
  | { readonly type: "model-availability"; readonly sessionPath: string; readonly availability: ModelAvailability }
  | { readonly type: "project-git"; readonly worktreePath: string; readonly git?: GitStatus }
  | { readonly type: "interaction-request"; readonly sessionPath: string; readonly request: AskUserInteractionRequest }
  | { readonly type: "interaction-cleared"; readonly sessionPath: string; readonly requestId: string }
  | { readonly type: "error"; readonly sessionPath?: string; readonly message: string }

export interface PiDesktopApi {
  readonly projects: {
    readonly list: () => Promise<ReadonlyArray<Project>>
    readonly add: () => Promise<ProjectSelection | null>
    readonly remove: (projectId: string) => Promise<void>
    readonly refreshGit: (context: WorktreeContext) => Promise<GitStatus | undefined>
    readonly diff: (context: WorktreeContext) => Promise<GitDiff | undefined>
    readonly sessionDraft: (context: WorktreeContext) => Promise<SessionDraftContext>
  }
  readonly attachments: {
    readonly save: (bytes: Uint8Array, name?: string, mimeType?: string) => Promise<ImageAttachment>
    readonly preview: (path: string) => Promise<AttachmentPreview>
  }
  readonly github: {
    readonly branchPullRequest: (context: WorktreeContext) => Promise<GitHubBranchPullRequest | null>
    readonly worktree: (context: WorktreeContext) => Promise<GitHubWorktreeContext>
    readonly commitOrPush: (context: WorktreeContext, message: string) => Promise<GitHubSyncResult>
  }
  readonly sessions: {
    readonly list: (context: WorktreeContext) => Promise<ReadonlyArray<SessionSummary>>
    readonly start: (context: WorktreeContext, requestId: string, text: string, baseBranch?: string, attachmentPaths?: ReadonlyArray<string>) => Promise<SessionDetail>
    readonly fork: (context: WorktreeContext, sessionPath: string, messageId: string) => Promise<SessionDetail>
    readonly open: (context: WorktreeContext, sessionPath: string) => Promise<SessionDetail>
    readonly inspect: (context: WorktreeContext, parentSessionPath: string, sessionPath: string) => Promise<SessionDetail>
    readonly prompt: (context: WorktreeContext, sessionPath: string, text: string, delivery?: QueueDelivery, attachmentPaths?: ReadonlyArray<string>) => Promise<void>
    readonly recover: (context: WorktreeContext, sessionPath: string, action: SessionRecoveryAction) => Promise<SessionDetail>
    readonly editQueuedMessage: (context: WorktreeContext, sessionPath: string, messageId: string, text: string) => Promise<void>
    readonly removeQueuedMessage: (context: WorktreeContext, sessionPath: string, messageId: string) => Promise<void>
    readonly steerQueuedMessage: (context: WorktreeContext, sessionPath: string, messageId: string) => Promise<void>
    readonly abort: (context: WorktreeContext, sessionPath: string) => Promise<void>
    readonly models: (context: WorktreeContext, sessionPath: string) => Promise<ModelAvailability>
    readonly commands: (context: WorktreeContext, sessionPath: string) => Promise<ReadonlyArray<PiCommand>>
    readonly setModel: (context: WorktreeContext, sessionPath: string, provider: string, modelId: string) => Promise<SessionDetail>
    readonly setThinkingLevel: (context: WorktreeContext, sessionPath: string, level: ThinkingLevel) => Promise<SessionDetail>
    readonly answerInteraction: (context: WorktreeContext, sessionPath: string, requestId: string, answer: AskUserInteractionAnswer) => Promise<void>
  }
  readonly onSessionEvent: (listener: (event: SessionEvent) => void) => () => void
}

export const IpcChannels = {
  listProjects: "projects:list",
  addProject: "projects:add",
  removeProject: "projects:remove",
  refreshProjectGit: "projects:refresh-git",
  gitDiff: "projects:git-diff",
  sessionDraft: "projects:session-draft",
  listSessions: "sessions:list",
  startSession: "sessions:start",
  forkSession: "sessions:fork",
  openSession: "sessions:open",
  inspectSession: "sessions:inspect",
  promptSession: "sessions:prompt",
  recoverSession: "sessions:recover",
  editQueuedMessage: "sessions:queue-edit",
  removeQueuedMessage: "sessions:queue-remove",
  steerQueuedMessage: "sessions:queue-steer",
  abortSession: "sessions:abort",
  listModels: "sessions:models",
  listCommands: "sessions:commands",
  setModel: "sessions:set-model",
  setThinkingLevel: "sessions:set-thinking-level",
  answerInteraction: "sessions:answer-interaction",
  saveAttachment: "attachments:save",
  previewAttachment: "attachments:preview",
  inspectGitHubBranchPullRequest: "github:inspect-branch-pull-request",
  inspectGitHubWorktree: "github:inspect-worktree",
  commitOrPushGitHubWorktree: "github:commit-or-push-worktree",
  sessionEvent: "sessions:event"
} as const
