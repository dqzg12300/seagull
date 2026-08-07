import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile, stat, open, unlink } from "node:fs/promises";
import path from "node:path";

export type CasePhase =
  | "INTAKE" | "APK_TRIAGE" | "JAVA_RECON" | "NATIVE_RECON"
  | "RUNTIME_TRACE" | "RECOVER_ALGORITHM" | "UNIDBG_EMULATE"
  | "VERIFY" | "GENERATE_REPLAY" | "REPORT";

export interface CaseState {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: CasePhase;
  target?: string;
  sha256?: string;
  notes: string[];
  artifacts: string[];
  analysisGoal?: string;
  analysisCategory?: "deobfuscation" | "report" | "parameter-trace" | "algorithm-recovery" | "data-collection" | "runtime-diagnostics" | "protocol-recovery" | "version-diff" | "app-reconstruction" | "app-development";
  analysisRequests?: Array<{ id: string; goal: string; category?: CaseState["analysisCategory"]; createdAt: string }>;
  activeRun?: AnalysisRun;
  workspaceDir?: string;
  description?: string;
  works?: Work[];
  activeWorkId?: string;
  title?: string;
  platform?: "android" | "native" | "protocol" | "general";
  inputs?: Array<{ id: string; type: "apk" | "device-package" | "project" | "native-library" | "dex" | "log" | "document" | "capture" | "other"; name: string; path?: string; packageName?: string; sha256?: string; metadata?: Record<string, string>; addedAt: string }>;
  primaryInputId?: string;
}

export interface Work {
  id: string;
  title: string;
  goal: string;
  category: NonNullable<CaseState["analysisCategory"]>;
  createdAt: string;
  updatedAt: string;
  status: AnalysisRun["status"];
  run: AnalysisRun;
  artifactSnapshot?: string[];
  artifacts?: string[];
  upstreamWorkIds?: string[];
}

export interface AnalysisRunStage {
  id: string;
  label: string;
  route?: string;
  successCriteria?: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
}

export interface AnalysisRun {
  id: string;
  requestId: string;
  goal: string;
  startedAt: string;
  updatedAt: string;
  status: "planning" | "running" | "completed" | "failed";
  stages: AnalysisRunStage[];
  objectives?: string[];
  rationale?: string;
  taskDir?: string;
  workspaceDir?: string;
  upstreamArtifacts?: string[];
}

function safeCaseId(value: string): string {
  if (value.includes("/") || value.includes("\\") || value.split(".").length > 3 || value.includes("..")) {
    throw new Error("Invalid case id");
  }
  const result = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!result || result === "." || result === "..") throw new Error("Invalid case id");
  return result;
}

export class CaseStore {
  private activeId?: string;
  constructor(private readonly root: string, private readonly boundWorkId?: string) {}

  get activeCaseId(): string | undefined { return this.activeId; }
  caseDir(id = this.requireActive()): string { return path.join(this.root, safeCaseId(id)); }

  async create(id: string, target?: string): Promise<CaseState> {
    id = safeCaseId(id);
    const now = new Date().toISOString();
    const state: CaseState = { id, title: id, platform: "android", inputs: [], createdAt: now, updatedAt: now, phase: "INTAKE", target, workspaceDir: this.caseDir(id), notes: [], artifacts: [] };
    await mkdir(path.join(this.caseDir(id), "artifacts"), { recursive: true });
    await mkdir(path.join(this.caseDir(id), "evidence"), { recursive: true });
    if (target) {
      try { state.sha256 = await this.sha256(target); } catch { /* target may be a package name */ }
      const extension = path.extname(target).toLowerCase();
      const isFile = Boolean(state.sha256);
      const type = !isFile ? "device-package" : [".apk", ".xapk", ".apks", ".aab"].includes(extension) ? "apk" : extension === ".so" ? "native-library" : [".dex", ".jar"].includes(extension) ? "dex" : "other";
      const input = { id: `input-${Date.now().toString(36)}`, type, name: isFile ? path.basename(target) : target, ...(isFile ? { path: target } : { packageName: target }), ...(state.sha256 ? { sha256: state.sha256 } : {}), addedAt: now } as NonNullable<CaseState["inputs"]>[number];
      state.inputs!.push(input); state.primaryInputId = input.id;
    }
    await this.save(state);
    this.activeId = id;
    return state;
  }

