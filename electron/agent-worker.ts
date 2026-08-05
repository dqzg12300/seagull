import path from "node:path";
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
import mobileReverse from "../src/index.js";

let session: AgentSession | undefined;
let cwd = process.cwd();
let toolWatchGeneration = 0;

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

function send(event: WorkerEvent): void {
  if (process.send) process.send(event);
}

function serializable(value: unknown): unknown {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return { type: "unserializable-event", text: String(value) }; }
}

async function initialize(nextCwd: string, caseId?: string, caseRoot?: string, settings?: AppSettings): Promise<void> {
  session?.dispose();
  cwd = path.resolve(nextCwd);
  if (caseRoot) process.env.SEAGULL_CASE_ROOT = path.resolve(caseRoot);
  else delete process.env.SEAGULL_CASE_ROOT;
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionFactories: [mobileReverse],
    additionalSkillPaths: [path.join(cwd, "skills"), path.join(cwd, ".pi", "skills")],
  });
  await resourceLoader.reload();
  const sessionDir = caseId && caseRoot ? path.join(caseRoot, caseId, ".sessions") : path.join(cwd, ".pi", "sessions", caseId ?? "workspace");
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
  const sessionManager = await recoverSessionManager(sessionDir, cwd);
  const previousSessionFile = sessionManager.getSessionFile();
  const created = await createAgentSession({
    cwd,
    resourceLoader,
    sessionManager,
    sessionStartEvent: previousSessionFile
      ? { type: "session_start", reason: "resume", previousSessionFile }
      : { type: "session_start", reason: "startup" },
    modelRuntime,
    model,
  });
  await created.session.bindExtensions({});
  session = created.session;
  watchActiveTools(session);
  session.subscribe(event => {
    send({ type: "agent-event", event: serializable(event) });
    sendState((event as { type?: string }).type === "agent_end" ? false : undefined);
  });
  const restoredHistory = session.messages.length ? session.messages : await persistedMessages(session.sessionFile);
  send({
    type: "ready",
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    tools: session.getAllTools().map(tool => tool.name),
    history: serializable(restoredHistory) as unknown[],
  });
  sendState();
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
    if (command.type === "initialize") return await initialize(command.cwd, command.caseId, command.caseRoot, command.settings);
    if (command.type === "shutdown") { session?.dispose(); process.exit(0); }
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
