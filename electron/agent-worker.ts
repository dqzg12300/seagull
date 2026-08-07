import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AppSettings, WorkerCommand, WorkerEvent } from "./shared.js";
import { buildInheritedWorkConversationContext, resolveUpstreamWorkIds, selectLegacySessionForWork, sessionBranchMessages, type InheritedWorkConversation, type WorkSessionLocator } from "./work-session.js";
import mobileReverse from "../src/index.js";

let session: AgentSession | undefined;
let cwd = process.cwd();
let toolWatchGeneration = 0;
const MAX_WARM_SESSIONS = 4;
type CachedSession = {
  key: string;
  session: AgentSession;
  sessionManager: SessionManager;
  settingsFingerprint: string;
  contextVersion: string;
  unsubscribe: () => void;
  lastUsed: number;
};
const sessionCache = new Map<string, CachedSession>();

function watchActiveTools(activeSession: AgentSession): void {
  const generation = ++toolWatchGeneration;
  let previous = "";
  let checks = 0;
  const poll = () => {
    if (generation !== toolWatchGeneration || session !== activeSession) return;
    const tools = activeSession.getAllTools().map(tool => tool.name).sort();
    const fingerprint = tools.join("\n");
    if (fingerprint !== previous) { previous = fingerprint; send({ type: "tools", tools }); }
    checks += 1;
    if (checks < 600) setTimeout(poll, 250);
  };
  poll();
}

async function recoverSessionManager(sessionDir: string, workingDirectory: string): Promise<SessionManager> {
  await mkdir(sessionDir, { recursive: true });
  const candidates = (await readdir(sessionDir))
    .filter(name => name.endsWith(".jsonl"))
    .map(name => path.join(sessionDir, name));
  const ranked = await Promise.all(candidates.map(async filename => ({ filename, mtime: (await stat(filename)).mtimeMs })));
  ranked.sort((a, b) => b.mtime - a.mtime);
  for (const candidate of ranked) {
    const content = await readFile(candidate.filename, "utf8");
    if (content.split(/\r?\n/).some(line => line.includes('"type":"message"'))) {
      return SessionManager.open(candidate.filename, sessionDir, workingDirectory);
    }
  }
  return SessionManager.continueRecent(workingDirectory, sessionDir);
}

