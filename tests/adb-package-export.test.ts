import { describe, expect, it } from "vitest";
import { apkArchiveEntryNames, parseAdbPackagePaths, safeAdbPackageStem, shouldExportAdbPackage } from "../electron/adb-package-export.js";

describe("ADB package export", () => {
  it("parses every base and split APK returned by pm path", () => {
    expect(parseAdbPackagePaths("package:/data/app/demo/base.apk\r\npackage:/data/app/demo/split_config.arm64_v8a.apk\nnoise\npackage:/data/app/demo/base.apk")).toEqual([
      "/data/app/demo/base.apk",
      "/data/app/demo/split_config.arm64_v8a.apk",
    ]);
  });

  it("creates safe unique archive entry names", () => {
    expect(apkArchiveEntryNames(["/one/base.apk", "/two/base.apk", "/one/split config.apk"])).toEqual(["base.apk", "base-2.apk", "split-config.apk"]);
  });

  it("sanitizes the local package filename", () => {
    expect(safeAdbPackageStem(" com.example/app ")).toBe("com.example-app");
  });

  it("exports by default and allows an explicit metadata opt-out", () => {
    expect(shouldExportAdbPackage()).toBe(true);
    expect(shouldExportAdbPackage({ exportApk: "true" })).toBe(true);
    expect(shouldExportAdbPackage({ exportApk: "false" })).toBe(false);
  });
});
