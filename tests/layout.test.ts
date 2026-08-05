import { describe, expect, it } from "vitest";
import { clampAgentPanelWidth, DEFAULT_AGENT_PANEL_WIDTH, MIN_AGENT_PANEL_WIDTH } from "../electron/renderer/src/layout.js";

describe("chat panel layout", () => {
  it("keeps the requested width inside the usable desktop range", () => {
    expect(clampAgentPanelWidth(520, 1440)).toBe(520);
    expect(clampAgentPanelWidth(120, 1440)).toBe(MIN_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(2000, 1440)).toBe(850);
  });

  it("falls back to the default width for invalid persisted values", () => {
    expect(clampAgentPanelWidth(Number.NaN, 1440)).toBe(DEFAULT_AGENT_PANEL_WIDTH);
  });
});
