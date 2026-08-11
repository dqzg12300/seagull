import { describe, expect, it } from "vitest";
import { supportsAndroidProjectActions, type AnalysisCategory } from "../electron/shared.js";

describe("Android project actions", () => {
  it.each<AnalysisCategory>(["app-development", "app-reconstruction"])("enables build actions for %s", category => {
    expect(supportsAndroidProjectActions(category)).toBe(true);
  });

  it.each<AnalysisCategory>([
    "deobfuscation",
    "report",
    "parameter-trace",
    "algorithm-recovery",
    "data-collection",
    "runtime-diagnostics",
    "protocol-recovery",
    "version-diff",
  ])("hides build actions for %s", category => {
    expect(supportsAndroidProjectActions(category)).toBe(false);
  });
});