  async use(id: string): Promise<CaseState> {
    const state = await this.load(safeCaseId(id));
    this.activeId = state.id;
    return state;
  }

  async load(id = this.requireActive()): Promise<CaseState> {
    const state = JSON.parse(await readFile(path.join(this.caseDir(id), "state.json"), "utf8")) as CaseState;
    return this.bindWork(state);
  }

  async update(patch: Partial<Pick<CaseState, "phase" | "target" | "sha256">> & { note?: string; artifact?: string }): Promise<CaseState> {
    const state = await this.load();
    Object.assign(state, patch);
    delete (state as CaseState & { note?: string }).note;
    delete (state as CaseState & { artifact?: string }).artifact;
    if (patch.note) state.notes.push(patch.note);
    if (patch.artifact && !state.artifacts.includes(patch.artifact)) state.artifacts.push(patch.artifact);
    state.updatedAt = new Date().toISOString();
    await this.save(state);
    return state;
  }

  async setAnalysisPlan(input: { objectives: string[]; rationale?: string; stages: Array<Omit<AnalysisRunStage, "status">> }): Promise<CaseState> {
    const state = await this.load();
    if (!state.activeRun) throw new Error("No active analysis run");
    if (state.activeRun.status !== "planning") {
      throw new Error("The active work plan has already been finalized. Continue as an incremental follow-up; start a new work item explicitly if a new plan is required.");
    }
    const ids = new Set<string>();
    const planned = input.stages.map((stage, index): AnalysisRunStage => {
      const id = stage.id.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_");
      if (!id || id === "PLANNING" || ids.has(id)) throw new Error(`Invalid or duplicate analysis stage: ${stage.id}`);
      ids.add(id);
      return { ...stage, id, label: stage.label.trim() || id, status: index === 0 ? "running" : "pending" };
    });
    if (planned.length === 0) throw new Error("Analysis plan must contain at least one execution stage");
    state.activeRun.objectives = input.objectives;
    state.activeRun.rationale = input.rationale;
    state.activeRun.status = "running";
    state.activeRun.stages = [{ id: "PLANNING", label: "Planning", route: "Pi", status: "completed" }, ...planned];
    state.activeRun.updatedAt = new Date().toISOString();
    state.updatedAt = state.activeRun.updatedAt;
    await this.save(state);
    return state;
  }

  async updateAnalysisStage(id: string, status: AnalysisRunStage["status"], note?: string): Promise<CaseState> {
    const state = await this.load();
    const run = state.activeRun;
    if (!run) throw new Error("No active analysis run");
    const stage = run.stages.find(item => item.id === id.trim().toUpperCase());
    if (!stage) throw new Error(`Analysis stage not found: ${id}`);
    if (status === "running") for (const item of run.stages) if (item.status === "running") item.status = "pending";
    stage.status = status;
    if (note) state.notes.push(note);
    if (status === "completed" || status === "skipped") {
      const next = run.stages.find(item => item.status === "pending");
      if (next) next.status = "running";
    }
    const remaining = run.stages.some(item => item.status === "pending" || item.status === "running");
    run.status = status === "failed" ? "failed" : remaining ? "running" : "completed";
    run.updatedAt = new Date().toISOString();
    state.updatedAt = run.updatedAt;
    await this.save(state);
    return state;
  }

