import { describe, expect, it } from "vitest";
import { applyLegacyWorkInheritance, buildInheritedWorkConversationContext, resolveUpstreamWorkIds, selectLegacySessionForWork, sessionBranchMessages } from "../electron/work-session.js";

const works = [
  { id: "work-one", createdAt: "2026-01-01T00:00:00Z", goal: "反混淆 armour", taskDir: "D:/cases/armour/tasks/work-one" },
  { id: "work-two", createdAt: "2026-01-02T00:00:00Z", goal: "开发验证应用", workspaceDir: "D:/cases/armour/projects/work-two" },
];

function entry(id: string, role: string, text: string, type = "message") {
  return { type, id, parentId: null, message: { role, content: [{ type: "text", text }] } };
}

describe("per-Work Pi session migration", () => {
  it("routes complete turns using work ids and directories", () => {
    const source = [
      { type: "session", version: 3, id: "session" },
      { type: "model_change", id: "model", parentId: null },
      entry("u1", "user", "Start D:/cases/armour/tasks/work-one"),
      entry("a1", "assistant", "first answer"),
      entry("u2", "user", "[SEAGULL_WORK_CONTEXT]\nActive work: work-two\n\n继续开发"),
      entry("a2", "assistant", "second answer"),
      entry("u3", "user", "继续修复细节"),
      entry("a3", "assistant", "third answer"),
    ];

    const first = selectLegacySessionForWork(source, works, "work-one");
    const second = selectLegacySessionForWork(source, works, "work-two");
    expect(first.filter(item => item.type === "message").map(item => item.id)).toEqual(["u1", "a1"]);
    expect(second.filter(item => item.type === "message").map(item => item.id)).toEqual(["u2", "a2", "u3", "a3"]);
  });

  it("rewires parent ids into a valid linear session", () => {
    const selected = selectLegacySessionForWork([
      { type: "session", version: 3, id: "session" },
      { type: "model_change", id: "model", parentId: "old" },
      entry("u1", "user", "反混淆 armour"),
      entry("a1", "assistant", "answer"),
    ], works, "work-one");
    expect(selected.slice(1).map(item => item.parentId)).toEqual([null, "model", "u1"]);
  });

  it("does not create a migrated session when the Work has no matching messages", () => {
    const selected = selectLegacySessionForWork([
      { type: "session", version: 3, id: "session" },
      entry("u1", "user", "反混淆 armour"),
      entry("a1", "assistant", "answer"),
    ], works, "missing-work");
    expect(selected).toEqual([]);
  });

  it("keeps the complete visible transcript across context compaction", () => {
    const branch = [
      { type: "session", version: 3, id: "session" },
      entry("u1", "user", "压缩前的问题"),
      entry("a1", "assistant", "压缩前的回答"),
      { type: "compaction", id: "compact", parentId: "a1", summary: "model-only summary" },
      entry("u2", "user", "压缩后的问题"),
      entry("a2", "assistant", "压缩后的回答"),
    ];
    expect(sessionBranchMessages(branch).map(message => (message as { content: Array<{ text: string }> }).content[0]?.text)).toEqual([
      "压缩前的问题",
      "压缩前的回答",
      "压缩后的问题",
      "压缩后的回答",
    ]);
  });

  it("builds hidden upstream memory without routing prompts or tool payloads", () => {
    const context = buildInheritedWorkConversationContext([{
      id: "work-one",
      title: "反混淆 Armour",
      goal: "恢复可读源码",
      messages: [
        { role: "user", content: [{ type: "text", text: "[SEAGULL_WORK_CONTEXT]\nActive work: work-one\n\n请保留 system UID。" }] },
        { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "secret" } }, { type: "text", text: "已确认必须保留 system UID。" }] },
        { role: "toolResult", content: [{ type: "text", text: "large raw tool output" }] },
        { role: "user", content: [{ type: "text", text: "[SEAGULL_WORKBENCH_ACTION] internal build command" }] },
      ],
    }]);
    expect(context.transcript).toContain("请保留 system UID。");
    expect(context.transcript).toContain("已确认必须保留 system UID。");
    expect(context.digest).toContain("恢复可读源码");
    expect(context.transcript).not.toContain("SEAGULL_WORK_CONTEXT");
    expect(context.transcript).not.toContain("SEAGULL_WORKBENCH_ACTION");
    expect(context.transcript).not.toContain("large raw tool output");
    expect(context.transcript).not.toContain("secret");
  });

  it("keeps a legacy Work's initial objective in inherited memory", () => {
    const context = buildInheritedWorkConversationContext([{
      id: "legacy-work",
      messages: [{ role: "user", content: [{ type: "text", text: "You are starting a goal-driven Android work run.\n\nThe operator's objective is:\n恢复可读源码并保留 system UID。" }] }],
    }]);
    expect(context.transcript).toContain("恢复可读源码并保留 system UID。");
    expect(context.transcript).not.toContain("Mandatory planning gate");
  });

  it("infers chronological upstream Works for legacy CASE data", () => {
    const legacy = [
      { id: "one", status: "completed", createdAt: "2026-01-01T00:00:00Z", upstreamWorkIds: [] as string[] },
      { id: "running", status: "running", createdAt: "2026-01-01T12:00:00Z", upstreamWorkIds: [] as string[] },
      { id: "two", status: "completed", createdAt: "2026-01-02T00:00:00Z", upstreamWorkIds: [] as string[] },
      { id: "three", status: "running", createdAt: "2026-01-03T00:00:00Z", upstreamWorkIds: [] as string[] },
    ];
    expect(resolveUpstreamWorkIds(legacy, "three")).toEqual(["one", "two"]);
    expect(applyLegacyWorkInheritance(legacy)).toBe(true);
    expect(legacy.find(work => work.id === "two")?.upstreamWorkIds).toEqual(["one"]);
    expect(legacy.find(work => work.id === "three")?.upstreamWorkIds).toEqual(["one", "two"]);
  });

  it("keeps explicit upstream relationships authoritative", () => {
    const items = [
      { id: "one", status: "completed", createdAt: "2026-01-01T00:00:00Z" },
      { id: "two", status: "running", createdAt: "2026-01-02T00:00:00Z", upstreamWorkIds: ["selected"] },
    ];
    expect(resolveUpstreamWorkIds(items, "two")).toEqual(["selected"]);
  });
});
