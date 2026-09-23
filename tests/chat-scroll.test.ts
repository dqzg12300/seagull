import { describe, expect, it } from "vitest";
import { chatSearchTargetScrollTop, isChatNearBottom } from "../electron/renderer/src/chat-scroll.js";

describe("chat scroll position", () => {
  it("treats the bottom and its threshold as pinned", () => {
    expect(isChatNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
    expect(isChatNearBottom({ scrollTop: 652, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("shows navigation when the operator has scrolled away", () => {
    expect(isChatNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 300 })).toBe(false);
  });

  it("positions a search text match near the top with surrounding context", () => {
    expect(chatSearchTargetScrollTop(
      { scrollTop: 800, scrollHeight: 2400, clientHeight: 600 },
      520,
      100,
    )).toBe(1148);
  });

  it("clamps search positioning to the scrollable range", () => {
    expect(chatSearchTargetScrollTop({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }, 90, 100)).toBe(0);
    expect(chatSearchTargetScrollTop({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 }, 900, 100)).toBe(600);
  });
});
