import type { AnalysisCategory, CaseInput } from "../../shared.js";

export const PCAP_SKILL_DIRECTIVE = "PCAP or packet-capture analysis is relevant. Explicitly load and follow the bundled $pcap-network-analysis skill before planning or inspecting packets. Preserve the original capture, use reproducible filters and structured artifacts, cite frame/stream/timestamp evidence, and distinguish observable traffic from inference or encrypted payload limitations.";

const CAPTURE_EXTENSION = /\.(?:pcap(?:ng)?|cap|har)(?:$|[?#\s])/i;
const CAPTURE_TOOL = /\b(?:pcap(?:ng)?|wireshark|tshark|tcpdump|dumpcap|capinfos|editcap|mergecap|pyshark|scapy)\b/i;
const ENGLISH_CAPTURE_NEED = /\b(?:packet|network|traffic)\s+(?:capture|trace|dump|analysis|forensics|flow|conversation|stream|reassembly)\b/i;
const PROTOCOL_TRAFFIC_NEED = /\b(?:tcp|udp|tls|quic|http2?|dns|icmp|websocket|grpc)\s+(?:packet|traffic|trace|flow|stream|conversation|handshake|retransmission|latency|analysis)\b/i;
const CHINESE_CAPTURE_NEED = /抓包|数据包|网络包|流量包|网络流量|流量分析|报文分析|会话流|协议流|包重组|流重组|丢包分析|重传分析|握手分析/;

type SkillRoutingInput = Pick<CaseInput, "type" | "name" | "path">;

export function needsPcapNetworkAnalysis(goal: string, inputs: readonly SkillRoutingInput[] = [], _category?: AnalysisCategory): boolean {
  if (inputs.some(input => input.type === "capture")) return true;
  const inputNames = inputs.map(input => `${input.name} ${input.path ?? ""}`).join("\n");
  const evidence = `${goal}\n${inputNames}`;
  return CAPTURE_EXTENSION.test(evidence)
    || CAPTURE_TOOL.test(evidence)
    || ENGLISH_CAPTURE_NEED.test(evidence)
    || PROTOCOL_TRAFFIC_NEED.test(evidence)
    || CHINESE_CAPTURE_NEED.test(evidence);
}

export function supplementalSkillDirectives(goal: string, inputs: readonly SkillRoutingInput[] = [], category?: AnalysisCategory): string[] {
  return needsPcapNetworkAnalysis(goal, inputs, category) ? [PCAP_SKILL_DIRECTIVE] : [];
}