  async recordToolCall(server: string, tool: string, args: unknown, result: unknown, elapsedMs: number): Promise<string | undefined> {
    if (!this.activeId) return undefined;
    const state = await this.load();
    const evidenceRoot = state.activeRun?.taskDir ? path.join(state.activeRun.taskDir, "evidence") : path.join(this.caseDir(), "evidence");
    await mkdir(evidenceRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(evidenceRoot, `${stamp}-${server}-${tool}.json`);
    await writeFile(filename, JSON.stringify({ timestamp: new Date().toISOString(), server, tool, args, elapsedMs, result }, null, 2));
    await appendFile(path.join(state.activeRun?.taskDir ?? this.caseDir(), "commands.jsonl"), JSON.stringify({ timestamp: new Date().toISOString(), server, tool, elapsedMs, evidence: filename }) + "\n");
    await this.update({ artifact: filename });
    return filename;
  }

  private async save(state: CaseState): Promise<void> {
    const workId = this.boundWorkId ?? state.activeWorkId;
    if (workId && state.activeRun && state.works) {
      const activeWork = state.works.find(work => work.id === workId);
      if (activeWork) {
        activeWork.run = structuredClone(state.activeRun);
        activeWork.status = state.activeRun.status;
        activeWork.updatedAt = state.activeRun.updatedAt;
        activeWork.goal = state.analysisGoal ?? activeWork.goal;
        activeWork.category = state.analysisCategory ?? activeWork.category;
        const root = activeWork.run.taskDir;
        if (root) {
          const normalizedRoot = path.resolve(root).toLowerCase();
          const owned = state.artifacts.filter(artifact => {
            const candidate = path.resolve(artifact).toLowerCase();
            return candidate === normalizedRoot || candidate.startsWith(normalizedRoot + path.sep);
          });
          activeWork.artifacts = [...new Set([...(activeWork.artifacts ?? []), ...owned])];
        } else {
          const inherited = new Set(activeWork.artifactSnapshot ?? []);
          activeWork.artifacts = state.artifacts.filter(artifact => !inherited.has(artifact));
        }
      }
    }
    await mkdir(this.caseDir(state.id), { recursive: true });
    await this.withStateLock(state.id, async () => {
      const stateFile = path.join(this.caseDir(state.id), "state.json");
      let latest: CaseState | undefined;
      try { latest = JSON.parse(await readFile(stateFile, "utf8")) as CaseState; } catch { /* first save */ }
      if (!latest || !workId || !state.works) {
        await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
        return;
      }
      latest.works ??= [];
      const desired = state.works.find(work => work.id === workId);
      const latestIndex = latest.works.findIndex(work => work.id === workId);
      if (desired) {
        const merged = { ...(latestIndex >= 0 ? latest.works[latestIndex] : undefined), ...desired, run: structuredClone(state.activeRun ?? desired.run), status: (state.activeRun ?? desired.run).status, updatedAt: (state.activeRun ?? desired.run).updatedAt } as Work;
        if (latestIndex >= 0) latest.works[latestIndex] = merged;
        else latest.works.push(merged);
        if (latest.activeWorkId === workId) {
          latest.activeRun = structuredClone(merged.run);
          latest.analysisGoal = merged.goal;
          latest.analysisCategory = merged.category;
          latest.phase = state.phase;
        }
      }
      latest.notes = [...new Set([...(latest.notes ?? []), ...(state.notes ?? [])])];
      latest.artifacts = [...new Set([...(latest.artifacts ?? []), ...(state.artifacts ?? [])])];
      latest.updatedAt = Date.parse(state.updatedAt) > Date.parse(latest.updatedAt) ? state.updatedAt : latest.updatedAt;
      await writeFile(stateFile, JSON.stringify(latest, null, 2) + "\n");
    });
  }

  private bindWork(state: CaseState): CaseState {
    if (!this.boundWorkId || !state.works) return state;
    const work = state.works.find(item => item.id === this.boundWorkId);
    if (!work) return state;
    state.activeWorkId = work.id;
    state.activeRun = structuredClone(work.run);
    state.analysisGoal = work.goal;
    state.analysisCategory = work.category;
    return state;
  }

  private async withStateLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const lockFile = path.join(this.caseDir(id), ".state.lock");
    let handle;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try { handle = await open(lockFile, "wx"); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const info = await stat(lockFile);
          if (Date.now() - info.mtimeMs > 120_000) await unlink(lockFile);
        } catch { /* another process released it */ }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!handle) throw new Error(`Timed out locking CASE state: ${id}`);
    try { return await action(); }
    finally {
      await handle.close();
      try { await unlink(lockFile); } catch { /* already removed */ }
    }
  }

  private requireActive(): string {
    if (!this.activeId) throw new Error("No active reverse case. Run /reverse-case-new <id> [target] first.");
    return this.activeId;
  }

  private async sha256(filename: string): Promise<string> {
    await stat(filename);
    const content = await readFile(filename);
    return createHash("sha256").update(content).digest("hex");
  }
}
