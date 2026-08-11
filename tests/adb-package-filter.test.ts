import { describe, expect, it } from "vitest";
import { filterAdbPackages } from "../electron/renderer/src/adb-package-filter.js";

const packages = [
  { packageName: "com.android.chrome", serial: "R58M", model: "SM-A266B" },
  { packageName: "com.android.provider.armour", serial: "R58M", model: "SM-A266B" },
  { packageName: "com.example.client", serial: "emulator-5554", model: "Pixel_9" },
];

describe("ADB package filter", () => {
  it("filters case-insensitively by package name", () => {
    expect(filterAdbPackages(packages, "ARMOUR").map(item => item.packageName)).toEqual(["com.android.provider.armour"]);
  });

  it("also matches the device model and serial", () => {
    expect(filterAdbPackages(packages, "pixel")).toHaveLength(1);
    expect(filterAdbPackages(packages, "5554")).toHaveLength(1);
  });

  it("returns the complete list for an empty query", () => {
    expect(filterAdbPackages(packages, "   ")).toEqual(packages);
  });
});
