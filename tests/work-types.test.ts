import { describe, expect, it } from "vitest";
import { groupArtifacts, workTypes } from "../electron/renderer/src/work-types.js";

describe("work type registry", () => {
  it("defines every supported work category", () => {
    expect(Object.keys(workTypes).sort()).toEqual(["algorithm-recovery", "app-development", "app-reconstruction", "data-collection", "deobfuscation", "parameter-trace", "protocol-recovery", "report", "runtime-diagnostics", "version-diff"].sort());
  });

  it("groups protocol artifacts once and preserves unmatched outputs", () => {
    const groups = groupArtifacts("protocol-recovery", ["protocol/spec.md", "captures/messages.pcap", "src/parser.py", "notes.txt"]);
    expect(groups.find(group => group.id === "spec")?.artifacts).toEqual(["protocol/spec.md"]);
    expect(groups.find(group => group.id === "samples")?.artifacts).toEqual(["captures/messages.pcap"]);
    expect(groups.find(group => group.id === "parser")?.artifacts).toEqual(["src/parser.py"]);
    expect(groups.find(group => group.id === "other")?.artifacts).toEqual(["notes.txt"]);
    expect(groups.flatMap(group => group.artifacts)).toHaveLength(4);
  });

  it("groups runtime diagnostic evidence by incident role", () => {
    const groups = groupArtifacts("runtime-diagnostics", ["diagnostics/device-snapshot.json", "diagnostics/logcat.txt", "diagnostics/timeline.json", "diagnostics/root-cause.md"]);
    expect(groups.find(group => group.id === "reproduction")?.artifacts).toContain("diagnostics/device-snapshot.json");
    expect(groups.find(group => group.id === "logs")?.artifacts).toContain("diagnostics/logcat.txt");
    expect(groups.find(group => group.id === "correlation")?.artifacts).toContain("diagnostics/timeline.json");
    expect(groups.find(group => group.id === "root-cause")?.artifacts).toContain("diagnostics/root-cause.md");
  });
});
