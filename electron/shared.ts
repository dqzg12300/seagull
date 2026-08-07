export type WorkerCommand =
  | { type: "initialize"; cwd: string; caseId?: string; workId?: string; caseRoot?: string; settings?: AppSettings; invalidate?: boolean }
  | { type: "prompt"; text: string; images?: ImageAttachment[] }
  | { type: "abort" }
  | { type: "shutdown" };

export type WorkerEvent =
  | { type: "ready"; sessionId: string; sessionFile?: string; tools: string[]; history?: unknown[]; cacheHit?: boolean }
  | { type: "tools"; tools: string[] }
  | { type: "agent-event"; event: unknown }
  | { type: "state"; streaming: boolean; model?: string; thinkingLevel?: string }
  | { type: "error"; message: string; stack?: string }
  | { type: "log"; channel: string; message: string }
  | { type: "queue"; items: PromptQueueItemView[] };

export type RoutedWorkerEvent = WorkerEvent & { sessionKey?: string; caseId?: string; workId?: string };

export type PromptQueueStatus = "queued" | "running";
export interface PromptQueueItemView {
  id: string;
  caseId?: string;
  workId?: string;
  displayText: string;
  status: PromptQueueStatus;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
}

export interface CaseStateView {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: string;
  target?: string;
  sha256?: string;
  notes: string[];
  artifacts: string[];
  artifactTypes?: Record<string, "file" | "directory" | "missing">;
  analysisGoal?: string;
  analysisCategory?: AnalysisCategory;
  analysisRequests?: Array<{ id: string; goal: string; category?: AnalysisCategory; createdAt: string }>;
  activeRun?: AnalysisRunView;
  workspaceDir?: string;
  description?: string;
  works?: WorkView[];
  activeWorkId?: string;
  title?: string;
  platform?: CasePlatform;
  inputs?: CaseInput[];
  primaryInputId?: string;
}

export type CasePlatform = "android" | "native" | "protocol" | "general";
export type CaseInputType = "apk" | "device-package" | "project" | "native-library" | "dex" | "log" | "document" | "capture" | "other";
export interface CaseInput { id: string; type: CaseInputType; name: string; path?: string; packageName?: string; sha256?: string; metadata?: Record<string, string>; addedAt: string }
export interface CaseInputDraft { type: CaseInputType; name: string; path?: string; packageName?: string; metadata?: Record<string, string> }
export interface CreateCaseRequest { title: string; description?: string; platform: CasePlatform; inputs?: CaseInputDraft[]; primaryInputIndex?: number }
export interface AdbPackageInfo { serial: string; packageName: string; model?: string }
export interface AdbDeviceInfo { serial: string; state: string; model?: string }
export interface InstallableApk { path: string; name: string; size: number; modifiedAt: string }
export interface WorkActionResult { success: true; message: string; output?: string }
export interface TerminalSessionInfo { id: string; title: string; cwd: string }
export type TerminalEvent =
  | { type: "output"; terminalId: string; data: string }
  | { type: "exit"; terminalId: string; code: number | null }
  | { type: "error"; terminalId: string; message: string };

export type AnalysisCategory = "deobfuscation" | "report" | "parameter-trace" | "algorithm-recovery" | "data-collection" | "runtime-diagnostics" | "protocol-recovery" | "version-diff" | "app-reconstruction" | "app-development";

export interface AnalysisRunStageView {
  id: string;
  label: string;
  route?: string;
  successCriteria?: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
}

export interface AnalysisRunView {
  id: string;
  requestId: string;
  goal: string;
  startedAt: string;
  updatedAt: string;
  status: "planning" | "running" | "completed" | "failed";
  stages: AnalysisRunStageView[];
  objectives?: string[];
  rationale?: string;
  taskDir?: string;
  workspaceDir?: string;
  upstreamArtifacts?: string[];
}

export interface WorkView {
  id: string;
  title: string;
  goal: string;
  category: AnalysisCategory;
  createdAt: string;
  updatedAt: string;
  status: AnalysisRunView["status"];
  run: AnalysisRunView;
  artifactSnapshot?: string[];
  artifacts?: string[];
  upstreamWorkIds?: string[];
}

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  outputRoot: string;
}

