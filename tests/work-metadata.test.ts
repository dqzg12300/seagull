import { describe, expect, it } from "vitest";
import { applyWorkMetadataUpdate } from "../electron/work-metadata.js";
import type { WorkView } from "../electron/shared.js";

function work(): WorkView {
  return {
    id: "work-1", title: "Old title", goal: "Build a new APK", category: "app-reconstruction",
    createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z", status: "completed",
    run: { id: "run-1", requestId: "work-1", goal: "Build a new APK", startedAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z", status: "completed", stages: [] },
  };
}

describe("work metadata editing", () => {
  it("updates the Work, matching request, and active CASE category together", () => {
    const state = {
      works: [work()], activeWorkId: "work-1", analysisCategory: "app-reconstruction" as const,
      analysisRequests: [{ id: "work-1", goal: "Build a new APK", category: "app-reconstruction" as const, createdAt: "2026-08-05T00:00:00.000Z" }],
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    applyWorkMetadataUpdate(state, "work-1", { title: "Device parity app", category: "app-development" }, "2026-08-06T00:00:00.000Z");
    expect(state.works[0]!).toMatchObject({ title: "Device parity app", category: "app-development" });
    expect(state.analysisRequests[0]!.category).toBe("app-development");
    expect(state.analysisCategory).toBe("app-development");
  });

  it("does not replace the current category while editing an inactive Work", () => {
    const state = { works: [work()], activeWorkId: "another", analysisCategory: "report" as const };
    applyWorkMetadataUpdate(state, "work-1", { title: "Renamed", category: "app-development" }, "2026-08-06T00:00:00.000Z");
    expect(state.analysisCategory).toBe("report");
  });
});
