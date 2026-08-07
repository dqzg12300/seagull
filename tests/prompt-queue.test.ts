import { describe, expect, it } from "vitest";
import { moveQueuedPrompt, replaceQueuedPromptDisplay, type StoredPromptQueueItem } from "../electron/prompt-queue.js";

function item(id: string, status: "queued" | "running" = "queued"): StoredPromptQueueItem {
  return { id, displayText: id, agentText: `context\n${id}\nattachments`, status, createdAt: "now", updatedAt: "now", imageCount: 0 };
}

describe("prompt queue", () => {
  it("edits only the visible operator section", () => {
    expect(replaceQueuedPromptDisplay(item("old"), "new text", "later")).toMatchObject({ displayText: "new text", agentText: "context\nnew text\nattachments", updatedAt: "later" });
  });

  it("moves queued entries without moving the running entry", () => {
    const moved = moveQueuedPrompt([item("run", "running"), item("one"), item("two")], "two", "up");
    expect(moved.map(value => value.id)).toEqual(["run", "two", "one"]);
  });
});
