import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSkills, searchSkills } from "../electron/skills-manager.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("skills manager", () => {
  it("discovers the bundled reverse engineering skills", async () => {
    const skills = await listSkills(projectRoot);
    const names = skills.map(skill => skill.name);
    expect(names).toContain("android-recon");
    expect(names).toContain("android-deobfuscation");
    expect(names).toContain("frida-android-runtime");
    expect(names).toContain("unidbg-algorithm-recovery");
    expect(names).toContain("android-app-reconstruction");
    expect(names).toContain("android-app-development");
    expect(names).toContain("android-protocol-recovery");
    expect(names).toContain("android-version-diff");
    expect(names).toContain("android-runtime-diagnostics");
    expect(names).toContain("pcap-network-analysis");
  });

  it("searches bundled and curated skills", async () => {
    const frida = await searchSkills(projectRoot, "frida");
    expect(frida.some(skill => skill.name === "frida-android-runtime" && skill.installed)).toBe(true);
    const apiExtraction = await searchSkills(projectRoot, "HTTP APIs");
    expect(apiExtraction.some(skill => skill.name === "android-reverse-engineering" && !skill.installed)).toBe(true);
  });
});
