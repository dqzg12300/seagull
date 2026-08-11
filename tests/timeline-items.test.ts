import { describe, expect, it } from "vitest";
import { upsertTimelineItem } from "../electron/renderer/src/timeline-items.js";

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
});
