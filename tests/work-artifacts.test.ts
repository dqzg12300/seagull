import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { allIndexedArtifacts, rebuildWorkArtifactOwnership, type ArtifactCaseState } from "../electron/work-artifacts.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("legacy Work artifact ownership", () => {
  it("rebuilds isolated Work roots and keeps shared legacy outputs on the first Work", async () => {
    const caseDir = await mkdtemp(path.join(os.tmpdir(), "seagull-work-artifacts-"));
    cleanup.push(caseDir);
    const sharedReport = path.join(caseDir, "artifacts", "report.md");
    const work2Task = path.join(caseDir, "tasks", "reconstruction-work-2");
    const work2Project = path.join(caseDir, "projects", "reconstruction-work-2");
    const work3Task = path.join(caseDir, "tasks", "reconstruction-work-3");
    const work3Project = path.join(caseDir, "projects", "reconstruction-work-3");
    await Promise.all([
      mkdir(path.dirname(sharedReport), { recursive: true }),
      mkdir(work2Task, { recursive: true }), mkdir(work2Project, { recursive: true }),
      mkdir(work3Task, { recursive: true }), mkdir(work3Project, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(sharedReport, "legacy report"),
      writeFile(path.join(work2Task, "delivery.md"), "rebuild delivery"),
      writeFile(path.join(work3Task, "delivery.md"), "app delivery"),
      writeFile(path.join(work3Project, "settings.gradle"), ""),
    ]);
    const state: ArtifactCaseState = {
      activeWorkId: "work-3",
      artifacts: [sharedReport, work2Task, work2Project, work3Task, work3Project],
      works: [
        { id: "work-1", createdAt: "2026-01-01T00:00:00Z", run: {}, artifacts: [] },
        { id: "work-2", createdAt: "2026-01-02T00:00:00Z", run: {}, artifacts: [] },
        { id: "work-3", createdAt: "2026-01-03T00:00:00Z", run: { taskDir: work3Task, workspaceDir: work3Project }, artifacts: [], artifactSnapshot: ["stale"] },
      ],
    };

    expect(await rebuildWorkArtifactOwnership(state, caseDir)).toBe(true);
    expect(state.works![0]!.artifacts).toContain(sharedReport);
    expect(state.works![1]!.run!.taskDir).toBe(work2Task);
    expect(state.works![1]!.run!.workspaceDir).toBe(work2Project);
    expect(state.works![1]!.artifacts).toEqual(expect.arrayContaining([work2Task, work2Project, path.join(work2Task, "delivery.md")]));
    expect(state.works![2]!.artifacts).toEqual(expect.arrayContaining([work3Task, work3Project, path.join(work3Task, "delivery.md"), path.join(work3Project, "settings.gradle")]));
    expect(state.works![2]!.artifactSnapshot).toEqual(expect.arrayContaining(state.works![0]!.artifacts ?? []));
    expect(state.activeRun).toEqual(state.works![2]!.run);
    expect(allIndexedArtifacts(state)).toContain(path.join(work3Task, "delivery.md"));
    expect(await rebuildWorkArtifactOwnership(state, caseDir)).toBe(false);
  });
});
