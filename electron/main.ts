import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import { execFile, fork, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { AdbDeviceInfo, AnalysisCategory, AppSettings, CaseInput, CaseInputDraft, CaseSummary, CreateCaseRequest, ImageAttachment, InstallableApk, PromptQueueItemView, RoutedWorkerEvent, TerminalEvent, TerminalSessionInfo, WorkerCommand, WorkerEvent } from "./shared.js";
import { installSkill, listSkills, searchSkills } from "./skills-manager.js";
import { chooseGradleScript, decodeProcessText, gradleBuildTasks, gradleLockedCleanDirectories, parseGradleDistributionProperties, windowsBatchCommand } from "./gradle-support.js";
import { applyLegacyWorkInheritance } from "./work-session.js";
import { orderedCaseWorkSummaries } from "./case-summary.js";
import { applyWorkMetadataUpdate } from "./work-metadata.js";
import { moveQueuedPrompt, promptQueueView, replaceQueuedPromptDisplay, type StoredPromptQueueItem } from "./prompt-queue.js";
import { allIndexedArtifacts, rebuildWorkArtifactOwnership } from "./work-artifacts.js";

const projectRoot = path.resolve(__dirname, "../..");
let mainWindow: BrowserWindow | undefined;
type AgentRuntime = {
  key: string;
  caseId?: string;
  workId?: string;
  worker: ChildProcess;
  ready: boolean;
  streaming: boolean;
  paused: boolean;
  currentPromptId?: string;
  pendingInitialization?: { resolves: Array<() => void>; rejects: Array<(error: Error) => void>; timer: NodeJS.Timeout };
  journal: WorkerEvent[];
  queue?: StoredPromptQueueItem[];
  queueTask: Promise<unknown>;
};
const agentRuntimes = new Map<string, AgentRuntime>();
const terminals = new Map<string, { info: TerminalSessionInfo; process: IPty }>();
const settingsFile = path.join(projectRoot, ".pi", "desktop-settings.json");
const legacyCasesRoot = path.join(projectRoot, ".pi", "cases");
const execFileAsync = promisify(execFile);

async function withCaseStateLock<T>(caseDir: string, action: () => Promise<T>): Promise<T> {
  const lockFile = path.join(caseDir, ".state.lock");
  let handle;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try { handle = await open(lockFile, "wx"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lockFile)).mtimeMs > 120_000) await unlink(lockFile); } catch { /* released */ }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error("Timed out locking CASE state");
  try { return await action(); }
  finally { await handle.close(); try { await unlink(lockFile); } catch { /* released */ } }
}

async function mutateCaseState<T = unknown>(caseId: string, mutate: (state: any, caseDir: string) => Promise<T> | T): Promise<{ state: any; result: T }> {
  const caseDir = await findCaseDir(caseId);
  return withCaseStateLock(caseDir, async () => {
    const stateFile = path.join(caseDir, "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const result = await mutate(state, caseDir);
    await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
    return { state, result };
  });
}

function sendTerminalEvent(event: TerminalEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("terminal:event", event);
}

function commandFailure(label: string, error: unknown): Error {
  const detail = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  const stdout = decodeProcessText(detail.stdout).trim();
  const stderr = decodeProcessText(detail.stderr).trim();
  const tail = [stderr, stdout].filter(Boolean).join("\n").slice(-4_000);
  return new Error(`${label} failed${tail ? `:\n${tail}` : detail.message ? `: ${detail.message}` : ""}`);
}

function commandOutput(error: unknown): string {
  const detail = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  return [decodeProcessText(detail.stderr), decodeProcessText(detail.stdout), detail.message].filter(Boolean).join("\n");
}

async function directoryContainsFile(directory: string): Promise<boolean> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return false; }
  for (const entry of entries) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && await directoryContainsFile(path.join(directory, entry.name))) return true;
  }
  return false;
}

async function cleanRemovedAllFiles(error: unknown, projectDir: string): Promise<boolean> {
  const matches = gradleLockedCleanDirectories(commandOutput(error));
  if (!matches.length) return false;
  const normalizedProject = path.resolve(projectDir).toLowerCase();
  for (const candidate of matches) {
    const resolved = path.resolve(candidate);
    const normalized = resolved.toLowerCase();
    if (normalized !== normalizedProject && !normalized.startsWith(normalizedProject + path.sep)) return false;
    if (await directoryContainsFile(resolved)) return false;
  }
  return true;
}

async function closeIntegratedBuildTerminals(projectDir: string): Promise<void> {
  let closed = false;
  const normalizedProject = path.resolve(projectDir).toLowerCase();
  for (const terminal of terminals.values()) {
    const cwd = path.resolve(terminal.info.cwd);
    const normalized = cwd.toLowerCase();
    if (normalized !== normalizedProject && !normalized.startsWith(normalizedProject + path.sep)) continue;
    const relativeParts = path.relative(projectDir, cwd).split(path.sep).map(part => part.toLowerCase());
    if (!relativeParts.includes("build")) continue;
    try { terminal.process.kill(); closed = true; } catch { /* already exited */ }
  }
  if (closed) await new Promise(resolve => setTimeout(resolve, 180));
}

async function isFile(filename: string): Promise<boolean> {
  try { return (await stat(filename)).isFile(); } catch { return false; }
}

async function cachedGradleExecutable(projectDir: string): Promise<string | undefined> {
  const propertiesFile = path.join(projectDir, "gradle", "wrapper", "gradle-wrapper.properties");
  if (!(await isFile(propertiesFile))) return undefined;
  const properties = await readFile(propertiesFile, "utf8");
  const parsed = parseGradleDistributionProperties(properties);
  if (!parsed) return undefined;
  const { distribution, versionDirectory } = parsed;
  const gradleHome = process.env.USERPROFILE || process.env.HOME;
  if (!gradleHome) return undefined;
  const cacheRoot = path.join(gradleHome, ".gradle", "wrapper", "dists", distribution);
  let hashDirectories;
  try { hashDirectories = await readdir(cacheRoot, { withFileTypes: true }); } catch { return undefined; }
  const executableName = process.platform === "win32" ? "gradle.bat" : "gradle";
  for (const entry of hashDirectories) {
    if (!entry.isDirectory()) continue;
    const executable = path.join(cacheRoot, entry.name, versionDirectory, "bin", executableName);
    if (await isFile(executable)) return executable;
  }
  return undefined;
}

async function javaHomeForBuild(): Promise<string | undefined> {
  const candidates = [
    process.env.JAVA_HOME,
    process.platform === "win32" ? "C:\\Program Files\\Android\\Android Studio\\jbr" : undefined,
    process.platform === "win32" ? "C:\\Program Files\\Android\\Android Studio\\jre" : undefined,
    process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr") : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const java = path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (await isFile(java)) return candidate;
  }
  if (process.platform === "win32") {
    const jetBrainsRoot = "C:\\Program Files\\JetBrains";
    try {
      for (const product of await readdir(jetBrainsRoot, { withFileTypes: true })) {
        if (!product.isDirectory()) continue;
        const candidate = path.join(jetBrainsRoot, product.name, "jbr");
        if (await isFile(path.join(candidate, "bin", "java.exe"))) return candidate;
      }
    } catch { /* JetBrains products are optional */ }
  }
  try {
    const locator = process.platform === "win32" ? ["where.exe", ["java.exe"]] as const : ["which", ["java"]] as const;
    await execFileAsync(locator[0], locator[1], { timeout: 3_000, windowsHide: true });
    return undefined;
  } catch {
    throw new Error("No Java runtime was found. Install Android Studio or configure JAVA_HOME before building.");
  }
}

