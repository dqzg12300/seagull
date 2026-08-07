import { describe, expect, it } from "vitest";
import { terminalContextAction } from "../electron/renderer/src/terminal-clipboard.js";

describe("terminal right-click clipboard behavior", () => {
  it("copies the exact active selection", () => {
    expect(terminalContextAction("adb devices\r\nserial-1")).toEqual({ type: "copy", text: "adb devices\r\nserial-1" });
  });

  it("pastes when there is no active selection", () => {
    expect(terminalContextAction("")).toEqual({ type: "paste" });
  });
});
