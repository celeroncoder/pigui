import { contextBridge, ipcRenderer } from "electron"
import type { PiDesktopApi, SessionEvent } from "../shared/contracts"
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
    refreshGit: (projectPath) => ipcRenderer.invoke(IpcChannels.refreshProjectGit, projectPath)
  },
  sessions: {
    list: (projectPath) => ipcRenderer.invoke(IpcChannels.listSessions, projectPath),
    create: (projectPath) => ipcRenderer.invoke(IpcChannels.createSession, projectPath),
    open: (projectPath, sessionPath) => ipcRenderer.invoke(IpcChannels.openSession, projectPath, sessionPath),
    inspect: (projectPath, parentSessionPath, sessionPath) => ipcRenderer.invoke(IpcChannels.inspectSession, projectPath, parentSessionPath, sessionPath),
    prompt: (sessionPath, text, delivery, attachmentPaths) => ipcRenderer.invoke(IpcChannels.promptSession, sessionPath, text, delivery, attachmentPaths),
    editQueuedMessage: (sessionPath, messageId, text) => ipcRenderer.invoke(IpcChannels.editQueuedMessage, sessionPath, messageId, text),
    removeQueuedMessage: (sessionPath, messageId) => ipcRenderer.invoke(IpcChannels.removeQueuedMessage, sessionPath, messageId),
    steerQueuedMessage: (sessionPath, messageId) => ipcRenderer.invoke(IpcChannels.steerQueuedMessage, sessionPath, messageId),
    abort: (sessionPath) => ipcRenderer.invoke(IpcChannels.abortSession, sessionPath),
    models: (sessionPath) => ipcRenderer.invoke(IpcChannels.listModels, sessionPath),
    setModel: (sessionPath, provider, modelId) => ipcRenderer.invoke(IpcChannels.setModel, sessionPath, provider, modelId),
    setThinkingLevel: (sessionPath, level) => ipcRenderer.invoke(IpcChannels.setThinkingLevel, sessionPath, level)
  },
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => listener(payload)
    ipcRenderer.on(IpcChannels.sessionEvent, handler)
    return () => ipcRenderer.removeListener(IpcChannels.sessionEvent, handler)
  }
}

contextBridge.exposeInMainWorld("piDesktop", api)