export interface ImageAttachment { name: string; mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string }
export interface McpReadiness { server: string; ready: boolean; detail: string }
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: "bundled" | "installed" | "catalog";
  installed: boolean;
  path?: string;
  repository?: string;
}
export interface DirectoryEntryInfo { name: string; path: string; type: "file" | "directory" }
export interface AttachedFileInfo { name: string; path: string; size: number; extension: string }
export interface CaseWorkSummary { id: string; title: string; category: AnalysisCategory; createdAt: string }
export interface CaseSummary {
  id: string;
  target?: string;
  sha256?: string;
  updatedAt: string;
  phase: string;
  analysisCategory?: AnalysisCategory;
  artifactCount: number;
  description?: string;
  title?: string;
  platform?: CasePlatform;
  inputCount?: number;
  works?: CaseWorkSummary[];
}

export interface DesktopApi {
  readonly apiVersion: number;
  selectApk(): Promise<string | undefined>;
  selectCaseFiles(): Promise<string[]>;
  selectProjectDirectory(): Promise<string | undefined>;
  listAdbPackages(): Promise<AdbPackageInfo[]>;
  listAdbDevices(): Promise<AdbDeviceInfo[]>;
  listWorkApks(caseId: string, workId: string): Promise<InstallableApk[]>;
  buildWork(caseId: string, workId: string, clean?: boolean): Promise<WorkActionResult>;
  installWorkApk(serial: string, apkPath: string): Promise<WorkActionResult>;
  createCase(request: CreateCaseRequest): Promise<CaseStateView>;
  addCaseInputs(caseId: string, inputs: CaseInputDraft[]): Promise<CaseStateView>;
  openCaseInput(caseId: string, inputId: string): Promise<void>;
  revealCaseInput(caseId: string, inputId: string): Promise<void>;
  selectOutputDirectory(): Promise<string | undefined>;
  importAttachments(caseId: string, workId?: string): Promise<AttachedFileInfo[]>;
  openCaseDirectory(caseId: string): Promise<void>;
  openWorkDirectory(caseId: string, workId: string): Promise<void>;
  openArtifact(filename: string): Promise<void>;
  revealArtifact(filename: string): Promise<void>;
  openArtifactTerminal(filename: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  createTerminal(cwd: string, title?: string, initialCommand?: string): Promise<TerminalSessionInfo>;
  writeTerminal(terminalId: string, data: string): void;
  resizeTerminal(terminalId: string, cols: number, rows: number): void;
  closeTerminal(terminalId: string): Promise<void>;
  checkMcpReadiness(server: string): Promise<McpReadiness>;
  listSkills(): Promise<SkillInfo[]>;
  searchSkills(query: string): Promise<SkillInfo[]>;
  installSkill(idOrUrl: string): Promise<SkillInfo>;
  identifyApk(filename: string): Promise<{ caseId: string; existing?: CaseStateView }>;
  initialize(caseId?: string, workId?: string, force?: boolean): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  listModels(settings: AppSettings): Promise<string[]>;
  prompt(caseId: string | undefined, workId: string | undefined, text: string, displayText: string, images?: ImageAttachment[]): Promise<PromptQueueItemView>;
  abort(caseId?: string, workId?: string): Promise<void>;
  listPromptQueue(caseId?: string, workId?: string): Promise<PromptQueueItemView[]>;
  updateQueuedPrompt(caseId: string | undefined, workId: string | undefined, promptId: string, displayText: string): Promise<PromptQueueItemView[]>;
  moveQueuedPrompt(caseId: string | undefined, workId: string | undefined, promptId: string, direction: "up" | "down"): Promise<PromptQueueItemView[]>;
  deleteQueuedPrompt(caseId: string | undefined, workId: string | undefined, promptId: string): Promise<PromptQueueItemView[]>;
  readCase(caseId: string): Promise<CaseStateView | undefined>;
  listCases(): Promise<CaseSummary[]>;
  deleteCase(caseId: string): Promise<boolean>;
  deleteAnalysisRequest(caseId: string, requestId: string): Promise<CaseStateView>;
  updateCaseDescription(caseId: string, description: string): Promise<CaseStateView>;
  saveAnalysisRequest(caseId: string, goal: string, category: AnalysisCategory): Promise<CaseStateView>;
  switchWork(caseId: string, workId: string): Promise<CaseStateView>;
  deleteWork(caseId: string, workId: string): Promise<CaseStateView>;
  renameWork(caseId: string, workId: string, title: string): Promise<CaseStateView>;
  updateWork(caseId: string, workId: string, update: { title: string; category: AnalysisCategory }): Promise<CaseStateView>;
  readTextFile(filename: string): Promise<string>;
  listDirectory(directory: string): Promise<DirectoryEntryInfo[]>;
  onWorkerEvent(listener: (event: RoutedWorkerEvent) => void): () => void;
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;
}
