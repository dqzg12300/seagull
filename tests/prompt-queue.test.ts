import { describe, expect, it } from "vitest";
import { dedupeFinalResponseRecoveryPrompts, insertPromptQueueItem, moveQueuedPrompt, removeFailedPromptFromQueue, replaceQueuedPromptDisplay, type StoredPromptQueueItem } from "../electron/prompt-queue.js";

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

  it("coalesces duplicate automatic recovery requests", () => {
    const first = { ...item("recovery-1"), agentText: "[SEAGULL_FINAL_RESPONSE_RECOVERY] first" };
    const second = { ...item("recovery-2"), agentText: "[SEAGULL_FINAL_RESPONSE_RECOVERY] second" };
    expect(dedupeFinalResponseRecoveryPrompts([item("normal"), first, second]).map(value => value.id)).toEqual(["normal", "recovery-1"]);
  });

  it("does not coalesce identical operator requests", () => {
    const first = { ...item("one"), agentText: "same operator request" };
    const second = { ...item("two"), agentText: "same operator request" };
    expect(dedupeFinalResponseRecoveryPrompts([first, second])).toHaveLength(2);
  });

  it("runs automatic recovery before already queued operator follow-ups", () => {
    const running = item("running", "running");
    const waiting = item("waiting");
    const recovery = { ...item("recovery"), agentText: "[SEAGULL_FINAL_RESPONSE_RECOVERY] answer the preceding turn" };
    expect(insertPromptQueueItem([running, waiting], recovery).map(value => value.id)).toEqual(["running", "recovery", "waiting"]);
  });

  it("removes one restored failed request and stale recovery prompts while preserving follow-ups", () => {
    const failed = { ...item("failed"), agentText: "failed request" };
    const duplicateFollowUp = { ...item("same-again"), agentText: "failed request" };
    const recovery = { ...item("recovery"), agentText: "[SEAGULL_FINAL_RESPONSE_RECOVERY] recover" };
    expect(removeFailedPromptFromQueue([failed, recovery, duplicateFollowUp, item("continue")], "failed request").map(value => value.id)).toEqual(["same-again", "continue"]);
  });
});
