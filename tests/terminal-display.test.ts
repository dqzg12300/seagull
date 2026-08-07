import { describe, expect, it } from "vitest";
import { shouldReportTerminalResize, TERMINAL_CLEAR_INPUT, terminalResizeKey } from "../electron/renderer/src/terminal-display.js";

describe("terminal display lifecycle", () => {
  it("uses the standard shell clear-screen input", () => {
    expect(TERMINAL_CLEAR_INPUT).toBe("\x0c");
  });

  it("does not resize ConPTY again when only switching tabs", () => {
    const current = terminalResizeKey(120, 30);
    expect(shouldReportTerminalResize(current, 120, 30)).toBe(false);
    expect(shouldReportTerminalResize(current, 121, 30)).toBe(true);
  });
});
