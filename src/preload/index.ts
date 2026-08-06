import { contextBridge, ipcRenderer } from "electron"
import type { AskUserInteractionAnswer, PiDesktopApi, SessionEvent } from "../shared/contracts"
import { IpcChannels } from "../shared/contracts"

const api: PiDesktopApi = {
  attachments: {
    save: (bytes, name, mimeType) => ipcRenderer.invoke(IpcChannels.saveAttachment, { bytes, name, mimeType }),
    preview: (path) => ipcRenderer.invoke(IpcChannels.previewAttachment, path)
  },
  projects: {
    list: () => ipcRenderer.invoke(IpcChannels.listProjects),
    add: () => ipcRenderer.invoke(IpcChannels.addProject),
    remove: (projectId) => ipcRenderer.invoke(IpcChannels.removeProject, projectId),
    refreshGit: (context) => ipcRenderer.invoke(IpcChannels.refreshProjectGit, context),
    diff: (context) => ipcRenderer.invoke(IpcChannels.gitDiff, context),
    sessionDraft: (context) => ipcRenderer.invoke(IpcChannels.sessionDraft, context)
  },
  sessions: {
    list: (context) => ipcRenderer.invoke(IpcChannels.listSessions, context),
    start: (context, requestId, text, baseBranch, attachmentPaths) => ipcRenderer.invoke(IpcChannels.startSession, context, requestId, text, baseBranch, attachmentPaths),
    open: (context, sessionPath) => ipcRenderer.invoke(IpcChannels.openSession, context, sessionPath),
    inspect: (context, parentSessionPath, sessionPath) => ipcRenderer.invoke(IpcChannels.inspectSession, context, parentSessionPath, sessionPath),
    prompt: (context, sessionPath, text, delivery, attachmentPaths) => ipcRenderer.invoke(IpcChannels.promptSession, context, sessionPath, text, delivery, attachmentPaths),
    editQueuedMessage: (context, sessionPath, messageId, text) => ipcRenderer.invoke(IpcChannels.editQueuedMessage, context, sessionPath, messageId, text),
    removeQueuedMessage: (context, sessionPath, messageId) => ipcRenderer.invoke(IpcChannels.removeQueuedMessage, context, sessionPath, messageId),
    steerQueuedMessage: (context, sessionPath, messageId) => ipcRenderer.invoke(IpcChannels.steerQueuedMessage, context, sessionPath, messageId),
    abort: (context, sessionPath) => ipcRenderer.invoke(IpcChannels.abortSession, context, sessionPath),
    models: (context, sessionPath) => ipcRenderer.invoke(IpcChannels.listModels, context, sessionPath),
    setModel: (context, sessionPath, provider, modelId) => ipcRenderer.invoke(IpcChannels.setModel, context, sessionPath, provider, modelId),
    setThinkingLevel: (context, sessionPath, level) => ipcRenderer.invoke(IpcChannels.setThinkingLevel, context, sessionPath, level),
    answerInteraction: (context, sessionPath, requestId, answer: AskUserInteractionAnswer) => ipcRenderer.invoke(IpcChannels.answerInteraction, context, sessionPath, requestId, answer)
  },
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => listener(payload)
    ipcRenderer.on(IpcChannels.sessionEvent, handler)
    return () => ipcRenderer.removeListener(IpcChannels.sessionEvent, handler)
  }
}

contextBridge.exposeInMainWorld("piDesktop", api)
