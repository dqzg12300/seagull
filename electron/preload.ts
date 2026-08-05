import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, TerminalEvent, WorkerEvent } from "./shared.js";

const api: DesktopApi = {
  apiVersion: 16,
  selectApk: () => ipcRenderer.invoke("desktop:select-apk"),
  selectCaseFiles: () => ipcRenderer.invoke("desktop:select-case-files"),
  selectProjectDirectory: () => ipcRenderer.invoke("desktop:select-project-directory"),
  listAdbPackages: () => ipcRenderer.invoke("desktop:list-adb-packages"),
  listAdbDevices: () => ipcRenderer.invoke("desktop:list-adb-devices"),
  listWorkApks: (caseId, workId) => ipcRenderer.invoke("case:list-work-apks", caseId, workId),
  buildWork: (caseId, workId) => ipcRenderer.invoke("work:build", caseId, workId),
  installWorkApk: (serial, apkPath) => ipcRenderer.invoke("work:install-apk", serial, apkPath),
  createCase: request => ipcRenderer.invoke("case:create", request),
  addCaseInputs: (caseId, inputs) => ipcRenderer.invoke("case:add-inputs", caseId, inputs),
  openCaseInput: (caseId, inputId) => ipcRenderer.invoke("case:open-input", caseId, inputId),
  selectOutputDirectory: () => ipcRenderer.invoke("desktop:select-output-directory"),
  importAttachments: (caseId, workId) => ipcRenderer.invoke("desktop:import-attachments", caseId, workId),
  openCaseDirectory: caseId => ipcRenderer.invoke("desktop:open-case-directory", caseId),
  openWorkDirectory: (caseId, workId) => ipcRenderer.invoke("desktop:open-work-directory", caseId, workId),
  openArtifact: filename => ipcRenderer.invoke("desktop:open-artifact", filename),
  revealArtifact: filename => ipcRenderer.invoke("desktop:reveal-artifact", filename),
  openArtifactTerminal: filename => ipcRenderer.invoke("desktop:open-artifact-terminal", filename),
  createTerminal: (cwd, title, initialCommand) => ipcRenderer.invoke("terminal:create", cwd, title, initialCommand),
  writeTerminal: (terminalId, data) => ipcRenderer.send("terminal:write", terminalId, data),
  resizeTerminal: (terminalId, cols, rows) => ipcRenderer.send("terminal:resize", terminalId, cols, rows),
  closeTerminal: terminalId => ipcRenderer.invoke("terminal:close", terminalId),
  checkMcpReadiness: server => ipcRenderer.invoke("mcp:check-readiness", server),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  searchSkills: query => ipcRenderer.invoke("skills:search", query),
  installSkill: idOrUrl => ipcRenderer.invoke("skills:install", idOrUrl),
  identifyApk: filename => ipcRenderer.invoke("desktop:identify-apk", filename),
  initialize: (caseId, force) => ipcRenderer.invoke("agent:initialize", caseId, force),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),
  listModels: settings => ipcRenderer.invoke("settings:list-models", settings),
  prompt: (text, images) => ipcRenderer.invoke("agent:prompt", text, images),
  abort: () => ipcRenderer.invoke("agent:abort"),
  readCase: caseId => ipcRenderer.invoke("case:read", caseId),
  listCases: () => ipcRenderer.invoke("case:list"),
  deleteCase: caseId => ipcRenderer.invoke("case:delete", caseId),
  deleteAnalysisRequest: (caseId, requestId) => ipcRenderer.invoke("case:delete-analysis-request", caseId, requestId),
  updateCaseDescription: (caseId, description) => ipcRenderer.invoke("case:update-description", caseId, description),
  saveAnalysisRequest: (caseId, goal, category) => ipcRenderer.invoke("case:save-analysis-request", caseId, goal, category),
  switchWork: (caseId, workId) => ipcRenderer.invoke("case:switch-work", caseId, workId),
  deleteWork: (caseId, workId) => ipcRenderer.invoke("case:delete-work", caseId, workId),
  renameWork: (caseId, workId, title) => ipcRenderer.invoke("case:rename-work", caseId, workId, title),
  readTextFile: filename => ipcRenderer.invoke("file:read-text", filename),
  listDirectory: directory => ipcRenderer.invoke("file:list-directory", directory),
  onWorkerEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, data: WorkerEvent) => listener(data);
    ipcRenderer.on("worker:event", handler);
    return () => ipcRenderer.removeListener("worker:event", handler);
  },
  onTerminalEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, data: TerminalEvent) => listener(data);
    ipcRenderer.on("terminal:event", handler);
    return () => ipcRenderer.removeListener("terminal:event", handler);
  },
};

contextBridge.exposeInMainWorld("mobileReverse", api);
