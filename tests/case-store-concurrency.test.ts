import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaseStore, type CaseState } from "../src/case-store.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("CaseStore concurrent Work isolation", () => {
  it("merges progress from two Work-bound stores without changing the selected Work", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "seagull-case-store-"));
    temporary.push(root);
    const caseDir = path.join(root, "case-1");
    await mkdir(caseDir);
    const now = new Date().toISOString();
    const run = (id: string) => ({ id: `run-${id}`, requestId: id, goal: id, startedAt: now, updatedAt: now, status: "running" as const, stages: [{ id: "VERIFY", label: "Verify", status: "running" as const }] });
    const state: CaseState = { id: "case-1", createdAt: now, updatedAt: now, phase: "VERIFY", notes: [], artifacts: [], activeWorkId: "work-b", activeRun: run("work-b"), works: [
      { id: "work-a", title: "A", goal: "A", category: "report", createdAt: now, updatedAt: now, status: "running", run: run("work-a") },
      { id: "work-b", title: "B", goal: "B", category: "report", createdAt: now, updatedAt: now, status: "running", run: run("work-b") },
    ] };
    await writeFile(path.join(caseDir, "state.json"), JSON.stringify(state));
    const storeA = new CaseStore(root, "work-a");
    const storeB = new CaseStore(root, "work-b");
    await Promise.all([storeA.use("case-1"), storeB.use("case-1")]);
    await Promise.all([storeA.updateAnalysisStage("VERIFY", "completed", "A done"), storeB.updateAnalysisStage("VERIFY", "completed", "B done")]);
    const saved = JSON.parse(await readFile(path.join(caseDir, "state.json"), "utf8")) as CaseState;
    expect(saved.activeWorkId).toBe("work-b");
    expect(saved.works?.map(work => work.run.status)).toEqual(["completed", "completed"]);
    expect(saved.notes).toEqual(expect.arrayContaining(["A done", "B done"]));
  });
});
