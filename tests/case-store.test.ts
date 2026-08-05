import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CaseStore } from "../src/case-store.js";

describe("CaseStore", () => {
  it("creates, updates, and records evidence for a case", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-mobile-reverse-"));
    const store = new CaseStore(root);
    const created = await store.create("demo-case", "com.example.app");
    expect(created.phase).toBe("INTAKE");
    expect(created.title).toBe("demo-case");
    expect(created.inputs?.[0]).toMatchObject({ type: "device-package", packageName: "com.example.app" });
    const updated = await store.update({ phase: "JAVA_RECON", note: "Found signer" });
    expect(updated.notes).toEqual(["Found signer"]);
    const evidence = await store.recordToolCall("jadx", "search", { query: "sign" }, { content: [] }, 12);
    expect(evidence).toBeTruthy();
    expect(JSON.parse(await readFile(evidence!, "utf8"))).toMatchObject({ server: "jadx", tool: "search", elapsedMs: 12 });
  });

  it("rejects traversal case ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-mobile-reverse-"));
    await expect(new CaseStore(root).create("../escape")).rejects.toThrow("Invalid case id");
  });

  it("does not let an incremental follow-up replace a finalized work plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-mobile-reverse-"));
    const store = new CaseStore(root);
    const state = await store.create("reconstruction-case", "demo.apk");
    state.analysisCategory = "app-reconstruction";
    state.activeRun = {
      id: "run-1", requestId: "request-1", goal: "Rebuild the app", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: "completed", stages: [{ id: "BUILD", label: "Build", status: "completed" }],
    };
    await writeFile(path.join(root, state.id, "state.json"), JSON.stringify(state));
    await expect(store.setAnalysisPlan({ objectives: ["Rename a detail"], stages: [{ id: "REPLAN", label: "Replan" }] }))
      .rejects.toThrow("already been finalized");
    expect((await store.load()).activeRun?.stages.map(stage => stage.id)).toEqual(["BUILD"]);
  });

  it("keeps the active work snapshot synchronized with Pi stage updates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-mobile-reverse-"));
    const store = new CaseStore(root);
    const state = await store.create("multi-work-case", "demo.apk");
    const now = new Date().toISOString();
    state.analysisGoal = "Recover the protocol";
    state.analysisCategory = "protocol-recovery";
    state.activeWorkId = "work-1";
    state.activeRun = { id: "run-1", requestId: "work-1", goal: state.analysisGoal, startedAt: now, updatedAt: now, status: "running", stages: [{ id: "CAPTURE", label: "Capture", status: "running" }] };
    state.works = [{ id: "work-1", title: "Recover the protocol", goal: state.analysisGoal, category: state.analysisCategory, createdAt: now, updatedAt: now, status: "running", run: structuredClone(state.activeRun) }];
    await writeFile(path.join(root, state.id, "state.json"), JSON.stringify(state));
    await store.update({ artifact: path.join(root, state.id, "artifacts", "protocol-spec.md") });
    await store.updateAnalysisStage("CAPTURE", "completed", "Capture verified");
    const saved = await store.load();
    expect(saved.activeRun?.status).toBe("completed");
    expect(saved.works?.[0]?.status).toBe("completed");
    expect(saved.works?.[0]?.run.stages[0]?.status).toBe("completed");
    expect(saved.works?.[0]?.artifacts?.[0]).toMatch(/protocol-spec\.md$/);
  });

  it("attributes new artifacts and MCP evidence only to the active work directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-mobile-reverse-"));
    const store = new CaseStore(root);
    const state = await store.create("isolated-works", "demo.apk");
    const now = new Date().toISOString();
    const firstRoot = path.join(root, state.id, "works", "report-first-a1b2c3");
    const secondRoot = path.join(root, state.id, "works", "runtime-second-d4e5f6");
    state.analysisGoal = "Diagnose the runtime failure";
    state.analysisCategory = "runtime-diagnostics";
    state.activeWorkId = "work-2";
    state.activeRun = { id: "run-2", requestId: "work-2", goal: state.analysisGoal, startedAt: now, updatedAt: now, status: "running", stages: [{ id: "CAPTURE", label: "Capture", status: "running" }], taskDir: secondRoot, workspaceDir: secondRoot };
    state.works = [
      { id: "work-1", title: "First", goal: "Write report", category: "report", createdAt: now, updatedAt: now, status: "completed", run: { id: "run-1", requestId: "work-1", goal: "Write report", startedAt: now, updatedAt: now, status: "completed", stages: [], taskDir: firstRoot, workspaceDir: firstRoot }, artifacts: [path.join(firstRoot, "artifacts", "report.md")] },
      { id: "work-2", title: "Second", goal: state.analysisGoal, category: state.analysisCategory, createdAt: now, updatedAt: now, status: "running", run: structuredClone(state.activeRun), artifacts: [] },
    ];
    await writeFile(path.join(root, state.id, "state.json"), JSON.stringify(state));
    const evidence = await store.recordToolCall("frida", "trace", {}, { ok: true }, 5);
    expect(evidence).toContain(path.join("works", "runtime-second-d4e5f6", "evidence"));
    const saved = await store.load();
    expect(saved.works?.[0]?.artifacts).toEqual([path.join(firstRoot, "artifacts", "report.md")]);
    expect(saved.works?.[1]?.artifacts).toContain(evidence);
  });
});
