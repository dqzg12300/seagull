import { describe, expect, it } from "vitest";
import { parseVisibleUserHistoryMessage } from "../electron/renderer/src/chat-history.js";
import { canSubmitWorkRequest, workRequestAttachmentContext, workRequestGoal } from "../electron/renderer/src/work-request-attachments.js";

describe("work request attachments", () => {
  it("serializes pasted text and image names into the persisted visible message protocol", () => {
    const context = workRequestAttachmentContext(
      [{ name: "crash log", text: "FATAL EXCEPTION\nmain" }],
      [{ name: "screen.png", mimeType: "image/png", data: "AA==" }],
    );
    expect(context).toContain("[PASTED_TEXT_ATTACHMENTS]");
    expect(context).toContain("## Text 1: crash log\nFATAL EXCEPTION");
    expect(context).toContain("[IMAGE_ATTACHMENTS]");
    expect(context).toContain("- screen.png (image/png)");
    const restored = parseVisibleUserHistoryMessage(`[INTERNAL PLANNING]\n[SEAGULL_USER_MESSAGE]\n修复这个崩溃${context}`);
    expect(restored?.text).toBe("修复这个崩溃");
    expect(restored?.attachments[0]?.content).toContain("FATAL EXCEPTION");
    expect(restored?.imageNames).toEqual(["screen.png"]);
  });

  it("allows an attachment-only request and supplies a valid persisted goal", () => {
    expect(canSubmitWorkRequest("", true)).toBe(true);
    expect(workRequestGoal("", true, "zh-CN").length).toBeGreaterThanOrEqual(10);
    expect(canSubmitWorkRequest("short", false)).toBe(false);
  });

  it("does not alter a complete operator goal", () => {
    const goal = "分析这个崩溃并给出可验证的修复方案";
    expect(workRequestGoal(goal, true, "zh-CN")).toBe(goal);
  });
});
