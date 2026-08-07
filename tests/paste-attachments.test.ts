import { describe, expect, it } from "vitest";
import {
  canRestorePastedText,
  pastedTextPreview,
  shouldAttachPastedText,
} from "../electron/renderer/src/paste-attachments.js";

describe("pasted text attachments", () => {
  it("keeps ordinary pasted text in the composer", () => {
    expect(shouldAttachPastedText("x".repeat(4_999))).toBe(false);
  });

  it("converts a Codex-sized large paste into an attachment", () => {
    expect(shouldAttachPastedText("x".repeat(5_000))).toBe(true);
  });

  it("only offers restoring attachment sizes supported by Codex", () => {
    expect(canRestorePastedText("x".repeat(5_000))).toBe(true);
    expect(canRestorePastedText("x".repeat(25_000))).toBe(true);
    expect(canRestorePastedText("x".repeat(25_001))).toBe(false);
  });

  it("builds the compact single-line attachment preview", () => {
    const preview = pastedTextPreview(`warn, no running\n${"details ".repeat(20)}`);
    expect(preview).not.toContain("\n");
    expect(preview).toHaveLength(80);
    expect(preview.endsWith("…")).toBe(true);
  });
});
