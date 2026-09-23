import { describe, expect, it } from "vitest";
import { agentTurnFailure, agentTurnText, agentTurnWillRetry, assistantMessageFailure, latestAssistantFailure, latestFailedUserPromptText } from "../electron/agent-turn.js";

describe("agent turn outcome", () => {
  it("surfaces provider errors embedded in agent_end messages", () => {
    const event = {
      type: "agent_end",
      messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "400: invalid tool schema" }],
    };
    expect(agentTurnFailure(event)).toBe("400: invalid tool schema");
    expect(agentTurnText(event)).toBe("");
  });

  it("recovers final text when a provider emitted no text deltas", () => {
    const event = {
      type: "agent_end",
      messages: [{ role: "assistant", content: [{ type: "text", text: "Final answer" }], stopReason: "stop" }],
    };
    expect(agentTurnFailure(event)).toBeUndefined();
    expect(agentTurnText(event)).toBe("Final answer");
  });

  it("does not classify normal assistant messages as failures", () => {
    expect(assistantMessageFailure({ role: "assistant", content: [], stopReason: "toolUse" })).toBeUndefined();
  });

  it("finds a terminal provider failure in persisted history", () => {
    expect(latestAssistantFailure([
      { role: "assistant", content: [{ type: "text", text: "older answer" }], stopReason: "stop" },
      { role: "user", content: [{ type: "text", text: "new request" }] },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "provider rejected tools" },
    ])).toBe("provider rejected tools");
  });

  it("finds the user request associated with the latest terminal failure", () => {
    expect(latestFailedUserPromptText([
      { role: "user", content: [{ type: "text", text: "older request" }] },
      { role: "assistant", content: [{ type: "text", text: "older answer" }], stopReason: "stop" },
      { role: "user", content: [{ type: "text", text: "failed request" }] },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "stream ended" },
    ])).toBe("failed request");
  });

  it("does not associate a request when the latest assistant response succeeded", () => {
    expect(latestFailedUserPromptText([
      { role: "user", content: "request" },
      { role: "assistant", content: "answer", stopReason: "stop" },
    ])).toBeUndefined();
  });

  it("distinguishes an internal retry boundary from the final agent end", () => {
    expect(agentTurnWillRetry({ type: "agent_end", messages: [], willRetry: true })).toBe(true);
    expect(agentTurnWillRetry({ type: "agent_end", messages: [], willRetry: false })).toBe(false);
    expect(agentTurnWillRetry({ type: "turn_end" })).toBe(false);
  });
});
