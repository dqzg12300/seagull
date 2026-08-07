import { describe, expect, it } from "vitest";
import { isChatNearBottom } from "../electron/renderer/src/chat-scroll.js";

describe("chat scroll position", () => {
  it("treats the bottom and its threshold as pinned", () => {
    expect(isChatNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
    expect(isChatNearBottom({ scrollTop: 652, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("shows navigation when the operator has scrolled away", () => {
    expect(isChatNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 300 })).toBe(false);
  });
});
