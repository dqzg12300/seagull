import { describe, expect, it } from "vitest";
import { chatSearchMatchIds, searchableChatText, stepChatSearchIndex } from "../electron/renderer/src/chat-search.js";

describe("chat search", () => {
  const items = [
    { id: "user", title: "你", body: "检查 Armour update 的闪退", attachments: [{ name: "crash.log", content: "FATAL EXCEPTION" }] },
    { id: "assistant", title: "Pi Agent", body: "根因是 snapshot 字段无效" },
    { id: "tool", title: "Tools", toolDetails: [{ title: "read DeviceSnapshot.java", output: "hidden command output" }] },
    { id: "open-tool", title: "Tools", expanded: true, toolDetails: [{ title: "read visible.java", output: "still hidden output" }] },
  ];

  it("searches visible message, attachment metadata and expanded tool summaries case-insensitively", () => {
    expect(chatSearchMatchIds(items, "ARMOUR")).toEqual(["user"]);
    expect(chatSearchMatchIds(items, "crash.log")).toEqual(["user"]);
    expect(chatSearchMatchIds(items, "visible.java")).toEqual(["open-tool"]);
  });

  it("does not search hidden attachment or collapsed command content", () => {
    expect(chatSearchMatchIds(items, "fatal exception")).toEqual([]);
    expect(chatSearchMatchIds(items, "devicesnapshot")).toEqual([]);
    expect(chatSearchMatchIds(items, "hidden command output")).toEqual([]);
    expect(chatSearchMatchIds(items, "still hidden output")).toEqual([]);
  });

  it("does not match an empty query", () => {
    expect(chatSearchMatchIds(items, "  ")).toEqual([]);
    expect(searchableChatText(items[0]!)).toContain("crash.log");
  });

  it("wraps previous and next navigation", () => {
    expect(stepChatSearchIndex(2, 3, 1)).toBe(0);
    expect(stepChatSearchIndex(0, 3, -1)).toBe(2);
    expect(stepChatSearchIndex(0, 0, 1)).toBe(0);
  });
});
