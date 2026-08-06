import { CircleDashed, FolderPlus, GitBranch, PanelRightOpen, RefreshCw, Sparkles, SquareTerminal, X } from "lucide-react"
import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import type { AskUserInteractionAnswer, AskUserInteractionRequest, AttachmentPreview, ChatMessage, GitDiff, GitStatus, ImageAttachment, ModelOption, Project, QueueDelivery, QueuedMessage, SessionDetail, SessionEvent, SessionRecoveryAction, SessionSummary, ThinkingLevel } from "../../shared/contracts"
import { normalizeImageReferences } from "../../shared/attachments"
import { reduceSessionEvent } from "../../shared/sessionEvents"
import { ActivityGroup } from "./components/ActivityGroup"
import { AskUserPanel } from "./components/AskUserPanel"
import { BackgroundProcessesPane } from "./components/BackgroundProcessesPane"
import { BrandMark } from "./components/BrandMark"
import { Composer } from "./components/Composer"
// import { Inspector } from "./components/Inspector"
import { MessagePreviewRail } from "./components/MessagePreviewRail"
import { MessageView } from "./components/MessageView"
import { ProjectSidebar } from "./components/ProjectSidebar"
import { SubagentAvatarGroup } from "./components/SubagentAvatars"
import { SubagentPane } from "./components/SubagentPane"
import { TransportRecoveryPanel } from "./components/TransportRecoveryPanel"
import styles from "./App.module.css"
import gitDiffStyles from "./components/GitDiffPane.module.css"
import { desktopApi } from "./lib/api"
import { buildConversationItems, buildConversationPreviewLandmarks, filterUserMessagePreviewLandmarks, findLastUserTurnIndex, latestTransientStatus } from "./lib/conversation"
import { compactLabel } from "./lib/text"

const GitDiffPane = lazy(() => import("./components/GitDiffPane").then(({ GitDiffPane: Pane }) => ({ default: Pane })))