async function persistedMessages(sessionFile: string | undefined): Promise<unknown[]> {
  if (!sessionFile) return [];
  try {
    const lines = (await readFile(sessionFile, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map(line => JSON.parse(line) as { type?: string; message?: unknown }).filter(entry => entry.type === "message" && entry.message).map(entry => entry.message);
  } catch { return []; }
}

function settingsFingerprint(settings?: AppSettings): string {
  return createHash("sha256").update(JSON.stringify([
    settings?.baseUrl ?? "",
    settings?.apiKey ?? "",
    settings?.modelId ?? "",
  ])).digest("hex");
}

async function directorySessionVersion(directory: string): Promise<string> {
  try {
    const files = (await readdir(directory)).filter(name => name.endsWith(".jsonl"));
    const details = await Promise.all(files.map(async name => {
      const info = await stat(path.join(directory, name));
      return `${name}:${info.size}:${info.mtimeMs}`;
    }));
    return details.sort().join("|");
  } catch { return "missing"; }
}

async function inheritedContextVersion(caseDir: string | undefined, workId: string | undefined): Promise<string> {
  if (!caseDir || !workId) return "none";
  try {
    const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8")) as {
      works?: Array<{ id: string; createdAt?: string; status?: string; upstreamWorkIds?: string[] }>;
    };
    const upstreamIds = resolveUpstreamWorkIds(state.works ?? [], workId);
    const versions = await Promise.all(upstreamIds.map(async id => `${id}:${await directorySessionVersion(path.join(caseDir, ".sessions", "works", id))}`));
    return createHash("sha256").update(JSON.stringify([upstreamIds, versions])).digest("hex");
  } catch { return "unavailable"; }
}

function disposeCachedSession(key: string): void {
  const cached = sessionCache.get(key);
  if (!cached) return;
  cached.unsubscribe();
  cached.session.dispose();
  sessionCache.delete(key);
  if (session === cached.session) session = undefined;
}

function trimSessionCache(activeKey: string): void {
  const candidates = [...sessionCache.values()].filter(item => item.key !== activeKey).sort((a, b) => a.lastUsed - b.lastUsed);
  while (sessionCache.size > MAX_WARM_SESSIONS && candidates.length) disposeCachedSession(candidates.shift()!.key);
}

async function activateCachedSession(cached: CachedSession, cacheHit: boolean): Promise<void> {
  session = cached.session;
  cached.lastUsed = Date.now();
  watchActiveTools(cached.session);
  const branchHistory = sessionBranchMessages(cached.sessionManager.getBranch());
  const restoredHistory = branchHistory.length
    ? branchHistory
    : cached.session.messages.length
      ? cached.session.messages
      : await persistedMessages(cached.session.sessionFile);
  send({
    type: "ready",
    sessionId: cached.session.sessionId,
    sessionFile: cached.session.sessionFile,
    tools: cached.session.getAllTools().map(tool => tool.name),
    history: serializable(restoredHistory) as unknown[],
    cacheHit,
  });
  sendState();
}

async function prepareWorkSessionDirectory(caseDir: string, workId: string): Promise<string> {
  const sessionDir = path.join(caseDir, ".sessions", "works", workId);
  await mkdir(sessionDir, { recursive: true });
  const existing = (await readdir(sessionDir)).some(name => name.endsWith(".jsonl"));
  if (existing) return sessionDir;

  const legacyDir = path.join(caseDir, ".sessions");
  let candidates: Array<{ filename: string; mtime: number }> = [];
  try {
    candidates = await Promise.all((await readdir(legacyDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async entry => { const filename = path.join(legacyDir, entry.name); return { filename, mtime: (await stat(filename)).mtimeMs }; }));
  } catch { return sessionDir; }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const legacy = candidates[0];
  if (!legacy) return sessionDir;

  try {
    const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8")) as { works?: Array<{ id: string; title?: string; goal?: string; createdAt?: string; run?: { taskDir?: string; workspaceDir?: string } }> };
    const works: WorkSessionLocator[] = (state.works ?? []).map(work => ({ id: work.id, title: work.title, goal: work.goal, createdAt: work.createdAt, taskDir: work.run?.taskDir, workspaceDir: work.run?.workspaceDir }));
    const entries = (await readFile(legacy.filename, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
    const selected = selectLegacySessionForWork(entries, works, workId);
    if (selected.length) await writeFile(path.join(sessionDir, path.basename(legacy.filename)), selected.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  } catch { /* malformed legacy sessions must not block a fresh Work session */ }
  return sessionDir;
}

async function prepareInheritedWorkContext(caseDir: string, workId: string, contextVersion: string): Promise<string | undefined> {
  try {
    const state = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8")) as {
      works?: Array<{ id: string; title?: string; goal?: string; createdAt?: string; status?: string; upstreamWorkIds?: string[]; run?: { taskDir?: string; workspaceDir?: string } }>;
    };
    const current = state.works?.find(work => work.id === workId);
    if (!current) return undefined;
    const upstreamIds = resolveUpstreamWorkIds(state.works ?? [], current.id);
    if (!upstreamIds.length) return undefined;

    const contextDir = current.run?.taskDir
      ? path.join(current.run.taskDir, ".context")
      : path.join(caseDir, ".context", workId);
    const transcriptFile = path.join(contextDir, "upstream-conversations.md");
    const memoryFile = path.join(contextDir, "upstream-memory.md");
    const versionFile = path.join(contextDir, ".upstream-context.version");
    try {
      const cachedVersion = (await readFile(versionFile, "utf8")).trim();
      if (cachedVersion === contextVersion) {
        await Promise.all([stat(transcriptFile), stat(memoryFile)]);
        return memoryFile;
      }
    } catch { /* rebuild stale or incomplete inherited context */ }

    const inherited: InheritedWorkConversation[] = [];
    for (const upstreamId of upstreamIds) {
      const upstream = state.works?.find(work => work.id === upstreamId);
      if (!upstream) continue;
      const upstreamSessionDir = await prepareWorkSessionDirectory(caseDir, upstreamId);
      const manager = await recoverSessionManager(upstreamSessionDir, cwd);
      const messages = sessionBranchMessages(manager.getBranch());
      inherited.push({ id: upstream.id, title: upstream.title, goal: upstream.goal, messages });
    }
    if (!inherited.length) return undefined;

    await mkdir(contextDir, { recursive: true });
    const context = buildInheritedWorkConversationContext(inherited);
    await writeFile(transcriptFile, `${context.transcript}\n`);
    await writeFile(memoryFile, `# Hidden inherited Work memory\n\n- Current Work: ${current.title ?? current.id}\n- Full cleaned transcript: ${transcriptFile}\n- Upstream Work count: ${inherited.length}\n\n${context.digest}\n`);
    await writeFile(versionFile, `${contextVersion}\n`);
    return memoryFile;
  } catch { return undefined; }
}

function send(event: WorkerEvent): void {
  if (process.send) process.send(event);
}

function serializable(value: unknown): unknown {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return { type: "unserializable-event", text: String(value) }; }
}

async function initialize(nextCwd: string, caseId?: string, workId?: string, caseRoot?: string, settings?: AppSettings, invalidate = false): Promise<void> {
  cwd = path.resolve(nextCwd);
  if (caseRoot) process.env.SEAGULL_CASE_ROOT = path.resolve(caseRoot);
  else delete process.env.SEAGULL_CASE_ROOT;
  if (caseId) process.env.SEAGULL_ACTIVE_CASE = caseId;
  else delete process.env.SEAGULL_ACTIVE_CASE;
  if (workId) process.env.SEAGULL_ACTIVE_WORK = workId;
  else delete process.env.SEAGULL_ACTIVE_WORK;
  const caseDir = caseId && caseRoot ? path.join(caseRoot, caseId) : undefined;
  const cacheKey = `${caseDir ?? cwd}::${workId ?? "case"}`;
  const nextSettingsFingerprint = settingsFingerprint(settings);
  const nextContextVersion = await inheritedContextVersion(caseDir, workId);
  if (invalidate) disposeCachedSession(cacheKey);
  const warm = sessionCache.get(cacheKey);
  if (warm && warm.settingsFingerprint === nextSettingsFingerprint && warm.contextVersion === nextContextVersion && !warm.session.isStreaming) {
    await activateCachedSession(warm, true);
    return;
  }
  if (warm) disposeCachedSession(cacheKey);
  const inheritedContextFile = caseDir && workId && nextContextVersion !== "none"
    ? await prepareInheritedWorkContext(caseDir, workId, nextContextVersion)
    : undefined;
  if (inheritedContextFile) process.env.SEAGULL_UPSTREAM_CONTEXT_FILE = inheritedContextFile;
  else delete process.env.SEAGULL_UPSTREAM_CONTEXT_FILE;
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionFactories: [mobileReverse],
    additionalSkillPaths: [path.join(cwd, "skills"), path.join(cwd, ".pi", "skills")],
  });
  const resourcesTask = resourceLoader.reload();
  const sessionManagerTask = (async () => {
    const sessionDir = caseDir
      ? workId ? await prepareWorkSessionDirectory(caseDir, workId) : path.join(caseDir, ".sessions")
      : path.join(cwd, ".pi", "sessions", caseId ?? "workspace");
    return recoverSessionManager(sessionDir, cwd);
  })();
  const modelTask = (async () => {
    let modelRuntime: ModelRuntime | undefined;
    let model;
    if (settings?.baseUrl && settings.modelId) {
      const runtimeDir = path.join(cwd, ".pi", "runtime");
      const modelsPath = path.join(runtimeDir, "models.json");
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(modelsPath, JSON.stringify({ providers: { seagull: {
        baseUrl: settings.baseUrl.replace(/\/$/, ""), api: "openai-completions", models: [{ id: settings.modelId, name: settings.modelId, input: ["text", "image"] }],
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      } } }, null, 2));
      modelRuntime = await ModelRuntime.create({ modelsPath, authPath: path.join(runtimeDir, "auth.json") });
      if (settings.apiKey) modelRuntime.setRuntimeApiKey("seagull", settings.apiKey);
      model = modelRuntime.getModel("seagull", settings.modelId);
      if (!model) throw new Error(`Configured model not found: ${settings.modelId}`);
    }
    return { modelRuntime, model };
  })();
  const [, sessionManager, modelSetup] = await Promise.all([resourcesTask, sessionManagerTask, modelTask]);
  const previousSessionFile = sessionManager.getSessionFile();
  const created = await createAgentSession({
    cwd,
    resourceLoader,
    sessionManager,
    sessionStartEvent: previousSessionFile
      ? { type: "session_start", reason: "resume", previousSessionFile }
      : { type: "session_start", reason: "startup" },
    modelRuntime: modelSetup.modelRuntime,
    model: modelSetup.model,
  });
  await created.session.bindExtensions({});
  const createdSession = created.session;
  const unsubscribe = createdSession.subscribe(event => {
    if (session !== createdSession) return;
    send({ type: "agent-event", event: serializable(event) });
    sendState((event as { type?: string }).type === "agent_end" ? false : undefined);
  });
  const cached: CachedSession = {
    key: cacheKey,
    session: createdSession,
    sessionManager,
    settingsFingerprint: nextSettingsFingerprint,
    contextVersion: nextContextVersion,
    unsubscribe,
    lastUsed: Date.now(),
  };
  sessionCache.set(cacheKey, cached);
  await activateCachedSession(cached, false);
  trimSessionCache(cacheKey);
}

function sendState(streamingOverride?: boolean): void {
  send({
    type: "state",
    streaming: streamingOverride ?? session?.isStreaming ?? false,
    model: session?.model ? `${session.model.provider}/${session.model.id}` : undefined,
    thinkingLevel: session?.thinkingLevel,
  });
}

let promptGeneration = 0;
let promptQueue: Promise<void> = Promise.resolve();

process.on("message", async (command: WorkerCommand) => {
  try {
    if (command.type === "initialize") return await initialize(command.cwd, command.caseId, command.workId, command.caseRoot, command.settings, command.invalidate);
    if (command.type === "shutdown") {
      for (const key of [...sessionCache.keys()]) disposeCachedSession(key);
      process.exit(0);
    }
    if (!session) throw new Error("Pi session is not initialized");
    if (command.type === "abort") {
      promptGeneration += 1;
      await session.abort();
      return sendState(false);
    }
    if (command.type === "prompt") {
      const generation = promptGeneration;
      promptQueue = promptQueue.then(async () => {
        if (generation !== promptGeneration || !session) return;
        await session.prompt(command.text || "请分析附加图片。", {
          images: command.images?.map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
        });
        if (generation === promptGeneration) sendState(false);
      }).catch(error => {
        const err = error instanceof Error ? error : new Error(String(error));
        send({ type: "error", message: err.message, stack: err.stack });
        sendState();
      });
      return;
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    send({ type: "error", message: err.message, stack: err.stack });
    sendState();
  }
});

process.on("uncaughtException", error => send({ type: "error", message: error.message, stack: error.stack }));
process.on("unhandledRejection", error => send({ type: "error", message: String(error) }));
