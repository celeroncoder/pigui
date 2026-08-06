import { FolderPlus, GitBranch, PanelRightOpen, RefreshCw, Sparkles, SquareTerminal, X } from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AskUserInteractionAnswer, AskUserInteractionRequest, AttachmentPreview, ChatMessage, GitDiff, GitStatus, ImageAttachment, ModelOption, Project, ProjectWorktree, QueueDelivery, QueuedMessage, SessionDetail, SessionDraftContext, SessionEvent, SessionSummary, ThinkingLevel, WorktreeContext } from "../../shared/contracts"
import { normalizeImageReferences } from "../../shared/attachments"
import { reduceSessionEvent } from "../../shared/sessionEvents"
import { AskUserPanel } from "./components/AskUserPanel"
import { BackgroundProcessesPane } from "./components/BackgroundProcessesPane"
import { BrandMark } from "./components/BrandMark"
import { Composer } from "./components/Composer"
import { ConversationTimeline } from "./components/ConversationTimeline"
// import { Inspector } from "./components/Inspector"
import { ProjectSidebar, type WorktreeSessionList } from "./components/ProjectSidebar"
import { SubagentAvatarGroup } from "./components/SubagentAvatars"
import { SubagentPane } from "./components/SubagentPane"
import styles from "./App.module.css"
import gitDiffStyles from "./components/GitDiffPane.module.css"
import { desktopApi } from "./lib/api"
import { buildConversationItems, buildConversationPreviewLandmarks, filterUserMessagePreviewLandmarks, latestTransientStatus } from "./lib/conversation"
import { compactLabel } from "./lib/text"

const GitDiffPane = lazy(() => import("./components/GitDiffPane").then(({ GitDiffPane: Pane }) => ({ default: Pane })))
const worktreeContext = (project: Project, worktree: ProjectWorktree): WorktreeContext => ({ projectId: project.id, worktreeId: worktree.id })
const worktreeKey = (project: Project, worktree: ProjectWorktree) => `${project.id}:${worktree.id}`

