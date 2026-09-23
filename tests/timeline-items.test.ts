import { describe, expect, it } from "vitest";
import { appendUniqueAssistantFinal, upsertTimelineItem } from "../electron/renderer/src/timeline-items.js";

describe("timeline item identity", () => {
  it("updates a prompt already announced by the queue instead of rendering it twice", () => {
    type Item = { id: string; title: string; body: string; status: string; attachments?: string[] };
    const announced: Item[] = [{ id: "queue-user-run-1", title: "You", body: "diagnose", status: "sent" }];
    const enriched = upsertTimelineItem(announced, {
      id: "queue-user-run-1",
      title: "Work objective",
      body: "diagnose",
      status: "sent",
      attachments: ["log.txt"],
    });

    expect(enriched).toHaveLength(1);
    expect(enriched[0]).toMatchObject({ title: "Work objective", attachments: ["log.txt"] });
  });

  it("appends a prompt that the queue has not announced yet", () => {
    expect(upsertTimelineItem([], { id: "queue-user-run-2", body: "next" })).toEqual([
      { id: "queue-user-run-2", body: "next" },
    ]);
  });

  it("does not append terminal fallback text already rendered by streaming", () => {
    const items = [
      { id: "user", kind: "user", body: "what model" },
      { id: "answer", kind: "assistant", body: "same final answer" },
    ];
    const result = appendUniqueAssistantFinal(items, "same final answer", () => ({ id: "duplicate", kind: "assistant", body: "same final answer" }));
    expect(result).toBe(items);
  });

  it("allows the same answer in a later user turn", () => {
    const items = [
      { id: "old-answer", kind: "assistant", body: "same final answer" },
      { id: "new-user", kind: "user", body: "ask again" },
    ];
    const result = appendUniqueAssistantFinal(items, "same final answer", () => ({ id: "new-answer", kind: "assistant", body: "same final answer" }));
    expect(result.map(item => item.id)).toEqual(["old-answer", "new-user", "new-answer"]);
  });
});
