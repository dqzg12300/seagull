import { describe, expect, it } from "vitest";
import { orderedCaseWorkSummaries } from "../electron/case-summary.js";

describe("case summary work labels", () => {
  it("shows every work in creation order instead of only the active category", () => {
    const summaries = orderedCaseWorkSummaries([
      { id: "rebuild", title: "Rebuild app", category: "app-reconstruction", createdAt: "2026-08-06T10:00:00.000Z" },
      { id: "deobfuscate", title: "Recover source", category: "deobfuscation", createdAt: "2026-08-05T10:00:00.000Z" },
      { id: "verify", title: "Verify report", category: "report", createdAt: "2026-08-06T11:00:00.000Z" },
    ]);
    expect(summaries.map(work => work.category)).toEqual(["deobfuscation", "app-reconstruction", "report"]);
    expect(summaries.map(work => work.id)).toEqual(["deobfuscate", "rebuild", "verify"]);
  });

  it("keeps stable order when legacy timestamps are missing", () => {
    const summaries = orderedCaseWorkSummaries([
      { id: "first", title: "First", category: "report", createdAt: "" },
      { id: "second", title: "Second", category: "runtime-diagnostics", createdAt: "" },
    ]);
    expect(summaries.map(work => work.id)).toEqual(["first", "second"]);
  });

  it("provides one compatibility label for a case without migrated works", () => {
    expect(orderedCaseWorkSummaries(undefined, { category: "version-diff", createdAt: "2026-08-01" }))
      .toEqual([{ id: "legacy-work", title: "", category: "version-diff", createdAt: "2026-08-01" }]);
  });
});
