import type { AnalysisCategory } from "../../shared.js";

export interface WorkArtifactGroup {
  id: string;
  zh: string;
  en: string;
  patterns: RegExp[];
}

export interface WorkTypeDefinition {
  id: AnalysisCategory;
  zh: string;
  en: string;
  accent: string;
  groups: WorkArtifactGroup[];
}

const group = (id: string, zh: string, en: string, ...patterns: RegExp[]): WorkArtifactGroup => ({ id, zh, en, patterns });

export const workTypes: Record<AnalysisCategory, WorkTypeDefinition> = {
  deobfuscation: { id: "deobfuscation", zh: "反混淆", en: "Deobfuscation", accent: "#23cdb2", groups: [group("source", "可读源码", "Readable source", /deobfus|readable|source/i), group("map", "符号与调用映射", "Symbol and call maps", /symbol|mapping|call.?map|index/i), group("transform", "转换记录", "Transformations", /transform|decode|rename/i), group("verify", "可读性验证", "Readability", /readability|verif|report/i)] },
  report: { id: "report", zh: "分析报告", en: "Analysis report", accent: "#5aaee7", groups: [group("plan", "调查规划", "Plan", /analysis-plan|request/i), group("evidence", "引用证据", "Evidence", /evidence|capture|trace|log/i), group("findings", "结论与报告", "Findings", /report|finding|conclusion/i)] },
  "parameter-trace": { id: "parameter-trace", zh: "参数回溯", en: "Parameter trace", accent: "#ad8df0", groups: [group("seed", "追踪种子", "Trace seed", /request|seed|input/i), group("graph", "来源与调用链", "Provenance graph", /trace|provenance|call|graph/i), group("runtime", "运行时样本", "Runtime samples", /runtime|frida|sample|capture/i), group("report", "回溯结论", "Trace report", /report|result/i)] },
  "algorithm-recovery": { id: "algorithm-recovery", zh: "算法还原", en: "Algorithm recovery", accent: "#e5a44d", groups: [group("native", "Native 分析", "Native analysis", /native|ida|jni|\.so$/i), group("vectors", "测试向量", "Test vectors", /vector|sample|input|output/i), group("unidbg", "Unidbg 工程", "Unidbg project", /unidbg|emulat/i), group("impl", "等价实现", "Equivalent implementation", /recover|algorithm|replay|\.py$|\.java$/i)] },
  "data-collection": { id: "data-collection", zh: "数据收集", en: "Data collection", accent: "#52b788", groups: [group("inventory", "静态字段清单", "Static inventory", /inventory|fingerprint|field/i), group("hooks", "Hook 方案", "Hooks", /hook|frida|script/i), group("events", "采集事件", "Events", /event|trace|capture|log/i), group("summary", "字段关联", "Correlation", /report|correlation|summary/i)] },
  "runtime-diagnostics": { id: "runtime-diagnostics", zh: "运行诊断", en: "Runtime diagnostics", accent: "#ffb454", groups: [group("reproduction", "复现与设备现场", "Reproduction", /repro|device-snapshot|environment|package-state/i), group("logs", "日志与崩溃证据", "Logs and crashes", /logcat|crash|anr|tombstone|trace|dumpsys/i), group("correlation", "代码与现场关联", "Code correlation", /timeline|correlation|call|jadx|ida|frida/i), group("root-cause", "根因与复验", "Root cause", /hypoth|root-cause|verif|report/i)] },
  "protocol-recovery": { id: "protocol-recovery", zh: "协议还原", en: "Protocol recovery", accent: "#36c4df", groups: [group("samples", "消息样本", "Messages", /sample|capture|pcap|message/i), group("spec", "帧与字段规范", "Frame specification", /protocol|spec|frame|field/i), group("parser", "Parser / Encoder", "Parser / Encoder", /parser|encoder|decoder|schema|proto/i), group("verify", "回环验证", "Round-trip", /test|round|verify|replay/i)] },
  "version-diff": { id: "version-diff", zh: "版本对比", en: "Version diff", accent: "#f28c6c", groups: [group("inventory", "版本清单", "Inventories", /inventory-(old|new)|manifest/i), group("changes", "变更集合", "Change set", /change|diff/i), group("migration", "符号迁移", "Symbol migration", /migration|symbol|mapping/i), group("queue", "复验队列", "Reanalysis queue", /queue|verify|report/i)] },
  "app-reconstruction": { id: "app-reconstruction", zh: "应用重构", en: "App reconstruction", accent: "#22cdb2", groups: [group("project", "Android 工程", "Android project", /project|reconstruction|gradle|src/i), group("mapping", "功能对应", "Module mapping", /mapping|parity|module/i), group("build", "构建产物", "Build outputs", /build|apk$|aab$|test-result/i), group("verify", "行为验证", "Behavior verification", /verify|validation|install|launch|report/i)] },
  "app-development": { id: "app-development", zh: "应用开发", en: "App development", accent: "#4bc69b", groups: [group("requirements", "需求与设计", "Requirements", /request|requirement|design|plan/i), group("project", "Android 工程", "Android project", /development|project|gradle|src/i), group("build", "构建与测试", "Build and test", /build|test|apk$|aab$/i), group("acceptance", "验收结果", "Acceptance", /accept|validation|install|launch|report/i)] },
};

export function groupArtifacts(category: AnalysisCategory, artifacts: string[]): Array<WorkArtifactGroup & { artifacts: string[] }> {
  const definition = workTypes[category];
  const claimed = new Set<string>();
  const groups = definition.groups.map(item => ({ ...item, artifacts: artifacts.filter(path => item.patterns.some(pattern => pattern.test(path)) && !claimed.has(path)).filter(path => { claimed.add(path); return true; }) }));
  const other = artifacts.filter(path => !claimed.has(path));
  if (other.length) groups.push({ ...group("other", "其他产物", "Other", /.*/), artifacts: other });
  return groups;
}
