import { describe, expect, it } from "vitest";
import { nextAppTheme, resolveAppTheme } from "../electron/renderer/src/theme.js";

describe("application theme", () => {
  it("falls back to dark for missing or unknown preferences", () => {
    expect(resolveAppTheme(null)).toBe("dark");
    expect(resolveAppTheme("unknown")).toBe("dark");
  });

  it("toggles between dark and light", () => {
    expect(nextAppTheme("dark")).toBe("light");
    expect(nextAppTheme("light")).toBe("dark");
  });
});