export default function App() {
  const [projects, setProjects] = useState<ReadonlyArray<Project>>([])
  const [sessions, setSessions] = useState<ReadonlyArray<SessionSummary>>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [session, setSession] = useState<SessionDetail | null>(null)
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
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [interactionRequest, setInteractionRequest] = useState<AskUserInteractionRequest | null>(null)
  const [interactionSubmitting, setInteractionSubmitting] = useState(false)
  const [recoverySubmitting, setRecoverySubmitting] = useState(false)
  const interactionSubmittingRef = useRef(false)
  const draftRevisionRef = useRef(0)
  const attachmentRevisionRef = useRef(0)
  const composerEpochRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const activeSessionPathRef = useRef<string | null>(null)
  const activeProjectRef = useRef<Project | null>(null)
  const activeProjectIdRef = useRef<string | null>(null)
  const projectRequestRef = useRef(0)
  const gitRequestRef = useRef(0)
  const gitDiffRequestRef = useRef(0)
  const sessionRequestRef = useRef(0)
  const modelRequestRef = useRef(0)
  const subagentRequestRef = useRef(0)
  const addingProjectRef = useRef(false)

  useEffect(() => {
    activeSessionPathRef.current = session?.summary.path ?? null
  }, [session?.summary.path])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  const loadModels = useCallback(async (sessionPath: string) => {
    const requestId = ++modelRequestRef.current
    setModelOptions([])
    try {
      const options = await desktopApi.sessions.models(sessionPath)
      if (requestId === modelRequestRef.current && activeSessionPathRef.current === sessionPath) setModelOptions(options)
    } catch {
      if (requestId === modelRequestRef.current && activeSessionPathRef.current === sessionPath) setModelOptions([])
    }
  }, [])

  const openSession = useCallback(async (project: Project, summary: SessionSummary) => {
    if (activeProjectIdRef.current !== project.id) return
    const requestId = ++sessionRequestRef.current
    activeSessionPathRef.current = summary.path
    composerEpochRef.current += 1
    draftRevisionRef.current += 1
    attachmentRevisionRef.current += 1
    setSession(null)
    setPendingAttachments([])
    setLightboxImage(null)
    setLiveThinking(null)
    setDraft("")
    setModelOptions([])
    setError(null)
    setInteractionRequest(null)
    setInteractionSubmitting(false)
    setRecoverySubmitting(false)
    interactionSubmittingRef.current = false
    try {
      const detail = await desktopApi.sessions.open(project.path, summary.path)
      if (requestId !== sessionRequestRef.current || activeProjectIdRef.current !== project.id) return
      activeSessionPathRef.current = detail.summary.path
      setSession(detail)
      setInteractionRequest(detail.interactionRequest ?? null)
      void loadModels(detail.summary.path)
    } catch (cause) {
      if (requestId === sessionRequestRef.current && activeProjectIdRef.current === project.id) {
        setError(cause instanceof Error ? cause.message : "Could not open this session")
      }
    }
  }, [loadModels])

  const inspectSubagent = useCallback(async (project: Project, summary: SessionSummary, showLoading = true) => {
    const parentSessionPath = activeSessionPathRef.current
    if (!parentSessionPath) return
    const requestId = ++subagentRequestRef.current
    setSelectedSubagent(summary)
    if (showLoading) {
      setSubagentLoading(true)
      setSubagentDetail(null)
    }
    try {
      const detail = await desktopApi.sessions.inspect(project.path, parentSessionPath, summary.path)
      if (requestId === subagentRequestRef.current && activeSessionPathRef.current === parentSessionPath) setSubagentDetail(detail)
    } catch (cause) {
      if (requestId === subagentRequestRef.current) setError(cause instanceof Error ? cause.message : "Could not inspect subagent")
    } finally {
      if (requestId === subagentRequestRef.current) setSubagentLoading(false)
    }
  }, [])

  const refreshProjectGit = useCallback(async (project: Project) => {
    const requestId = ++gitRequestRef.current
    try {
      const git = await desktopApi.projects.refreshGit(project.path)
      if (requestId !== gitRequestRef.current || activeProjectIdRef.current !== project.id) return
      const updateProject = (current: Project) => current.id === project.id
        ? git ? { ...current, git } : { id: current.id, path: current.path, name: current.name, addedAt: current.addedAt }
        : current
      setProjects((current) => current.map(updateProject))
      setActiveProject((current) => current ? updateProject(current) : current)
    } catch {
      // Git context is auxiliary; a project remains usable if Git is unavailable.
    }
  }, [])

  const loadGitDiff = useCallback(async (project: Project) => {
    const requestId = ++gitDiffRequestRef.current
    setGitDiffLoading(true)
    try {
      const diff = await desktopApi.projects.diff(project.path)
      if (requestId === gitDiffRequestRef.current && activeProjectIdRef.current === project.id) setGitDiff(diff ?? { files: [], truncated: false, omittedFiles: 0 })
    } catch (cause) {
      if (requestId === gitDiffRequestRef.current && activeProjectIdRef.current === project.id) setError(cause instanceof Error ? cause.message : "Could not load Git changes")
    } finally {
      if (requestId === gitDiffRequestRef.current) setGitDiffLoading(false)
    }
  }, [])

  const selectProject = useCallback(async (project: Project) => {
    const requestId = ++projectRequestRef.current
    ++sessionRequestRef.current
    ++modelRequestRef.current
    activeProjectIdRef.current = project.id
    activeSessionPathRef.current = null
    composerEpochRef.current += 1
    draftRevisionRef.current += 1
    attachmentRevisionRef.current += 1
    setActiveProject(project)
    ++gitDiffRequestRef.current
    setGitPaneOpen(false)
    setGitDiff(null)
    setGitDiffLoading(false)
    setSession(null)
    setPendingAttachments([])
    setLightboxImage(null)
    setLiveThinking(null)
    setDraft("")
    setSessions([])
    setModelOptions([])
    setInteractionRequest(null)
    setInteractionSubmitting(false)
    setRecoverySubmitting(false)
    interactionSubmittingRef.current = false
    setLoadingSessions(true)
    setError(null)
    void refreshProjectGit(project)
    try {
      const nextSessions = await desktopApi.sessions.list(project.path)
      if (requestId !== projectRequestRef.current || activeProjectIdRef.current !== project.id) return
      setSessions(nextSessions)
      const first = nextSessions.find((candidate) => !candidate.name.toLocaleLowerCase().startsWith("subagent:")) ?? nextSessions[0]
      if (first) await openSession(project, first)
    } catch (cause) {
      if (requestId === projectRequestRef.current && activeProjectIdRef.current === project.id) {
        setError(cause instanceof Error ? cause.message : "Could not load project sessions")
      }
    } finally {
      if (requestId === projectRequestRef.current) setLoadingSessions(false)
    }
  }, [openSession, refreshProjectGit])

  useEffect(() => {
    void desktopApi.projects.list().then((items) => {
      setProjects(items)
      const first = items[0]
      if (first) void selectProject(first)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load projects")
    })
  }, [selectProject])

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
    if (!subagentPaneOpen || !selectedSubagent || !activeProject) return
    const interval = window.setInterval(() => {
      void inspectSubagent(activeProject, selectedSubagent, false)
    }, 2500)
    return () => window.clearInterval(interval)
  }, [activeProject, inspectSubagent, selectedSubagent, subagentPaneOpen])

  useEffect(() => desktopApi.onSessionEvent((event: SessionEvent) => {
    if (event.type === "error") {
      if (event.sessionPath && event.sessionPath !== activeSessionPathRef.current) return
      setError(event.message)
      return
    }
    if (event.type === "project-git") {
      gitRequestRef.current += 1
      const project = activeProjectRef.current
      if (!project || project.path !== event.projectPath) return
      const updateProject = (current: Project) => current.path === event.projectPath
        ? event.git ? { ...current, git: event.git } : { id: current.id, path: current.path, name: current.name, addedAt: current.addedAt }
        : current
      setProjects((current) => current.map(updateProject))
      setActiveProject((current) => current ? updateProject(current) : current)
      if (gitPaneOpen) void loadGitDiff(project)
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
      setRecoverySubmitting(false)
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
          if (!project) return
          void desktopApi.sessions.list(project.path).then((nextSessions) => {
            if (activeProjectRef.current?.id === project.id) setSessions(nextSessions)
          })
        }, 1200)
      }
    }
    if (event.type === "agent-status") {
      if (!event.isStreaming) setLiveThinking(null)
    }
    setSession((current) => reduceSessionEvent(current, activeSessionPathRef.current, event))
  }), [gitPaneOpen, loadGitDiff])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: session?.isStreaming ? "instant" : "smooth", block: "end" })
  }, [session?.messages, session?.isStreaming])

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
      const project = await desktopApi.projects.add()
      if (!project) return
      setProjects((current) => current.some((item) => item.id === project.id) ? current : [...current, project])
      await selectProject(project)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add project")
    } finally {
      addingProjectRef.current = false
    }
  }

  const newSession = useCallback(async () => {
    if (!activeProject) return
    const project = activeProject
    const requestId = ++sessionRequestRef.current
    setError(null)
    try {
      const detail = await desktopApi.sessions.create(project.path)
      if (requestId !== sessionRequestRef.current || activeProjectIdRef.current !== project.id) return
      activeSessionPathRef.current = detail.summary.path
      setSession(detail)
      setInteractionRequest(detail.interactionRequest ?? null)
      composerEpochRef.current += 1
      draftRevisionRef.current += 1
      attachmentRevisionRef.current += 1
      setPendingAttachments([])
      setLightboxImage(null)
      setLiveThinking(null)
      setDraft("")
      setInteractionSubmitting(false)
      interactionSubmittingRef.current = false
      setSessions((current) => [detail.summary, ...current.filter((item) => item.path !== detail.summary.path)])
      void loadModels(detail.summary.path)
    } catch (cause) {
      if (requestId === sessionRequestRef.current && activeProjectIdRef.current === project.id) {
        setError(cause instanceof Error ? cause.message : "Could not create session")
      }
    }
  }, [activeProject, loadModels])

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
    if (!request || !sessionPath || interactionSubmittingRef.current) return
    interactionSubmittingRef.current = true
    setInteractionSubmitting(true)
    void desktopApi.sessions.answerInteraction(sessionPath, request.requestId, answer).then(() => {
      setInteractionRequest((current) => current?.requestId === request.requestId ? null : current)
    }).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath) return
      setError(cause instanceof Error ? cause.message : "Could not deliver the answer to Pi")
    }).finally(() => {
      interactionSubmittingRef.current = false
      if (activeSessionPathRef.current === sessionPath) setInteractionSubmitting(false)
    })
  }

  const sendPrompt = (delivery: QueueDelivery = "follow-up") => {
    const rawText = draft.trim()
    const attachmentPaths = pendingAttachments.map((attachment) => attachment.path)
    const text = normalizeImageReferences(rawText, attachmentPaths)
    if (!text.trim() || !session) return
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
    void desktopApi.sessions.prompt(sessionPath, rawText, delivery, attachmentPaths).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath) return
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

  const recoverSession = (action: SessionRecoveryAction) => {
    if (!session || recoverySubmitting) return
    const sessionPath = session.summary.path
    setRecoverySubmitting(true)
    setError(null)
    if (action !== "resume") setSession((current) => current ? { ...current, recovery: undefined, isStreaming: true } : current)
    void desktopApi.sessions.recover(sessionPath, action).then((detail) => {
      if (activeSessionPathRef.current !== sessionPath) return
      setSession(detail)
      setInteractionRequest(detail.interactionRequest ?? null)
    }).catch(async (cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath) return
      setError(cause instanceof Error ? cause.message : "Pi could not recover this session")
      const project = activeProjectRef.current
      if (action !== "resume" && project) {
        try {
          const detail = await desktopApi.sessions.open(project.path, sessionPath)
          if (activeSessionPathRef.current === sessionPath) setSession(detail)
        } catch {
          // Keep the original recovery failure visible; a later explicit reopen
          // can retry loading the preserved Pi state.
        }
      }
    }).finally(() => {
      if (activeSessionPathRef.current === sessionPath) setRecoverySubmitting(false)
    })
  }

  const addPastedImage = async (image: File) => {
    if (!session) return
    const sessionPath = session.summary.path
    const epoch = composerEpochRef.current
    try {
      const bytes = new Uint8Array(await image.arrayBuffer())
      const attachment = await desktopApi.attachments.save(bytes, image.name, image.type)
      if (activeSessionPathRef.current !== sessionPath || composerEpochRef.current !== epoch) return
      attachmentRevisionRef.current += 1
      setPendingAttachments((current) => [...current, attachment])
      setError(null)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath && composerEpochRef.current === epoch) {
        setError(cause instanceof Error ? cause.message : "Could not save the pasted image")
      }
    }
  }

  const abort = () => {
    if (!session) return
    const sessionPath = session.summary.path
    void desktopApi.sessions.abort(sessionPath).catch((cause: unknown) => {
      if (activeSessionPathRef.current !== sessionPath) return
      setError(cause instanceof Error ? cause.message : "Could not stop Pi")
    })
  }

  const editQueuedMessage = async (message: QueuedMessage, text: string) => {
    if (!session) return
    const sessionPath = session.summary.path
    try {
      await desktopApi.sessions.editQueuedMessage(sessionPath, message.id, text)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath) {
        setError(cause instanceof Error ? cause.message : "Could not edit the queued message")
      }
      throw cause
    }
  }

  const removeQueuedMessage = async (message: QueuedMessage) => {
    if (!session) return
    const sessionPath = session.summary.path
    try {
      await desktopApi.sessions.removeQueuedMessage(sessionPath, message.id)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath) {
        setError(cause instanceof Error ? cause.message : "Could not remove the queued message")
      }
      throw cause
    }
  }

  const steerQueuedMessage = async (message: QueuedMessage) => {
    if (!session) return
    const sessionPath = session.summary.path
    try {
      await desktopApi.sessions.steerQueuedMessage(sessionPath, message.id)
    } catch (cause) {
      if (activeSessionPathRef.current === sessionPath) {
        setError(cause instanceof Error ? cause.message : "Could not steer the queued message")
      }
      throw cause
    }
  }

  const displayMessages: ReadonlyArray<ChatMessage> = session?.isCompacting
    ? [...session.messages, { id: "compaction-active", role: "system", blocks: [{ type: "compaction", status: "compacting" }], timestamp: Date.now() }]
    : session?.messages ?? []
  const conversationItems = buildConversationItems(displayMessages)
  const recoveryTurnIndex = session?.recovery ? findLastUserTurnIndex(conversationItems) : -1
  const conversationLandmarks = buildConversationPreviewLandmarks(conversationItems)
  const allPreviewLandmarks = filterUserMessagePreviewLandmarks(conversationLandmarks)
  const previewStride = Math.max(1, Math.ceil(allPreviewLandmarks.length / 28))
  const previewLandmarks = allPreviewLandmarks.filter((_landmark, index) => index === 0 || index === allPreviewLandmarks.length - 1 || index % previewStride === 0)
  const lastActivityIndex = conversationItems.findLastIndex((item) => item.type === "activity")
  const linkedSubagents = sessions.filter((candidate) => candidate.parentSessionPath === session?.summary.path)
  const sidebarSessions = sessions.filter((candidate) => !candidate.parentSessionPath)
  const backgroundProcesses = (session?.backgroundProcesses ?? []).filter((process) => process.status === "running")
  const runningProcesses = backgroundProcesses.length
  const liveStatus = liveThinking ? latestTransientStatus(liveThinking.text) : undefined
  const git: GitStatus | undefined = activeProject?.git
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
        <div className="titlebar-center">{activeProject?.name ?? "Desktop"}</div>
        <div className="titlebar-actions" />
      </header>

      <div className={`workspace-layout ${(gitPaneOpen || (subagentPaneOpen && linkedSubagents.length > 0) || (backgroundPaneOpen && backgroundProcesses.length > 0)) ? "with-subagents" : ""} ${gitPaneOpen ? "with-git" : ""}`}>
        <ProjectSidebar
          projects={projects}
          sessions={sidebarSessions}
          activeProject={activeProject}
          activeSessionPath={session?.summary.path ?? null}
          isLoading={loadingSessions}
          onSelectProject={(project) => void selectProject(project)}
          onSelectSession={(summary) => activeProject && void openSession(activeProject, summary)}
          onAddProject={() => void addProject()}
          onNewSession={() => void newSession()}
        />

        <main className={`conversation ${interactionRequest ? "has-interaction" : ""}`} id="main-content">
          <div className="conversation-header">
            <div className="conversation-title">
              <span className="eyebrow">{activeProject?.name ?? "Workspace"}</span>
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
                      if (!activeProject) return
                      setSubagentPaneOpen(false)
                      setBackgroundPaneOpen(false)
                      setGitPaneOpen(true)
                      void loadGitDiff(activeProject)
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
              {linkedSubagents.length > 0 && activeProject && (
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
                    if (first) void inspectSubagent(activeProject, first)
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
            <div className={styles.sessionNotices}>
              <AskUserPanel request={interactionRequest} submitting={interactionSubmitting} onAnswer={answerInteraction} />
            </div>
          )}

          <div className="message-scroll-shell">
            {conversationItems.length > 0 && (
              <MessagePreviewRail landmarks={previewLandmarks} totalCount={allPreviewLandmarks.length} scrollRootRef={messageScrollRef} />
            )}
            <div className="message-scroll" ref={messageScrollRef}>
            {displayMessages.length ? (
              <div className="message-list">
                {conversationItems.map((item, index) => {
                  const landmark = conversationLandmarks[index]
                  return (
                    <Fragment key={item.id}>
                      {item.type === "message"
                        ? <MessageView message={item.message} anchorId={landmark?.targetId} onOpenImage={setLightboxImage} />
                        : <ActivityGroup messages={item.messages} anchorId={landmark?.targetId} isLive={(session?.isStreaming ?? false) && index === lastActivityIndex} onOpenImage={setLightboxImage} />}
                      {session?.recovery && index === recoveryTurnIndex && (
                        <TransportRecoveryPanel recovery={session.recovery} queuedCount={session.queuedMessages.length} busy={recoverySubmitting} onRecover={recoverSession} />
                      )}
                    </Fragment>
                  )
                })}
                {session?.recovery && recoveryTurnIndex < 0 && (
                  <TransportRecoveryPanel recovery={session.recovery} queuedCount={session.queuedMessages.length} busy={recoverySubmitting} onRecover={recoverSession} />
                )}
                {session?.isStreaming && (
                  <div className="live-status" role="status" aria-live="polite">
                    <CircleDashed size={14} />
                    <span>{liveStatus ?? "Thinking"}</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            ) : activeProject ? (
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

          {error && <div className="error-toast" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
          <Composer
            key={session?.summary.path ?? "no-session"}
            value={draft}
            disabled={!session || interactionRequest !== null || session.recovery !== undefined || recoverySubmitting}
            disabledReason={interactionRequest ? "Answer Pi above to continue…" : session?.recovery ? "Choose how to recover below your last message…" : recoverySubmitting ? "Recovering Pi session…" : undefined}
            attachments={pendingAttachments}
            isStreaming={session?.isStreaming ?? false}
            model={session?.model.split("/").at(-1) ?? "Choose model"}
            modelProvider={session?.model.includes("/") ? session.model.split("/")[0] : undefined}
            modelOptions={modelOptions}
            thinkingLevel={session?.thinkingLevel ?? "off"}
            availableThinkingLevels={session?.availableThinkingLevels ?? []}
            queuedMessages={session?.queuedMessages ?? []}
            contextUsage={session?.contextUsage}
            onModelChange={(option) => {
              if (!session) return
              const sessionPath = session.summary.path
              void desktopApi.sessions.setModel(sessionPath, option.provider, option.id)
                .then((detail) => {
                  if (activeSessionPathRef.current === sessionPath) {
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
                  if (activeSessionPathRef.current === sessionPath) {
                    setError(cause instanceof Error ? cause.message : "Could not change model")
                  }
                })
            }}
            onThinkingLevelChange={(level: ThinkingLevel) => {
              if (!session) return
              const sessionPath = session.summary.path
              void desktopApi.sessions.setThinkingLevel(sessionPath, level)
                .then((detail) => {
                  if (activeSessionPathRef.current === sessionPath) {
                    setSession((current) => current ? {
                      ...current,
                      thinkingLevel: detail.thinkingLevel,
                      availableThinkingLevels: detail.availableThinkingLevels,
                      contextUsage: detail.contextUsage
                    } : current)
                  }
                })
                .catch((cause: unknown) => {
                  if (activeSessionPathRef.current === sessionPath) setError(cause instanceof Error ? cause.message : "Could not change effort")
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

        {subagentPaneOpen && !backgroundPaneOpen && linkedSubagents.length > 0 && activeProject && (
          <SubagentPane
            sessions={linkedSubagents}
            selectedPath={selectedSubagent?.path ?? null}
            detail={subagentDetail}
            loading={subagentLoading}
            onSelect={(summary) => void inspectSubagent(activeProject, summary)}
            onRefresh={() => selectedSubagent && void inspectSubagent(activeProject, selectedSubagent, false)}
            onClose={() => setSubagentPaneOpen(false)}
            onOpenImage={setLightboxImage}
          />
        )}
        {backgroundPaneOpen && backgroundProcesses.length > 0 && (
          <BackgroundProcessesPane processes={backgroundProcesses} onClose={() => setBackgroundPaneOpen(false)} />
        )}
        {gitPaneOpen && activeProject && (
          <Suspense fallback={<aside className={gitDiffStyles.root} aria-label="Git changes"><div className={gitDiffStyles.loading}><RefreshCw size={16} /> Preparing diff…</div></aside>}>
            <GitDiffPane
              diff={gitDiff}
              loading={gitDiffLoading}
              onClose={() => setGitPaneOpen(false)}
              onRefresh={() => void loadGitDiff(activeProject)}
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
