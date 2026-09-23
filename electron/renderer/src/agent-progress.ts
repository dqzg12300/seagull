export type AgentProgressPhase = "analyzing" | "reasoning" | "tool" | "reviewing" | "responding";

export interface AgentProgressState {
  phase: AgentProgressPhase;
  startedAt: number;
  updatedAt: number;
  completedTools: number;
  failedTools: number;
  activeTool?: string;
}

export function createAgentProgress(now = Date.now()): AgentProgressState {
  return { phase: "analyzing", startedAt: now, updatedAt: now, completedTools: 0, failedTools: 0 };
}

export function advanceAgentProgress(current: AgentProgressState | undefined, event: unknown, now = Date.now()): AgentProgressState | undefined {
  if (!event || typeof event !== "object") return current;
  const value = event as Record<string, unknown>;
  if (value.type === "agent_end") return undefined;
  const state = current ?? createAgentProgress(now);
  if (value.type === "agent_start" || value.type === "turn_start") return { ...state, phase: "analyzing", activeTool: undefined, updatedAt: now };
  if (value.type === "tool_execution_start") return { ...state, phase: "tool", activeTool: String(value.toolName ?? "tool"), updatedAt: now };
  if (value.type === "tool_execution_end") return {
    ...state,
    phase: "reviewing",
    activeTool: undefined,
    completedTools: state.completedTools + 1,
    failedTools: state.failedTools + (value.isError ? 1 : 0),
    updatedAt: now,
  };
  if (value.type === "turn_end") return { ...state, phase: "reviewing", activeTool: undefined, updatedAt: now };
  if (value.type === "message_update") {
    const update = value.assistantMessageEvent as Record<string, unknown> | undefined;
    if (update?.type === "thinking_start" || update?.type === "thinking_delta" || update?.type === "thinking_end") {
      return { ...state, phase: "reasoning", activeTool: undefined, updatedAt: now };
    }
    if (update?.type === "text_start" || update?.type === "text_delta") {
      return { ...state, phase: "responding", activeTool: undefined, updatedAt: now };
    }
  }
  return state;
}

export function elapsedAgentProgress(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
