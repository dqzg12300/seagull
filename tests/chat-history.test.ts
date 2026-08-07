import { describe, expect, it } from "vitest";
import { historyImageAttachments, historyNeedsFinalResponse, parseVisibleUserHistoryMessage, visibleUserHistoryText } from "../electron/renderer/src/chat-history.js";

describe("chat history display", () => {
  it("keeps a normal operator message unchanged", () => {
    expect(visibleUserHistoryText("  帮我检查这个崩溃。  ")).toBe("帮我检查这个崩溃。");
  });

  it("extracts the operator text from a project follow-up envelope", () => {
    const stored = `[SEAGULL_WORK_CONTEXT]\nActive case: armour. Active work: work-1. Preserve its pipeline.\n\n[SEAGULL_PROJECT_FOLLOW_UP]\nContinue the existing Android project.\n\nOperator follow-up:\n重新编译，然后安装到当前设备。`;
    expect(visibleUserHistoryText(stored)).toBe("重新编译，然后安装到当前设备。");
  });

  it("extracts multiline legacy reconstruction follow-ups", () => {
    const stored = `[SEAGULL_RECONSTRUCTION_FOLLOW_UP]\nContinue the existing reconstruction project.\n\nOperator follow-up:\n出现新的错误：\njava.lang.IllegalStateException\n继续帮我修复。`;
    expect(visibleUserHistoryText(stored)).toBe("出现新的错误：\njava.lang.IllegalStateException\n继续帮我修复。");
  });

  it("removes the work context prefix from non-project conversations", () => {
    const stored = `[SEAGULL_WORK_CONTEXT]\nActive case: armour. Active work: work-2.\n\n分析这段日志的根因。`;
    expect(visibleUserHistoryText(stored)).toBe("分析这段日志的根因。");
  });

  it("supports an explicit user-message marker for future envelopes", () => {
    const stored = `[SEAGULL_UNKNOWN_CONTEXT]\ninternal\n\n[SEAGULL_USER_MESSAGE]\n这是用户原文。`;
    expect(visibleUserHistoryText(stored)).toBe("这是用户原文。");
  });

  it("extracts the first objective from legacy planning prompts", () => {
    const stored = `You are starting a goal-driven Android work run for armour.apk.

Mandatory planning gate:
Analysis category: app-development.

The operator's objective is:
开发一个设备信息验证应用，比较 Armour 与 DpMock 的结果。`;
    expect(visibleUserHistoryText(stored)).toBe("开发一个设备信息验证应用，比较 Armour 与 DpMock 的结果。");
  });

  it("lets an explicit marker override a generated planning envelope", () => {
    const stored = `You are starting a goal-driven work run.

The operator's objective is:
[SEAGULL_USER_MESSAGE]
这是新格式保存的用户原文。`;
    expect(visibleUserHistoryText(stored)).toBe("这是新格式保存的用户原文。");
  });

  it.each([
    "/reverse-case-use armour",
    "You are starting a goal-driven Android work run for armour.",
    "[SEAGULL_FINAL_RESPONSE_RECOVERY] recover the response",
    "[SEAGULL_VALIDATION_RERUN] rerun validation",
    "[SEAGULL_WORKBENCH_ACTION] build the project",
  ])("hides application-generated user prompts: %s", prompt => {
    expect(visibleUserHistoryText(prompt)).toBeUndefined();
  });

  it("does not recover a final answer for a trailing internal command", () => {
    expect(historyNeedsFinalResponse([
      { role: "user", content: [{ type: "text", text: "正常问题" }] },
      { role: "assistant", content: [{ type: "text", text: "正常回答" }] },
      { role: "user", content: [{ type: "text", text: "/reverse-case-use armour" }] },
    ])).toBe(false);
  });

  it("detects a genuinely unanswered visible user message", () => {
    expect(historyNeedsFinalResponse([
      { role: "assistant", content: [{ type: "text", text: "旧回答" }] },
      { role: "user", content: [{ type: "text", text: "这个问题还没有回答" }] },
    ])).toBe(true);
  });

  it("restores legacy pasted text and file payloads as attachment cards", () => {
    const stored = `分析这段崩溃日志。\n\n[PASTED_TEXT_ATTACHMENTS]\n## Text 1: FATAL EXCEPTION: main …\njava.lang.IllegalStateException\nline two\n\n[FILE_ATTACHMENTS]\nThe operator attached these persistent files.\n- D:\\autore\\armour\\attachments\\crash.log (28316 bytes)`;
    expect(parseVisibleUserHistoryMessage(stored)).toEqual({
      text: "分析这段崩溃日志。",
      attachments: [
        { kind: "text", name: "FATAL EXCEPTION: main …", detail: "40 characters", content: "java.lang.IllegalStateException\nline two" },
        { kind: "file", name: "crash.log", path: "D:\\autore\\armour\\attachments\\crash.log", detail: "28,316 bytes" },
      ],
      imageNames: [],
    });
  });

  it("restores image names while keeping images out of message text", () => {
    expect(parseVisibleUserHistoryMessage("看一下截图。\n\n[IMAGE_ATTACHMENTS]\n- crash-screen.png (image/png)")).toEqual({
      text: "看一下截图。",
      attachments: [],
      imageNames: ["crash-screen.png"],
    });
  });

  it("restores persisted image data for historical preview", () => {
    expect(historyImageAttachments([
      { type: "text", text: "查看截图" },
      { type: "image", mimeType: "image/webp", data: "AQID" },
    ])).toEqual([{ source: "data:image/webp;base64,AQID", mimeType: "image/webp" }]);
  });

  it("ignores invalid historical image blocks", () => {
    expect(historyImageAttachments([{ type: "image", mimeType: "image/png", data: "" }, null])).toEqual([]);
  });
});