export default function App() {
  const [projects, setProjects] = useState<ReadonlyArray<Project>>([])
  const [sessions, setSessions] = useState<ReadonlyArray<SessionSummary>>([])
  const [sessionsByWorktree, setSessionsByWorktree] = useState<Readonly<Record<string, WorktreeSessionList | undefined>>>({})
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [activeWorktree, setActiveWorktree] = useState<ProjectWorktree | null>(null)
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraftContext | null>(null)
  const [draftBaseBranch, setDraftBaseBranch] = useState<string | undefined>()
  const [draftContextLoading, setDraftContextLoading] = useState(false)
  const [draftStarting, setDraftStarting] = useState(false)
  const [liveThinking, setLiveThinking] = useState<{ readonly messageId: string; readonly text: string } | null>(null)
  const [subagentPaneOpen, setSubagentPaneOpen] = useState(false)
  const [backgroundPaneOpen, setBackgroundPaneOpen] = useState(false)
  const [gitPaneOpen, setGitPaneOpen] = useState(false)
  const [gitDiff, setGitDiff] = useState<GitDiff | null>(null)
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [selectedSubagent, setSelectedSubagent] = useState<SessionSummary | null>(null)
  const [subagentDetail, setSubagentDetail] = useState<SessionDetail | null>(null)
  const [subagentLoading, setSubagentLoading] = useState(false)
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<ModelOption>>([])
  const [draft, setDraft] = useState("")
  const [pendingAttachments, setPendingAttachments] = useState<ReadonlyArray<ImageAttachment>>([])
  const [lightboxImage, setLightboxImage] = useState<AttachmentPreview | null>(null)
  const [interactionRequest, setInteractionRequest] = useState<AskUserInteractionRequest | null>(null)
  const [interactionSubmitting, setInteractionSubmitting] = useState(false)
  const interactionSubmittingRef = useRef(false)
  const draftRevisionRef = useRef(0)
  const attachmentRevisionRef = useRef(0)
  const composerEpochRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const activeSessionPathRef = useRef<string | null>(null)
  const activeProjectRef = useRef<Project | null>(null)
  const activeWorktreeRef = useRef<ProjectWorktree | null>(null)
  const activeWorktreeKeyRef = useRef<string | null>(null)
  const projectRequestRef = useRef(0)
  const gitRequestRef = useRef(0)
  const gitDiffRequestRef = useRef(0)
  const sessionRequestRef = useRef(0)
  const modelRequestRef = useRef(0)
  const subagentRequestRef = useRef(0)
  const addingProjectRef = useRef(false)
  const catalogRequestRef = useRef(0)
  const draftContextRequestRef = useRef(0)
  const sessionStartSequenceRef = useRef(0)
  const pendingSessionStartRef = useRef<string | null>(null)
  const startedSessionRequestRef = useRef<string | null>(null)

  const storeWorktreeSessions = useCallback((project: Project, worktree: ProjectWorktree, nextSessions: ReadonlyArray<SessionSummary>) => {
    const key = worktreeKey(project, worktree)
    setSessionsByWorktree((current) => ({ ...current, [key]: { sessions: nextSessions, loading: false } }))
  }, [])

  const loadSessionCatalog = useCallback(async (items: ReadonlyArray<Project>) => {
    const requestId = ++catalogRequestRef.current
    const contexts = items.flatMap((project) => project.worktrees.map((worktree) => ({ project, worktree, key: worktreeKey(project, worktree) })))
    setSessionsByWorktree(Object.fromEntries(contexts.map(({ key }) => [key, { sessions: [], loading: true }])))
    const results = await Promise.all(contexts.map(async ({ project, worktree, key }) => {
      try {
        return [key, { sessions: await desktopApi.sessions.list(worktreeContext(project, worktree)), loading: false }] as const
      } catch {
        return [key, { sessions: [], loading: false, unavailable: true }] as const
      }
    }))
    if (requestId === catalogRequestRef.current) {
      setSessionsByWorktree((current) => {
        const next = { ...current }
        for (const [key, listing] of results) if (current[key]?.loading) next[key] = listing
        return next
      })
    }
  }, [])

  useEffect(() => {
    activeSessionPathRef.current = session?.summary.path ?? null
  }, [session?.summary.path])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  useEffect(() => {
    activeWorktreeRef.current = activeWorktree
  }, [activeWorktree])

  const loadModels = useCallback(async (context: WorktreeContext, contextKey: string, sessionPath: string) => {
    const requestId = ++modelRequestRef.current
    setModelOptions([])
    try {
      const options = await desktopApi.sessions.models(context, sessionPath)
      if (requestId === modelRequestRef.current && activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) setModelOptions(options)
    } catch {
      if (requestId === modelRequestRef.current && activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) setModelOptions([])
    }
  }, [])

  const openSession = useCallback(async (project: Project, worktree: ProjectWorktree, summary: SessionSummary) => {
    const contextKey = worktreeKey(project, worktree)
    if (activeWorktreeKeyRef.current !== contextKey) return
    const requestId = ++sessionRequestRef.current
    ++draftContextRequestRef.current
    activeSessionPathRef.current = summary.path
    composerEpochRef.current += 1
    draftRevisionRef.current += 1
    attachmentRevisionRef.current += 1
    setSession(null)
    setSessionDraft(null)
    setDraftBaseBranch(undefined)
    setDraftContextLoading(false)
    setDraftStarting(false)
    pendingSessionStartRef.current = null
    startedSessionRequestRef.current = null
    setPendingAttachments([])
    setLightboxImage(null)
    setLiveThinking(null)
    setDraft("")
    setModelOptions([])
    setError(null)
    setInteractionRequest(null)
    setInteractionSubmitting(false)
    interactionSubmittingRef.current = false
    try {
      const detail = await desktopApi.sessions.open(worktreeContext(project, worktree), summary.path)
      if (requestId !== sessionRequestRef.current || activeWorktreeKeyRef.current !== contextKey) return
      activeSessionPathRef.current = detail.summary.path
      setSession(detail)
      setInteractionRequest(detail.interactionRequest ?? null)
      void loadModels(worktreeContext(project, worktree), contextKey, detail.summary.path)
    } catch (cause) {
      if (requestId === sessionRequestRef.current && activeWorktreeKeyRef.current === contextKey) {
        setError(cause instanceof Error ? cause.message : "Could not open this session")
      }
    }
  }, [loadModels])

  const inspectSubagent = useCallback(async (project: Project, worktree: ProjectWorktree, summary: SessionSummary, showLoading = true) => {
    const parentSessionPath = activeSessionPathRef.current
    if (!parentSessionPath) return
    const requestId = ++subagentRequestRef.current
    setSelectedSubagent(summary)
    if (showLoading) {
      setSubagentLoading(true)
      setSubagentDetail(null)
    }
    try {
      const detail = await desktopApi.sessions.inspect(worktreeContext(project, worktree), parentSessionPath, summary.path)
      if (requestId === subagentRequestRef.current && activeSessionPathRef.current === parentSessionPath && activeWorktreeKeyRef.current === worktreeKey(project, worktree)) setSubagentDetail(detail)
    } catch (cause) {
      if (requestId === subagentRequestRef.current) setError(cause instanceof Error ? cause.message : "Could not inspect subagent")
    } finally {
      if (requestId === subagentRequestRef.current) setSubagentLoading(false)
    }
  }, [])

  const refreshProjectGit = useCallback(async (project: Project, worktree: ProjectWorktree) => {
    const contextKey = worktreeKey(project, worktree)
    const requestId = ++gitRequestRef.current
    try {
      const git = await desktopApi.projects.refreshGit(worktreeContext(project, worktree))
      if (requestId !== gitRequestRef.current || activeWorktreeKeyRef.current !== contextKey) return
      const updateWorktree = (current: ProjectWorktree) => current.id === worktree.id
        ? git ? { ...current, branch: git.branch, git } : { ...current, git: undefined }
        : current
      const updateProject = (current: Project) => current.id === project.id ? { ...current, worktrees: current.worktrees.map(updateWorktree) } : current
      setProjects((current) => current.map(updateProject))
      setActiveProject((current) => current ? updateProject(current) : current)
      setActiveWorktree((current) => current ? updateWorktree(current) : current)
    } catch {
      // Git context is auxiliary; a project remains usable if Git is unavailable.
    }
  }, [])

  const loadGitDiff = useCallback(async (project: Project, worktree: ProjectWorktree) => {
    const contextKey = worktreeKey(project, worktree)
    const requestId = ++gitDiffRequestRef.current
    setGitDiffLoading(true)
    try {
      const diff = await desktopApi.projects.diff(worktreeContext(project, worktree))
      if (requestId === gitDiffRequestRef.current && activeWorktreeKeyRef.current === contextKey) setGitDiff(diff ?? { files: [], truncated: false, omittedFiles: 0 })
    } catch (cause) {
      if (requestId === gitDiffRequestRef.current && activeWorktreeKeyRef.current === contextKey) setError(cause instanceof Error ? cause.message : "Could not load Git changes")
    } finally {
      if (requestId === gitDiffRequestRef.current) setGitDiffLoading(false)
    }
  }, [])

  const selectWorktree = useCallback(async (project: Project, worktree: ProjectWorktree, preferredSessionPath?: string) => {
    const contextKey = worktreeKey(project, worktree)
    const requestId = ++projectRequestRef.current
    ++draftContextRequestRef.current
    ++sessionRequestRef.current
    ++modelRequestRef.current
    activeWorktreeKeyRef.current = contextKey
    activeProjectRef.current = project
    activeWorktreeRef.current = worktree
    activeSessionPathRef.current = null
    composerEpochRef.current += 1
    draftRevisionRef.current += 1
    attachmentRevisionRef.current += 1
    setActiveProject(project)
    setActiveWorktree(worktree)
    ++gitDiffRequestRef.current
    setGitPaneOpen(false)
    setGitDiff(null)
    setGitDiffLoading(false)
    setSession(null)
    setSessionDraft(null)
    setDraftBaseBranch(undefined)
    setDraftContextLoading(false)
    setDraftStarting(false)
    pendingSessionStartRef.current = null
    startedSessionRequestRef.current = null
    setPendingAttachments([])
    setLightboxImage(null)
    setLiveThinking(null)
    setDraft("")
    setSessions([])
    setModelOptions([])
    setInteractionRequest(null)
    setInteractionSubmitting(false)
    interactionSubmittingRef.current = false
    setError(null)
    void refreshProjectGit(project, worktree)
    try {
      const nextSessions = await desktopApi.sessions.list(worktreeContext(project, worktree))
      if (requestId !== projectRequestRef.current || activeWorktreeKeyRef.current !== contextKey) return
      setSessions(nextSessions)
      storeWorktreeSessions(project, worktree, nextSessions)
      const first = nextSessions.find((candidate) => candidate.path === preferredSessionPath)
        ?? nextSessions.find((candidate) => !candidate.name.toLocaleLowerCase().startsWith("subagent:"))
        ?? nextSessions[0]
      if (first) await openSession(project, worktree, first)
    } catch (cause) {
      if (requestId === projectRequestRef.current && activeWorktreeKeyRef.current === contextKey) {
        setError(cause instanceof Error ? cause.message : "Could not load project sessions")
      }
    }
  }, [openSession, refreshProjectGit, storeWorktreeSessions])

  const selectProject = useCallback((project: Project) => {
    const worktree = activeProjectRef.current?.id === project.id
      ? activeWorktreeRef.current ?? project.worktrees.find((candidate) => candidate.kind === "local") ?? project.worktrees[0]
      : project.worktrees.find((candidate) => candidate.kind === "local") ?? project.worktrees[0]
    if (worktree) void selectWorktree(project, worktree)
  }, [selectWorktree])

  useEffect(() => {
    void desktopApi.projects.list().then((items) => {
      setProjects(items)
      void loadSessionCatalog(items)
      const first = items[0]
      const worktree = first?.worktrees[0]
      if (first && worktree) void selectWorktree(first, worktree)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load projects")
    })
  }, [loadSessionCatalog, selectWorktree])

  useEffect(() => {
    ++subagentRequestRef.current
    setSubagentPaneOpen(false)
    setBackgroundPaneOpen(false)
    setGitPaneOpen(false)
    setGitDiff(null)
    setGitDiffLoading(false)
    setSelectedSubagent(null)
    setSubagentDetail(null)
    setSubagentLoading(false)
  }, [session?.summary.path])

  useEffect(() => {
    if (!subagentPaneOpen || !selectedSubagent || !activeProject || !activeWorktree) return
    const interval = window.setInterval(() => {
      void inspectSubagent(activeProject, activeWorktree, selectedSubagent, false)
    }, 2500)
    return () => window.clearInterval(interval)
  }, [activeProject, activeWorktree, inspectSubagent, selectedSubagent, subagentPaneOpen])

  useEffect(() => desktopApi.onSessionEvent((event: SessionEvent) => {
    if (event.type === "error") {
      if (event.sessionPath && event.sessionPath !== activeSessionPathRef.current) return
      setError(event.message)
      return
    }
    if (event.type === "project-git") {
      gitRequestRef.current += 1
      const project = activeProjectRef.current
      const worktree = activeWorktreeRef.current
      if (!project || !worktree || worktree.path !== event.worktreePath) return
      const updateWorktree = (current: ProjectWorktree) => current.path === event.worktreePath
        ? event.git ? { ...current, branch: event.git.branch, git: event.git } : { ...current, git: undefined }
        : current
      const updateProject = (current: Project) => current.id === project.id ? { ...current, worktrees: current.worktrees.map(updateWorktree) } : current
      setProjects((current) => current.map(updateProject))
      setActiveProject((current) => current ? updateProject(current) : current)
      setActiveWorktree((current) => current ? updateWorktree(current) : current)
      if (gitPaneOpen) void loadGitDiff(project, worktree)
      return
    }
    if (event.type === "session-started") {
      const contextKey = `${event.context.projectId}:${event.context.worktreeId}`
      if (activeWorktreeKeyRef.current !== contextKey || activeSessionPathRef.current !== null || pendingSessionStartRef.current !== event.requestId) return
      const project = activeProjectRef.current
      const worktree = activeWorktreeRef.current
      pendingSessionStartRef.current = null
      startedSessionRequestRef.current = event.requestId
      activeSessionPathRef.current = event.detail.summary.path
      setSession(event.detail)
      setSessionDraft(null)
      setDraftBaseBranch(undefined)
      setDraftContextLoading(false)
      setDraftStarting(false)
      setInteractionRequest(event.detail.interactionRequest ?? null)
      setSessions((current) => [event.detail.summary, ...current.filter((item) => item.path !== event.detail.summary.path)])
      if (project && worktree) {
        setSessionsByWorktree((current) => {
          const listing = current[contextKey] ?? { sessions: [], loading: false }
          return { ...current, [contextKey]: { sessions: [event.detail.summary, ...listing.sessions.filter((item) => item.path !== event.detail.summary.path)], loading: false } }
        })
        void loadModels(event.context, contextKey, event.detail.summary.path)
      }
      return
    }
    const activeSessionPath = activeSessionPathRef.current
    if (event.sessionPath !== activeSessionPath) return

    if (event.type === "interaction-request") {
      setInteractionRequest(event.request)
      setInteractionSubmitting(false)
      interactionSubmittingRef.current = false
      return
    }
    if (event.type === "interaction-cleared") {
      setInteractionRequest((current) => current?.requestId === event.requestId ? null : current)
      setInteractionSubmitting(false)
      interactionSubmittingRef.current = false
      return
    }

    if (event.type === "session-state") {
      setLiveThinking(null)
      setSession((current) => reduceSessionEvent(current, activeSessionPathRef.current, event))
      setInteractionRequest(event.detail.interactionRequest ?? null)
      setSessions((current) => [
        event.detail.summary,
        ...current.filter((item) => item.path !== event.detail.summary.path)
      ])
      const project = activeProjectRef.current
      const worktree = activeWorktreeRef.current
      if (project && worktree) {
        setSessionsByWorktree((current) => {
          const key = worktreeKey(project, worktree)
          const listing = current[key] ?? { sessions: [], loading: false }
          return { ...current, [key]: { sessions: [event.detail.summary, ...listing.sessions.filter((item) => item.path !== event.detail.summary.path)], loading: false } }
        })
      }
      return
    }
    if (event.type === "assistant-start") {
      setLiveThinking(null)
    }
    if (event.type === "text-delta") {
      setLiveThinking(null)
    }
    if (event.type === "thinking-delta") {
      setLiveThinking((current) => ({
        messageId: event.messageId,
        text: `${current?.messageId === event.messageId ? current.text : ""}${event.delta}`
      }))
      return
    }
    if (event.type === "tool-start") {
      if (event.tool.name === "subagent_spawn") {
        window.setTimeout(() => {
          const project = activeProjectRef.current
          const worktree = activeWorktreeRef.current
          if (!project || !worktree) return
          const contextKey = worktreeKey(project, worktree)
          void desktopApi.sessions.list(worktreeContext(project, worktree)).then((nextSessions) => {
            if (activeWorktreeKeyRef.current === contextKey) {
              setSessions(nextSessions)
              storeWorktreeSessions(project, worktree, nextSessions)
            }
          })
        }, 1200)
      }
    }
    if (event.type === "agent-status") {
      if (!event.isStreaming) setLiveThinking(null)
    }
    setSession((current) => reduceSessionEvent(current, activeSessionPathRef.current, event))
  }), [gitPaneOpen, loadGitDiff, loadModels, storeWorktreeSessions])

  useEffect(() => {
    if (!lightboxImage) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxImage(null)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [lightboxImage])

  const addProject = async () => {
    if (addingProjectRef.current) return
    addingProjectRef.current = true
    try {
      const selection = await desktopApi.projects.add()
      if (!selection) return
      setProjects((current) => [...current.filter((item) => item.id !== selection.project.id), selection.project])
      void loadSessionCatalog([...projects.filter((item) => item.id !== selection.project.id), selection.project])
      await selectWorktree(selection.project, selection.worktree)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add project")
    } finally {
      addingProjectRef.current = false
    }
  }

  const newSession = useCallback(async (targetProject?: Project, targetWorktree?: ProjectWorktree) => {
    const project = targetProject ?? activeProjectRef.current
    const worktree = targetWorktree
      ?? (activeProjectRef.current?.id === project?.id ? activeWorktreeRef.current : null)
      ?? project?.worktrees.find((candidate) => candidate.kind === "local")
      ?? project?.worktrees[0]
    if (!project || !worktree) return
    const contextKey = worktreeKey(project, worktree)
    ++projectRequestRef.current
    ++sessionRequestRef.current
    ++modelRequestRef.current
    activeWorktreeKeyRef.current = contextKey
    activeSessionPathRef.current = null
    activeProjectRef.current = project
    activeWorktreeRef.current = worktree
    composerEpochRef.current += 1
    draftRevisionRef.current += 1
    attachmentRevisionRef.current += 1
    setActiveProject(project)
    setActiveWorktree(worktree)
    setSessions(sessionsByWorktree[contextKey]?.sessions ?? [])
    setSession(null)
    const fallbackDraft: SessionDraftContext = {
      path: worktree.path,
      folderName: worktree.name,
      worktreeKind: worktree.kind === "linked" ? "linked" : "local",
      branch: worktree.git?.branch ?? worktree.branch,
      baseBranches: []
    }
    setSessionDraft(fallbackDraft)
    setDraftBaseBranch(undefined)
    setDraftStarting(false)
    pendingSessionStartRef.current = null
    startedSessionRequestRef.current = null
    setPendingAttachments([])
    setLightboxImage(null)
    setLiveThinking(null)
    setDraft("")
    setModelOptions([])
    setInteractionRequest(null)
    setInteractionSubmitting(false)
    interactionSubmittingRef.current = false
    ++gitDiffRequestRef.current
    setGitPaneOpen(false)
    setGitDiff(null)
    setGitDiffLoading(false)
    setError(null)
    const requestId = ++draftContextRequestRef.current
    setDraftContextLoading(true)
    try {
      const described = await desktopApi.projects.sessionDraft(worktreeContext(project, worktree))
      if (requestId !== draftContextRequestRef.current || activeWorktreeKeyRef.current !== contextKey || activeSessionPathRef.current !== null) return
      setSessionDraft(described)
      setDraftBaseBranch(described.defaultBaseBranch ?? described.baseBranches[0])
    } catch (cause) {
      if (requestId === draftContextRequestRef.current && activeWorktreeKeyRef.current === contextKey && activeSessionPathRef.current === null) {
        setError(cause instanceof Error ? cause.message : "Could not prepare the session draft")
      }
    } finally {
      if (requestId === draftContextRequestRef.current) setDraftContextLoading(false)
    }
  }, [sessionsByWorktree])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault()
        void newSession()
      }
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [newSession])

  const answerInteraction = (answer: AskUserInteractionAnswer) => {
    const request = interactionRequest
    const sessionPath = activeSessionPathRef.current
    const project = activeProjectRef.current
    const worktree = activeWorktreeRef.current
    if (!request || !sessionPath || !project || !worktree || interactionSubmittingRef.current) return
    const contextKey = worktreeKey(project, worktree)
    interactionSubmittingRef.current = true
    setInteractionSubmitting(true)
    void desktopApi.sessions.answerInteraction(worktreeContext(project, worktree), sessionPath, request.requestId, answer).then(() => {
      setInteractionRequest((current) => current?.requestId === request.requestId ? null : current)
    }).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath || activeWorktreeKeyRef.current !== contextKey) return
      setError(cause instanceof Error ? cause.message : "Could not deliver the answer to Pi")
    }).finally(() => {
      interactionSubmittingRef.current = false
      if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) setInteractionSubmitting(false)
    })
  }

  const sendPrompt = (delivery: QueueDelivery = "follow-up") => {
    const rawText = draft.trim()
    const attachmentPaths = pendingAttachments.map((attachment) => attachment.path)
    const text = normalizeImageReferences(rawText, attachmentPaths)
    if (!text.trim() || !activeProject || !activeWorktree) return
    const context = worktreeContext(activeProject, activeWorktree)
    const contextKey = worktreeKey(activeProject, activeWorktree)
    if (!session) {
      if (!sessionDraft || draftContextLoading || draftStarting || pendingSessionStartRef.current) return
      if (sessionDraft.worktreeKind === "linked" && !draftBaseBranch) {
        setError("Choose a base branch before starting this worktree session")
        return
      }
      const previousDraft = draft
      const previousAttachments = pendingAttachments
      const draftRevision = ++draftRevisionRef.current
      const attachmentRevision = ++attachmentRevisionRef.current
      const requestId = `${contextKey}:${++sessionStartSequenceRef.current}`
      pendingSessionStartRef.current = requestId
      startedSessionRequestRef.current = null
      composerEpochRef.current += 1
      setDraft("")
      setPendingAttachments([])
      setDraftStarting(true)
      setError(null)
      void desktopApi.sessions.start(context, requestId, rawText, draftBaseBranch, attachmentPaths).catch((cause: unknown) => {
        if (activeWorktreeKeyRef.current !== contextKey || (pendingSessionStartRef.current !== requestId && startedSessionRequestRef.current !== requestId)) return
        if (pendingSessionStartRef.current === requestId) pendingSessionStartRef.current = null
        if (draftRevisionRef.current === draftRevision) {
          draftRevisionRef.current += 1
          setDraft(previousDraft)
        }
        if (attachmentRevisionRef.current === attachmentRevision) {
          attachmentRevisionRef.current += 1
          setPendingAttachments(previousAttachments)
        }
        setDraftStarting(false)
        setError(cause instanceof Error ? cause.message : "Pi could not start the session")
      })
      return
    }
    const sessionPath = session.summary.path
    const wasStreaming = session.isStreaming
    const previousDraft = draft
    const previousAttachments = pendingAttachments
    const draftRevision = ++draftRevisionRef.current
    const attachmentRevision = ++attachmentRevisionRef.current
    composerEpochRef.current += 1
    setDraft("")
    setPendingAttachments([])
    if (!wasStreaming) {
      setLiveThinking(null)
      setSession((current) => current ? { ...current, isStreaming: true } : current)
    }
    setError(null)
    void desktopApi.sessions.prompt(context, sessionPath, rawText, delivery, attachmentPaths).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath || activeWorktreeKeyRef.current !== contextKey) return
      if (draftRevisionRef.current === draftRevision) {
        draftRevisionRef.current += 1
        setDraft(previousDraft)
      }
      if (attachmentRevisionRef.current === attachmentRevision) {
        attachmentRevisionRef.current += 1
        setPendingAttachments(previousAttachments)
      }
      if (!wasStreaming) setSession((current) => current ? { ...current, isStreaming: false } : current)
      setError(cause instanceof Error ? cause.message : "Pi could not process the message")
    })
  }

  const addPastedImage = async (image: File) => {
    if ((!session && !sessionDraft) || !activeProject || !activeWorktree) return
    const sessionPath = session?.summary.path ?? null
    const contextKey = worktreeKey(activeProject, activeWorktree)
    const epoch = composerEpochRef.current
    try {
      const bytes = new Uint8Array(await image.arrayBuffer())
      const attachment = await desktopApi.attachments.save(bytes, image.name, image.type)
      if (activeSessionPathRef.current !== sessionPath || activeWorktreeKeyRef.current !== contextKey || composerEpochRef.current !== epoch) return
      attachmentRevisionRef.current += 1
      setPendingAttachments((current) => [...current, attachment])
      setError(null)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey && composerEpochRef.current === epoch) {
        setError(cause instanceof Error ? cause.message : "Could not save the pasted image")
      }
    }
  }

  const abort = () => {
    if (!session || !activeProject || !activeWorktree) return
    const sessionPath = session.summary.path
    const contextKey = worktreeKey(activeProject, activeWorktree)
    void desktopApi.sessions.abort(worktreeContext(activeProject, activeWorktree), sessionPath).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath || activeWorktreeKeyRef.current !== contextKey) return
      setError(cause instanceof Error ? cause.message : "Could not stop Pi")
    })
  }

  const editQueuedMessage = async (message: QueuedMessage, text: string) => {
    if (!session || !activeProject || !activeWorktree) return
    const sessionPath = session.summary.path
    const contextKey = worktreeKey(activeProject, activeWorktree)
    try {
      await desktopApi.sessions.editQueuedMessage(worktreeContext(activeProject, activeWorktree), sessionPath, message.id, text)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
        setError(cause instanceof Error ? cause.message : "Could not edit the queued message")
      }
      throw cause
    }
  }

  const removeQueuedMessage = async (message: QueuedMessage) => {
    if (!session || !activeProject || !activeWorktree) return
    const sessionPath = session.summary.path
    const contextKey = worktreeKey(activeProject, activeWorktree)
    try {
      await desktopApi.sessions.removeQueuedMessage(worktreeContext(activeProject, activeWorktree), sessionPath, message.id)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
        setError(cause instanceof Error ? cause.message : "Could not remove the queued message")
      }
      throw cause
    }
  }

  const steerQueuedMessage = async (message: QueuedMessage) => {
    if (!session || !activeProject || !activeWorktree) return
    const sessionPath = session.summary.path
    const contextKey = worktreeKey(activeProject, activeWorktree)
    try {
      await desktopApi.sessions.steerQueuedMessage(worktreeContext(activeProject, activeWorktree), sessionPath, message.id)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
        setError(cause instanceof Error ? cause.message : "Could not steer the queued message")
      }
      throw cause
    }
  }

  const displayMessages: ReadonlyArray<ChatMessage> = useMemo(() => session?.isCompacting
    ? [...session.messages, { id: "compaction-active", role: "system", blocks: [{ type: "compaction", status: "compacting" }], timestamp: Date.now() }]
    : session?.messages ?? [], [session?.isCompacting, session?.messages])
  const { conversationItems, conversationLandmarks, allPreviewLandmarks, previewLandmarks } = useMemo(() => {
    const items = buildConversationItems(displayMessages)
    const landmarks = buildConversationPreviewLandmarks(items)
    const allPreviews = filterUserMessagePreviewLandmarks(landmarks)
    const previewStride = Math.max(1, Math.ceil(allPreviews.length / 28))
    return {
      conversationItems: items,
      conversationLandmarks: landmarks,
      allPreviewLandmarks: allPreviews,
      previewLandmarks: allPreviews.filter((_landmark, index) => index === 0 || index === allPreviews.length - 1 || index % previewStride === 0)
    }
  }, [displayMessages])
  const linkedSubagents = sessions.filter((candidate) => candidate.parentSessionPath === session?.summary.path)
  const backgroundProcesses = (session?.backgroundProcesses ?? []).filter((process) => process.status === "running")
  const runningProcesses = backgroundProcesses.length
  const liveStatus = liveThinking ? latestTransientStatus(liveThinking.text) : undefined
  const git: GitStatus | undefined = activeWorktree?.git
  const gitLineTotalsVisible = !!git && (git.additions > 0 || git.deletions > 0)
  const gitChangedFiles = git?.changedFiles ?? 0
  const gitChangesVisible = gitLineTotalsVisible || gitChangedFiles > 0
  const gitChangeLabel = gitLineTotalsVisible
    ? `${git?.additions ?? 0} lines added, ${git?.deletions ?? 0} lines deleted`
    : `${gitChangedFiles} changed ${gitChangedFiles === 1 ? "file" : "files"}`

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-leading" aria-hidden="true" />
        <div className="titlebar-dither" aria-hidden="true" />
        <div className="titlebar-brand"><BrandMark size={20} /><span>Pi</span></div>
        <div className="titlebar-center">{activeProject && activeWorktree ? `${activeProject.name} · ${activeWorktree.branch}` : "Desktop"}</div>
        <div className="titlebar-actions" />
      </header>

      <div className={`workspace-layout ${(gitPaneOpen || (subagentPaneOpen && linkedSubagents.length > 0) || (backgroundPaneOpen && backgroundProcesses.length > 0)) ? "with-subagents" : ""} ${gitPaneOpen ? "with-git" : ""}`}>
        <ProjectSidebar
          projects={projects}
          sessionsByWorktree={sessionsByWorktree}
          activeProject={activeProject}
          activeWorktree={activeWorktree}
          activeSessionPath={session?.summary.path ?? null}
          activeSessionStreaming={session?.isStreaming ?? false}
          onSelectProject={selectProject}
          onSelectSession={(project, worktree, summary) => void selectWorktree(project, worktree, summary.path)}
          onAddProject={() => void addProject()}
          onNewSession={(project, worktree) => void newSession(project, worktree)}
        />

        <main className={`conversation ${interactionRequest ? "has-interaction" : ""}`} id="main-content">
          <div className="conversation-header">
            <div className="conversation-title">
              <span className="eyebrow">{activeProject && activeWorktree ? `${activeProject.name} / ${activeWorktree.name}` : "Workspace"}</span>
              <div className="session-heading">
                <h1 title={session?.summary.name}>{compactLabel(session?.summary.name ?? "New Pi session", 72)}</h1>
                {git && gitChangesVisible && (
                  <button
                    type="button"
                    className={`${styles.headerControl} ${styles.gitTotals} ${gitPaneOpen ? styles.active : ""}`}
                    aria-expanded={gitPaneOpen}
                    title={gitChangeLabel}
                    aria-label={gitChangeLabel}
                    onClick={() => {
                      if (gitPaneOpen) {
                        setGitPaneOpen(false)
                        return
                      }
                      if (!activeProject || !activeWorktree) return
                      setSubagentPaneOpen(false)
                      setBackgroundPaneOpen(false)
                      setGitPaneOpen(true)
                      void loadGitDiff(activeProject, activeWorktree)
                    }}
                  >
                    <span>{gitLineTotalsVisible ? `+${git.additions}/-${git.deletions}` : `${gitChangedFiles} ${gitChangedFiles === 1 ? "file" : "files"}`}</span>
                    <PanelRightOpen size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {git && <span className="git-branch" title={`Current branch: ${git.branch}`}><GitBranch size={11} aria-hidden="true" /><span>{git.branch}</span></span>}
            </div>
            <div className="conversation-header-actions">
              {backgroundProcesses.length > 0 && (
                <button
                  type="button"
                  className={`${styles.headerControl} background-toggle ${backgroundPaneOpen ? styles.active : ""}`}
                  aria-expanded={backgroundPaneOpen}
                  aria-label={`${backgroundProcesses.length} background processes, ${runningProcesses} running`}
                  title={runningProcesses > 0 ? `${runningProcesses} running background ${runningProcesses === 1 ? "process" : "processes"}` : `${backgroundProcesses.length} background processes in this session`}
                  onClick={() => {
                    setSubagentPaneOpen(false)
                    setGitPaneOpen(false)
                    setBackgroundPaneOpen((open) => !open)
                  }}
                >
                  <span className="background-toggle-icon"><SquareTerminal size={14} /><small className={runningProcesses > 0 ? "active" : ""}>{runningProcesses || backgroundProcesses.length}</small></span>
                  <span>Processes</span>
                  <PanelRightOpen size={14} />
                </button>
              )}
              {linkedSubagents.length > 0 && activeProject && activeWorktree && (
                <button
                  type="button"
                  className={`${styles.headerControl} subagent-toggle ${subagentPaneOpen ? styles.active : ""}`}
                  aria-expanded={subagentPaneOpen}
                  onClick={() => {
                    if (subagentPaneOpen) {
                      setSubagentPaneOpen(false)
                      return
                    }
                    const first = linkedSubagents[0]
                    setBackgroundPaneOpen(false)
                    setGitPaneOpen(false)
                    setSubagentPaneOpen(true)
                    if (first) void inspectSubagent(activeProject, activeWorktree, first)
                  }}
                >
                  <SubagentAvatarGroup sessions={linkedSubagents} />
                  <span>{linkedSubagents.length} {linkedSubagents.length === 1 ? "subagent" : "subagents"}</span>
                  <PanelRightOpen size={14} />
                </button>
              )}
            </div>
          </div>

          {interactionRequest && (
            <AskUserPanel
              request={interactionRequest}
              submitting={interactionSubmitting}
              onAnswer={answerInteraction}
            />
          )}

          {displayMessages.length ? (
            <ConversationTimeline
              key={`timeline-${session?.summary.path}`}
              items={conversationItems}
              landmarks={conversationLandmarks}
              previewLandmarks={previewLandmarks}
              previewTotalCount={allPreviewLandmarks.length}
              isStreaming={session?.isStreaming ?? false}
              liveStatus={liveStatus}
              onOpenImage={setLightboxImage}
            />
          ) : (
            <div className="message-scroll-shell">
              <div className="message-scroll">
              {activeProject ? (
              <div className="conversation-empty">
                <div className="empty-mark"><BrandMark size={42} /></div>
                <span className="empty-kicker"><Sparkles size={13} /> Project context is ready</span>
                <h2>What should we make?</h2>
                <p>Pi can inspect this workspace, edit files, run commands, and keep every turn in the same session you use from the terminal.</p>
                <div className="prompt-suggestions">
                  <button type="button" onClick={() => { draftRevisionRef.current += 1; setDraft("Give me a concise overview of this codebase") }}>Map this codebase</button>
                  <button type="button" onClick={() => { draftRevisionRef.current += 1; setDraft("Find the highest-impact issue and fix it") }}>Find and fix an issue</button>
                  <button type="button" onClick={() => { draftRevisionRef.current += 1; setDraft("Run the tests and explain any failures") }}>Run the test suite</button>
                </div>
              </div>
              ) : (
              <div className="conversation-empty onboarding-empty">
                <div className="empty-mark"><BrandMark size={42} /></div>
                <span className="empty-kicker"><Sparkles size={13} /> Pi Desktop is ready</span>
                <h2>Open a workspace</h2>
                <p>Add a project folder to discover its existing Pi sessions and start new ones with the same config, skills, and credentials.</p>
                <button className="onboarding-action" type="button" onClick={() => void addProject()}><FolderPlus size={15} /> Add a project folder</button>
              </div>
              )}
              </div>
            </div>
          )}

          {error && <div className="error-toast" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
          <Composer
            key={session?.summary.path ?? (sessionDraft ? `draft:${activeWorktree?.id ?? "worktree"}` : "no-session")}
            value={draft}
            disabled={(!session && (!sessionDraft || draftContextLoading || draftStarting)) || interactionRequest !== null}
            disabledReason={interactionRequest ? "Answer Pi above to continue…" : draftStarting ? "Creating the Pi session…" : draftContextLoading ? "Preparing worktree context…" : undefined}
            attachments={pendingAttachments}
            isStreaming={session?.isStreaming ?? false}
            model={session?.model.split("/").at(-1) ?? (sessionDraft ? "Pi default" : "Choose model")}
            modelProvider={session?.model.includes("/") ? session.model.split("/")[0] : undefined}
            modelOptions={modelOptions}
            thinkingLevel={session?.thinkingLevel ?? "off"}
            availableThinkingLevels={session?.availableThinkingLevels ?? []}
            queuedMessages={session?.queuedMessages ?? []}
            contextUsage={session?.contextUsage}
            worktreeContext={activeWorktree ? {
              path: activeWorktree.path,
              folderName: activeWorktree.name,
              worktreeKind: activeWorktree.kind === "linked" ? "linked" : "local",
              branch: activeWorktree.git?.branch ?? activeWorktree.branch,
              baseBranches: []
            } : undefined}
            draftContext={sessionDraft ?? undefined}
            draftBaseBranch={draftBaseBranch}
            draftContextLoading={draftContextLoading}
            onDraftBaseBranchChange={setDraftBaseBranch}
            onModelChange={(option) => {
              if (!session || !activeProject || !activeWorktree) return
              const sessionPath = session.summary.path
              const contextKey = worktreeKey(activeProject, activeWorktree)
              void desktopApi.sessions.setModel(worktreeContext(activeProject, activeWorktree), sessionPath, option.provider, option.id)
                .then((detail) => {
                  if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
                    setSession((current) => current ? {
                      ...current,
                      model: detail.model,
                      thinkingLevel: detail.thinkingLevel,
                      availableThinkingLevels: detail.availableThinkingLevels,
                      contextUsage: detail.contextUsage
                    } : current)
                  }
                })
                .catch((cause: unknown) => {
                  if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
                    setError(cause instanceof Error ? cause.message : "Could not change model")
                  }
                })
            }}
            onThinkingLevelChange={(level: ThinkingLevel) => {
              if (!session || !activeProject || !activeWorktree) return
              const sessionPath = session.summary.path
              const contextKey = worktreeKey(activeProject, activeWorktree)
              void desktopApi.sessions.setThinkingLevel(worktreeContext(activeProject, activeWorktree), sessionPath, level)
                .then((detail) => {
                  if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) {
                    setSession((current) => current ? {
                      ...current,
                      thinkingLevel: detail.thinkingLevel,
                      availableThinkingLevels: detail.availableThinkingLevels,
                      contextUsage: detail.contextUsage
                    } : current)
                  }
                })
                .catch((cause: unknown) => {
                  if (activeSessionPathRef.current === sessionPath && activeWorktreeKeyRef.current === contextKey) setError(cause instanceof Error ? cause.message : "Could not change effort")
                })
            }}
            onChange={(value) => { draftRevisionRef.current += 1; setDraft(value) }}
            onOpenImage={setLightboxImage}
            onPasteImage={(image) => void addPastedImage(image)}
            onRemoveAttachment={(id) => {
              attachmentRevisionRef.current += 1
              setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
            }}
            onSubmit={sendPrompt}
            onEditQueuedMessage={editQueuedMessage}
            onRemoveQueuedMessage={removeQueuedMessage}
            onSteerQueuedMessage={steerQueuedMessage}
            onAbort={abort}
          />
        </main>

        {subagentPaneOpen && !backgroundPaneOpen && linkedSubagents.length > 0 && activeProject && activeWorktree && (
          <SubagentPane
            sessions={linkedSubagents}
            selectedPath={selectedSubagent?.path ?? null}
            detail={subagentDetail}
            loading={subagentLoading}
            onSelect={(summary) => void inspectSubagent(activeProject, activeWorktree, summary)}
            onRefresh={() => selectedSubagent && void inspectSubagent(activeProject, activeWorktree, selectedSubagent, false)}
            onClose={() => setSubagentPaneOpen(false)}
            onOpenImage={setLightboxImage}
          />
        )}
        {backgroundPaneOpen && backgroundProcesses.length > 0 && (
          <BackgroundProcessesPane processes={backgroundProcesses} onClose={() => setBackgroundPaneOpen(false)} />
        )}
        {gitPaneOpen && activeProject && activeWorktree && (
          <Suspense fallback={<aside className={gitDiffStyles.root} aria-label="Git changes"><div className={gitDiffStyles.loading}><RefreshCw size={16} /> Preparing diff…</div></aside>}>
            <GitDiffPane
              diff={gitDiff}
              loading={gitDiffLoading}
              onClose={() => setGitPaneOpen(false)}
              onRefresh={() => void loadGitDiff(activeProject, activeWorktree)}
            />
          </Suspense>
        )}
      </div>
      {lightboxImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${lightboxImage.name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightboxImage(null)
          }}
        >
          <div className="image-lightbox-dialog">
            <div className="image-lightbox-header">
              <span title={lightboxImage.name}>{lightboxImage.name}</span>
              <button type="button" autoFocus aria-label="Close image preview" onClick={() => setLightboxImage(null)}><X size={17} /></button>
            </div>
            <div className="image-lightbox-canvas"><img src={lightboxImage.dataUrl} alt={lightboxImage.name} /></div>
          </div>
        </div>
      )}
    </div>
  )
}
