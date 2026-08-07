import { describe, expect, it } from "vitest";
import { filterTerminalQuickCommands, parseTerminalQuickCommands, terminalCommandPayload } from "../electron/renderer/src/terminal-quick-commands.js";

describe("terminal quick commands", () => {
  it("loads only complete saved commands", () => {
    const value = JSON.stringify([{ id: "adb", name: "ADB devices", command: "adb devices -l" }, { id: "bad", name: "Missing command" }]);
    expect(parseTerminalQuickCommands(value)).toEqual([{ id: "adb", name: "ADB devices", command: "adb devices -l", scope: "global" }]);
    expect(parseTerminalQuickCommands("invalid")).toEqual([]);
  });

  it("keeps global commands available everywhere and isolates case commands", () => {
    const commands = parseTerminalQuickCommands(JSON.stringify([
      { id: "global", name: "ADB devices", command: "adb devices", scope: "global" },
      { id: "case-a", name: "Install A", command: "adb install a.apk", scope: "case", caseId: "case-a" },
      { id: "case-b", name: "Install B", command: "adb install b.apk", scope: "case", caseId: "case-b" },
    ]));
    expect(filterTerminalQuickCommands(commands, "case-a", "available").map(item => item.id)).toEqual(["global", "case-a"]);
    expect(filterTerminalQuickCommands(commands, "case-a", "case").map(item => item.id)).toEqual(["case-a"]);
    expect(filterTerminalQuickCommands(commands, "case-a", "global", "devices").map(item => item.id)).toEqual(["global"]);
  });

  it("converts multiline commands into terminal submissions", () => {
    expect(terminalCommandPayload("pwd\nGet-ChildItem")).toBe("pwd\rGet-ChildItem\r");
  });
});