async function gradleBuildInvocation(projectDir: string, tasks: string[]): Promise<{ executable: string; args: string[]; source: "wrapper" | "cache" | "path"; windowsVerbatimArguments?: boolean }> {
  const wrapper = path.join(projectDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const wrapperJar = path.join(projectDir, "gradle", "wrapper", "gradle-wrapper.jar");
  const wrapperExists = await isFile(wrapper);
  const wrapperJarExists = await isFile(wrapperJar);
  const wrapperHealthy = wrapperExists && wrapperJarExists;
  const cached = !wrapperHealthy ? await cachedGradleExecutable(projectDir) : undefined;
  let global: string | undefined;
  if (!wrapperHealthy && !cached) {
    if (process.platform === "win32") {
      try { global = (await execFileAsync("where.exe", ["gradle.bat"], { timeout: 3_000, windowsHide: true })).stdout.split(/\r?\n/).find(Boolean)?.trim(); }
      catch { /* no global Gradle */ }
    } else {
      try { global = (await execFileAsync("which", ["gradle"], { timeout: 3_000 })).stdout.trim(); }
      catch { /* no global Gradle */ }
    }
  }
  const selected = chooseGradleScript({ wrapper: wrapperExists ? wrapper : undefined, wrapperJarExists, cached, global });
  if (!selected) {
    const reason = wrapperExists && !wrapperJarExists ? `Gradle wrapper is incomplete: ${wrapperJar} is missing.` : "No Gradle wrapper or Gradle executable was found.";
    throw new Error(`${reason} Restore the wrapper JAR or run a matching Gradle distribution's 'wrapper' task.`);
  }
  const { script, source } = selected;
  if (process.platform === "win32") {
    const command = windowsBatchCommand(script, tasks);
    return { executable: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command], source, windowsVerbatimArguments: true };
  }
  return { executable: script, args: tasks, source };
}

async function adbDevices(): Promise<AdbDeviceInfo[]> {
  const { stdout } = await execFileAsync("adb", ["devices", "-l"], { timeout: 10_000, windowsHide: true });
  return stdout.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => {
    const [serial = "", state = ""] = line.split(/\s+/);
    const model = /(?:^|\s)model:([^\s]+)/.exec(line)?.[1]?.replaceAll("_", " ");
    return { serial, state, ...(model ? { model } : {}) };
  }).filter(device => Boolean(device.serial));
}

function canConnect(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function casesRootFor(settings: AppSettings): string {
  return settings.outputRoot.trim() ? path.resolve(settings.outputRoot.trim()) : legacyCasesRoot;
}

function ensureCaseInputModel(state: any): boolean {
  let changed = false;
  if (!state.title) { state.title = state.id; changed = true; }
  if (!state.platform) { state.platform = "android"; changed = true; }
  if (!Array.isArray(state.inputs)) { state.inputs = []; changed = true; }
  if (state.target && !state.inputs.some((input: CaseInput) => input.path && path.resolve(input.path) === path.resolve(state.target))) {
    const extension = path.extname(state.target).toLowerCase();
    const isFile = Boolean(state.sha256);
    const type = !isFile ? "device-package" : [".apk", ".xapk", ".apks", ".aab"].includes(extension) ? "apk" : extension === ".so" ? "native-library" : [".dex", ".jar"].includes(extension) ? "dex" : "other";
    const input: CaseInput = { id: `input-${Math.random().toString(36).slice(2, 10)}`, type, name: isFile ? path.basename(state.target) : state.target, ...(isFile ? { path: state.target } : { packageName: state.target }), sha256: state.sha256, addedAt: state.createdAt ?? new Date().toISOString() };
    state.inputs.unshift(input); state.primaryInputId ??= input.id; changed = true;
  }
  return changed;
}

function inputTypeForPath(filename: string): CaseInputDraft["type"] {
  const extension = path.extname(filename).toLowerCase();
  if ([".apk", ".xapk", ".apks", ".aab"].includes(extension)) return "apk";
  if (extension === ".so") return "native-library";
  if ([".dex", ".jar"].includes(extension)) return "dex";
  if ([".log", ".txt", ".tombstone"].includes(extension)) return "log";
  if ([".pcap", ".pcapng", ".har"].includes(extension)) return "capture";
  if ([".doc", ".docx", ".xls", ".xlsx", ".pdf", ".md", ".csv"].includes(extension)) return "document";
  return "other";
}

async function addInputsToState(caseDir: string, state: any, drafts: CaseInputDraft[]): Promise<CaseInput[]> {
  state.inputs ??= [];
  const imported: CaseInput[] = [];
  const inputDir = path.join(caseDir, "inputs");
  await mkdir(inputDir, { recursive: true });
  for (const draft of drafts.slice(0, 50)) {
    let storedPath = draft.path ? path.resolve(draft.path) : undefined;
    let digest: string | undefined;
    if (storedPath) {
      const info = await stat(storedPath);
      if (info.isFile()) {
        digest = await hashFile(storedPath);
        const extension = path.extname(storedPath);
        const stem = path.basename(storedPath, extension).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "input";
        let destination = path.join(inputDir, `${stem}${extension}`);
        let index = 2;
        while (true) { try { await stat(destination); if (await hashFile(destination) === digest) break; destination = path.join(inputDir, `${stem}-${index++}${extension}`); } catch { await copyFile(storedPath, destination); break; } }
        storedPath = destination;
        state.artifacts ??= [];
        if (!state.artifacts.includes(destination)) state.artifacts.push(destination);
      }
    }
    const input: CaseInput = { id: `input-${Math.random().toString(36).slice(2, 10)}`, type: draft.type, name: draft.name.trim() || (storedPath ? path.basename(storedPath) : draft.packageName ?? "Input"), ...(storedPath ? { path: storedPath } : {}), ...(draft.packageName ? { packageName: draft.packageName } : {}), ...(digest ? { sha256: digest } : {}), ...(draft.metadata ? { metadata: draft.metadata } : {}), addedAt: new Date().toISOString() };
    state.inputs.push(input); imported.push(input);
  }
  state.primaryInputId ??= imported[0]?.id;
  const primary = state.inputs.find((input: CaseInput) => input.id === state.primaryInputId);
  if (!state.target && primary?.path) state.target = primary.path;
  if (!state.sha256 && primary?.sha256) state.sha256 = primary.sha256;
  return imported;
}

async function findCaseDir(caseId: string, configuredSettings?: AppSettings): Promise<string> {
  const settings = configuredSettings ?? await readSettings();
  const roots = [...new Set([casesRootFor(settings), legacyCasesRoot])];
  for (const root of roots) {
    const candidate = path.join(root, caseId);
    try { await stat(path.join(candidate, "state.json")); return candidate; } catch { /* try next root */ }
  }
  return path.join(casesRootFor(settings), caseId);
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsFile, "utf8")) as Omit<AppSettings, "apiKey"> & { encryptedApiKey?: string; apiKey?: string };
    let apiKey = raw.apiKey ?? "";
    if (raw.encryptedApiKey && safeStorage.isEncryptionAvailable()) apiKey = safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, "base64"));
    return { baseUrl: raw.baseUrl ?? "https://api.openai.com/v1", modelId: raw.modelId ?? "gpt-5.1-codex", apiKey, outputRoot: raw.outputRoot ?? "" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.1-codex", apiKey: "", outputRoot: "" };
  }
}

async function saveSettings(settings: AppSettings): Promise<void> {
  const baseUrl = new URL(settings.baseUrl).toString().replace(/\/$/, "");
  if (!settings.modelId.trim()) throw new Error("Model ID is required");
  await mkdir(path.dirname(settingsFile), { recursive: true });
  const outputRoot = settings.outputRoot.trim() ? path.resolve(settings.outputRoot.trim()) : "";
  if (outputRoot) await mkdir(outputRoot, { recursive: true });
  const stored = safeStorage.isEncryptionAvailable()
    ? { baseUrl, modelId: settings.modelId.trim(), outputRoot, encryptedApiKey: safeStorage.encryptString(settings.apiKey).toString("base64") }
    : { baseUrl, modelId: settings.modelId.trim(), outputRoot, apiKey: settings.apiKey };
  await writeFile(settingsFile, JSON.stringify(stored, null, 2) + "\n");
}

