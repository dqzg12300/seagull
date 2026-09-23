import { describe, expect, it } from "vitest";
import { needsPcapNetworkAnalysis, supplementalSkillDirectives } from "../electron/renderer/src/work-skill-routing.js";

describe("work skill routing", () => {
  it("routes registered capture inputs to the bundled PCAP skill", () => {
    const inputs = [{ type: "capture" as const, name: "incident.pcapng", path: "D:/cases/incident.pcapng" }];
    expect(needsPcapNetworkAnalysis("找出连接失败的原因", inputs, "runtime-diagnostics")).toBe(true);
    expect(supplementalSkillDirectives("找出连接失败的原因", inputs)[0]).toContain("$pcap-network-analysis");
  });

  it.each([
    "分析这个 PCAP 中的 TCP 重传与 TLS 握手",
    "请用 tshark 还原相关会话流",
    "Investigate packet capture latency and retransmission",
    "Analyze the HTTP traffic trace",
  ])("routes an explicit capture-analysis objective: %s", goal => {
    expect(needsPcapNetworkAnalysis(goal)).toBe(true);
  });

  it("does not route ordinary networking implementation work", () => {
    expect(needsPcapNetworkAnalysis("给 Android 应用新增一个 HTTP 客户端并实现重试", [], "app-development")).toBe(false);
  });
});
