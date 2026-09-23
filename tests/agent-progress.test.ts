import { describe, expect, it } from "vitest";
import { advanceAgentProgress, createAgentProgress, elapsedAgentProgress } from "../electron/renderer/src/agent-progress.js";

describe("public agent progress", () => {
  it("tracks safe phases without retaining private thinking text", () => {
    const started = createAgentProgress(1_000);
    const reasoning = advanceAgentProgress(started, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "private draft" } }, 2_000)!;
    expect(reasoning.phase).toBe("reasoning");
    expect(JSON.stringify(reasoning)).not.toContain("private draft");
  });

  it("tracks active, completed, and failed tools", () => {
    const active = advanceAgentProgress(createAgentProgress(1_000), { type: "tool_execution_start", toolName: "read" }, 2_000)!;
    expect(active).toMatchObject({ phase: "tool", activeTool: "read", completedTools: 0 });
    const completed = advanceAgentProgress(active, { type: "tool_execution_end", isError: true }, 3_000)!;
    expect(completed).toMatchObject({ phase: "reviewing", completedTools: 1, failedTools: 1 });
  });

  it("switches to response generation and ends cleanly", () => {
    const responding = advanceAgentProgress(createAgentProgress(1_000), { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } }, 2_000)!;
    expect(responding.phase).toBe("responding");
    expect(advanceAgentProgress(responding, { type: "agent_end" }, 3_000)).toBeUndefined();
    expect(elapsedAgentProgress(1_000, 4_900)).toBe(3);
  });
});