async function listModels(settings: AppSettings): Promise<string[]> {
  if (!settings.baseUrl.trim() || !settings.apiKey.trim()) throw new Error("API Host and API Key are required");
  const endpoint = `${settings.baseUrl.trim().replace(/\/$/, "")}/models`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Model request failed (${response.status}): ${body.slice(0, 300)}`);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error("Model endpoint did not return valid JSON"); }
  const value = parsed as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown } | string> };
  const entries = value.data ?? value.models ?? [];
  const models = entries
    .map(item => typeof item === "string" ? item : typeof item?.id === "string" ? item.id : undefined)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));
  if (models.length === 0) throw new Error("The endpoint returned no model IDs");
  return [...new Set(models)];
}

function sessionKey(caseId?: string, workId?: string): string {
  return caseId ? `${caseId}:${workId ?? "case"}` : "workspace";
}

function routed(runtime: AgentRuntime, event: WorkerEvent): RoutedWorkerEvent {
  return { ...event, sessionKey: runtime.key, caseId: runtime.caseId, workId: runtime.workId } as RoutedWorkerEvent;
}

function emitWorkerEvent(runtime: AgentRuntime, event: WorkerEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("worker:event", routed(runtime, event));
}

async function queueFilename(runtime: AgentRuntime): Promise<string> {
  if (runtime.caseId) {
    const caseDir = await findCaseDir(runtime.caseId);
    const directory = path.join(caseDir, ".queues");
    await mkdir(directory, { recursive: true });
    return path.join(directory, `${runtime.workId ?? "case"}.json`);
  }
  const directory = path.join(projectRoot, ".pi", "queues");
  await mkdir(directory, { recursive: true });
  return path.join(directory, "workspace.json");
}

async function ensurePromptQueue(runtime: AgentRuntime): Promise<StoredPromptQueueItem[]> {
  if (runtime.queue) return runtime.queue;
  try {
    const parsed = JSON.parse(await readFile(await queueFilename(runtime), "utf8"));
    runtime.queue = Array.isArray(parsed) ? parsed.map((item: StoredPromptQueueItem) => ({ ...item, status: "queued" as const })) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    runtime.queue = [];
  }
  return runtime.queue;
}

async function persistPromptQueue(runtime: AgentRuntime): Promise<void> {
  const queue = await ensurePromptQueue(runtime);
  await writeFile(await queueFilename(runtime), JSON.stringify(queue, null, 2) + "\n");
}

async function emitPromptQueue(runtime: AgentRuntime): Promise<PromptQueueItemView[]> {
  const views = (await ensurePromptQueue(runtime)).map(promptQueueView);
  emitWorkerEvent(runtime, { type: "queue", items: views });
  return views;
}

function serializeQueueOperation<T>(runtime: AgentRuntime, operation: () => Promise<T>): Promise<T> {
  const result = runtime.queueTask.then(operation, operation);
  runtime.queueTask = result.then(() => undefined, () => undefined);
  return result;
}

async function dispatchNextPrompt(runtime: AgentRuntime): Promise<void> {
  if (!runtime.ready || runtime.streaming || runtime.paused) return;
  const queue = await ensurePromptQueue(runtime);
  const next = queue.find(item => item.status === "queued");
  if (!next) return;
  next.status = "running";
  next.updatedAt = new Date().toISOString();
  runtime.currentPromptId = next.id;
  runtime.streaming = true;
  await persistPromptQueue(runtime);
  await emitPromptQueue(runtime);
  runtime.worker.send({ type: "prompt", text: next.agentText, images: next.images } satisfies WorkerCommand);
}

async function finishCurrentPrompt(runtime: AgentRuntime): Promise<void> {
  if (!runtime.currentPromptId) return;
  const queue = await ensurePromptQueue(runtime);
  runtime.queue = queue.filter(item => item.id !== runtime.currentPromptId);
  runtime.currentPromptId = undefined;
  runtime.streaming = false;
  await persistPromptQueue(runtime);
  await emitPromptQueue(runtime);
  await dispatchNextPrompt(runtime);
}

function createWorkerRuntime(caseId?: string, workId?: string): AgentRuntime {
  const key = sessionKey(caseId, workId);
  const existing = agentRuntimes.get(key);
  if (existing && !existing.worker.killed) return existing;
  const workerFile = path.join(__dirname, "agent-worker.js");
  const child = fork(workerFile, [], {
    cwd: projectRoot,
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const runtime: AgentRuntime = { key, caseId, workId, worker: child, ready: false, streaming: false, paused: false, journal: [], queueTask: Promise.resolve() };
  agentRuntimes.set(key, runtime);
  child.on("message", event => {
    const message = event as WorkerEvent;
    if (message.type === "ready") {
      runtime.ready = true;
      runtime.journal = [message];
      const pending = runtime.pendingInitialization;
      if (pending) {
        clearTimeout(pending.timer);
        runtime.pendingInitialization = undefined;
        for (const resolve of pending.resolves) resolve();
      }
      void serializeQueueOperation(runtime, async () => { await emitPromptQueue(runtime); await dispatchNextPrompt(runtime); });
    } else {
      runtime.journal.push(message);
      if (runtime.journal.length > 10_000) runtime.journal.splice(1, runtime.journal.length - 10_000);
    }
    if (message.type === "state") runtime.streaming = message.streaming || Boolean(runtime.currentPromptId);
    if (message.type === "error" && runtime.pendingInitialization) {
      const pending = runtime.pendingInitialization;
      clearTimeout(pending.timer);
      runtime.pendingInitialization = undefined;
      for (const reject of pending.rejects) reject(new Error(message.message));
    }
    emitWorkerEvent(runtime, message);
    if (message.type === "error" && runtime.currentPromptId) {
      void serializeQueueOperation(runtime, async () => {
        const queue = await ensurePromptQueue(runtime);
        const current = queue.find(item => item.id === runtime.currentPromptId);
        if (current) { current.status = "queued"; current.updatedAt = new Date().toISOString(); }
        runtime.currentPromptId = undefined;
        runtime.streaming = false;
        runtime.paused = true;
        await persistPromptQueue(runtime);
        await emitPromptQueue(runtime);
      });
    }
    if (message.type === "agent-event" && (message.event as { type?: string } | undefined)?.type === "agent_end") {
      void serializeQueueOperation(runtime, () => finishCurrentPrompt(runtime));
    }
  });
  child.stdout?.on("data", chunk => emitWorkerEvent(runtime, { type: "log", channel: "pi", message: chunk.toString() }));
  child.stderr?.on("data", chunk => emitWorkerEvent(runtime, { type: "log", channel: "error", message: chunk.toString() }));
  child.on("exit", code => {
    emitWorkerEvent(runtime, { type: "log", channel: "system", message: `Agent worker exited (${code})` });
    agentRuntimes.delete(key);
  });
  return runtime;
}

async function hashFile(filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filename);
    stream.on("error", reject); stream.on("data", chunk => hash.update(chunk)); stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function withArtifactTypes<T extends { artifacts?: string[]; works?: Array<{ artifacts?: string[]; artifactSnapshot?: string[] }> }>(state: T): Promise<T & { artifactTypes: Record<string, "file" | "directory" | "missing"> }> {
  const entries = await Promise.all(allIndexedArtifacts(state).map(async artifact => {
    try { const info = await stat(artifact); return [artifact, info.isDirectory() ? "directory" : "file"] as const; }
    catch { return [artifact, "missing"] as const; }
  }));
  return { ...state, artifactTypes: Object.fromEntries(entries) };
}

function migrateLegacyWorks(state: any): boolean {
  if (Array.isArray(state.works) && state.works.length) return false;
  const requests = Array.isArray(state.analysisRequests) ? state.analysisRequests : [];
  if (!requests.length && !state.activeRun) return false;
  const fallbackRequest = state.activeRun ? { id: state.activeRun.requestId, goal: state.analysisGoal ?? state.activeRun.goal, category: state.analysisCategory ?? "report", createdAt: state.activeRun.startedAt } : undefined;
  const source = requests.length ? requests : fallbackRequest ? [fallbackRequest] : [];
  state.works = source.map((request: any) => {
    const active = state.activeRun?.requestId === request.id;
    const run = active ? structuredClone(state.activeRun) : {
      id: `legacy-${request.id}`, requestId: request.id, goal: request.goal, startedAt: request.createdAt, updatedAt: request.createdAt,
      status: "completed", stages: [{ id: "HISTORY", label: "Historical work", route: "Pi", status: "completed" }],
    };
    return { id: request.id, title: workTitle(request.goal), goal: request.goal, category: request.category ?? "report", createdAt: request.createdAt, updatedAt: run.updatedAt, status: run.status, run, artifactSnapshot: active ? [...(state.artifacts ?? [])] : [], artifacts: [], upstreamWorkIds: [] };
  });
  state.activeWorkId = state.activeRun?.requestId ?? state.works.at(-1)?.id;
  return true;
}

function ensureLegacyWorkInheritance(state: any): boolean {
  return Array.isArray(state.works) && applyLegacyWorkInheritance(state.works);
}

async function createWindow(): Promise<void> {
  const debugLog = path.join(projectRoot, "ui-debug.log");
  const logUi = (message: string) => void appendFile(debugLog, `${new Date().toISOString()} ${message}\n`);
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#090d12",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => logUi(`did-fail-load ${code} ${description} ${url}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => logUi(`render-process-gone ${JSON.stringify(details)}`));
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => logUi(`console ${level} ${message} ${sourceId}:${line}`));
  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      const state = await mainWindow!.webContents.executeJavaScript(`({ api: typeof window.mobileReverse, root: document.getElementById('root')?.innerHTML.length ?? -1, href: location.href })`);
      logUi(`did-finish-load ${JSON.stringify(state)}`);
    } catch (error) { logUi(`inspect-failed ${String(error)}`); }
  });
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("desktop:select-apk", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile"], filters: [{ name: "Android packages", extensions: ["apk", "xapk", "apks"] }] });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle("desktop:select-case-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile", "multiSelections"], title: "Select case materials" });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("desktop:select-project-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"], title: "Select source or project directory" });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle("desktop:list-adb-packages", async () => {
  const devices = (await adbDevices()).filter(device => device.state === "device");
  const results: Array<{ serial: string; packageName: string; model?: string }> = [];
  for (const device of devices) {
    const { stdout: packages } = await execFileAsync("adb", ["-s", device.serial, "shell", "pm", "list", "packages", "-3"], { timeout: 20_000, windowsHide: true });
    for (const line of packages.split(/\r?\n/)) {
      const packageName = line.trim().replace(/^package:/, "");
      if (packageName) results.push({ serial: device.serial, packageName, model: device.model });
    }
  }
  return results.sort((a, b) => a.packageName.localeCompare(b.packageName));
});
ipcMain.handle("desktop:list-adb-devices", async () => adbDevices());
ipcMain.handle("desktop:select-output-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"], title: "Select analysis output directory" });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle("desktop:open-external", async (_event, value: string) => {
  let url: URL;
  try { url = new URL(String(value)); }
  catch { throw new Error("Invalid external URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported external URL protocol");
  await shell.openExternal(url.toString());
});
ipcMain.handle("desktop:import-attachments", async (_event, caseId: string, workId?: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile", "multiSelections"], title: "Attach files to Pi Agent" });
  if (result.canceled || result.filePaths.length === 0) return [];
  const caseDir = await findCaseDir(caseId);
  const stateFile = path.join(caseDir, "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === (workId ?? state.activeWorkId)) : undefined;
  const ownerRoot = work?.run?.taskDir ? path.resolve(work.run.taskDir) : path.join(caseDir, "attachments");
  const attachmentDir = path.join(ownerRoot, "attachments");
  await mkdir(attachmentDir, { recursive: true });
  const imported: Array<{ name: string; path: string; size: number; extension: string }> = [];
  for (const source of result.filePaths.slice(0, 20)) {
    const info = await stat(source);
    if (!info.isFile()) continue;
    if (info.size > 200 * 1024 * 1024) throw new Error(`${path.basename(source)} exceeds the 200 MB attachment limit`);
    const extension = path.extname(source);
    const stem = path.basename(source, extension).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "attachment";
    let destination = path.join(attachmentDir, `${stem}${extension}`);
    let index = 2;
    while (true) { try { await stat(destination); destination = path.join(attachmentDir, `${stem}-${index++}${extension}`); } catch { break; } }
    await copyFile(source, destination);
    imported.push({ name: path.basename(destination), path: destination, size: info.size, extension: extension.toLowerCase() });
    state.artifacts ??= [];
    if (!state.artifacts.includes(destination)) state.artifacts.push(destination);
    if (work) { work.artifacts ??= []; if (!work.artifacts.includes(destination)) work.artifacts.push(destination); }
  }
  state.updatedAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  return imported;
});
ipcMain.handle("desktop:open-case-directory", async (_event, caseId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const directory = await findCaseDir(caseId);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("Case output directory does not exist");
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
ipcMain.handle("desktop:open-work-directory", async (_event, caseId: string, workId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8"));
  const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === workId) : undefined;
  if (!work) throw new Error("Work item not found");
  const directory = path.resolve(work.run?.workspaceDir ?? work.run?.taskDir ?? caseDir);
  const normalizedCase = path.resolve(caseDir).toLowerCase();
  if (directory.toLowerCase() !== normalizedCase && !directory.toLowerCase().startsWith(normalizedCase + path.sep)) throw new Error("Work directory is outside the case");
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("Work directory does not exist");
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
ipcMain.handle("desktop:open-artifact", async (_event, filename: string) => {
  const resolved = await assertCaseWorkspacePath(filename);
  await stat(resolved);
  const error = await shell.openPath(resolved);
  if (error) throw new Error(error);
});
ipcMain.handle("desktop:reveal-artifact", async (_event, filename: string) => {
  const resolved = await assertCaseWorkspacePath(filename);
  const info = await stat(resolved);
  if (info.isDirectory()) {
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  } else shell.showItemInFolder(resolved);
});
ipcMain.handle("desktop:open-artifact-terminal", async (_event, filename: string) => {
  const resolved = await assertCaseWorkspacePath(filename);
  const info = await stat(resolved);
  const directory = info.isDirectory() ? resolved : path.dirname(resolved);
  if (process.platform === "win32") {
    try {
      await execFileAsync("where.exe", ["wt.exe"], { windowsHide: true });
      const child = spawn("wt.exe", ["-d", directory], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
    } catch {
      const child = spawn("powershell.exe", ["-NoExit", "-Command", "Set-Location -LiteralPath $args[0]", directory], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
    }
    return;
  }
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
ipcMain.handle("terminal:create", async (_event, requestedCwd: string, requestedTitle?: string, initialCommand?: string) => {
  const resolved = await assertCaseWorkspacePath(requestedCwd);
  const targetInfo = await stat(resolved);
  const cwd = targetInfo.isDirectory() ? resolved : path.dirname(resolved);
  const id = randomUUID();
  const title = requestedTitle?.trim().slice(0, 80) || `PowerShell ${terminals.size + 1}`;
  let executable: string;
  let args: string[];
  if (process.platform === "win32") {
    try { await execFileAsync("where.exe", ["pwsh.exe"], { timeout: 3_000, windowsHide: true }); executable = "pwsh.exe"; }
    catch { executable = "powershell.exe"; }
    const utf8Setup = "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)";
    args = ["-NoLogo", "-NoProfile", "-NoExit", "-Command", utf8Setup];
  } else {
    executable = process.env.SHELL || "/bin/bash";
    args = ["-i"];
  }
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const child = pty.spawn(executable, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor" },
    useConpty: process.platform === "win32",
  });
  const info: TerminalSessionInfo = { id, title, cwd };
  terminals.set(id, { info, process: child });
  child.onData(data => sendTerminalEvent({ type: "output", terminalId: id, data }));
  child.onExit(({ exitCode }) => { terminals.delete(id); sendTerminalEvent({ type: "exit", terminalId: id, code: exitCode }); });
  setTimeout(() => {
    const terminal = terminals.get(id);
    if (terminal && initialCommand?.trim()) terminal.process.write(`${initialCommand.trim()}\r`);
  }, 120);
  return info;
});
ipcMain.on("terminal:write", (_event, terminalId: string, data: string) => {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    sendTerminalEvent({ type: "error", terminalId, message: "Terminal session is no longer running" });
    return;
  }
  terminal.process.write(String(data).slice(0, 1_000_000));
});
ipcMain.on("terminal:resize", (_event, terminalId: string, cols: number, rows: number) => {
  const terminal = terminals.get(terminalId);
  if (!terminal) return;
  const safeCols = Math.max(2, Math.min(500, Math.floor(cols)));
  const safeRows = Math.max(1, Math.min(300, Math.floor(rows)));
  try { terminal.process.resize(safeCols, safeRows); } catch { /* terminal may have exited between render frames */ }
});
ipcMain.handle("terminal:close", async (_event, terminalId: string) => {
  const terminal = terminals.get(terminalId);
  if (!terminal) return;
  terminals.delete(terminalId);
  try { terminal.process.kill(); } catch { /* already exited */ }
});
ipcMain.handle("case:list-work-apks", async (_event, caseId: string, workId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8"));
  const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === workId) : undefined;
  if (!work) throw new Error("Work item not found");
  const root = await assertCaseWorkspacePath(path.resolve(work.run?.workspaceDir ?? work.run?.taskDir ?? caseDir));
  const skip = new Set([".git", ".gradle", ".idea", "node_modules", "caches", "transforms"]);
  const found: InstallableApk[] = [];
  let visited = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 10 || visited > 15_000 || found.length >= 100) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++visited > 15_000) break;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name.toLowerCase())) await walk(candidate, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".apk")) {
        const info = await stat(candidate);
        found.push({ path: candidate, name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    }
  };
  await walk(root, 0);
  const recorded = [...(work.artifacts ?? []), ...(state.artifacts ?? [])].filter((item: unknown): item is string => typeof item === "string" && item.toLowerCase().endsWith(".apk"));
  for (const filename of recorded) {
    try {
      const resolved = await assertCaseWorkspacePath(filename);
      if (found.some(item => item.path.toLowerCase() === resolved.toLowerCase())) continue;
      const info = await stat(resolved);
      if (info.isFile()) found.push({ path: resolved, name: path.basename(resolved), size: info.size, modifiedAt: info.mtime.toISOString() });
    } catch { /* stale artifact */ }
  }
  return found.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
});
ipcMain.handle("work:build", async (_event, caseId: string, workId: string, clean = false) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8"));
  const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === workId) : undefined;
  if (!work) throw new Error("Work item not found");
  const cwd = await assertCaseWorkspacePath(path.resolve(work.run?.workspaceDir ?? work.run?.taskDir ?? caseDir));
  if (!(await stat(cwd)).isDirectory()) throw new Error("Work directory does not exist");
  try {
    const rebuild = clean === true;
    const javaHome = await javaHomeForBuild();
    const encodingFlags = "-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8";
    const env = { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome, Path: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.Path ?? ""}`, PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH ?? ""}` } : {}), JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ""} ${encodingFlags}`.trim(), GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ""} ${encodingFlags}`.trim() };
    if (rebuild) await closeIntegratedBuildTerminals(cwd);
    const runGradle = async (tasks: string[]) => {
      const invocation = await gradleBuildInvocation(cwd, tasks);
      const { stdout, stderr } = await execFileAsync(invocation.executable, invocation.args, { cwd, env, encoding: "buffer", timeout: 30 * 60_000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments });
      return { invocation, output: `${decodeProcessText(stdout)}${stderr?.length ? `\n${decodeProcessText(stderr)}` : ""}`.trim() };
    };
    try {
      const result = await runGradle(gradleBuildTasks(rebuild));
      return { success: true as const, message: `${rebuild ? "Rebuild" : "Build"} succeeded via ${result.invocation.source}`, output: result.output.slice(-8_000) };
    } catch (error) {
      if (!rebuild || !(await cleanRemovedAllFiles(error, cwd))) throw error;
      const result = await runGradle(["--no-daemon", "assembleDebug"]);
      const cleanNotice = "Gradle could not remove locked empty output directories, but all build files were cleared before the full build.";
      return { success: true as const, message: `Rebuild succeeded via ${result.invocation.source}`, output: `${cleanNotice}\n${result.output}`.slice(-8_000) };
    }
  } catch (error) { throw commandFailure(clean === true ? "Rebuild" : "Build", error); }
});
ipcMain.handle("work:install-apk", async (_event, serial: string, apkPath: string) => {
  const device = (await adbDevices()).find(item => item.serial === serial && item.state === "device");
  if (!device) throw new Error("The selected ADB device is offline, unauthorized, or no longer connected");
  const resolved = await assertCaseWorkspacePath(apkPath);
  const apkInfo = await stat(resolved);
  if (!apkInfo.isFile() || path.extname(resolved).toLowerCase() !== ".apk") throw new Error("The selected artifact is not an APK file");
  try {
    const { stdout, stderr } = await execFileAsync("adb", ["-s", serial, "install", "-r", resolved], { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
    return { success: true as const, message: "Installation succeeded", output: output.slice(-8_000) };
  } catch (error) { throw commandFailure("Installation", error); }
});
ipcMain.handle("desktop:identify-apk", async (_event, filename: string) => {
  const resolved = path.resolve(filename);
  if (!/\.(apk|xapk|apks)$/i.test(resolved)) throw new Error("Unsupported Android package file");
  const digest = await hashFile(resolved);
  const base = path.basename(resolved).replace(/\.(apk|xapk|apks)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "app";
  const settings = await readSettings();
  const casesRoot = casesRootFor(settings);
  let caseId = settings.outputRoot.trim() ? base : `${base}-${digest.slice(0, 12)}`;
  let existing;
  try {
    existing = JSON.parse(await readFile(path.join(casesRoot, caseId, "state.json"), "utf8"));
    if (existing.sha256 && existing.sha256 !== digest) { caseId = `${base}-${digest.slice(0, 12)}`; existing = undefined; }
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!existing) {
    try {
      const candidates = [] as Array<{ id: string; state: { target?: string; sha256?: string; updatedAt?: string } }>;
      for (const entry of await readdir(casesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const state = JSON.parse(await readFile(path.join(casesRoot, entry.name, "state.json"), "utf8"));
          if (state.sha256 === digest || (state.target && path.resolve(state.target) === resolved)) candidates.push({ id: entry.name, state });
        } catch { /* ignore incomplete legacy case */ }
      }
      candidates.sort((a, b) => String(b.state.updatedAt ?? "").localeCompare(String(a.state.updatedAt ?? "")));
      if (candidates[0]) { caseId = candidates[0].id; existing = candidates[0].state; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!existing && !settings.outputRoot.trim()) {
    const sessionsRoot = path.join(projectRoot, ".pi", "sessions");
    const encodedTarget = JSON.stringify(resolved).slice(1, -1);
    try {
      const legacy = [] as Array<{ id: string; updated: number }>;
      for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const file of await readdir(path.join(sessionsRoot, entry.name))) {
          if (!file.endsWith(".jsonl")) continue;
          const filename = path.join(sessionsRoot, entry.name, file);
          const content = await readFile(filename, "utf8");
          if (content.includes(encodedTarget)) legacy.push({ id: entry.name, updated: (await stat(filename)).mtimeMs });
        }
      }
      legacy.sort((a, b) => b.updated - a.updated);
      if (legacy[0]) {
        caseId = legacy[0].id;
        const now = new Date().toISOString();
        const caseDir = path.join(casesRoot, caseId);
        existing = { id: caseId, createdAt: now, updatedAt: now, phase: "INTAKE", target: resolved, sha256: digest, workspaceDir: caseDir, notes: ["Recovered legacy Pi analysis session"], artifacts: [] };
        await mkdir(path.join(caseDir, "artifacts"), { recursive: true });
        await mkdir(path.join(caseDir, "evidence"), { recursive: true });
        await writeFile(path.join(caseDir, "state.json"), JSON.stringify(existing, null, 2) + "\n");
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!existing) {
    const now = new Date().toISOString();
    const caseDir = path.join(casesRoot, caseId);
    existing = { id: caseId, createdAt: now, updatedAt: now, phase: "INTAKE", target: resolved, sha256: digest, workspaceDir: caseDir, notes: [], artifacts: [] };
    await mkdir(path.join(caseDir, "artifacts"), { recursive: true });
    await mkdir(path.join(caseDir, "evidence"), { recursive: true });
    await writeFile(path.join(caseDir, "state.json"), JSON.stringify(existing, null, 2) + "\n");
  }
  const existingCaseDir = path.join(casesRoot, caseId);
  const worksChanged = migrateLegacyWorks(existing);
  const inheritanceChanged = ensureLegacyWorkInheritance(existing);
  const inputsChanged = ensureCaseInputModel(existing);
  const artifactsChanged = await rebuildWorkArtifactOwnership(existing, existingCaseDir);
  if (worksChanged || inheritanceChanged || inputsChanged || artifactsChanged) await writeFile(path.join(existingCaseDir, "state.json"), JSON.stringify(existing, null, 2) + "\n");
  return { caseId, existing: await withArtifactTypes(existing) };
});
ipcMain.handle("case:create", async (_event, request: CreateCaseRequest) => {
  const title = String(request?.title ?? "").trim();
  if (!title || title.length > 100) throw new Error("Case title must contain 1 to 100 characters");
  const platforms = new Set(["android", "native", "protocol", "general"]);
  if (!platforms.has(request.platform)) throw new Error("Invalid case platform");
  const settings = await readSettings();
  const root = casesRootFor(settings);
  await mkdir(root, { recursive: true });
  const base = title.normalize("NFKC").toLowerCase().match(/[a-z0-9]+/g)?.join("-").slice(0, 48) || "case";
  let id = base; let suffix = 2;
  while (true) { try { await stat(path.join(root, id, "state.json")); id = `${base}-${suffix++}`; } catch { break; } }
  const caseDir = path.join(root, id);
  const now = new Date().toISOString();
  const state: any = { id, title, description: String(request.description ?? "").trim().slice(0, 240), platform: request.platform, createdAt: now, updatedAt: now, phase: "INTAKE", workspaceDir: caseDir, notes: [], artifacts: [], inputs: [] };
  await Promise.all([mkdir(path.join(caseDir, "artifacts"), { recursive: true }), mkdir(path.join(caseDir, "evidence"), { recursive: true }), mkdir(path.join(caseDir, "works"), { recursive: true })]);
  const imported = await addInputsToState(caseDir, state, request.inputs ?? []);
  if (typeof request.primaryInputIndex === "number") { const primary = imported[request.primaryInputIndex]; if (primary) state.primaryInputId = primary.id; }
  await writeFile(path.join(caseDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
  return withArtifactTypes(state);
});
ipcMain.handle("case:add-inputs", async (_event, caseId: string, inputs: CaseInputDraft[]) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const stateFile = path.join(caseDir, "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  ensureCaseInputModel(state);
  await addInputsToState(caseDir, state, Array.isArray(inputs) ? inputs : []);
  state.updatedAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  return withArtifactTypes(state);
});
ipcMain.handle("case:open-input", async (_event, caseId: string, inputId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8"));
  ensureCaseInputModel(state);
  const input = state.inputs.find((item: CaseInput) => item.id === inputId);
  if (!input) throw new Error("Case input not found");
  if (!input.path) throw new Error("This case input has no local path");
  await stat(input.path);
  const error = await shell.openPath(input.path);
  if (error) throw new Error(error);
});
ipcMain.handle("case:reveal-input", async (_event, caseId: string, inputId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const caseDir = await findCaseDir(caseId);
  const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8"));
  ensureCaseInputModel(state);
  const input = state.inputs.find((item: CaseInput) => item.id === inputId);
  if (!input) throw new Error("Case input not found");
  if (!input.path) throw new Error("This case input has no local path");
  const resolved = path.resolve(input.path);
  const info = await stat(resolved);
  if (info.isDirectory()) {
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  } else {
    shell.showItemInFolder(resolved);
  }
});
ipcMain.handle("agent:initialize", async (_event, caseId?: string, workId?: string, force = false) => {
  if (workId && (!/^[a-zA-Z0-9._-]+$/.test(workId) || workId.includes(".."))) throw new Error("Invalid work id");
  if (workId && !caseId) throw new Error("A Work session requires a CASE id");
  const runtime = createWorkerRuntime(caseId, workId);
  if (!force && runtime.ready) {
    for (const event of runtime.journal) emitWorkerEvent(runtime, event);
    await emitPromptQueue(runtime);
    return;
  }
  if (runtime.pendingInitialization) {
    return new Promise<void>((resolve, reject) => { runtime.pendingInitialization!.resolves.push(resolve); runtime.pendingInitialization!.rejects.push(reject); });
  }
  if (force && runtime.streaming) throw new Error("Cannot rebuild a Pi session while its Work is running");
  const settings = await readSettings();
  const caseRoot = caseId ? path.dirname(await findCaseDir(caseId, settings)) : casesRootFor(settings);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = runtime.pendingInitialization;
      runtime.pendingInitialization = undefined;
      for (const fail of pending?.rejects ?? [reject]) fail(new Error("Pi initialization timed out"));
    }, 60_000);
    runtime.pendingInitialization = { resolves: [resolve], rejects: [reject], timer };
    runtime.worker.send({ type: "initialize", cwd: projectRoot, caseId, workId, caseRoot, settings, invalidate: force } satisfies WorkerCommand);
  });
});
ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:save", (_event, settings: AppSettings) => saveSettings(settings));
ipcMain.handle("settings:list-models", (_event, settings: AppSettings) => listModels(settings));
ipcMain.handle("skills:list", () => listSkills(projectRoot));
ipcMain.handle("skills:search", (_event, query: string) => searchSkills(projectRoot, String(query ?? "")));
ipcMain.handle("skills:install", (_event, idOrUrl: string) => installSkill(projectRoot, String(idOrUrl ?? "")));
ipcMain.handle("mcp:check-readiness", async (_event, server: string) => {
  if (server === "jadx") {
    const ready = await canConnect("127.0.0.1", 8650);
    return { server, ready, detail: ready ? "JADX GUI bridge is reachable on 127.0.0.1:8650" : "MCP process is connected, but JADX GUI/plugin is not listening on port 8650" };
  }
  if (server === "ida") {
    const directory = path.join(process.env.APPDATA ?? "", "Hex-Rays", "IDA Pro", "mcp", "instances");
    try {
      const files = await readdir(directory);
      for (const file of files.filter(name => name.endsWith(".json"))) {
        const instance = JSON.parse(await readFile(path.join(directory, file), "utf8")) as { port?: number };
        if (instance.port && await canConnect("127.0.0.1", instance.port)) return { server, ready: true, detail: `IDA GUI MCP is reachable on port ${instance.port}` };
      }
    } catch { /* no live GUI discovery */ }
    return { server, ready: false, detail: "IDALib MCP is connected and can open an IDB on demand; no live IDA GUI MCP instance was discovered" };
  }
  if (server === "frida") {
    try {
      const executable = "D:\\tools\\mcp\\.venvs\\frida\\Scripts\\frida-ps.exe";
      const { stdout } = await execFileAsync(executable, ["-U"], { timeout: 8000, windowsHide: true });
      const ready = stdout.trim().split(/\r?\n/).length > 1;
      return { server, ready, detail: ready ? "Frida device is connected and responding" : "Frida MCP is connected, but no USB/ADB device is available" };
    } catch { return { server, ready: false, detail: "Frida MCP is connected, but no reachable device was detected" }; }
  }
  throw new Error("Unknown MCP server");
});
ipcMain.handle("agent:prompt", async (_event, caseId: string | undefined, workId: string | undefined, text: string, displayText: string, images?: ImageAttachment[]) => {
  const runtime = createWorkerRuntime(caseId, workId);
  if (!runtime.ready) throw new Error("Pi session is not initialized");
  const now = new Date().toISOString();
  const entry: StoredPromptQueueItem = { id: randomUUID(), caseId, workId, agentText: String(text), displayText: String(displayText).trim() || "Attachment request", images, imageCount: images?.length ?? 0, status: "queued", createdAt: now, updatedAt: now };
  return serializeQueueOperation(runtime, async () => {
    const queue = await ensurePromptQueue(runtime);
    queue.push(entry);
    runtime.paused = false;
    await persistPromptQueue(runtime);
    await dispatchNextPrompt(runtime);
    await emitPromptQueue(runtime);
    return promptQueueView(entry);
  });
});
ipcMain.handle("agent:abort", async (_event, caseId?: string, workId?: string) => {
  const runtime = agentRuntimes.get(sessionKey(caseId, workId));
  if (!runtime) return;
  await serializeQueueOperation(runtime, async () => {
    runtime.paused = true;
    if (runtime.currentPromptId) {
      runtime.queue = (await ensurePromptQueue(runtime)).filter(item => item.id !== runtime.currentPromptId);
      runtime.currentPromptId = undefined;
      runtime.streaming = false;
      await persistPromptQueue(runtime);
      await emitPromptQueue(runtime);
    }
  });
  runtime.worker.send({ type: "abort" } satisfies WorkerCommand);
});
ipcMain.handle("agent:queue-list", async (_event, caseId?: string, workId?: string) => {
  const runtime = createWorkerRuntime(caseId, workId);
  return serializeQueueOperation(runtime, () => emitPromptQueue(runtime));
});
ipcMain.handle("agent:queue-update", async (_event, caseId: string | undefined, workId: string | undefined, promptId: string, displayText: string) => {
  const runtime = createWorkerRuntime(caseId, workId);
  return serializeQueueOperation(runtime, async () => {
    const queue = await ensurePromptQueue(runtime);
    const index = queue.findIndex(item => item.id === promptId && item.status === "queued");
    if (index < 0) throw new Error("Only queued messages can be edited");
    queue[index] = replaceQueuedPromptDisplay(queue[index]!, displayText, new Date().toISOString());
    await persistPromptQueue(runtime);
    return emitPromptQueue(runtime);
  });
});
ipcMain.handle("agent:queue-move", async (_event, caseId: string | undefined, workId: string | undefined, promptId: string, direction: "up" | "down") => {
  const runtime = createWorkerRuntime(caseId, workId);
  return serializeQueueOperation(runtime, async () => {
    runtime.queue = moveQueuedPrompt(await ensurePromptQueue(runtime), promptId, direction);
    await persistPromptQueue(runtime);
    return emitPromptQueue(runtime);
  });
});
ipcMain.handle("agent:queue-delete", async (_event, caseId: string | undefined, workId: string | undefined, promptId: string) => {
  const runtime = createWorkerRuntime(caseId, workId);
  return serializeQueueOperation(runtime, async () => {
    const queue = await ensurePromptQueue(runtime);
    const target = queue.find(item => item.id === promptId);
    if (target?.status === "running") throw new Error("Stop the running task instead of deleting it from the queue");
    runtime.queue = queue.filter(item => item.id !== promptId);
    await persistPromptQueue(runtime);
    return emitPromptQueue(runtime);
  });
});
ipcMain.handle("case:read", async (_event, caseId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  try {
    const caseDir = await findCaseDir(caseId);
    const stateFile = path.join(caseDir, "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const worksChanged = migrateLegacyWorks(state);
    const inheritanceChanged = ensureLegacyWorkInheritance(state);
    const inputsChanged = ensureCaseInputModel(state);
    const artifactsChanged = await rebuildWorkArtifactOwnership(state, caseDir);
    const changed = worksChanged || inheritanceChanged || inputsChanged || artifactsChanged;
    if (changed) await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
    return withArtifactTypes(state);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
});
ipcMain.handle("case:list", async () => {
  const settings = await readSettings();
  const roots = [...new Set([casesRootFor(settings), legacyCasesRoot])];
  const cases = new Map<string, CaseSummary>();
  for (const root of roots) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9._-]+$/.test(entry.name) || entry.name.includes("..")) continue;
      try {
        const state = JSON.parse(await readFile(path.join(root, entry.name, "state.json"), "utf8"));
        ensureCaseInputModel(state);
        const summary: CaseSummary = { id: state.id ?? entry.name, title: state.title ?? state.id ?? entry.name, platform: state.platform, inputCount: state.inputs.length, target: state.target, sha256: state.sha256, updatedAt: state.updatedAt ?? state.createdAt, phase: state.phase ?? "INTAKE", analysisCategory: state.analysisCategory, artifactCount: Array.isArray(state.artifacts) ? state.artifacts.length : 0, description: state.description ?? state.analysisGoal, works: orderedCaseWorkSummaries(state.works, { category: state.analysisCategory, createdAt: state.createdAt }) };
        const existing = cases.get(summary.id);
        if (!existing || Date.parse(summary.updatedAt) > Date.parse(existing.updatedAt)) cases.set(summary.id, summary);
      } catch { /* ignore directories that are not valid cases */ }
    }
  }
  return [...cases.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
});
ipcMain.handle("case:delete", async (_event, caseId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const directory = await findCaseDir(caseId);
  const stateFile = path.join(directory, "state.json");
  await stat(stateFile);
  const confirmation = await dialog.showMessageBox(mainWindow!, {
    type: "warning",
    buttons: ["取消", "移到回收站"],
    defaultId: 0,
    cancelId: 0,
    title: "删除案例",
    message: `确定删除案例 “${caseId}” 吗？`,
    detail: "案例目录、会话、报告、证据和重构工程都会移动到 Windows 回收站。",
    noLink: true,
  });
  if (confirmation.response !== 1) return false;
  await shell.trashItem(directory);
  return true;
});
ipcMain.handle("case:delete-analysis-request", async (_event, caseId: string, requestId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  if (!/^[a-zA-Z0-9._-]+$/.test(requestId) || requestId.includes("..")) throw new Error("Invalid request id");
  const caseDir = await findCaseDir(caseId);
  const stateFile = path.join(caseDir, "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const requests = Array.isArray(state.analysisRequests) ? state.analysisRequests : [];
  if (!requests.some((request: { id?: string }) => request.id === requestId)) throw new Error("Analysis request not found");
  state.analysisRequests = requests.filter((request: { id?: string }) => request.id !== requestId);
  const latest = state.analysisRequests.at(-1);
  if (state.analysisGoal && !state.analysisRequests.some((request: { goal?: string }) => request.goal === state.analysisGoal)) {
    state.analysisGoal = latest?.goal ?? "";
    state.analysisCategory = latest?.category ?? state.analysisCategory;
  }
  state.updatedAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  return withArtifactTypes(state);
});
ipcMain.handle("case:update-description", async (_event, caseId: string, rawDescription: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const description = String(rawDescription ?? "").trim();
  if (description.length > 240) throw new Error("Case description must not exceed 240 characters");
  const stateFile = path.join(await findCaseDir(caseId), "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.description = description;
  state.updatedAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  return withArtifactTypes(state);
});
function workTitle(goal: string): string {
  const first = goal.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "Untitled work";
  return first.length > 48 ? `${first.slice(0, 48)}…` : first;
}

const workDirectoryPrefixes: Record<AnalysisCategory, string> = {
  deobfuscation: "deobfuscation", report: "report", "parameter-trace": "parameter-trace",
  "algorithm-recovery": "algorithm-recovery", "data-collection": "data-collection",
  "runtime-diagnostics": "runtime-diagnostics", "protocol-recovery": "protocol-recovery",
  "version-diff": "version-diff", "app-reconstruction": "rebuild", "app-development": "app",
};

function workDirectoryName(category: AnalysisCategory, goal: string, requestId: string): string {
  const words = goal.normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const ignored = new Set(["a", "an", "and", "app", "application", "android", "for", "of", "the", "to", "with"]);
  const meaningful = words.filter(word => word.length > 1 && !ignored.has(word)).slice(0, 6).join("-").slice(0, 42);
  const suffix = requestId.split("-").at(-1)?.slice(0, 6) ?? Math.random().toString(36).slice(2, 8);
  return [workDirectoryPrefixes[category], meaningful, suffix].filter(Boolean).join("-").replace(/-+/g, "-").slice(0, 72);
}

ipcMain.handle("case:switch-work", async (_event, caseId: string, workId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const { state } = await mutateCaseState(caseId, state => {
    const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === workId) : undefined;
    if (!work) throw new Error("Work item not found");
    state.activeWorkId = work.id;
    state.activeRun = structuredClone(work.run);
    state.analysisGoal = work.goal;
    state.analysisCategory = work.category;
    state.updatedAt = new Date().toISOString();
  });
  return withArtifactTypes(state);
});

ipcMain.handle("case:delete-work", async (_event, caseId: string, workId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const runtime = agentRuntimes.get(sessionKey(caseId, workId));
  if (runtime?.streaming) throw new Error("Stop this Work before deleting it");
  const { state } = await mutateCaseState(caseId, state => {
    const works = Array.isArray(state.works) ? state.works : [];
    if (!works.some((item: { id?: string }) => item.id === workId)) throw new Error("Work item not found");
    state.works = works.filter((item: { id?: string }) => item.id !== workId);
    if (state.activeWorkId === workId) {
      const fallback = state.works.at(-1);
      state.activeWorkId = fallback?.id;
      state.activeRun = fallback ? structuredClone(fallback.run) : undefined;
      state.analysisGoal = fallback?.goal ?? "";
      state.analysisCategory = fallback?.category ?? "report";
    }
    state.updatedAt = new Date().toISOString();
  });
  return withArtifactTypes(state);
});
ipcMain.handle("case:rename-work", async (_event, caseId: string, workId: string, rawTitle: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const title = String(rawTitle ?? "").trim();
  if (!title || title.length > 80) throw new Error("Work title must contain 1 to 80 characters");
  const { state } = await mutateCaseState(caseId, state => {
    const work = Array.isArray(state.works) ? state.works.find((item: { id?: string }) => item.id === workId) : undefined;
    if (!work) throw new Error("Work item not found");
    work.title = title;
    work.updatedAt = new Date().toISOString();
    state.updatedAt = work.updatedAt;
  });
  return withArtifactTypes(state);
});
ipcMain.handle("case:update-work", async (_event, caseId: string, workId: string, rawUpdate: { title?: string; category?: AnalysisCategory }) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const title = String(rawUpdate?.title ?? "").trim();
  if (!title || title.length > 80) throw new Error("Work title must contain 1 to 80 characters");
  const categories = new Set<AnalysisCategory>(["deobfuscation", "report", "parameter-trace", "algorithm-recovery", "data-collection", "runtime-diagnostics", "protocol-recovery", "version-diff", "app-reconstruction", "app-development"]);
  const category = rawUpdate?.category;
  if (!category || !categories.has(category)) throw new Error("Invalid analysis category");
  const { state } = await mutateCaseState(caseId, state => applyWorkMetadataUpdate(state, workId, { title, category }, new Date().toISOString()));
  return withArtifactTypes(state);
});
ipcMain.handle("case:save-analysis-request", async (_event, caseId: string, rawGoal: string, category: AnalysisCategory) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(caseId) || caseId.includes("..")) throw new Error("Invalid case id");
  const goal = rawGoal.trim();
  if (goal.length < 10) throw new Error("Analysis goal must contain at least 10 characters");
  if (goal.length > 8000) throw new Error("Analysis goal is too long");
  const categories = new Set<AnalysisCategory>(["deobfuscation", "report", "parameter-trace", "algorithm-recovery", "data-collection", "runtime-diagnostics", "protocol-recovery", "version-diff", "app-reconstruction", "app-development"]);
  if (!categories.has(category)) throw new Error("Invalid analysis category");
  const caseDir = await findCaseDir(caseId);
  return withCaseStateLock(caseDir, async () => {
  const stateFile = path.join(caseDir, "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const sourceCategory = state.analysisCategory as AnalysisCategory | undefined;
  state.workspaceDir ??= caseDir;
  state.analysisGoal = goal;
  state.analysisCategory = category;
  state.description ||= goal.slice(0, 160);
  state.analysisRequests ??= [];
  const previous = state.analysisRequests.at(-1);
  const request = previous?.goal === goal && previous?.category === category ? previous : { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, goal, category, createdAt: new Date().toISOString() };
  if (request !== previous) state.analysisRequests.push(request);
  const now = new Date().toISOString();
  const upstreamArtifacts = [...(state.artifacts ?? [])];
  const taskDir = path.join(caseDir, "works", workDirectoryName(category, goal, request.id));
  const workspaceDir = category === "app-reconstruction" || category === "app-development" ? path.join(taskDir, "project") : taskDir;
  const artifactDir = path.join(taskDir, "artifacts");
  const evidenceDir = path.join(taskDir, "evidence");
  await Promise.all([mkdir(workspaceDir, { recursive: true }), mkdir(artifactDir, { recursive: true }), mkdir(evidenceDir, { recursive: true })]);
  const taskRequest = path.join(taskDir, "request.md");
  const inheritance = path.join(taskDir, "upstream-works.json");
  await writeFile(taskRequest, `# Work request\n\n- Category: ${category}\n- Source case: ${caseId}\n- Source category: ${sourceCategory ?? previous?.category ?? "unknown"}\n- Work directory: ${taskDir}\n- Project directory: ${workspaceDir}\n\n## Objective\n\n${goal}\n`);
  await writeFile(inheritance, JSON.stringify({ sourceCase: caseId, capturedAt: now, workIds: (state.works ?? []).map((item: { id: string }) => item.id), artifacts: upstreamArtifacts }, null, 2) + "\n");
  state.activeRun = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    requestId: request.id,
    goal,
    startedAt: now,
    updatedAt: now,
    status: "planning",
    stages: [{ id: "PLANNING", label: "Planning", route: "Pi", status: "running" }],
    taskDir, workspaceDir, upstreamArtifacts,
  };
  state.works ??= [];
  const work = {
    id: request.id,
    title: workTitle(goal),
    goal,
    category,
    createdAt: request.createdAt,
    updatedAt: now,
    status: state.activeRun.status,
    run: structuredClone(state.activeRun),
    artifactSnapshot: upstreamArtifacts,
    artifacts: [taskRequest, inheritance, artifactDir, evidenceDir, ...(workspaceDir !== taskDir ? [workspaceDir] : [])],
    upstreamWorkIds: (state.works ?? []).filter((item: { status?: string }) => item.status === "completed").map((item: { id: string }) => item.id),
  };
  const existingWork = state.works.findIndex((item: { id?: string }) => item.id === work.id);
  if (existingWork >= 0) state.works[existingWork] = work;
  else state.works.push(work);
  state.activeWorkId = work.id;
  state.updatedAt = now;
  state.artifacts ??= [];
  for (const item of work.artifacts) if (!state.artifacts.includes(item)) state.artifacts.push(item);
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  return state;
  });
});
async function assertCaseWorkspacePath(filename: string): Promise<string> {
  const resolved = path.resolve(filename);
  const settings = await readSettings();
  const allowedRoots = [...new Set([casesRootFor(settings), legacyCasesRoot])].map(root => path.resolve(root));
  const candidate = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const allowed = allowedRoots.some(root => {
    const normalized = process.platform === "win32" ? root.toLowerCase() : root;
    return candidate === normalized || candidate.startsWith(normalized + path.sep);
  });
  if (!allowed) throw new Error("File is outside the case workspace");
  return resolved;
}
ipcMain.handle("file:read-text", async (_event, filename: string) => {
  const resolved = await assertCaseWorkspacePath(filename);
  const info = await stat(resolved);
  if (info.isDirectory()) {
    const entries = await readdir(resolved, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const lines = entries.map(entry => `${entry.isDirectory() ? "[DIR] " : "[FILE]"} ${entry.name}${entry.isDirectory() ? path.sep : ""}`);
    return `${resolved}\n\n${lines.length ? lines.join("\n") : "(empty directory)"}`;
  }
  const binaryExtensions = new Set([".apk", ".apks", ".arsc", ".class", ".dex", ".gif", ".ico", ".jar", ".jpeg", ".jpg", ".png", ".so", ".webp", ".xapk", ".zip"]);
  const maxTextBytes = 256 * 1024;
  const handle = await open(resolved, "r");
  try {
    const size = info.size;
    const length = Math.min(size, maxTextBytes);
    const buffer = Buffer.alloc(length);
    if (length) await handle.read(buffer, 0, length, 0);
    const probe = buffer.subarray(0, Math.min(buffer.length, 8192));
    const controlBytes = [...probe].filter(byte => byte === 0 || (byte < 9 || (byte > 13 && byte < 32))).length;
    const binary = binaryExtensions.has(path.extname(resolved).toLowerCase()) || probe.includes(0) || (probe.length > 0 && controlBytes / probe.length > 0.08);
    if (binary) {
      const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
      const rows: string[] = [];
      for (let offset = 0; offset < sample.length; offset += 16) {
        const chunk = sample.subarray(offset, offset + 16);
        const hex = [...chunk].map(byte => byte.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
        const ascii = [...chunk].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("");
        rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
      }
      return `[Binary preview]\nPath: ${resolved}\nSize: ${size.toLocaleString()} bytes\nShowing: ${sample.length.toLocaleString()} bytes as hex\n\n${rows.join("\n")}`;
    }
    const text = new TextDecoder("utf-8").decode(buffer);
    return size > maxTextBytes ? `${text}\n\n--- Preview truncated: showing first ${maxTextBytes.toLocaleString()} of ${size.toLocaleString()} bytes ---` : text;
  } finally { await handle.close(); }
});
ipcMain.handle("file:list-directory", async (_event, directory: string) => {
  const resolved = await assertCaseWorkspacePath(directory);
  if (!(await stat(resolved)).isDirectory()) throw new Error("Path is not a directory");
  const entries = (await readdir(resolved, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() || entry.isFile())
    .map(entry => ({ name: entry.name, path: path.join(resolved, entry.name), type: entry.isDirectory() ? "directory" as const : "file" as const }));
  entries.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
  return entries.slice(0, 5000);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => {
  for (const runtime of agentRuntimes.values()) {
    try { runtime.worker.send({ type: "shutdown" } satisfies WorkerCommand); } catch { /* already exited */ }
  }
  agentRuntimes.clear();
  for (const terminal of terminals.values()) {
    try { terminal.process.kill(); } catch { /* already exited */ }
  }
  terminals.clear();
});
