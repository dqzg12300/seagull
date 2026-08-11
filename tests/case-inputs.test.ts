import { describe, expect, it } from "vitest";
import { dedupeCaseInputs } from "../electron/case-inputs.js";
import type { CaseInput } from "../electron/shared.js";

const input = (id: string, overrides: Partial<CaseInput> = {}): CaseInput => ({ id, type: "apk", name: "phonepe.apk", path: `D:\\case\\inputs\\${id}.apk`, addedAt: "2026-08-07T00:00:00.000Z", ...overrides });

describe("CASE input deduplication", () => {
  it("keeps one record for repeated files with the same hash", () => {
    const result = dedupeCaseInputs([input("one", { sha256: "ABC" }), input("two", { sha256: "abc" }), input("three", { sha256: "ABC" })]);
    expect(result.inputs.map(item => item.id)).toEqual(["one"]);
    expect(result.removedIds).toEqual(["two", "three"]);
  });

  it("prefers the current primary record when duplicates already exist", () => {
    const result = dedupeCaseInputs([input("old", { sha256: "abc" }), input("primary", { sha256: "abc" })], "primary");
    expect(result.inputs.map(item => item.id)).toEqual(["primary"]);
    expect(result.primaryInputId).toBe("primary");
  });

  it("keeps files with different hashes even when their names match", () => {
    const result = dedupeCaseInputs([input("one", { sha256: "abc" }), input("two", { sha256: "def", name: "phonepe.apk" })]);
    expect(result.inputs).toHaveLength(2);
  });

  it("deduplicates the same package on the same ADB device", () => {
    const device = (id: string): CaseInput => input(id, { type: "device-package", path: undefined, sha256: undefined, packageName: "com.phonepe.app", metadata: { serial: "DEVICE-1" } });
    expect(dedupeCaseInputs([device("one"), device("two")]).inputs).toHaveLength(1);
  });
});
