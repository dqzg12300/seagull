import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowDown, ArrowUp, BookOpen, Bookmark, Bot, Box, Braces, Bug, ChevronDown, ChevronRight, CircleStop, Copy, Download, FileCode2, FolderOpen, Languages, Maximize2, Minimize2, Moon, Network, Paperclip, Pencil, Play, Radio, RefreshCw, ScrollText, Send, Settings, ShieldCheck, Smartphone, Sun, TerminalSquare, Trash2, UserRound, WrapText, X } from "lucide-react";
import { supportsAndroidProjectActions, type AdbDeviceInfo, type AdbPackageInfo, type AnalysisCategory, type AppSettings, type AttachedFileInfo, type CaseInputDraft, type CasePlatform, type CaseStateView, type CaseSummary, type DirectoryEntryInfo, type ImageAttachment, type InstallableApk, type PromptQueueItemView, type RoutedWorkerEvent, type SkillInfo, type TerminalEvent, type TerminalSessionInfo } from "../../shared.js";
import { workTypes } from "./work-types.js";
import { XtermView, type XtermHandle } from "./XtermView.js";
import { clampAgentPanelWidth, DEFAULT_AGENT_PANEL_WIDTH } from "./layout.js";
import { filterTerminalQuickCommands, isTerminalQuickCommandShortcut, parseTerminalQuickCommands, terminalCommandPayload, type TerminalQuickCommand, type TerminalQuickCommandFilter } from "./terminal-quick-commands.js";
import { TERMINAL_CLEAR_INPUT } from "./terminal-display.js";
import { historyImageAttachments, historyNeedsFinalResponse, isFinalResponseRecoveryDisplayText, parseVisibleUserHistoryMessage, visibleUserHistoryText, type HistoryMessageAttachment } from "./chat-history.js";
import { canRestorePastedText, pastedTextPreview, shouldAttachPastedText } from "./paste-attachments.js";
import { isChatNearBottom } from "./chat-scroll.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { nextAppTheme, resolveAppTheme, THEME_STORAGE_KEY, type AppTheme } from "./theme.js";
import { upsertTimelineItem } from "./timeline-items.js";
import { canSubmitWorkRequest, workRequestAttachmentContext, workRequestGoal } from "./work-request-attachments.js";
import { filterAdbPackages } from "./adb-package-filter.js";
import { artifactPreviewKind } from "./artifact-preview.js";
import "./report.css";

type ToolDetail = { id?: string; title: string; body?: string; output?: string; status?: string; at: string };
type ToolActionKind = "read" | "write" | "command";
type TimelineItem = { id: string; kind: "assistant" | "user" | "tool" | "system" | "error"; title: string; body?: string; output?: string; toolDetails?: ToolDetail[]; attachments?: HistoryMessageAttachment[]; images?: string[]; imageNames?: string[]; status?: string; at: string; expanded?: boolean };
type LogItem = { channel: string; message: string; at: string };
type UsedSkill = { name: string; source: string; at: string };
type PastedTextAttachment = { id: string; name: string; text: string };
type ImagePreview = { source: string; name: string };
type TextPreview = { content: string; name: string };
type CaseSourceKind = "blank" | "apk" | "device" | "project" | "materials";
type TerminalTab = TerminalSessionInfo & { status: "running" | "exited" | "failed" };
type FinalRecoveryState = "idle" | "scheduled" | "running" | "finished";

function draftTypeForPath(filename: string): CaseInputDraft["type"] {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["apk", "xapk", "apks", "aab"].includes(extension)) return "apk";
  if (extension === "so") return "native-library";
  if (["dex", "jar"].includes(extension)) return "dex";
  if (["log", "txt", "tombstone"].includes(extension)) return "log";
  if (["pcap", "pcapng", "har"].includes(extension)) return "capture";
  if (["doc", "docx", "xls", "xlsx", "pdf", "md", "csv"].includes(extension)) return "document";
  return "other";
}

function caseInputTypeLabel(type: CaseInputDraft["type"], locale: Locale): string {
  const labels: Record<CaseInputDraft["type"], [string, string]> = {
    apk: ["APK", "APK"], "device-package": ["设备应用", "Device app"], project: ["工程", "Project"],
    "native-library": ["SO", "SO"], dex: ["DEX", "DEX"], log: ["日志", "Log"], document: ["文档", "Document"],
    capture: ["抓包", "Capture"], other: ["材料", "Material"],
  };
  return labels[type][locale === "zh-CN" ? 0 : 1];
}

const phases = ["INTAKE", "APK_TRIAGE", "JAVA_RECON", "NATIVE_RECON", "RUNTIME_TRACE", "RECOVER_ALGORITHM", "UNIDBG_EMULATE", "VERIFY", "GENERATE_REPLAY", "REPORT"];
type Locale = "zh-CN" | "en-US";
const phaseCopy: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    INTAKE: "接收目标",
    APK_TRIAGE: "APK 初检",
    JAVA_RECON: "Java 分析",
    NATIVE_RECON: "Native 分析",
    RUNTIME_TRACE: "运行时追踪",
    RECOVER_ALGORITHM: "算法恢复",
    UNIDBG_EMULATE: "Unidbg 模拟",
    VERIFY: "验证",
    GENERATE_REPLAY: "生成重放",
    REPORT: "报告",
    PLANNING: "需求规划",
  },
  "en-US": Object.fromEntries(phases.map(phase => [phase, phase.replaceAll("_", " ")])),
};
const copy = {
  "zh-CN": { selectApk:"选择 APP", analyze:"开始分析", stop:"停止", noCase:"未创建案例", chooseHint:"选择 APK 开始", workflow:"分析流程", phase:"阶段", workspace:"工作区", ready:"Agent 就绪", working:"Agent 分析中", idle:"Agent 未启动", overview:"概览", manifest:"清单", java:"Java", native:"Native", runtime:"运行时", replay:"请求重放", evidence:"证据", report:"报告", allLogs:"全部日志", noLogs:"运行日志将在这里显示。", agent:"Pi Agent", running:"运行中", agentIdle:"空闲", readyAnalysis:"等待分析", readyDesc:"选择 APK 并启动工作流，工具调用和结论会显示在这里。", ask:"向 Pi 提问或调整分析方向…", target:"分析目标", noApk:"尚未选择 APK", chooseLong:"请选择 Android 安装包以创建可复现的逆向分析案例。", currentPhase:"当前阶段", waiting:"等待开始", artifacts:"证据数量", persisted:"已保存的产物", observations:"确认结论", notes:"条观察记录", pipeline:"分析流水线", confirmed:"确认的观察", noConfirmed:"暂无确认的观察。", artifactList:"证据产物", noEvidence:"尚未捕获证据。", selectEvidence:"选择证据产物以查看结构化结果。", noReport:"尚未生成最终报告。再次点击开始分析可补全报告。", reportFile:"报告产物", workspaceSuffix:"工作区", future:"对应分析阶段产生结构化产物后，此页面会自动填充。", modelNone:"未选择模型", language:"EN", settings:"模型设置", host:"API Host", apiKey:"API Key", modelId:"模型 ID", save:"保存设置", cancel:"取消", settingsHint:"支持 OpenAI-compatible Chat Completions 接口，Host 通常以 /v1 结尾。模型既可以从列表选择，也可以手动输入。", initFailed:"初始化失败", refreshModels:"刷新模型", refreshing:"正在获取模型列表…", modelsLoaded:"已获取 {count} 个模型" },
  "en-US": { selectApk:"Select APP", analyze:"Analyze", stop:"Stop", noCase:"No active case", chooseHint:"Select an APK to begin", workflow:"Workflow", phase:"Phase", workspace:"Workspace", ready:"Agent ready", working:"Agent working", idle:"Agent idle", overview:"Overview", manifest:"Manifest", java:"Java", native:"Native", runtime:"Runtime", replay:"Replay", evidence:"Evidence", report:"Report", allLogs:"All logs", noLogs:"Runtime logs will appear here.", agent:"Pi Agent", running:"Running", agentIdle:"Idle", readyAnalysis:"Ready for analysis", readyDesc:"Select an APK and start the workflow. Tool calls and findings will appear here.", ask:"Ask Pi or steer the analysis…", target:"Target", noApk:"No APK selected", chooseLong:"Choose an Android package to initialize a reproducible reverse-engineering case.", currentPhase:"Current phase", waiting:"Waiting", artifacts:"Evidence", persisted:"persisted artifacts", observations:"Observations", notes:"confirmed notes", pipeline:"Analysis pipeline", confirmed:"Confirmed observations", noConfirmed:"No confirmed observations yet.", artifactList:"Artifacts", noEvidence:"No evidence captured.", selectEvidence:"Select an evidence artifact to inspect its structured result.", noReport:"No final report has been generated. Click Analyze again to finalize it.", reportFile:"Report artifact", workspaceSuffix:"workspace", future:"This view will populate as the corresponding analysis phase produces structured artifacts.", modelNone:"No model", language:"中文", settings:"Model settings", host:"API Host", apiKey:"API Key", modelId:"Model ID", save:"Save settings", cancel:"Cancel", settingsHint:"Supports OpenAI-compatible Chat Completions endpoints. The host usually ends in /v1. Choose a fetched model or enter one manually.", initFailed:"Initialization failed", refreshModels:"Refresh models", refreshing:"Fetching model list…", modelsLoaded:"Loaded {count} models" },
} as const;

const analysisCopy = {
  "zh-CN": {
    title: "分析目标",
    hint: "描述本次要解决的问题、重点模块、预期交付结果和限制。Pi 会先拆解需求并选择路线，再开始执行。",
    placeholder: "例如：定位登录请求的签名算法，恢复 Java/JNI 调用链，使用运行时样本验证，并输出可复现脚本和报告。",
    submit: "规划并开始分析",
    required: "请至少输入 10 个字符的分析目标。",
    recent: "历史分析目标",
    reuse: "点击复用",
    preloadMismatch: "应用组件版本不一致，请完全关闭 Electron 窗口和开发终端后重新运行 npm run app:dev。",
    outputRoot: "结果输出目录",
    outputHint: "每个 APP 的分析结果会保存到该目录下以 APP 名称命名的子目录中。",
    outputRequired: "首次分析前必须选择结果输出目录。",
    browse: "浏览",
  },
  "en-US": {
    title: "Analysis objective",
    hint: "Describe the problem, focus areas, expected deliverables, and constraints. Pi will select routes before execution.",
    placeholder: "Example: locate the login signing algorithm, recover the Java/JNI call chain, validate it at runtime, and produce a script and report.",
    submit: "Plan and analyze",
    required: "Enter an analysis objective of at least 10 characters.",
    recent: "Recent analysis objectives",
    reuse: "Click to reuse",
    preloadMismatch: "Application components are out of sync. Fully close Electron and the dev terminal, then run npm run app:dev again.",
    outputRoot: "Output directory",
    outputHint: "Each app is saved under a subdirectory named after the app.",
    outputRequired: "Select an output directory before the first analysis.",
    browse: "Browse",
  },
} as const;

const categoryCopy: Record<Locale, Record<AnalysisCategory, { label: string; description: string }>> = {
  "zh-CN": {
    deobfuscation: { label: "反混淆", description: "迭代恢复 Java/Native 代码，并以人工可读性验收" },
    report: { label: "分析报告", description: "根据需求动态选择静态、动态、模拟与重放路线" },
    "parameter-trace": { label: "参数回溯", description: "从代码或参数反查来源、转换过程与调用链" },
    "algorithm-recovery": { label: "算法还原", description: "聚焦 SO/JNI，使用 Unidbg 还原并验证算法" },
    "data-collection": { label: "数据收集", description: "静态识别设备指纹，动态 Hook 系统调用并留存日志" },
    "runtime-diagnostics": { label: "运行诊断", description: "通过 ADB 复现设备现场异常，并关联反编译代码定位根因" },
    "protocol-recovery": { label: "协议还原", description: "还原帧结构、字段来源、序列化、签名与通信状态机" },
    "version-diff": { label: "版本对比", description: "对比两个 APK 并迁移旧版本已有的符号、结论和验证经验" },
    "app-reconstruction": { label: "应用重构", description: "继承反混淆成果，恢复或重实现为可编译、可验证的 Android 工程" },
    "app-development": { label: "应用开发", description: "根据需求开发新的 Android 应用，并自动复用当前案例的历史经验与产物" },
  },
  "en-US": {
    deobfuscation: { label: "Deobfuscation", description: "Iteratively recover readable Java/native code and verify readability" },
    report: { label: "Analysis report", description: "Dynamically select static, runtime, emulation, and replay routes" },
    "parameter-trace": { label: "Parameter tracing", description: "Trace a value or code fragment back through its sources and transforms" },
    "algorithm-recovery": { label: "Algorithm recovery", description: "Recover SO/JNI algorithms with Unidbg-based verification" },
    "data-collection": { label: "Data collection", description: "Inventory fingerprint collection and capture runtime system-call logs" },
    "runtime-diagnostics": { label: "Runtime diagnostics", description: "Reproduce live device failures over ADB and correlate them with decompiled code" },
    "protocol-recovery": { label: "Protocol recovery", description: "Recover framing, field provenance, serialization, signing, and protocol state" },
    "version-diff": { label: "Version comparison", description: "Compare APK versions and migrate prior symbols, findings, and validation evidence" },
    "app-reconstruction": { label: "App reconstruction", description: "Inherit deobfuscation artifacts and rebuild a compilable, verifiable Android project" },
    "app-development": { label: "App development", description: "Build a new Android app from requirements while reusing the current case knowledge and artifacts" },
  },
};

function CaseWorkTags({ summary, locale }: { summary: CaseSummary; locale: Locale }) {
  const works = summary.works?.length
    ? summary.works
    : summary.analysisCategory
      ? [{ id: "legacy-work", title: "", category: summary.analysisCategory, createdAt: summary.updatedAt }]
      : [];
  if (!works.length) return <div className="case-work-tags"><i><span>{summary.phase}</span></i></div>;
  return <div className="case-work-tags" aria-label={locale === "zh-CN" ? "工作顺序" : "Work order"}>{works.map((work, index) => <i title={work.title || categoryCopy[locale][work.category].label} key={`${work.id}-${index}`}><span>{categoryCopy[locale][work.category].label}</span>{index < works.length - 1 && <ChevronRight size={11}/>}</i>)}</div>;
}

type CategorySection = "analysis" | "tools" | "development";
const categorySections: Array<{ id: CategorySection; zh: string; en: string; descriptionZh: string; descriptionEn: string; categories: AnalysisCategory[] }> = [
  { id: "analysis", zh: "分析", en: "Analysis", descriptionZh: "分析代码与协议、追踪参数并还原实现", descriptionEn: "Analyze code and protocols, trace parameters, and recover implementations", categories: ["deobfuscation", "report", "parameter-trace", "algorithm-recovery", "protocol-recovery"] },
  { id: "tools", zh: "工具", en: "Tools", descriptionZh: "设备现场诊断、数据采集与版本对比", descriptionEn: "Live diagnostics, data collection, and version comparison", categories: ["data-collection", "runtime-diagnostics", "version-diff"] },
  { id: "development", zh: "开发", en: "Development", descriptionZh: "重构现有应用或开发新应用", descriptionEn: "Reconstruct existing apps or build new ones", categories: ["app-reconstruction", "app-development"] },
];
function sectionForCategory(category: AnalysisCategory): CategorySection {
  return categorySections.find(section => section.categories.includes(category))?.id ?? "analysis";
}
function categoryInputAdvisory(category: AnalysisCategory, inputs: CaseStateView["inputs"], locale: Locale): string | undefined {
  const types = new Set((inputs ?? []).map(input => input.type));
  const accepts: Partial<Record<AnalysisCategory, CaseInputDraft["type"][]>> = {
    deobfuscation: ["apk", "dex", "project"], "version-diff": ["apk", "project"],
    "algorithm-recovery": ["native-library", "apk", "project"], "runtime-diagnostics": ["device-package", "apk"],
    "data-collection": ["device-package", "apk", "project"], "protocol-recovery": ["capture", "apk", "project", "native-library"],
    "app-reconstruction": ["apk", "dex", "project"],
  };
  const required = accepts[category];
  if (!required || required.some(type => types.has(type))) return undefined;
  const names: Record<CaseInputDraft["type"], string> = { apk: "APK", "device-package": "ADB package", project: "project/source", "native-library": "SO", dex: "DEX/JAR", log: "log", document: "document", capture: "PCAP/capture", other: "material" };
  return locale === "zh-CN" ? `当前 CASE 尚未包含常用输入：${required.map(type => names[type]).join("、")}。仍可开始规划，Pi 会说明缺少的材料。` : `This CASE does not yet contain the usual inputs: ${required.map(type => names[type]).join(", ")}. Planning may continue and Pi will identify blockers.`;
}

const categoryDirectives: Record<AnalysisCategory, string> = {
  deobfuscation: "Required loop: APK triage -> identify obfuscation -> deobfuscate into a separate derived tree -> verify semantics and human readability -> repeat targeted deobfuscation until readable or a documented blocker. Deliver friendly indexed source, symbol/call maps, transformations, residual obfuscation, and readability verification. Never overwrite originals.",
  report: "Build a requirement-specific route. Select only evidence-producing static, native, runtime, emulation, replay, or verification stages needed to answer the objective. Deliver a structured report separating confirmed facts, hypotheses, limitations, evidence links, and actionable conclusions.",
  "parameter-trace": "Treat the supplied code/value as the trace seed. Establish static definitions, callers, serializers, JNI/native boundaries and transformations; then use runtime hooks/watchpoints with controlled inputs where needed. Deliver an end-to-end provenance graph with source, transforms, sinks, evidence, and confidence.",
  "algorithm-recovery": "Prioritize ABI/architecture and JNI-to-SO mapping, recover native inputs/outputs/state and dependencies, then build a repeatable Unidbg harness. Recover equivalent readable code and verify it against multiple original runtime samples. Document unsupported syscalls/environment shims and mismatches.",
  "data-collection": "Inventory device-fingerprint and risk-control collection statically, then design scoped runtime hooks for filesystem access, system properties, identifiers, sensors, network interfaces, process/package inspection, native syscalls and relevant Java APIs. Preserve timestamped structured logs, correlate static-to-runtime evidence, minimize duplicate noise, and report field/source/purpose/confidence without inventing intent.",
  "runtime-diagnostics": "Explicitly load and follow the bundled $android-runtime-diagnostics skill before planning. Start from the ADB-connected device and a precise symptom/reproduction window. Capture only relevant device, package, logcat, dumpsys, crash, ANR, tombstone, UI/data, and runtime evidence; correlate it with JADX/IDA code paths and use narrow Frida observation only to distinguish remaining hypotheses. Deliver a reproducible timeline, ranked hypotheses, confirmed root cause or bounded blocker, and focused verification.",
  "protocol-recovery": "Explicitly load and follow the bundled $android-protocol-recovery skill before planning. Select only the required static, runtime, capture, native, parsing, and replay routes. Preserve raw samples, recover framing and field provenance before semantics, generate a deterministic parser/encoder, and verify round trips and known vectors before reporting.",
  "version-diff": "Explicitly load and follow the bundled $android-version-diff skill before planning. Compare the current target against the operator-selected or case-inherited prior version. Reuse unchanged evidence, match symbols using stable anchors, focus reanalysis on changed or uncertain surfaces, and deliver a confidence-scored migration map and impact report.",
  "app-reconstruction": "This is a downstream engineering task. Explicitly load and follow the bundled $android-app-reconstruction skill before planning. Inherit and audit upstream deobfuscation artifacts without modifying them. Work only in the reconstruction project directory, select recovery versus clean-room reimplementation per module, produce a compilable Android project, and verify build, installation, launch, and the operator's acceptance criteria.",
  "app-development": "This is a new Android application engineering task. Explicitly load and follow the bundled $android-app-development skill before planning. Reuse the current case's persistent conversation, requirements, reverse-engineering findings, deobfuscation lessons, reconstructed project, reports, and registered artifacts as design evidence. Work only in the isolated development project directory. Deliver a maintainable, compilable app and verify build, installation, launch, required UI, and acceptance behavior.",
};

function stamp(): string { return new Date().toLocaleTimeString("zh-CN", { hour12: false }); }
function agentSessionKey(caseId?: string, workId?: string): string { return caseId ? `${caseId}:${workId ?? "case"}` : "workspace"; }
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
async function imageAttachmentsFromFiles(files: File[], limit: number): Promise<ImageAttachment[]> {
  const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const selected = files.filter(file => allowed.has(file.type) && file.size <= 10 * 1024 * 1024).slice(0, Math.max(0, limit));
  return Promise.all(selected.map(async file => ({ name: file.name || "clipboard-image.png", mimeType: file.type as ImageAttachment["mimeType"], data: arrayBufferToBase64(await file.arrayBuffer()) })));
}
function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return value == null ? "" : String(value);
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const text = (record.content as Array<Record<string, unknown>>).filter(item => item.type === "text").map(item => String(item.text ?? "")).join("\n");
    if (text) return text;
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function eventToTimeline(event: unknown): TimelineItem | undefined {
  if (!event || typeof event !== "object") return undefined;
  const value = event as Record<string, unknown>;
  if (value.type === "tool_execution_start") return { id: String(value.toolCallId), kind: "tool", title: String(value.toolName ?? "Tool call"), body: JSON.stringify(value.args ?? {}, null, 2), status: "running", expanded: true, at: stamp() };
  if (value.type === "agent_end") return { id: crypto.randomUUID(), kind: "system", title: "Agent turn completed", status: "done", at: stamp() };
  return undefined;
}

function parseToolArguments(body?: string): Record<string, unknown> {
  if (!body) return {};
  try { const value = JSON.parse(body); return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}

function toolAction(detail: ToolDetail): { kind: ToolActionKind; subject: string } {
  const name = detail.title.toLowerCase();
  const args = parseToolArguments(detail.body);
  const pathValue = args.path ?? args.filename ?? args.file ?? args.filePath ?? args.directory;
  const commandValue = args.command ?? args.cmd ?? args.script;
  const subject = String(pathValue ?? commandValue ?? detail.title).replace(/\s+/g, " ").trim();
  if (/^(read|file[_-]?read)|read[_-]?(file|text)|get[_-]?file/.test(name)) return { kind: "read", subject };
  if (/^(write|edit|apply_patch)|write[_-]?file|replace|patch/.test(name)) return { kind: "write", subject };
  return { kind: "command", subject };
}

function collapseCompletedTools(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let group: TimelineItem[] = [];
  const flush = () => {
    if (group.length > 0) result.push({
      id: `tool-group-${group[0]!.id}`,
      kind: "tool",
      title: `Actions · ${group.reduce((count, item) => count + (item.toolDetails?.length ?? 1), 0)}`,
      body: group.map(item => `${item.status === "failed" ? "✕" : "✓"} ${item.title}  ${item.at}`).join("\n"),
      toolDetails: group.flatMap(item => item.toolDetails ?? [{ id: item.id, title: item.title, body: item.body, output: item.output, status: item.status, at: item.at }]),
      status: group.some(item => item.status === "failed") ? "failed" : "done",
      expanded: false,
      at: group.at(-1)?.at ?? "",
    });
    group = [];
  };
  for (const item of items) {
    if (item.kind === "tool" && item.status !== "running") group.push(item);
    else { flush(); result.push(item); }
  }
  flush();
  return result;
}

function appendLiveTool(items: TimelineItem[], tool: TimelineItem): TimelineItem[] {
  const detail: ToolDetail = { id: tool.id, title: tool.title, body: tool.body, output: tool.output, status: "running", at: tool.at };
  const last = items.at(-1);
  if (last?.kind === "tool" && last.id.startsWith("tool-group-live-")) {
    return items.map(item => item.id === last.id ? { ...item, title: `Actions · ${(item.toolDetails?.length ?? 0) + 1}`, toolDetails: [...(item.toolDetails ?? []), detail], status: "running", at: tool.at } : item);
  }
  return [...items, {
    id: `tool-group-live-${tool.id}`,
    kind: "tool",
    title: "Actions · 1",
    toolDetails: [detail],
    status: "running",
    expanded: false,
    at: tool.at,
  }];
}

function finishLiveTool(items: TimelineItem[], toolId: string, output: string, failed: boolean): TimelineItem[] {
  return items.map(item => {
    if (item.kind !== "tool") return item;
    if (item.id === toolId) return { ...item, output, status: failed ? "failed" : "done", expanded: false, at: stamp() };
    if (!item.toolDetails?.some(detail => detail.id === toolId)) return item;
    const details = item.toolDetails.map(detail => detail.id === toolId ? { ...detail, output, status: failed ? "failed" : "done", at: stamp() } : detail);
    const status = details.some(detail => detail.status === "running") ? "running" : details.some(detail => detail.status === "failed") ? "failed" : "done";
    return { ...item, toolDetails: details, status, at: stamp() };
  });
}

function historyToTimeline(messages: unknown[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const tools = new Map<string, number>();
  const messageText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return (content as Array<Record<string, unknown>>).filter(block => block.type === "text").map(block => String(block.text ?? "")).join("\n");
  };
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean; timestamp?: number };
    const at = message.timestamp ? new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "";
    if (message.role === "user") {
      const visible = parseVisibleUserHistoryMessage(messageText(message.content));
      const images = historyImageAttachments(message.content).map(image => image.source);
      if (visible || images.length) items.push({ id: `user-${message.timestamp ?? crypto.randomUUID()}-${items.length}`, kind: "user", title: "你", body: visible?.text, attachments: visible?.attachments, images, imageNames: visible?.imageNames, at });
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && String(block.text ?? "").trim()) items.push({ id: `assistant-${message.timestamp ?? crypto.randomUUID()}-${items.length}`, kind: "assistant", title: "Pi Agent", body: String(block.text), status: "done", at });
        if (block.type === "toolCall" && typeof block.id === "string") { tools.set(block.id, items.length); items.push({ id: block.id, kind: "tool", title: String(block.name ?? "tool"), body: JSON.stringify(block.arguments ?? {}, null, 2), status: "running", expanded: false, at }); }
      }
    }
    if (message.role === "toolResult" && message.toolCallId) {
      const index = tools.get(message.toolCallId);
      const current = index === undefined ? undefined : items[index];
      const output = messageText(message.content).trim();
      if (index !== undefined && current) items[index] = { ...current, title: message.toolName ?? current.title, output, status: message.isError ? "failed" : "done", expanded: false };
    }
  }
  return collapseCompletedTools(items);
}

function toolChannel(name: string): string {
  const value = name.toLowerCase();
  if (value.includes("frida")) return "frida";
  if (value.includes("unidbg")) return "unidbg";
  if (value.startsWith("jadx__") || value.startsWith("ida__") || value.includes("mcp")) return "mcp";
  return "pi";
}

function historyToLogs(messages: unknown[]): LogItem[] {
  const result: LogItem[] = [];
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown; toolName?: string; isError?: boolean; timestamp?: number };
    const at = message.timestamp ? new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : "";
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type === "toolCall") result.push({ channel: toolChannel(String(block.name ?? "tool")), message: `START ${String(block.name ?? "tool")} ${JSON.stringify(block.arguments ?? {})}`, at });
      }
    }
    if (message.role === "toolResult") result.push({ channel: toolChannel(message.toolName ?? "pi"), message: `${message.isError ? "FAILED" : "DONE"} ${message.toolName ?? "tool"}`, at });
  }
  return result.slice(-400);
}

function skillsFromTimeline(items: TimelineItem[]): UsedSkill[] {
  const found = new Map<string, UsedSkill>();
  const inspect = (text: string | undefined, at: string) => {
    if (!text) return;
    const normalized = text.replaceAll("\\\\", "/").replaceAll("\\", "/");
    const matches = normalized.matchAll(/(?:[A-Za-z]:)?[^\s"']*\/skills\/([^\s"']+)\/SKILL\.md/gi);
    for (const match of matches) {
      const relative = match[1]!.replace(/^\/+|\/+$/g, "");
      const parts = relative.split("/");
      const name = parts.at(-1) ?? relative;
      const source = match[0].replace(/[),;]+$/, "");
      found.set(source.toLowerCase(), { name, source, at });
    }
  };
  for (const item of items) {
    inspect(item.body, item.at);
    inspect(item.output, item.at);
    for (const detail of item.toolDetails ?? []) {
      inspect(detail.body, detail.at);
      inspect(detail.output, detail.at);
    }
  }
  return [...found.values()];
}

export function App() {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem("seagull.locale") as Locale) || "zh-CN");
  const [theme, setTheme] = useState<AppTheme>(() => resolveAppTheme(localStorage.getItem(THEME_STORAGE_KEY)));
  const t = copy[locale];
  const analysisText = analysisCopy[locale];
  const phaseText = phaseCopy[locale];
  const [apk, setApk] = useState<string>();
  const [caseId, setCaseId] = useState<string>();
  const [caseState, setCaseState] = useState<CaseStateView>();
  const [casesOpen, setCasesOpen] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseListError, setCaseListError] = useState("");
  const [caseEditor, setCaseEditor] = useState<CaseSummary>();
  const [caseEditorDescription, setCaseEditorDescription] = useState("");
  const [caseEditorError, setCaseEditorError] = useState("");
  const [caseEditorBusy, setCaseEditorBusy] = useState(false);
  const [caseWizardOpen, setCaseWizardOpen] = useState(false);
  const [caseWizardMode, setCaseWizardMode] = useState<"create" | "add">("create");
  const [caseSource, setCaseSource] = useState<CaseSourceKind>("blank");
  const [caseTitle, setCaseTitle] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [casePlatform, setCasePlatform] = useState<CasePlatform>("android");
  const [caseSourcePaths, setCaseSourcePaths] = useState<string[]>([]);
  const [adbPackages, setAdbPackages] = useState<AdbPackageInfo[]>([]);
  const [adbPackageFilter, setAdbPackageFilter] = useState("");
  const [selectedAdbPackage, setSelectedAdbPackage] = useState("");
  const [caseWizardBusy, setCaseWizardBusy] = useState(false);
  const [caseWizardError, setCaseWizardError] = useState("");
  const [caseInputNotice, setCaseInputNotice] = useState("");
  const [caseInputBusy, setCaseInputBusy] = useState<string>();
  const [ready, setReady] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [switchingWorkId, setSwitchingWorkId] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState<string>(t.modelNone);
  const [tools, setTools] = useState<string[]>([]);
  const [mcpChecking, setMcpChecking] = useState<string>();
  const [mcpReadiness, setMcpReadiness] = useState<Record<string, { ready: boolean; detail: string }>>({});
  const [active, setActive] = useState("Overview");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [showTimelineBottomButton, setShowTimelineBottomButton] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const usedSkills = useMemo(() => skillsFromTimeline(timeline), [timeline]);
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillResults, setSkillResults] = useState<SkillInfo[]>([]);
  const [availableSkillCount, setAvailableSkillCount] = useState(0);
  const [skillBusy, setSkillBusy] = useState<string>();
  const [skillError, setSkillError] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logTab, setLogTab] = useState("all");
  const [logWrap, setLogWrap] = useState(() => localStorage.getItem("seagull.logWrap") === "true");
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<AttachedFileInfo[]>([]);
  const [pastedTexts, setPastedTexts] = useState<PastedTextAttachment[]>([]);
  const [promptQueue, setPromptQueue] = useState<PromptQueueItemView[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [queueEditor, setQueueEditor] = useState<PromptQueueItemView>();
  const [queueEditorText, setQueueEditorText] = useState("");
  const [queueError, setQueueError] = useState("");
  const [sessionActivity, setSessionActivity] = useState<Record<string, { streaming: boolean; queued: number }>>({});
  const [imagePreview, setImagePreview] = useState<ImagePreview>();
  const [imageActionStatus, setImageActionStatus] = useState("");
  const [textPreview, setTextPreview] = useState<TextPreview>();
  const [textActionStatus, setTextActionStatus] = useState("");
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [agentResizing, setAgentResizing] = useState(false);
  const [agentWidth, setAgentWidth] = useState(() => clampAgentPanelWidth(Number(localStorage.getItem("seagull.agentWidth")) || DEFAULT_AGENT_PANEL_WIDTH, window.innerWidth));
  const [selectedArtifact, setSelectedArtifact] = useState<string>();
  const [artifactText, setArtifactText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisGoal, setAnalysisGoal] = useState("");
  const [analysisCategory, setAnalysisCategory] = useState<AnalysisCategory>("report");
  const [analysisSection, setAnalysisSection] = useState<CategorySection>("analysis");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisImages, setAnalysisImages] = useState<ImageAttachment[]>([]);
  const [analysisPastedTexts, setAnalysisPastedTexts] = useState<PastedTextAttachment[]>([]);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [workQuery, setWorkQuery] = useState("");
  const [workEditorId, setWorkEditorId] = useState<string>();
  const [workEditorTitle, setWorkEditorTitle] = useState("");
  const [workEditorCategory, setWorkEditorCategory] = useState<AnalysisCategory>("report");
  const [workEditorError, setWorkEditorError] = useState("");
  const [workEditorBusy, setWorkEditorBusy] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [workActionBusy, setWorkActionBusy] = useState<"build" | "rebuild" | "install">();
  const [workActionFeedback, setWorkActionFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  const [installOpen, setInstallOpen] = useState(false);
  const [installLoading, setInstallLoading] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installDevices, setInstallDevices] = useState<AdbDeviceInfo[]>([]);
  const [installApks, setInstallApks] = useState<InstallableApk[]>([]);
  const [selectedInstallDevice, setSelectedInstallDevice] = useState("");
  const [selectedInstallApk, setSelectedInstallApk] = useState("");
  const [settings, setSettings] = useState<AppSettings>({ baseUrl: "https://api.openai.com/v1", apiKey: "", modelId: "gpt-5.1-codex", outputRoot: "" });
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelMessage, setModelMessage] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const terminalBody = useRef<HTMLDivElement>(null);
  const terminalViews = useRef(new Map<string, XtermHandle>());
  const terminalPending = useRef(new Map<string, string>());
  const terminalClosing = useRef(new Set<string>());
  const timelineBody = useRef<HTMLDivElement>(null);
  const timelinePinnedToBottom = useRef(true);
  const imageInput = useRef<HTMLInputElement>(null);
  const analysisImageInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const appMenu = useRef<HTMLDivElement>(null);
  const activeAssistantId = useRef<string | undefined>(undefined);
  const activePromptId = useRef<string | undefined>(undefined);
  const queuedTimelineItems = useRef(new Map<string, TimelineItem>());
  const turnHadAssistantText = useRef(false);
  const finalRecoveryState = useRef<FinalRecoveryState>("idle");
  const finalRecoveryTimer = useRef<number | undefined>(undefined);
  const turnEnded = useRef(true);
  const startGeneration = useRef(0);
  const activeSessionKey = useRef("workspace");
  const activeSessionIdentity = useRef<{ caseId?: string; workId?: string }>({});
  const nav = [["Overview", locale === "zh-CN" ? "工作概览" : "Overview", ShieldCheck], ["Artifacts", locale === "zh-CN" ? "产物" : "Artifacts", ScrollText], ["Terminal", locale === "zh-CN" ? "终端" : "Terminal", TerminalSquare]] as const;

  function selectWorkspaceView(view: string) {
    setActive(view);
    setAgentExpanded(false);
  }

  function resizeAgentWithKeyboard(direction: -1 | 1) {
    setAgentWidth(current => {
      const next = clampAgentPanelWidth(current + direction * 32, window.innerWidth);
      localStorage.setItem("seagull.agentWidth", String(next));
      return next;
    });
  }

  function beginAgentResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (agentExpanded || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentWidth;
    let finalWidth = startWidth;
    setAgentResizing(true);
    document.body.classList.add("agent-panel-resizing");
    const move = (pointerEvent: PointerEvent) => {
      finalWidth = clampAgentPanelWidth(startWidth + startX - pointerEvent.clientX, window.innerWidth);
      setAgentWidth(finalWidth);
    };
    const finish = () => {
      localStorage.setItem("seagull.agentWidth", String(finalWidth));
      setAgentResizing(false);
      document.body.classList.remove("agent-panel-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  }

  function toggleLocale() { const next: Locale = locale === "zh-CN" ? "en-US" : "zh-CN"; localStorage.setItem("seagull.locale", next); setLocale(next); document.documentElement.lang = next; }
  function toggleTheme() { const next = nextAppTheme(theme); localStorage.setItem(THEME_STORAGE_KEY, next); document.documentElement.dataset.theme = next; setTheme(next); }
  useEffect(() => { setAnalysisSection(sectionForCategory(analysisCategory)); }, [analysisCategory]);
  useEffect(() => { if (active !== "Overview" && active !== "Artifacts" && active !== "Terminal") setActive("Overview"); }, [active]);
  useEffect(() => {
    if (!imagePreview && !textPreview) return;
    setImageActionStatus("");
    setTextActionStatus("");
    const closePreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setImagePreview(undefined); setTextPreview(undefined); }
    };
    document.addEventListener("keydown", closePreview);
    return () => document.removeEventListener("keydown", closePreview);
  }, [imagePreview, textPreview]);
  useEffect(() => {
    if (!appMenuOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!appMenu.current?.contains(event.target as Node)) setAppMenuOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAppMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [appMenuOpen]);
  function resetFinalRecovery() {
    if (finalRecoveryTimer.current !== undefined) window.clearTimeout(finalRecoveryTimer.current);
    finalRecoveryTimer.current = undefined;
    finalRecoveryState.current = "idle";
  }
  function scheduleFinalRecovery(prompt: string) {
    if (finalRecoveryState.current !== "idle") return;
    finalRecoveryState.current = "scheduled";
    finalRecoveryTimer.current = window.setTimeout(() => {
      finalRecoveryTimer.current = undefined;
      turnEnded.current = false;
      setStreaming(true);
      const identity = activeSessionIdentity.current;
      void window.mobileReverse.prompt(identity.caseId, identity.workId, prompt, locale === "zh-CN" ? "补全上一轮最终答复" : "Recover the previous final response").catch(() => {
        finalRecoveryState.current = "finished";
        turnEnded.current = true;
        setStreaming(false);
      });
    }, 250);
  }
  function recordPromptTimeline(queued: PromptQueueItemView, message: Omit<TimelineItem, "id" | "status">) {
    const item: TimelineItem = { ...message, id: `queue-user-${queued.id}`, status: queued.status === "queued" ? "queued" : "sent" };
    setTimeline(items => {
      if (queued.status === "queued") {
        queuedTimelineItems.current.set(queued.id, item);
        return items;
      }
      return upsertTimelineItem(items, item);
    });
  }

  useEffect(() => {
    window.scrollTo(0, 0);
    const lastApk = localStorage.getItem("seagull.lastApk");
    const lastCase = localStorage.getItem("seagull.lastCase");
    const unsubscribe = window.mobileReverse.onWorkerEvent((message: RoutedWorkerEvent) => {
    if (message.sessionKey) {
      if (message.type === "state") setSessionActivity(current => ({ ...current, [message.sessionKey!]: { streaming: message.streaming, queued: current[message.sessionKey!]?.queued ?? 0 } }));
      if (message.type === "queue") setSessionActivity(current => ({ ...current, [message.sessionKey!]: { streaming: message.items.some(item => item.status === "running"), queued: message.items.filter(item => item.status === "queued").length } }));
      if (message.sessionKey !== activeSessionKey.current) return;
    }
    if (message.type === "queue") {
      const running = message.items.find(item => item.status === "running");
      if (running?.id !== activePromptId.current) {
        activePromptId.current = running?.id;
        activeAssistantId.current = undefined;
        turnHadAssistantText.current = false;
        if (running) {
          if (isFinalResponseRecoveryDisplayText(running.displayText)) finalRecoveryState.current = "running";
          else resetFinalRecovery();
        }
        turnEnded.current = !running;
      }
      if (running) setTimeline(items => {
        const id = `queue-user-${running.id}`;
        const existing = items.find(item => item.id === id);
        const cached = queuedTimelineItems.current.get(running.id);
        queuedTimelineItems.current.delete(running.id);
        const next: TimelineItem = existing ? { ...existing, body: running.displayText, status: "sent" } : cached ? { ...cached, body: running.displayText, status: "sent" } : { id, kind: "user", title: locale === "zh-CN" ? "你" : "You", body: running.displayText, status: "sent", at: new Date(running.createdAt).toLocaleTimeString(locale, { hour12: false }) };
        return upsertTimelineItem(items, next);
      });
      setPromptQueue(message.items);
      setStreaming(Boolean(running));
      return;
    }
    if (message.type === "ready") { setReady(true); setInitializing(false); setTools(message.tools); if (message.history?.length) { setTimeline(historyToTimeline(message.history)); setLogs([...historyToLogs(message.history), { channel: "system", message: `Pi ready · ${message.sessionId}`, at: stamp() }]); if (historyNeedsFinalResponse(message.history)) scheduleFinalRecovery("[SEAGULL_FINAL_RESPONSE_RECOVERY] The previous turn ended after a tool result without a final user-facing answer. Do not repeat completed tool work. Review the immediately preceding request and tool results, then provide the complete final answer now."); } else setLogs(v => [...v, { channel: "system", message: `Pi ready · ${message.sessionId}`, at: stamp() }]); }
    if (message.type === "tools") setTools(message.tools);
    if (message.type === "state") { if (!message.streaming || !turnEnded.current) setStreaming(message.streaming); if (message.model) setModel(message.model); }
    if (message.type === "log") setLogs(v => [...v.slice(-400), { channel: message.channel, message: message.message.trim(), at: stamp() }]);
    if (message.type === "error") {
      setInitializing(false);
      turnEnded.current = true;
      setStreaming(false);
      setTimeline(v => [...v, { id: crypto.randomUUID(), kind: "error", title: "Worker error", body: message.message, status: "failed", at: stamp() }]);
      setLogs(v => [...v, { channel: "error", message: message.message, at: stamp() }]);
    }
    if (message.type === "agent-event") {
      const raw = message.event as Record<string, unknown> | undefined;
      if (raw?.type === "tool_execution_end") {
        const id = String(raw.toolCallId);
        const output = toolResultText(raw.result ?? raw.toolResult ?? raw.output);
        setTimeline(items => finishLiveTool(items, id, output, Boolean(raw.isError)));
        setLogs(items => [...items.slice(-400), { channel: toolChannel(String(raw.toolName ?? "pi")), message: `${raw.isError ? "FAILED" : "DONE"} ${String(raw.toolName ?? "tool")}`, at: stamp() }]);
        return;
      }
      if (raw?.type === "message_update") {
        turnEnded.current = false;
        setStreaming(true);
        const update = raw.assistantMessageEvent as Record<string, unknown> | undefined;
        if (update?.type === "text_delta") {
          const delta = String(update.delta ?? "");
          if (delta) turnHadAssistantText.current = true;
          setTimeline(items => {
            const id = activeAssistantId.current;
            const index = id ? items.findIndex(item => item.id === id) : -1;
            if (index >= 0) return items.map((item, itemIndex) => itemIndex === index ? { ...item, body: (item.body ?? "") + delta } : item);
            const nextId = crypto.randomUUID();
            activeAssistantId.current = nextId;
            return [...items, { id: nextId, kind: "assistant", title: "Pi Agent", body: delta, status: "streaming", at: stamp() }];
          });
          return;
        }
      }
      if (raw?.type === "agent_end") {
        turnEnded.current = true;
        setStreaming(false);
        const id = activeAssistantId.current;
        setTimeline(items => collapseCompletedTools(items.map(item => item.id === id ? { ...item, status: "done" } : item)));
        activeAssistantId.current = undefined;
        if (!turnHadAssistantText.current && finalRecoveryState.current === "idle") {
          setLogs(items => [...items.slice(-400), { channel: "system", message: locale === "zh-CN" ? "本轮缺少最终答复，正在自动续写…" : "Final answer missing; recovering…", at: stamp() }]);
          scheduleFinalRecovery("[SEAGULL_FINAL_RESPONSE_RECOVERY] The previous turn ended after tool execution without a final user-facing answer. Do not repeat completed work. Provide the complete final answer for the preceding user request now.");
        } else if (!turnHadAssistantText.current && finalRecoveryState.current === "running") {
          finalRecoveryState.current = "finished";
          setTimeline(items => [...items, { id: crypto.randomUUID(), kind: "error", title: locale === "zh-CN" ? "未收到最终答复" : "Final answer missing", body: locale === "zh-CN" ? "模型在工具执行后连续两次未返回文本。可以重新发送上一条问题继续。" : "The model ended twice without text after tool execution. Resend the previous request to continue.", status: "failed", at: stamp() }]);
        } else if (turnHadAssistantText.current && finalRecoveryState.current === "running") finalRecoveryState.current = "finished";
      }
      const item = eventToTimeline(message.event);
      if (raw?.type === "tool_execution_start") {
        turnEnded.current = false;
        setStreaming(true);
        setLogs(items => [...items.slice(-400), { channel: toolChannel(String(raw.toolName ?? "pi")), message: `START ${String(raw.toolName ?? "tool")} ${JSON.stringify(raw.args ?? {})}`, at: stamp() }]);
        if (item) setTimeline(items => appendLiveTool(items, item));
        return;
      }
      if (item) setTimeline(v => [...v, item]);
    }
    });
    void (async () => {
      const settingsTask = window.mobileReverse.getSettings();
      const storedCaseTask: Promise<CaseStateView | undefined> = lastCase
        ? window.mobileReverse.readCase(lastCase).catch(() => { localStorage.removeItem("seagull.lastCase"); return undefined; })
        : Promise.resolve(undefined);
      const [saved, stored] = await Promise.all([settingsTask, storedCaseTask]);
      setSettings(saved);
      setModel(saved.modelId ? `seagull/${saved.modelId}` : t.modelNone);
      if (!saved.outputRoot.trim()) { setOutputError(true); setOutputOpen(true); }
      let bootCaseId: string | undefined;
      let bootWorkId: string | undefined;
      if (stored) {
        bootCaseId = stored.id;
        bootWorkId = stored.activeWorkId;
        setCaseId(stored.id); setCaseState(stored); setApk(stored.target);
        setAnalysisGoal(stored.analysisGoal ?? ""); setAnalysisCategory(stored.analysisCategory ?? "report");
      } else if (lastCase) {
        localStorage.removeItem("seagull.lastCase");
      }
      if (!bootCaseId && lastApk) {
        try {
          const identified = await window.mobileReverse.identifyApk(lastApk);
          bootCaseId = identified.caseId;
          bootWorkId = identified.existing?.activeWorkId;
          setApk(lastApk);
          setCaseId(identified.caseId);
          setCaseState(identified.existing);
          setAnalysisGoal(identified.existing?.analysisGoal ?? "");
          setAnalysisCategory(identified.existing?.analysisCategory ?? "report");
          localStorage.setItem("seagull.lastCase", identified.caseId);
        } catch { localStorage.removeItem("seagull.lastApk"); }
      }
      try { await initializeAgent(bootCaseId, bootWorkId); }
      catch (error) { setLogs(v => [...v, { channel: "error", message: `MCP initialization failed: ${error instanceof Error ? error.message : String(error)}`, at: stamp() }]); }
    })();
    return () => {
      unsubscribe();
      if (finalRecoveryTimer.current !== undefined) window.clearTimeout(finalRecoveryTimer.current);
    };
  }, []);

  useEffect(() => window.mobileReverse.onTerminalEvent((event: TerminalEvent) => {
    if (terminalClosing.current.has(event.terminalId)) {
      if (event.type === "exit") terminalClosing.current.delete(event.terminalId);
      return;
    }
    const write = (data: string) => {
      const view = terminalViews.current.get(event.terminalId);
      if (view) view.write(data);
      else terminalPending.current.set(event.terminalId, `${terminalPending.current.get(event.terminalId) ?? ""}${data}`.slice(-1_000_000));
    };
    if (event.type === "output") write(event.data);
    else if (event.type === "error") write(`\r\n\x1b[31mERROR: ${event.message}\x1b[0m\r\n`);
    else {
      removeTerminalSession(event.terminalId);
      return;
    }
    setTerminalTabs(current => {
      const index = current.findIndex(tab => tab.id === event.terminalId);
      if (event.type === "output") {
        if (index < 0) return [...current, { id: event.terminalId, title: "PowerShell", cwd: "", status: "running" }];
        return current;
      }
      if (event.type === "error") {
        if (index < 0) return current;
        return current.map((tab, itemIndex) => itemIndex === index ? { ...tab, status: "failed" } : tab);
      }
      return current;
    });
  }), []);

  useEffect(() => {
    if (!caseId) return;
    const poll = window.setInterval(async () => setCaseState(await window.mobileReverse.readCase(caseId)), 1200);
    return () => window.clearInterval(poll);
  }, [caseId]);
  useEffect(() => {
    const api = window.mobileReverse as Partial<typeof window.mobileReverse>;
    if ((api.apiVersion ?? 0) >= 2 && typeof api.listSkills === "function") {
      void api.listSkills().then(skills => setAvailableSkillCount(skills.length)).catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const element = terminalBody.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setLogWrap(value => { const next = !value; localStorage.setItem("seagull.logWrap", String(next)); return next; });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (!timelinePinnedToBottom.current) return;
    const frame = window.requestAnimationFrame(() => {
      const element = timelineBody.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timeline]);
  useEffect(() => {
    const element = timelineBody.current;
    if (!element) return;
    const onScroll = () => {
      const pinned = isChatNearBottom(element);
      timelinePinnedToBottom.current = pinned;
      setShowTimelineBottomButton(!pinned);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);
  const legacyPhaseIndex = Math.max(0, phases.indexOf(caseState?.phase ?? "INTAKE"));
  const runStages = useMemo(() => caseState?.activeRun?.stages ?? phases.map((id, index) => ({ id, label: phaseText[id] ?? id, status: index < legacyPhaseIndex ? "completed" as const : index === legacyPhaseIndex ? "running" as const : "pending" as const })), [caseState?.activeRun?.stages, legacyPhaseIndex, phaseText]);
  const completedStages = runStages.filter(stage => stage.status === "completed" || stage.status === "skipped").length;
  const activeStageIndex = runStages.findIndex(stage => stage.status === "running" || stage.status === "failed");
  const currentStageIndex = activeStageIndex >= 0 ? activeStageIndex : Math.max(0, runStages.length - 1);
  const currentStage = runStages[currentStageIndex] ?? runStages.at(-1);
  const currentStageLabel: string = currentStage ? (phaseText[currentStage.id] ?? currentStage.label) : (phaseText.INTAKE ?? "Intake");
  const mcp = useMemo(() => ["jadx", "ida", "frida"].map(name => ({ name, online: tools.some(tool => tool.startsWith(`${name}__`)), count: tools.filter(tool => tool.startsWith(`${name}__`)).length })), [tools]);
  const filteredModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    return !query ? modelOptions : modelOptions.filter(id => id.toLowerCase().includes(query));
  }, [modelOptions, modelFilter]);
  const visibleAdbPackages = useMemo(() => filterAdbPackages(adbPackages, adbPackageFilter), [adbPackages, adbPackageFilter]);
  const visibleLogs = useMemo(() => logTab === "all" ? logs : logTab === "problems" ? logs.filter(log => log.channel === "error" || /failed|error|exception|unavailable/i.test(log.message)) : logs.filter(log => log.channel === logTab || (logTab === "pi" && log.channel === "system")), [logs, logTab]);
  const analysisHistory = useMemo(() => {
    if (caseState?.analysisRequests?.length) return [...caseState.analysisRequests].reverse();
    return caseState?.analysisGoal ? [{ id: "legacy", goal: caseState.analysisGoal, createdAt: caseState.updatedAt }] : [];
  }, [caseState?.analysisRequests, caseState?.analysisGoal, caseState?.updatedAt]);
  const works = useMemo(() => {
    if (caseState?.works?.length) return [...caseState.works].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    if (!caseState?.activeRun || !caseState.analysisCategory) return [];
    return [{ id: caseState.activeRun.requestId, title: caseState.analysisGoal?.split(/\r?\n/)[0]?.slice(0, 48) || categoryCopy[locale][caseState.analysisCategory].label, goal: caseState.analysisGoal ?? caseState.activeRun.goal, category: caseState.analysisCategory, createdAt: caseState.activeRun.startedAt, updatedAt: caseState.activeRun.updatedAt, status: caseState.activeRun.status, run: caseState.activeRun }];
  }, [caseState, locale]);
  const activeWork = works.find(work => work.id === caseState?.activeWorkId) ?? works[0];
  const activeWorkDirectory = activeWork?.run.workspaceDir ?? activeWork?.run.taskDir ?? caseState?.workspaceDir;
  const activeWorkArtifacts = activeWork?.artifacts ?? [];
  const activeTerminal = terminalTabs.find(tab => tab.id === activeTerminalId) ?? terminalTabs[0];
  const visibleWorks = useMemo(() => { const query = workQuery.trim().toLowerCase(); return query ? works.filter(work => `${work.title} ${work.goal} ${categoryCopy[locale][work.category].label}`.toLowerCase().includes(query)) : works; }, [works, workQuery, locale]);
  const reportArtifact = useMemo(() => activeWorkArtifacts.find(file => /(?:^|[\\/])(?:final-)?report\.md$/i.test(file)) ?? activeWorkArtifacts.find(file => /(?:^|[\\/])delivery\.md$/i.test(file)), [activeWorkArtifacts]);
  const activeTool = useMemo(() => [...timeline].reverse().find(item => item.kind === "tool" && item.status === "running"), [timeline]);
  const statusActivity = streaming ? `${currentStageLabel}${activeTool ? ` · ${activeTool.title}` : ""}` : (locale === "zh-CN" ? "当前空闲" : "Idle");
  useEffect(() => { const latest = logs.at(-1); if (latest?.channel === "error") { setLogTab("problems"); setActivityExpanded(true); } }, [logs.length]);

  useEffect(() => {
    if (active !== "Artifacts" || !reportArtifact) return;
    void openArtifact(reportArtifact);
  }, [active, reportArtifact]);

  async function restoreApk(file: string): Promise<{ caseId: string; workId?: string } | undefined> {
    try {
      const identified = await window.mobileReverse.identifyApk(file);
      setApk(file); setCaseId(identified.caseId); setCaseState(identified.existing); setAnalysisGoal(identified.existing?.analysisGoal ?? ""); setAnalysisCategory(identified.existing?.analysisCategory ?? "report");
      localStorage.setItem("seagull.lastCase", identified.caseId);
      return { caseId: identified.caseId, workId: identified.existing?.activeWorkId };
    } catch { localStorage.removeItem("seagull.lastApk"); return undefined; }
  }
  async function initializeAgent(selectedCaseId?: string, selectedWorkId?: string, force = false) {
    activeSessionKey.current = agentSessionKey(selectedCaseId, selectedWorkId);
    activeSessionIdentity.current = { caseId: selectedCaseId, workId: selectedWorkId };
    timelinePinnedToBottom.current = true;
    setShowTimelineBottomButton(false);
    setInitializing(true);
    try { await window.mobileReverse.initialize(selectedCaseId, selectedWorkId, force); }
    finally { setInitializing(false); }
  }
  function scrollTimelineToBottom() {
    const element = timelineBody.current;
    if (!element) return;
    timelinePinnedToBottom.current = true;
    setShowTimelineBottomButton(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }
  async function chooseApk() { const file = await window.mobileReverse.selectApk(); if (file) { localStorage.setItem("seagull.lastApk", file); setReady(false); setTimeline([]); const selected = await restoreApk(file); if (selected) await initializeAgent(selected.caseId, selected.workId); } }
  function openCaseWizard(mode: "create" | "add" = caseId ? "add" : "create") {
    setCaseWizardMode(mode); setCaseSource(mode === "add" ? "apk" : "blank"); setCaseTitle(""); setCaseDescription(""); setCasePlatform("android"); setCaseSourcePaths([]); setAdbPackages([]); setAdbPackageFilter(""); setSelectedAdbPackage(""); setCaseWizardError(""); setCaseWizardOpen(true);
  }
  function changeCaseWizardMode(mode: "create" | "add") {
    setCaseWizardMode(mode); setCaseSource(mode === "add" ? "apk" : "blank"); setCaseSourcePaths([]); setAdbPackages([]); setAdbPackageFilter(""); setSelectedAdbPackage(""); setCaseWizardError("");
  }
  async function chooseCaseSource(source: CaseSourceKind) {
    setCaseSource(source); setCaseWizardError(""); setCaseSourcePaths([]); setAdbPackageFilter(""); setSelectedAdbPackage("");
    try {
      if (source === "apk") {
        const file = await window.mobileReverse.selectApk();
        if (file) { setCaseSourcePaths([file]); setCasePlatform("android"); setCaseTitle(current => current || file.split(/[\\/]/).pop()!.replace(/\.(apk|xapk|apks)$/i, "")); }
      } else if (source === "project") {
        const directory = await window.mobileReverse.selectProjectDirectory();
        if (directory) { setCaseSourcePaths([directory]); setCasePlatform("android"); setCaseTitle(current => current || directory.split(/[\\/]/).pop()!); }
      } else if (source === "materials") {
        const files = await window.mobileReverse.selectCaseFiles();
        if (files.length) { setCaseSourcePaths(files); setCaseTitle(current => current || files[0]!.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "")); }
      } else if (source === "device") {
        setCaseWizardBusy(true); const packages = await window.mobileReverse.listAdbPackages(); setAdbPackages(packages); setCasePlatform("android");
        if (!packages.length) setCaseWizardError(locale === "zh-CN" ? "没有发现可用的 ADB 设备或第三方应用。" : "No usable ADB device or third-party package was found.");
      }
    } catch (error) { setCaseWizardError(error instanceof Error ? error.message : String(error)); }
    finally { setCaseWizardBusy(false); }
  }
  async function submitCaseWizard() {
    if (caseWizardMode === "create" && !caseTitle.trim()) { setCaseWizardError(locale === "zh-CN" ? "请输入案例名称。" : "Enter a case title."); return; }
    if (caseWizardMode === "add" && caseSource === "blank") { setCaseWizardError(locale === "zh-CN" ? "向已有案例添加目标时请选择输入来源。" : "Choose an input source to add to this case."); return; }
    const drafts: CaseInputDraft[] = caseSource === "device" && selectedAdbPackage
      ? (() => { const [serial = "", ...packageParts] = selectedAdbPackage.split("|"); const packageName = packageParts.join("|"); const selected = adbPackages.find(item => item.serial === serial && item.packageName === packageName); return [{ type: "device-package" as const, name: packageName, packageName, metadata: { serial, ...(selected?.model ? { model: selected.model } : {}) } }]; })()
      : caseSourcePaths.map(filename => ({ type: caseSource === "project" ? "project" : draftTypeForPath(filename), name: filename.split(/[\\/]/).pop() ?? filename, path: filename }));
    if (caseSource !== "blank" && drafts.length === 0) { setCaseWizardError(locale === "zh-CN" ? "请先选择输入目标。" : "Select an input first."); return; }
    setCaseWizardBusy(true); setCaseWizardError("");
    try {
      const submittedAt = Date.now();
      const saved = caseWizardMode === "create"
        ? await window.mobileReverse.createCase({ title: caseTitle.trim(), description: caseDescription.trim(), platform: casePlatform, inputs: drafts })
        : await window.mobileReverse.addCaseInputs(caseId!, drafts);
      if (caseWizardMode === "add") {
        const names = drafts.map(item => item.name).join(locale === "zh-CN" ? "、" : ", ");
        const total = saved.inputs?.length ?? 0;
        const added = (saved.inputs ?? []).filter(item => Date.parse(item.addedAt) >= submittedAt).length;
        setCaseInputNotice(added > 0
          ? (locale === "zh-CN" ? `已添加 ${names}，当前 CASE 共 ${total} 项输入` : `Added ${names}. This CASE now has ${total} inputs.`)
          : (locale === "zh-CN" ? `${names} 已存在，未重复添加` : `${names} already exists and was not added again.`));
      } else setCaseInputNotice("");
      setCaseWizardOpen(false); setCaseState(saved); setCaseId(saved.id); setApk(saved.inputs?.find(item => item.type === "apk")?.path ?? saved.target); setAnalysisGoal(saved.analysisGoal ?? ""); setAnalysisCategory(saved.analysisCategory ?? "report"); setSelectedArtifact(undefined); setArtifactText(""); setTimeline([]); setLogs([]); setReady(false);
      localStorage.setItem("seagull.lastCase", saved.id);
      const apkInput = saved.inputs?.find(item => item.type === "apk")?.path;
      if (apkInput) localStorage.setItem("seagull.lastApk", apkInput); else localStorage.removeItem("seagull.lastApk");
      await initializeAgent(saved.id, saved.activeWorkId, true);
    } catch (error) { setCaseWizardError(error instanceof Error ? error.message : String(error)); }
    finally { setCaseWizardBusy(false); }
  }
  async function openCasePicker() {
    setCasesOpen(true); setCasesLoading(true); setCaseListError("");
    try { setCases(await window.mobileReverse.listCases()); }
    catch (error) { setCaseListError(error instanceof Error ? error.message : String(error)); }
    finally { setCasesLoading(false); }
  }
  async function selectCase(id: string) {
    setCasesOpen(false); setReady(false); setStreaming(false); setPromptQueue([]); setQueueEditor(undefined); setTimeline([]); setLogs([]); setSelectedArtifact(undefined); setArtifactText(""); setCaseInputNotice("");
    try {
      const stored = await window.mobileReverse.readCase(id);
      if (!stored) throw new Error(locale === "zh-CN" ? "案例不存在或已被移动。" : "The case no longer exists or was moved.");
      setCaseId(stored.id); setCaseState(stored); setApk(stored.target);
      setAnalysisGoal(stored.analysisGoal ?? ""); setAnalysisCategory(stored.analysisCategory ?? "report");
      localStorage.setItem("seagull.lastCase", stored.id);
      await initializeAgent(stored.id, stored.activeWorkId);
    } catch (error) {
      setLogs(items => [...items, { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]);
      setReady(true);
    }
  }
  async function deleteCase(id: string) {
    const caseBusy = Object.entries(sessionActivity).some(([key, activity]) => key.startsWith(`${id}:`) && activity.streaming);
    if (caseBusy) { setCaseListError(locale === "zh-CN" ? "该案例仍有工作正在执行，停止对应工作后才能删除。" : "A Work in this case is still running. Stop it before deleting the case."); return; }
    setCaseListError("");
    try {
      const deleted = await window.mobileReverse.deleteCase(id);
      if (!deleted) return;
      setCases(items => items.filter(item => item.id !== id));
      if (id === caseId) {
        setCaseId(undefined); setCaseState(undefined); setApk(undefined); setTimeline([]); setLogs([]); setSelectedArtifact(undefined); setArtifactText("");
        localStorage.removeItem("seagull.lastCase"); localStorage.removeItem("seagull.lastApk");
        setReady(false); await initializeAgent(undefined, undefined, true);
      }
    } catch (error) { setCaseListError(error instanceof Error ? error.message : String(error)); }
  }
  function editCaseDescription(item: CaseSummary) {
    setCaseEditor(item);
    setCaseEditorDescription(item.description ?? "");
    setCaseEditorError("");
  }
  async function saveCaseDescription() {
    if (!caseEditor || caseEditorBusy) return;
    const description = caseEditorDescription.trim();
    if (description.length > 240) {
      setCaseEditorError(locale === "zh-CN" ? "案例描述不能超过 240 个字符。" : "The case description cannot exceed 240 characters.");
      return;
    }
    setCaseEditorBusy(true); setCaseEditorError(""); setCaseListError("");
    try {
      if (typeof window.mobileReverse.updateCaseDescription !== "function") throw new Error(analysisText.preloadMismatch);
      const saved = await window.mobileReverse.updateCaseDescription(caseEditor.id, description);
      setCases(items => items.map(current => current.id === caseEditor.id ? { ...current, description: saved.description, updatedAt: saved.updatedAt } : current));
      if (caseEditor.id === caseId) setCaseState(saved);
      setCaseEditor(undefined);
    } catch (error) { setCaseEditorError(error instanceof Error ? error.message : String(error)); }
    finally { setCaseEditorBusy(false); }
  }
  async function deleteAnalysisRequest(requestId: string) {
    if (!caseId) return;
    const confirmed = window.confirm(locale === "zh-CN" ? "删除这条历史工作目标？对应的报告、证据和工程文件不会被删除。" : "Delete this work-objective history entry? Reports, evidence, and project files will be preserved.");
    if (!confirmed) return;
    try {
      const saved = await window.mobileReverse.deleteAnalysisRequest(caseId, requestId);
      setCaseState(saved); setAnalysisGoal(saved.analysisGoal ?? ""); setAnalysisCategory(saved.analysisCategory ?? "report");
    } catch (error) { setAnalysisError(error instanceof Error ? error.message : String(error)); }
  }
  async function switchWork(workId: string) {
    if (!caseId || workId === caseState?.activeWorkId) return;
    setSwitchingWorkId(workId);
    try {
      setReady(false); setStreaming(false); setPromptQueue([]); setQueueEditor(undefined); setTimeline([]); setLogs([]); setSkillsOpen(false);
      activeAssistantId.current = undefined; turnHadAssistantText.current = false; resetFinalRecovery(); turnEnded.current = true;
      const saved = await window.mobileReverse.switchWork(caseId, workId);
      setCaseState(saved); setAnalysisGoal(saved.analysisGoal ?? ""); setAnalysisCategory(saved.analysisCategory ?? "report");
      setSelectedArtifact(undefined); setArtifactText("");
      await initializeAgent(caseId, workId, false);
    } catch (error) {
      setReady(true);
      setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]);
    } finally { setSwitchingWorkId(undefined); }
  }
  async function deleteWork(workId: string) {
    if (!caseId || sessionActivity[agentSessionKey(caseId, workId)]?.streaming) return;
    if (!window.confirm(locale === "zh-CN" ? "删除这条工作记录？工作目录和产物不会自动删除。" : "Delete this work record? Its directory and artifacts will remain.")) return;
    const deletingActiveWork = workId === caseState?.activeWorkId;
    try {
      const saved = await window.mobileReverse.deleteWork(caseId, workId); setCaseState(saved);
      if (deletingActiveWork) {
        setReady(false); setTimeline([]); setLogs([]); setTools([]);
        await initializeAgent(caseId, saved.activeWorkId, true);
      }
    }
    catch (error) { setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  function editWork(workId: string) {
    if (!caseId) return;
    const work = works.find(item => item.id === workId);
    if (!work) return;
    setWorkEditorId(workId); setWorkEditorTitle(work.title); setWorkEditorCategory(work.category); setWorkEditorError("");
  }
  async function saveWorkEditor() {
    if (!caseId || !workEditorId || workEditorBusy) return;
    const title = workEditorTitle.trim();
    if (!title) { setWorkEditorError(locale === "zh-CN" ? "请输入工作名称。" : "Enter a Work title."); return; }
    setWorkEditorBusy(true); setWorkEditorError("");
    try {
      if (typeof window.mobileReverse.updateWork !== "function") throw new Error(analysisText.preloadMismatch);
      const saved = await window.mobileReverse.updateWork(caseId, workEditorId, { title, category: workEditorCategory });
      setCaseState(saved); setAnalysisCategory(saved.analysisCategory ?? "report"); setWorkEditorId(undefined);
    } catch (error) { setWorkEditorError(error instanceof Error ? error.message : String(error)); }
    finally { setWorkEditorBusy(false); }
  }
  function branchWork(workId: string) {
    const work = works.find(item => item.id === workId);
    if (!work) return;
    setAnalysisCategory(work.category); setAnalysisGoal(""); setAnalysisImages([]); setAnalysisPastedTexts([]); setAnalysisError(""); setAnalysisOpen(true);
  }
  async function rerunValidation(stage: { id: string; label: string; successCriteria?: string }) {
    if (!caseId || !activeWork) return;
    const body = locale === "zh-CN" ? `重新验证：${stage.label}` : `Revalidate: ${stage.label}`;
    turnEnded.current = false; setStreaming(true);
    try {
      const queued = await window.mobileReverse.prompt(caseId, activeWork.id, `[SEAGULL_VALIDATION_RERUN]\nContinue the current work '${activeWork.title}' without replanning or resetting its pipeline. Re-run only validation stage ${stage.id} (${stage.label}). Acceptance criterion: ${stage.successCriteria ?? "use the existing work plan and evidence"}. Reuse existing artifacts, run focused checks, register new evidence, update this stage, and report the exact result and remaining blocker.`, body);
      recordPromptTimeline(queued, { kind: "user", title: locale === "zh-CN" ? "复验请求" : "Validation request", body, at: stamp() });
    }
    catch (error) { turnEnded.current = true; setStreaming(false); setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  async function runWorkbenchAction(label: string, instruction: string) {
    if (!caseId || !activeWork) return;
    const body = locale === "zh-CN" ? `操作台：${label}` : `Workbench: ${label}`;
    turnEnded.current = false; setStreaming(true);
    try {
      const queued = await window.mobileReverse.prompt(caseId, activeWork.id, `[SEAGULL_WORKBENCH_ACTION]\nContinue the current Work '${activeWork.title}' without replanning or resetting its pipeline. Work only inside ${activeWork.run.taskDir ?? activeWork.run.workspaceDir}. Reuse upstream Work artifacts read-only. Execute this focused action: ${instruction}\nReport changed artifacts, validation result, and any blocker.`, instruction);
      recordPromptTimeline(queued, { kind: "user", title: body, body: instruction, at: stamp() });
    }
    catch (error) { turnEnded.current = true; setStreaming(false); setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  function requestAnalysis() {
    if (!settings.outputRoot.trim()) { setOutputError(true); setOutputOpen(true); return; }
    setAnalysisGoal("");
    setAnalysisImages([]);
    setAnalysisPastedTexts([]);
    setAnalysisCategory("report");
    setAnalysisError("");
    setAnalysisOpen(true);
  }
  function requestReconstruction() {
    if (!settings.outputRoot.trim()) { setOutputError(true); setOutputOpen(true); return; }
    setAnalysisCategory("app-reconstruction");
    setAnalysisGoal("");
    setAnalysisImages([]);
    setAnalysisPastedTexts([]);
    setAnalysisError("");
    setAnalysisOpen(true);
  }
  async function start() {
    if (!caseId) return;
    const requestImages = analysisImages;
    const requestTexts = analysisPastedTexts;
    const hasAttachments = requestImages.length > 0 || requestTexts.length > 0;
    if (!canSubmitWorkRequest(analysisGoal, hasAttachments)) { setAnalysisError(analysisText.required); return; }
    const goal = workRequestGoal(analysisGoal, hasAttachments, locale);
    const operatorMessage = `${analysisGoal.trim() || goal}${workRequestAttachmentContext(requestTexts, requestImages)}`;
    const timelineAttachments: HistoryMessageAttachment[] = requestTexts.map(item => ({ kind: "text", name: item.name, detail: `${item.text.length.toLocaleString()} ${locale === "zh-CN" ? "字符" : "characters"}`, content: item.text }));
    const generation = ++startGeneration.current;
    setAnalysisOpen(false);
    setReady(false);
    turnEnded.current = false;
    setStreaming(true);
    try {
      if (typeof window.mobileReverse.saveAnalysisRequest !== "function") throw new Error(analysisText.preloadMismatch);
      const saved = await window.mobileReverse.saveAnalysisRequest(caseId, goal, analysisCategory);
      if (generation !== startGeneration.current) return;
      setCaseState(saved);
      const caseWorkspaceDir = (saved.workspaceDir ?? `${settings.outputRoot}/${caseId}`).replace(/\\/g, "/");
      const workDirectory = (saved.activeRun?.workspaceDir ?? caseWorkspaceDir).replace(/\\/g, "/");
      const taskDirectory = saved.activeRun?.taskDir?.replace(/\\/g, "/");
      const caseInputs = (saved.inputs ?? []).map(item => `- ${item.type}: ${item.name}${item.path ? ` @ ${item.path.replace(/\\/g, "/")}` : ""}${item.packageName ? ` (${item.packageName})` : ""}`).join("\n") || "- No material input has been added yet; start from the operator objective and explicitly identify blockers.";
      const routeOptions = analysisCategory === "app-development" ? "requirements, Android architecture, UI/UX, platform APIs, storage/networking, implementation, Gradle build, automated tests, device installation, and acceptance verification" : analysisCategory === "runtime-diagnostics" ? "ADB device/package snapshot, controlled reproduction, filtered logcat, dumpsys, crash/ANR/tombstone evidence, JADX/IDA correlation, narrow Frida observation, hypothesis discrimination, and focused verification" : "APK triage, JADX Java analysis, IDA native analysis, Frida runtime tracing, Unidbg emulation, request replay, algorithm recovery, and verification";
      await initializeAgent(caseId, saved.activeWorkId, true);
      if (generation !== startGeneration.current) return;
      const queued = await window.mobileReverse.prompt(caseId, saved.activeWorkId, `You are starting a goal-driven work run for CASE ${saved.title ?? caseId} (${saved.platform ?? "android"}).

Mandatory planning gate:
Analysis category: ${analysisCategory}.
Category-specific contract: ${categoryDirectives[analysisCategory]}

Registered CASE inputs:
${caseInputs}

1. The persistent case workspace is ${caseWorkspaceDir}. This work is isolated at ${taskDirectory}; read ${taskDirectory}/request.md, ${taskDirectory}/upstream-works.json, and ${caseWorkspaceDir}/state.json. Its project/workspace directory is ${workDirectory}. Read inherited artifacts when needed, but never modify another Work directory.
2. Decompose the objective into concrete questions and success criteria.
3. Select only the necessary routes from ${routeOptions}. Explicitly explain why each selected route is needed and why skipped routes are unnecessary.
4. Write the ordered plan, selected tools, expected artifacts, stop conditions, and reuse strategy to ${taskDirectory}/plan.md. Put every new result under ${taskDirectory}/artifacts, runtime evidence under ${taskDirectory}/evidence, and application source/build outputs under ${workDirectory}. Register absolute paths, then call reverse_analysis_plan with ONLY the stages selected for this objective BEFORE invoking target-analysis tools.
5. Announce the plan, then execute it. Call reverse_analysis_step whenever a stage starts, completes, is skipped, or fails. Reuse confirmed evidence and do not repeat completed work unless the new objective requires revalidation.
6. Include a REPORT stage only when a report is required. Generate and register ${taskDirectory}/artifacts/delivery.md aligned specifically to this objective, then mark that stage completed with reverse_analysis_step.

The operator's objective is:
[SEAGULL_USER_MESSAGE]
${operatorMessage}`, analysisGoal.trim() || goal, requestImages);
      recordPromptTimeline(queued, { kind: "user", title: locale === "zh-CN" ? "工作目标" : "Work objective", body: analysisGoal.trim() || goal, attachments: timelineAttachments, images: requestImages.map(image => `data:${image.mimeType};base64,${image.data}`), imageNames: requestImages.map(image => image.name), at: stamp() });
      setAnalysisImages([]);
      setAnalysisPastedTexts([]);
    } catch (error) {
      turnEnded.current = true;
      setStreaming(false);
      const message = error instanceof Error ? error.message : String(error);
      setAnalysisError(message);
      setAnalysisOpen(true);
      setLogs(v => [...v, { channel: "error", message: `${t.initFailed}: ${message}`, at: stamp() }]);
    }
  }
  async function stopWork() {
    startGeneration.current += 1;
    turnEnded.current = true;
    setStreaming(false);
    const identity = activeSessionIdentity.current;
    try { await window.mobileReverse.abort(identity.caseId, identity.workId); }
    catch (error) { setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  async function chooseOutputRoot() { const directory = await window.mobileReverse.selectOutputDirectory(); if (directory) { setSettings({ ...settings, outputRoot: directory }); setOutputError(false); } }
  async function saveOutputSettings() {
    if (!settings.outputRoot.trim()) { setOutputError(true); return; }
    await window.mobileReverse.saveSettings(settings);
    setOutputOpen(false);
    if (apk) { const selected = await restoreApk(apk); if (selected) await initializeAgent(selected.caseId, selected.workId, true); }
  }
  async function saveModelSettings() {
    if (!settings.outputRoot.trim()) { setOutputError(true); return; }
    await window.mobileReverse.saveSettings(settings);
    setSettingsOpen(false);
    setModel(`seagull/${settings.modelId}`);
    if (apk) { const selected = await restoreApk(apk); if (selected) await initializeAgent(selected.caseId, selected.workId, true); }
  }
  async function refreshModels() {
    setModelsLoading(true); setModelMessage("");
    try {
      const result = await window.mobileReverse.listModels(settings);
      setModelOptions(result);
      setModelFilter("");
      setModelMenuOpen(true);
      setModelMessage(t.modelsLoaded.replace("{count}", String(result.length)));
      if (!settings.modelId && result[0]) setSettings({ ...settings, modelId: result[0] });
    } catch (error) { setModelMessage(error instanceof Error ? error.message : String(error)); }
    finally { setModelsLoading(false); }
  }
  async function recheckMcp(server: string) {
    if (mcpChecking) return;
    setMcpChecking(server);
    try {
      const result = await window.mobileReverse.checkMcpReadiness(server);
      setMcpReadiness(current => ({ ...current, [server]: { ready: result.ready, detail: result.detail } }));
      setLogs(items => [...items.slice(-400), { channel: "mcp", message: `${server.toUpperCase()}: ${result.detail}`, at: stamp() }]);
    } catch (error) {
      setLogs(items => [...items.slice(-400), { channel: "error", message: `MCP check failed: ${error instanceof Error ? error.message : String(error)}`, at: stamp() }]);
    } finally { setMcpChecking(undefined); }
  }
  async function addImages(files: File[]) {
    const room = Math.max(0, 4 - pendingImages.length);
    const images = await imageAttachmentsFromFiles(files, room);
    setPendingImages(current => [...current, ...images].slice(0, 4));
    if (images.length < files.length) setLogs(items => [...items.slice(-400), { channel: "error", message: locale === "zh-CN" ? "仅支持 PNG/JPEG/GIF/WebP，单张不超过 10 MB，最多 4 张。" : "PNG/JPEG/GIF/WebP only, 10 MB each, up to 4 images.", at: stamp() }]);
  }
  async function addAnalysisImages(files: File[]) {
    const room = Math.max(0, 4 - analysisImages.length);
    const images = await imageAttachmentsFromFiles(files, room);
    setAnalysisImages(current => [...current, ...images].slice(0, 4));
    if (images.length < files.length) setAnalysisError(locale === "zh-CN" ? "仅支持 PNG/JPEG/GIF/WebP，单张不超过 10 MB，最多 4 张。" : "PNG/JPEG/GIF/WebP only, 10 MB each, up to 4 images.");
  }
  function handleAnalysisPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (imageFiles.length) { event.preventDefault(); void addAnalysisImages(imageFiles); return; }
    const pasted = event.clipboardData.getData("text/plain");
    if (!shouldAttachPastedText(pasted)) return;
    event.preventDefault();
    setAnalysisPastedTexts(current => [...current, { id: crypto.randomUUID(), name: pastedTextPreview(pasted), text: pasted }].slice(0, 8));
    setAnalysisError("");
  }
  async function addFileAttachments() {
    if (!caseId) return;
    try {
      const files = await window.mobileReverse.importAttachments(caseId, activeWork?.id);
      setPendingFiles(current => [...current, ...files].slice(0, 20));
      if (files.length) setCaseState(await window.mobileReverse.readCase(caseId));
    } catch (error) { setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  function showImagePreview(source: string, name = "image.png") {
    setImagePreview({ source, name });
  }
  async function copyPreviewImage() {
    if (!imagePreview) return;
    try {
      const response = await fetch(imagePreview.source);
      const sourceBlob = await response.blob();
      let pngBlob = sourceBlob;
      if (sourceBlob.type !== "image/png") {
        const bitmap = await createImageBitmap(sourceBlob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to encode image as PNG")), "image/png"));
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setImageActionStatus(locale === "zh-CN" ? "图片已复制" : "Image copied");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setImageActionStatus(locale === "zh-CN" ? `复制失败：${detail}` : `Copy failed: ${detail}`);
    }
  }
  function downloadPreviewImage() {
    if (!imagePreview) return;
    const mimeType = /^data:(image\/[^;]+)/.exec(imagePreview.source)?.[1] ?? "image/png";
    const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const originalName = imagePreview.name.trim() || `image.${extension}`;
    const filename = /\.[a-z0-9]+$/i.test(originalName) ? originalName : `${originalName}.${extension}`;
    const link = document.createElement("a");
    link.href = imagePreview.source;
    link.download = filename.replace(/[<>:"/\\|?*]/g, "_");
    link.click();
    setImageActionStatus(locale === "zh-CN" ? "已开始下载" : "Download started");
  }
  function showTextPreview(content: string, name = "pasted-text.txt") {
    setTextPreview({ content, name });
  }
  async function copyPreviewText() {
    if (!textPreview) return;
    try {
      await navigator.clipboard.writeText(textPreview.content);
      setTextActionStatus(locale === "zh-CN" ? "文本已复制" : "Text copied");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setTextActionStatus(locale === "zh-CN" ? `复制失败：${detail}` : `Copy failed: ${detail}`);
    }
  }
  function downloadPreviewText() {
    if (!textPreview) return;
    const link = document.createElement("a");
    const blobUrl = URL.createObjectURL(new Blob([textPreview.content], { type: "text/plain;charset=utf-8" }));
    const originalName = textPreview.name.trim() || "pasted-text.txt";
    link.href = blobUrl;
    link.download = (/\.[a-z0-9]+$/i.test(originalName) ? originalName : `${originalName}.txt`).replace(/[<>:"/\\|?*]/g, "_");
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    setTextActionStatus(locale === "zh-CN" ? "已开始下载" : "Download started");
  }
  function restorePastedText(attachment: PastedTextAttachment) {
    if (!canRestorePastedText(attachment.text)) return;
    setInput(current => current ? `${current}\n${attachment.text}` : attachment.text);
    setPastedTexts(current => current.filter(item => item.id !== attachment.id));
    window.requestAnimationFrame(() => composerInput.current?.focus());
  }
  async function movePromptInQueue(promptId: string, direction: "up" | "down") {
    const identity = activeSessionIdentity.current;
    try { setPromptQueue(await window.mobileReverse.moveQueuedPrompt(identity.caseId, identity.workId, promptId, direction)); }
    catch (error) { setQueueError(error instanceof Error ? error.message : String(error)); }
  }
  async function deletePromptFromQueue(promptId: string) {
    const identity = activeSessionIdentity.current;
    try { setPromptQueue(await window.mobileReverse.deleteQueuedPrompt(identity.caseId, identity.workId, promptId)); queuedTimelineItems.current.delete(promptId); setTimeline(items => items.filter(item => item.id !== `queue-user-${promptId}`)); }
    catch (error) { setQueueError(error instanceof Error ? error.message : String(error)); }
  }
  function editQueuedPrompt(item: PromptQueueItemView) {
    setQueueEditor(item); setQueueEditorText(item.displayText); setQueueError("");
  }
  async function saveQueuedPrompt() {
    if (!queueEditor || !queueEditorText.trim()) return;
    const identity = activeSessionIdentity.current;
    try {
      setPromptQueue(await window.mobileReverse.updateQueuedPrompt(identity.caseId, identity.workId, queueEditor.id, queueEditorText));
      const cached = queuedTimelineItems.current.get(queueEditor.id);
      if (cached) queuedTimelineItems.current.set(queueEditor.id, { ...cached, body: queueEditorText.trim() });
      setTimeline(items => items.map(item => item.id === `queue-user-${queueEditor.id}` ? { ...item, body: queueEditorText.trim() } : item));
      setQueueEditor(undefined);
    } catch (error) { setQueueError(error instanceof Error ? error.message : String(error)); }
  }
  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (imageFiles.length) { event.preventDefault(); void addImages(imageFiles); return; }
    const pasted = event.clipboardData.getData("text/plain");
    if (!shouldAttachPastedText(pasted)) return;
    event.preventDefault();
    setPastedTexts(current => [...current, { id: crypto.randomUUID(), name: pastedTextPreview(pasted), text: pasted }].slice(0, 8));
  }
  async function sendPrompt() {
    const text = input.trim();
    if (!text && pendingImages.length === 0 && pendingFiles.length === 0 && pastedTexts.length === 0) return;
    const images = pendingImages;
    const files = pendingFiles;
    const textAttachments = pastedTexts;
    const attachmentContext = [
      textAttachments.length ? `\n\n[PASTED_TEXT_ATTACHMENTS]\n${textAttachments.map((item, index) => `## Text ${index + 1}: ${item.name}\n${item.text}`).join("\n\n")}` : "",
      files.length ? `\n\n[FILE_ATTACHMENTS]\nThe operator attached these persistent files. Inspect them with the appropriate document, spreadsheet, PDF, archive, or filesystem tools before answering:\n${files.map(file => `- ${file.path} (${file.size} bytes)`).join("\n")}` : "",
      images.length ? `\n\n[IMAGE_ATTACHMENTS]\n${images.map(image => `- ${image.name} (${image.mimeType})`).join("\n")}` : "",
    ].join("");
    const operatorText = `${text || (locale === "zh-CN" ? "请分析附件。" : "Please analyze the attachments.")}${attachmentContext}`;
    timelinePinnedToBottom.current = true;
    setShowTimelineBottomButton(false);
    setInput(""); setPendingImages([]); setPendingFiles([]); setPastedTexts([]);
    const messageAttachments: HistoryMessageAttachment[] = [
      ...textAttachments.map(item => ({ kind: "text" as const, name: item.name, detail: `${item.text.length.toLocaleString()} ${locale === "zh-CN" ? "字符" : "characters"}`, content: item.text })),
      ...files.map(file => ({ kind: "file" as const, name: file.name, path: file.path, detail: file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB` })),
    ];
    const incrementalProjectWork = (caseState?.analysisCategory === "app-reconstruction" || caseState?.analysisCategory === "app-development") && Boolean(caseState.activeRun?.workspaceDir);
    const workContext = activeWork ? `[SEAGULL_WORK_CONTEXT]\nActive case: ${caseId}. Active work: ${activeWork.id} (${activeWork.title}). Category: ${activeWork.category}. This message belongs to that work. Preserve its pipeline, artifacts, upstream inheritance, and current project context; do not silently switch to another historical work.\n\n` : "";
    const promptText = workContext + (incrementalProjectWork ? `[SEAGULL_PROJECT_FOLLOW_UP]\nThis is an incremental follow-up to the existing Android project task, not a new work request. Continue in ${caseState.activeRun?.workspaceDir?.replace(/\\/g, "/")}. Preserve the established architecture and inherited case evidence unless the operator explicitly requests otherwise. Do not call reverse_analysis_plan and do not replace or reset the completed/current pipeline. Inspect the current project, implement only the requested adjustment, run focused build/tests, record changed files and validation, then answer the operator directly. If the requested change genuinely requires a separate deliverable, ask the operator to create a new work item through Start work.\n\nOperator follow-up:\n${operatorText}` : operatorText);
    try {
      const queued = await window.mobileReverse.prompt(caseId, activeWork?.id, promptText, text || (locale === "zh-CN" ? "请分析附件。" : "Please analyze the attachments."), images);
      recordPromptTimeline(queued, { kind: "user", title: locale === "zh-CN" ? "你" : "You", body: text || undefined, attachments: messageAttachments, images: images.map(image => `data:${image.mimeType};base64,${image.data}`), imageNames: images.map(image => image.name), at: stamp() });
    }
    catch (error) {
      if (!streaming) { turnEnded.current = true; setStreaming(false); }
      setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]);
    }
  }
  async function openArtifact(filename: string) { setSelectedArtifact(filename); try { setArtifactText(await window.mobileReverse.readTextFile(filename)); } catch (error) { setArtifactText(String(error)); } }
  async function openCurrentCaseDirectory() {
    if (!caseId) return;
    try {
      await window.mobileReverse.openCaseDirectory(caseId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLogs(items => [...items.slice(-400), {
        channel: "error",
        message: locale === "zh-CN" ? `无法打开当前结果目录：${detail}` : `Failed to open the current results directory: ${detail}`,
        at: stamp()
      }]);
    }
  }
  async function createIntegratedTerminal(cwd: string | undefined, title?: string, initialCommand?: string) {
    if (!cwd) return;
    try {
      const session = await window.mobileReverse.createTerminal(cwd, title, initialCommand);
      setTerminalTabs(current => {
        const existing = current.find(tab => tab.id === session.id);
        return existing ? current.map(tab => tab.id === session.id ? { ...tab, ...session } : tab) : [...current, { ...session, status: "running" }];
      });
      setActiveTerminalId(session.id);
      setActive("Terminal");
    } catch (error) {
      setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]);
    }
  }
  async function closeIntegratedTerminal(terminalId: string) {
    terminalClosing.current.add(terminalId);
    removeTerminalSession(terminalId);
    try { await window.mobileReverse.closeTerminal(terminalId); }
    catch { /* the process may already have exited */ }
    window.setTimeout(() => terminalClosing.current.delete(terminalId), 2000);
  }
  function removeTerminalSession(terminalId: string) {
    setTerminalTabs(current => {
      const index = current.findIndex(tab => tab.id === terminalId);
      if (index < 0) return current;
      const next = current.filter(tab => tab.id !== terminalId);
      setActiveTerminalId(activeId => {
        if (activeId !== terminalId && activeId && next.some(tab => tab.id === activeId)) return activeId;
        return next[Math.min(index, next.length - 1)]?.id;
      });
      return next;
    });
    terminalViews.current.delete(terminalId);
    terminalPending.current.delete(terminalId);
  }
  function registerTerminalView(terminalId: string, handle?: XtermHandle) {
    if (!handle) { terminalViews.current.delete(terminalId); return; }
    terminalViews.current.set(terminalId, handle);
    const pending = terminalPending.current.get(terminalId);
    if (pending) {
      handle.write(pending);
      terminalPending.current.delete(terminalId);
    }
  }
  function copyTerminalOutput(terminalId: string) {
    const text = terminalViews.current.get(terminalId)?.copyAll();
    if (text) void navigator.clipboard.writeText(text);
  }
  function clearTerminalOutput(terminalId: string) {
    terminalPending.current.delete(terminalId);
    terminalViews.current.get(terminalId)?.clear();
    window.mobileReverse.writeTerminal(terminalId, TERMINAL_CLEAR_INPUT);
  }
  async function buildActiveWork(clean = false) {
    if (!caseId || !activeWork || workActionBusy) return;
    const action = clean ? "rebuild" : "build";
    setWorkActionBusy(action); setWorkActionFeedback(undefined);
    try {
      await window.mobileReverse.buildWork(caseId, activeWork.id, clean);
      const apks = await window.mobileReverse.listWorkApks(caseId, activeWork.id);
      setWorkActionFeedback({ kind: "success", message: locale === "zh-CN" ? `${clean ? "重新编译" : "编译"}成功${apks.length ? `，发现 ${apks.length} 个 APK` : ""}` : `${clean ? "Rebuild" : "Build"} succeeded${apks.length ? ` · ${apks.length} APK${apks.length === 1 ? "" : "s"}` : ""}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkActionFeedback({ kind: "error", message: locale === "zh-CN" ? `${clean ? "重新编译" : "编译"}失败：${message}` : `${clean ? "Rebuild" : "Build"} failed: ${message}` });
      setLogs(items => [...items.slice(-400), { channel: "error", message, at: stamp() }]);
    } finally { setWorkActionBusy(undefined); }
  }

  async function revealCaseInput(inputId: string) {
    if (!caseId) return;
    try { await window.mobileReverse.revealCaseInput(caseId, inputId); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLogs(items => [...items.slice(-400), { channel: "error", message, at: stamp() }]);
      setWorkActionFeedback({ kind: "error", message: locale === "zh-CN" ? `无法打开输入目录：${message}` : `Could not reveal input: ${message}` });
    }
  }
  async function removeCaseInput(inputId: string, name: string) {
    if (!caseId || caseInputBusy) return;
    setCaseInputBusy(inputId);
    try {
      const saved = await window.mobileReverse.deleteCaseInput(caseId, inputId);
      if (!saved) return;
      setCaseState(saved);
      setApk(saved.inputs?.find(item => item.type === "apk")?.path ?? saved.target);
      setCaseInputNotice(locale === "zh-CN" ? `已移除 ${name}，当前 CASE 剩余 ${saved.inputs?.length ?? 0} 项输入` : `Removed ${name}. ${saved.inputs?.length ?? 0} inputs remain in this CASE.`);
      if (!streaming) await initializeAgent(saved.id, saved.activeWorkId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLogs(items => [...items.slice(-400), { channel: "error", message, at: stamp() }]);
      setCaseInputNotice(locale === "zh-CN" ? `移除 ${name} 失败：${message}` : `Could not remove ${name}: ${message}`);
    } finally { setCaseInputBusy(undefined); }
  }
  async function openWorkSystemTerminal() {
    if (!activeWorkDirectory) return;
    try { await window.mobileReverse.openArtifactTerminal(activeWorkDirectory); }
    catch (error) { setLogs(items => [...items.slice(-400), { channel: "error", message: error instanceof Error ? error.message : String(error), at: stamp() }]); }
  }
  async function requestWorkInstall() {
    if (!caseId || !activeWork || workActionBusy) return;
    setWorkActionBusy("install"); setWorkActionFeedback(undefined);
    setInstallOpen(true); setInstallLoading(true); setInstallError(""); setInstallDevices([]); setInstallApks([]);
    try {
      const [devices, apks] = await Promise.all([window.mobileReverse.listAdbDevices(), window.mobileReverse.listWorkApks(caseId, activeWork.id)]);
      const usableDevices = devices.filter(device => device.state === "device");
      setInstallDevices(devices); setInstallApks(apks);
      setSelectedInstallDevice(usableDevices[0]?.serial ?? "");
      setSelectedInstallApk(apks[0]?.path ?? "");
      if (!usableDevices.length) setInstallError(locale === "zh-CN" ? "没有发现可用的 ADB 设备。请连接设备并确认授权状态。" : "No usable ADB device was found. Connect and authorize a device.");
      else if (!apks.length) setInstallError(locale === "zh-CN" ? "当前工作目录中没有找到 APK。请先点击“编译”。" : "No APK was found in this work directory. Build the project first.");
    } catch (error) { setInstallError(error instanceof Error ? error.message : String(error)); }
    finally { setInstallLoading(false); setWorkActionBusy(undefined); }
  }
  async function confirmWorkInstall() {
    if (!activeWork || !selectedInstallDevice || !selectedInstallApk || workActionBusy) return;
    setInstallOpen(false);
    setWorkActionBusy("install"); setWorkActionFeedback(undefined);
    try {
      await window.mobileReverse.installWorkApk(selectedInstallDevice, selectedInstallApk);
      const device = installDevices.find(item => item.serial === selectedInstallDevice);
      setWorkActionFeedback({ kind: "success", message: locale === "zh-CN" ? `安装成功 · ${device?.model ?? selectedInstallDevice}` : `Installation succeeded · ${device?.model ?? selectedInstallDevice}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkActionFeedback({ kind: "error", message: locale === "zh-CN" ? `安装失败：${message}` : `Installation failed: ${message}` });
      setLogs(items => [...items.slice(-400), { channel: "error", message, at: stamp() }]);
    } finally { setWorkActionBusy(undefined); }
  }
  async function openArtifactInTerminal(filename: string) {
    await createIntegratedTerminal(filename, `${locale === "zh-CN" ? "产物" : "Artifact"} · ${filename.split(/[\\/]/).pop() ?? "Terminal"}`);
  }
  function toggleEvent(id: string) { setTimeline(items => items.map(item => item.id === id ? { ...item, expanded: !item.expanded } : item)); }
  function skillApi() {
    const api = window.mobileReverse as Partial<typeof window.mobileReverse>;
    if ((api.apiVersion ?? 0) < 2 || typeof api.listSkills !== "function" || typeof api.searchSkills !== "function" || typeof api.installSkill !== "function") {
      throw new Error(analysisText.preloadMismatch);
    }
    return api as typeof window.mobileReverse;
  }
  async function openSkillManager() {
    setSkillsOpen(false); setSkillManagerOpen(true); setSkillError(""); setSkillBusy("list");
    try { const skills = await skillApi().listSkills(); setSkillResults(skills); setAvailableSkillCount(skills.length); }
    catch (error) { setSkillError(error instanceof Error ? error.message : String(error)); }
    finally { setSkillBusy(undefined); }
  }
  async function findSkills() {
    setSkillError(""); setSkillBusy("search");
    try { setSkillResults(await skillApi().searchSkills(skillQuery)); }
    catch (error) { setSkillError(error instanceof Error ? error.message : String(error)); }
    finally { setSkillBusy(undefined); }
  }
  async function addSkill(idOrUrl: string) {
    setSkillError(""); setSkillBusy(idOrUrl);
    try {
      const api = skillApi();
      await api.installSkill(idOrUrl);
      setSkillResults(await api.searchSkills(skillQuery));
      setAvailableSkillCount((await api.listSkills()).length);
      if (caseId) await initializeAgent(caseId, activeWork?.id, true);
    } catch (error) { setSkillError(error instanceof Error ? error.message : String(error)); }
    finally { setSkillBusy(undefined); }
  }
  const logTabs: Array<[string, string]> = [["all", t.allLogs], ["problems", locale === "zh-CN" ? "问题" : "Problems"], ["pi", "Pi"], ["mcp", "MCP"], ["frida", "Frida"], ["unidbg", "Unidbg"]];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">S</div><div><strong>SEAGULL</strong><span>Mobile Reverse</span></div></div>
      <button className="apk-picker" onClick={() => openCaseWizard(caseId ? "add" : "create")} title={locale === "zh-CN" ? (caseId ? "向当前案例添加目标" : "创建案例") : (caseId ? "Add an input to this case" : "Create a case")}><FolderOpen size={16}/><span>{caseId ? (caseState?.title ?? apk?.split(/[\\/]/).pop() ?? caseId) : (locale === "zh-CN" ? "新建 CASE" : "New CASE")}</span><ChevronDown size={13}/></button>
      <div className="top-spacer"/>
      <div className="model-pill"><Bot size={15}/>{model}</div>
      <button className="language-switch" disabled={!caseId || initializing} onClick={() => void openCurrentCaseDirectory()} title={locale === "zh-CN" ? `在资源管理器中打开当前结果目录${caseId ? `：${caseId}` : ""}` : `Open current results directory${caseId ? `: ${caseId}` : ""}`}><FolderOpen size={15}/>{locale === "zh-CN" ? "打开结果" : "Open results"}</button>
      {mcp.map(server => { const readiness = mcpReadiness[server.name]; const state = readiness?.ready ? "ready" : server.online ? "connected" : "offline"; return <button type="button" title={readiness?.detail ?? (locale === "zh-CN" ? "橙色表示 MCP 已连接；点击检测目标应用/设备是否就绪" : "Amber means MCP connected; click to check target readiness")} onClick={() => void recheckMcp(server.name)} disabled={Boolean(mcpChecking)} className={`mcp-pill ${state}`} key={server.name}><i/>{server.name.toUpperCase()}<small>{server.count}</small>{mcpChecking === server.name && <RefreshCw size={11} className="spin"/>}</button>; })}
      <div className="app-menu" ref={appMenu}><button className={`language-switch ${appMenuOpen ? "active" : ""}`} onClick={() => setAppMenuOpen(value => !value)}><Settings size={15}/>{locale === "zh-CN" ? "工具" : "Tools"}<ChevronDown size={13}/></button>{appMenuOpen && <div className="app-menu-popover"><button onClick={() => { setAppMenuOpen(false); void openCasePicker(); }}><FolderOpen size={14}/><span>{locale === "zh-CN" ? "案例管理" : "Case manager"}</span></button><button onClick={() => { setAppMenuOpen(false); setOutputOpen(true); }}><FolderOpen size={14}/><span>{analysisText.outputRoot}</span></button><button onClick={() => { setAppMenuOpen(false); setSettingsOpen(true); }}><Settings size={14}/><span>{t.settings}</span></button><button onClick={() => { setAppMenuOpen(false); void openSkillManager(); }}><BookOpen size={14}/><span>{locale === "zh-CN" ? "Skills 管理" : "Skill manager"}</span></button><button onClick={() => { setAppMenuOpen(false); toggleTheme(); }}>{theme === "dark" ? <Sun size={14}/> : <Moon size={14}/>}<span>{theme === "dark" ? (locale === "zh-CN" ? "切换为浅色主题" : "Switch to light theme") : (locale === "zh-CN" ? "切换为深色主题" : "Switch to dark theme")}</span></button><button onClick={() => { setAppMenuOpen(false); toggleLocale(); }}><Languages size={14}/><span>{locale === "zh-CN" ? "切换为 English" : "切换为中文"}</span></button></div>}</div>
      {streaming ? <button className="danger" onClick={() => void stopWork()}><CircleStop size={16}/>{t.stop}</button> : <button className="primary" disabled={!caseId || !ready} onClick={requestAnalysis}><Play size={15}/>{locale === "zh-CN" ? "开始工作" : "Start work"}</button>}
    </header>


    <div className={`workspace ${agentExpanded ? "agent-expanded" : ""} ${agentResizing ? "agent-resizing" : ""}`} style={{ "--agent-width": `${agentWidth}px` } as CSSProperties}>
      <aside className="sidebar">
        <button type="button" className="case-head case-switcher" onClick={() => void openCasePicker()} title={locale === "zh-CN" ? "切换历史案例" : "Switch case"}><span>CASE</span><strong>{caseState?.title ?? caseId ?? t.noCase}</strong><small>{caseState?.inputs?.length ? `${caseState.inputs.length} ${locale === "zh-CN" ? "项输入" : "inputs"} · ${caseState.platform ?? "android"}` : caseState?.sha256 ? caseState.sha256.slice(0, 16) + "…" : t.chooseHint}</small><ChevronDown size={14}/></button>
        <section className="work-list"><header><span>WORKS</span><button type="button" disabled={!caseId || initializing} onClick={requestAnalysis} title={locale === "zh-CN" ? "新建工作" : "New work"}>+</button></header>{works.length > 4 && <div className="work-search"><input value={workQuery} onChange={event => setWorkQuery(event.target.value)} placeholder={locale === "zh-CN" ? "筛选工作…" : "Filter works…"}/>{workQuery && <button onClick={() => setWorkQuery("")}><X size={11}/></button>}</div>}<div>{visibleWorks.length ? visibleWorks.map(work => { const activity = caseId ? sessionActivity[agentSessionKey(caseId, work.id)] : undefined; return <article className={`${work.id === (caseState?.activeWorkId ?? activeWork?.id) ? "active" : ""} ${activity?.streaming ? "background-running" : ""}`} key={work.id}><button type="button" className="work-select" disabled={initializing} onClick={() => void switchWork(work.id)}><i className={activity?.streaming ? "running" : work.status}/><span><strong>{work.title}</strong><small>{categoryCopy[locale][work.category]?.label ?? work.category} · {work.run.stages.filter(stage => stage.status === "completed" || stage.status === "skipped").length}/{work.run.stages.length}{activity?.queued ? ` · ${activity.queued} ${locale === "zh-CN" ? "排队" : "queued"}` : ""}</small></span></button><div className="work-actions"><button type="button" disabled={initializing} onClick={() => editWork(work.id)} title={locale === "zh-CN" ? "编辑工作" : "Edit Work"}><Pencil size={11}/></button><button type="button" disabled={initializing} onClick={() => branchWork(work.id)} title={locale === "zh-CN" ? "基于此工作新建分支" : "Branch from work"}><Copy size={11}/></button><button type="button" disabled={initializing || Boolean(activity?.streaming)} onClick={() => void deleteWork(work.id)} title={locale === "zh-CN" ? "删除工作记录" : "Delete work"}><Trash2 size={11}/></button></div></article>; }) : <p>{workQuery ? (locale === "zh-CN" ? "没有匹配工作" : "No matching works") : (locale === "zh-CN" ? "还没有工作记录" : "No work items")}</p>}</div></section>
        <nav>{nav.map(([key, label, Icon]) => <button key={key} className={active === key ? "active" : ""} onClick={() => selectWorkspaceView(key)}><Icon size={16}/>{label}<ChevronRight size={13}/></button>)}</nav>
        <div className="phase-card"><span>{t.workflow.toUpperCase()}</span><div className="phase-name">{currentStageLabel}</div><div className="progress"><i style={{ width: `${runStages.length ? (completedStages / runStages.length) * 100 : 0}%` }}/></div><small>{t.phase} {Math.min(currentStageIndex + 1, runStages.length)} / {runStages.length}</small></div>
      </aside>

      <main className={`main-stage ${activityExpanded ? "activity-open" : "activity-closed"}`}>
        <div className="stage-head"><div><span>{t.workspace.toUpperCase()} / {(nav.find(n=>n[0]===active)?.[1] ?? active).toUpperCase()}</span><h1>{nav.find(n=>n[0]===active)?.[1] ?? active}</h1></div><div className={`status ${streaming ? "working" : ready ? "ready" : "idle"}`}><Radio size={14}/>{streaming ? t.working : ready ? t.ready : t.idle}</div></div>
        {active === "Overview" && <Overview
          state={caseState} stages={runStages} phaseText={phaseText} currentStageLabel={currentStageLabel}
          apk={apk} t={t} locale={locale} caseInputNotice={caseInputNotice} caseInputBusy={caseInputBusy} workActionBusy={workActionBusy} workActionFeedback={workActionFeedback}
          onReconstruct={requestReconstruction} onRevealInput={inputId => void revealCaseInput(inputId)}
          onRemoveInput={(inputId, name) => void removeCaseInput(inputId, name)}
          onOpenDirectory={() => { if (caseId && activeWork) void window.mobileReverse.openWorkDirectory(caseId, activeWork.id); }}
          onBuild={() => void buildActiveWork()} onRebuild={() => void buildActiveWork(true)} onInstall={() => void requestWorkInstall()}
          onIntegratedTerminal={() => void createIntegratedTerminal(activeWorkDirectory, activeWork?.title)} onSystemTerminal={() => void openWorkSystemTerminal()}
        />}
        {active === "Artifacts" && <Evidence state={caseState} selected={selectedArtifact} content={artifactText} onOpen={openArtifact} onOpenDefault={file => void window.mobileReverse.openArtifact(file)} onReveal={file => void window.mobileReverse.revealArtifact(file)} onTerminal={file => void openArtifactInTerminal(file)} t={t} locale={locale}/>} 
        <div className={`terminal-route ${active === "Terminal" ? "active" : "inactive"}`}><IntegratedTerminal visible={active === "Terminal"} locale={locale} caseId={caseId} tabs={terminalTabs} activeId={activeTerminal?.id} onSelect={setActiveTerminalId} onNew={() => void createIntegratedTerminal(activeWorkDirectory, activeWork?.title)} onClose={id => void closeIntegratedTerminal(id)} onWrite={(id, data) => window.mobileReverse.writeTerminal(id, data)} onResize={(id, cols, rows) => window.mobileReverse.resizeTerminal(id, cols, rows)} onReady={registerTerminalView} onCopy={copyTerminalOutput} onClear={clearTerminalOutput}/></div>
        <section className={`terminal-panel activity-panel ${activityExpanded ? "expanded" : "collapsed"}`}><div className="terminal-tabs"><button className="activity-toggle" onClick={() => setActivityExpanded(value => !value)}><ChevronRight size={14}/><strong>{locale === "zh-CN" ? "活动" : "Activity"}</strong><small>{logs.length}</small></button>{activityExpanded && logTabs.map(([key, label]) => <button className={logTab === key ? "active" : ""} onClick={() => setLogTab(key)} key={key}>{label}</button>)}<div className="terminal-tab-spacer"/>{activityExpanded && <button className={`wrap-toggle ${logWrap ? "active" : ""}`} onClick={() => setLogWrap(value => { const next = !value; localStorage.setItem("seagull.logWrap", String(next)); return next; })}><WrapText size={14}/><span>{locale === "zh-CN" ? "换行" : "Wrap"}</span><kbd>Alt+Z</kbd></button>}</div>{activityExpanded && <div className={`terminal-body ${logWrap ? "wrap" : "no-wrap"}`} ref={terminalBody}>{visibleLogs.length === 0 ? <div className="muted">{t.noLogs}</div> : visibleLogs.map((log, i) => <div className={`log ${log.channel}`} key={`${log.at}-${i}`}><time>{log.at}</time><b>{log.channel}</b><span>{log.message}</span></div>)}</div>}</section>
      </main>

      <aside className="agent-panel"><button type="button" role="separator" className="agent-resize-handle" aria-label={locale === "zh-CN" ? "拖动调整聊天栏宽度" : "Drag to resize chat panel"} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={clampAgentPanelWidth(Number.MAX_SAFE_INTEGER, window.innerWidth)} aria-valuenow={agentWidth} title={locale === "zh-CN" ? "拖动调整对话区宽度" : "Drag to resize chat"} onPointerDown={beginAgentResize} onKeyDown={event => { if (event.key === "ArrowLeft") resizeAgentWithKeyboard(1); if (event.key === "ArrowRight") resizeAgentWithKeyboard(-1); }}/><div className="agent-work-context"><span>{caseId ?? "—"}</span><ChevronRight size={10}/><strong>{activeWork?.title ?? (locale === "zh-CN" ? "未选择工作" : "No work selected")}</strong>{activeWork && <small>{categoryCopy[locale][activeWork.category].label}</small>}</div>
        <div className="agent-head"><div><Bot size={18}/><strong>{t.agent}</strong></div><div className="agent-actions"><button className={`skills-button ${usedSkills.length ? "active" : ""}`} onClick={() => setSkillsOpen(value => !value)} title={locale === "zh-CN" ? `当前会话已使用 ${usedSkills.length} 个，可用 ${availableSkillCount} 个` : `${usedSkills.length} used in this session, ${availableSkillCount} available`}><BookOpen size={13}/><span>Skills {usedSkills.length}/{availableSkillCount}</span></button><span>{streaming ? t.running.toUpperCase() : t.agentIdle.toUpperCase()}</span><button onClick={() => setAgentExpanded(value => !value)} title={agentExpanded ? (locale === "zh-CN" ? "恢复工作区" : "Restore workspace") : (locale === "zh-CN" ? "专注对话" : "Focus chat")}>{agentExpanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button>{skillsOpen && <div className="skills-popover"><header><strong>{locale === "zh-CN" ? `本会话已使用 ${usedSkills.length} / 可用 ${availableSkillCount}` : `${usedSkills.length} used / ${availableSkillCount} available`}</strong><button onClick={() => setSkillsOpen(false)}><X size={13}/></button></header>{usedSkills.length ? <div className="skills-list">{usedSkills.map(skill => <article key={skill.source}><BookOpen size={14}/><div><strong>{skill.name}</strong><small title={skill.source}>{skill.source}</small></div><time>{skill.at}</time></article>)}</div> : <p>{locale === "zh-CN" ? "当前会话尚未激活 Skill。开始 Frida、Unidbg、反混淆等对应任务后，Pi 读取 SKILL.md 时会记录在这里。" : "No skill has been activated in this session. It will appear here when Pi reads its SKILL.md for a matching task."}</p>}<footer><button onClick={() => void openSkillManager()}><Settings size={13}/>{locale === "zh-CN" ? "管理与安装 Skills" : "Manage and install Skills"}</button></footer></div>}</div></div>
        <div className="timeline" ref={timelineBody}>{initializing ? <div className="work-switch-loader" role="status"><RefreshCw size={20} className="spin"/><strong>{locale === "zh-CN" ? (switchingWorkId ? "正在切换工作" : "正在恢复工作会话") : (switchingWorkId ? "Switching Work" : "Restoring Work session")}</strong><span>{locale === "zh-CN" ? "工作区可以先查看；Pi、Skills 与 MCP 工具将在后台完成加载。" : "The workspace is available while Pi, Skills, and MCP tools finish loading in the background."}</span>{switchingWorkId && <small>{works.find(work => work.id === switchingWorkId)?.title ?? switchingWorkId}</small>}</div> : timeline.length === 0 ? <div className="agent-empty"><Bug size={30}/><strong>{t.readyAnalysis}</strong><span>{t.readyDesc}</span></div> : timeline.map(item => <article className={`event ${item.kind} ${item.expanded ? "expanded" : "collapsed"}`} key={item.id} onClick={() => item.kind === "tool" && toggleEvent(item.id)}><div className="event-top"><b>{item.kind === "tool" && <ChevronRight size={12}/>} {item.kind === "user" && <UserRound size={12}/>} {item.kind === "tool" ? <ToolGroupTitle item={item} locale={locale}/> : item.title}</b><small>{item.at}</small></div><MessageAttachmentCards attachments={item.attachments} locale={locale} onOpenFile={file => void window.mobileReverse.openArtifact(file)} onOpenText={(content, name) => showTextPreview(content, name)}/>{item.images?.length ? <div className="message-images">{item.images.map((source, index) => { const name = item.imageNames?.[index] || (locale === "zh-CN" ? `图片 ${index + 1}` : `Image ${index + 1}`); return <button type="button" className="message-image-trigger" title={name} onClick={event => { event.stopPropagation(); showImagePreview(source, name); }} key={index}><img src={source} alt={name}/><span>{name}</span></button>; })}</div> : null}{item.kind === "tool" ? (item.expanded && <ToolEventDetails item={item} locale={locale}/>) : (item.body && (item.kind === "assistant" ? <MarkdownMessage content={item.body}/> : <pre>{item.body}</pre>))}{item.status && item.kind !== "tool" && <span className={`event-status ${item.status}`}>{item.status}</span>}</article>)}</div>
        {showTimelineBottomButton && <button type="button" className="timeline-scroll-bottom" title={locale === "zh-CN" ? "跳转到最新消息" : "Jump to latest message"} aria-label={locale === "zh-CN" ? "跳转到最新消息" : "Jump to latest message"} onClick={scrollTimelineToBottom}><ArrowDown size={17}/></button>}
        <PromptQueuePanel items={promptQueue} expanded={queueExpanded} locale={locale} error={queueError} onToggle={() => setQueueExpanded(value => !value)} onMove={(id, direction) => void movePromptInQueue(id, direction)} onEdit={editQueuedPrompt} onDelete={id => void deletePromptFromQueue(id)}/>
        <div className={`composer ${pendingFiles.length || pastedTexts.length ? "has-attachment-strip" : ""} ${pendingImages.length ? "has-image-strip" : ""}`}>
          {(pastedTexts.length > 0 || pendingFiles.length > 0) && <div className="pending-attachments">
            {pastedTexts.map(item => <article className="text-attachment" key={item.id}><button type="button" className="attachment-main" disabled={!canRestorePastedText(item.text)} title={canRestorePastedText(item.text) ? (locale === "zh-CN" ? "将完整文本放回输入框" : "Restore the full text to the composer") : (locale === "zh-CN" ? "超过 25000 字符，仅作为附件发送" : "Over 25,000 characters; send as an attachment only")} onClick={() => restorePastedText(item)}><span className="pasted-text-icon"><Braces size={16}/></span><span><strong>{item.name}</strong><small>{canRestorePastedText(item.text) ? (locale === "zh-CN" ? "在文本框中显示" : "Show in text field") : (locale === "zh-CN" ? `${item.text.length} 字符的大文本` : `${item.text.length} character attachment`)}</small></span><ChevronRight size={13}/></button><button type="button" className="attachment-remove" title={locale === "zh-CN" ? "移除文本附件" : "Remove text attachment"} onClick={() => setPastedTexts(current => current.filter(value => value.id !== item.id))}><X size={12}/></button></article>)}
            {pendingFiles.map(file => <article className="file-attachment" key={file.path}><div className="attachment-main"><FileCode2 size={16}/><span><strong>{file.name}</strong><small>{file.extension || (locale === "zh-CN" ? "文件" : "file")} · {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</small></span></div><button type="button" className="attachment-remove" onClick={() => setPendingFiles(current => current.filter(value => value.path !== file.path))}><X size={12}/></button></article>)}
          </div>}
          {pendingImages.length > 0 && <div className="pending-images">{pendingImages.map((image, index) => { const source = `data:${image.mimeType};base64,${image.data}`; return <div key={`${image.name}-${index}`}><button type="button" className="pending-image-trigger" title={locale === "zh-CN" ? "点击预览图片" : "Preview image"} onClick={() => showImagePreview(source, image.name)}><img src={source} alt={image.name}/></button><button type="button" className="pending-image-remove" title={locale === "zh-CN" ? "移除图片" : "Remove image"} onClick={() => setPendingImages(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12}/></button></div>; })}</div>}
          <div className="composer-row"><input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={event => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ""; }}/><button type="button" className="attach-button" disabled={initializing || !ready} title={locale === "zh-CN" ? "添加文件（支持文档、表格、PDF、压缩包、源码及图片）" : "Attach files, documents, spreadsheets, PDFs, archives, source, or images"} onClick={() => void addFileAttachments()}><Paperclip size={16}/></button><textarea ref={composerInput} disabled={initializing || !ready} value={input} onChange={e => setInput(e.target.value)} onPaste={handleComposerPaste} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPrompt(); } }} placeholder={initializing ? (locale === "zh-CN" ? "正在切换工作会话…" : "Switching Work session…") : (locale === "zh-CN" ? "向 Pi 提问，或粘贴长文本/添加文件…" : "Ask Pi, paste long text, or attach files…")}/><button type="button" onClick={sendPrompt} disabled={initializing || !ready || (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0 && pastedTexts.length === 0)}><Send size={16}/></button></div>
        </div>
      </aside>
    </div>
    <footer className={`global-statusbar ${streaming ? "working" : "idle"}`}><div>{streaming ? <Activity size={13}/> : <Radio size={13}/>}<strong>{streaming ? (locale === "zh-CN" ? "正在执行" : "Working") : (locale === "zh-CN" ? "空闲" : "Idle")}</strong><span>{statusActivity}</span></div><div><span>{caseId ?? t.noCase}</span>{streaming && runStages.length > 0 && <span>{Math.min(currentStageIndex + 1, runStages.length)} / {runStages.length}</span>}</div></footer>
    {imagePreview && createPortal(<div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label={locale === "zh-CN" ? "图片预览" : "Image preview"} onMouseDown={() => setImagePreview(undefined)}><section className="image-preview-dialog" onMouseDown={event => event.stopPropagation()}><header><div><strong title={imagePreview.name}>{imagePreview.name}</strong>{imageActionStatus && <span>{imageActionStatus}</span>}</div><nav><button type="button" onClick={() => void copyPreviewImage()}><Copy size={15}/>{locale === "zh-CN" ? "复制" : "Copy"}</button><button type="button" onClick={downloadPreviewImage}><Download size={15}/>{locale === "zh-CN" ? "下载" : "Download"}</button><button type="button" className="image-preview-close" title={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => setImagePreview(undefined)}><X size={18}/></button></nav></header><div className="image-preview-canvas"><img src={imagePreview.source} alt={imagePreview.name}/></div></section></div>, document.body)}
    {textPreview && createPortal(<div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label={locale === "zh-CN" ? "长文本预览" : "Long text preview"} onMouseDown={() => setTextPreview(undefined)}><section className="image-preview-dialog text-preview-dialog" onMouseDown={event => event.stopPropagation()}><header><div><strong title={textPreview.name}>{textPreview.name}</strong><small>{textPreview.content.length.toLocaleString()} {locale === "zh-CN" ? "字符" : "characters"}</small>{textActionStatus && <span>{textActionStatus}</span>}</div><nav><button type="button" onClick={() => void copyPreviewText()}><Copy size={15}/>{locale === "zh-CN" ? "复制" : "Copy"}</button><button type="button" onClick={downloadPreviewText}><Download size={15}/>{locale === "zh-CN" ? "下载" : "Download"}</button><button type="button" className="image-preview-close" title={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => setTextPreview(undefined)}><X size={18}/></button></nav></header><pre className="text-preview-content">{textPreview.content}</pre></section></div>, document.body)}
    {queueEditor && createPortal(<div className="modal-backdrop" onMouseDown={() => setQueueEditor(undefined)}><section className="settings-modal queue-editor-modal" onMouseDown={event => event.stopPropagation()}><header><div><Pencil size={18}/><strong>{locale === "zh-CN" ? "编辑排队消息" : "Edit queued message"}</strong></div><button onClick={() => setQueueEditor(undefined)}><X size={17}/></button></header><p>{locale === "zh-CN" ? "只修改用户正文；原有图片和文件附件会继续保留。" : "Only the operator text changes; existing images and file attachments remain attached."}</p><textarea autoFocus value={queueEditorText} onChange={event => { setQueueEditorText(event.target.value); setQueueError(""); }} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveQueuedPrompt(); }}/>{queueError && <div className="analysis-error">{queueError}</div>}<footer><button onClick={() => setQueueEditor(undefined)}>{t.cancel}</button><button className="primary" disabled={!queueEditorText.trim()} onClick={() => void saveQueuedPrompt()}>{t.save}</button></footer></section></div>, document.body)}
    {workEditorId && createPortal(<div className="modal-backdrop" onMouseDown={() => !workEditorBusy && setWorkEditorId(undefined)}><section className="settings-modal work-editor-modal" onMouseDown={event => event.stopPropagation()}><header><div><Pencil size={18}/><strong>{locale === "zh-CN" ? "编辑工作" : "Edit Work"}</strong></div><button disabled={workEditorBusy} onClick={() => setWorkEditorId(undefined)}><X size={17}/></button></header><p>{locale === "zh-CN" ? "修改名称和工作分类。分类会同步到对应历史目标和 CASE 当前状态，不会移动或重命名已有工作目录。" : "Change the title and category. The matching history entry and active CASE state are updated without moving the existing Work directory."}</p><label>{locale === "zh-CN" ? "工作名称" : "Work title"}<input autoFocus maxLength={80} value={workEditorTitle} onChange={event => { setWorkEditorTitle(event.target.value); setWorkEditorError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void saveWorkEditor(); } }}/></label><label>{locale === "zh-CN" ? "工作分类" : "Work category"}<select value={workEditorCategory} onChange={event => { setWorkEditorCategory(event.target.value as AnalysisCategory); setWorkEditorError(""); }}>{categorySections.map(section => <optgroup label={locale === "zh-CN" ? section.zh : section.en} key={section.id}>{section.categories.map(category => <option value={category} key={category}>{categoryCopy[locale][category].label}</option>)}</optgroup>)}</select></label><div className="work-editor-category-hint">{categoryCopy[locale][workEditorCategory].description}</div>{workEditorError && <div className="analysis-error">{workEditorError}</div>}<footer><button disabled={workEditorBusy} onClick={() => setWorkEditorId(undefined)}>{t.cancel}</button><button className="primary" disabled={workEditorBusy || !workEditorTitle.trim()} onClick={() => void saveWorkEditor()}>{workEditorBusy ? <RefreshCw size={14} className="spin"/> : <Pencil size={14}/>} {workEditorBusy ? (locale === "zh-CN" ? "保存中" : "Saving") : t.save}</button></footer></section></div>, document.body)}
    {caseEditor && createPortal(<div className="modal-backdrop case-editor-backdrop" onMouseDown={() => !caseEditorBusy && setCaseEditor(undefined)}><section className="settings-modal case-editor-modal" role="dialog" aria-modal="true" aria-labelledby="case-editor-title" onMouseDown={event => event.stopPropagation()}><header><div><Pencil size={18}/><strong id="case-editor-title">{locale === "zh-CN" ? "编辑案例描述" : "Edit case description"}</strong></div><button type="button" disabled={caseEditorBusy} title={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => setCaseEditor(undefined)}><X size={17}/></button></header><p>{locale === "zh-CN" ? `为“${caseEditor.title ?? caseEditor.id}”补充清晰的用途说明，方便在多个案例间快速区分。` : `Describe the purpose of “${caseEditor.title ?? caseEditor.id}” so it is easy to distinguish from other cases.`}</p><label>{locale === "zh-CN" ? "案例描述" : "Case description"}<textarea autoFocus maxLength={240} value={caseEditorDescription} placeholder={locale === "zh-CN" ? "例如：分析设备信息采集路径，并验证重构应用与原应用的行为差异。" : "Example: analyze device-data collection and compare reconstructed behavior."} onChange={event => { setCaseEditorDescription(event.target.value); setCaseEditorError(""); }} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveCaseDescription(); }}/><small className={caseEditorDescription.length >= 220 ? "near-limit" : ""}>{caseEditorDescription.length} / 240</small></label>{caseEditorError && <div className="analysis-error">{caseEditorError}</div>}<footer><span>{locale === "zh-CN" ? "Ctrl + Enter 保存" : "Ctrl + Enter to save"}</span><button type="button" disabled={caseEditorBusy} onClick={() => setCaseEditor(undefined)}>{t.cancel}</button><button type="button" className="primary" disabled={caseEditorBusy} onClick={() => void saveCaseDescription()}>{caseEditorBusy ? <RefreshCw size={14} className="spin"/> : <Pencil size={14}/>} {caseEditorBusy ? (locale === "zh-CN" ? "保存中" : "Saving") : t.save}</button></footer></section></div>, document.body)}
    {caseWizardOpen && createPortal(<div className="modal-backdrop" onMouseDown={() => !caseWizardBusy && setCaseWizardOpen(false)}><section className="settings-modal case-wizard" onMouseDown={event => event.stopPropagation()}><header><div><FolderOpen size={18}/><strong>{caseWizardMode === "create" ? (locale === "zh-CN" ? "创建 CASE" : "Create CASE") : (locale === "zh-CN" ? "添加案例输入" : "Add case input")}</strong></div><button disabled={caseWizardBusy} onClick={() => setCaseWizardOpen(false)}><X size={17}/></button></header>
      {caseId && <div className="case-wizard-mode"><button className={caseWizardMode === "create" ? "selected" : ""} onClick={() => changeCaseWizardMode("create")}>{locale === "zh-CN" ? "创建新案例" : "New case"}</button><button className={caseWizardMode === "add" ? "selected" : ""} onClick={() => changeCaseWizardMode("add")}>{locale === "zh-CN" ? `添加到 ${caseState?.title ?? caseId}` : `Add to ${caseState?.title ?? caseId}`}</button></div>}
      {caseWizardMode === "add" && <p className="case-add-hint">{locale === "zh-CN" ? "为当前 CASE 补充 APK、设备应用、源码工程或分析材料。已有工作、产物和聊天记录不会被清空。" : "Add an APK, device package, source project, or analysis material. Existing Works, artifacts, and chat history are preserved."}</p>}
      <div className="case-source-grid">{([
        ["blank", Braces, locale === "zh-CN" ? "空白 CASE" : "Blank CASE", locale === "zh-CN" ? "先记录需求，后续逐步添加材料" : "Start with requirements and add materials later"],
        ["apk", Smartphone, locale === "zh-CN" ? "安装包" : "Package", "APK / XAPK / APKS"],
        ["device", Radio, locale === "zh-CN" ? "ADB 设备应用" : "ADB package", locale === "zh-CN" ? "从当前设备选择已安装应用" : "Select an installed device package"],
        ["project", FolderOpen, locale === "zh-CN" ? "工程或源码目录" : "Project directory", "Gradle / JADX / AOSP / source"],
        ["materials", Paperclip, locale === "zh-CN" ? "分析材料" : "Analysis materials", "SO / DEX / logs / PCAP / documents"],
      ] as const).filter(([id]) => caseWizardMode === "create" || id !== "blank").map(([id, Icon, label, hint]) => <button type="button" disabled={caseWizardBusy} className={caseSource === id ? "selected" : ""} key={id} onClick={() => void chooseCaseSource(id)}><Icon size={17}/><span><strong>{label}</strong><small>{hint}</small></span>{caseSource === id && <i>✓</i>}</button>)}</div>
      {caseWizardMode === "create" && <div className="case-wizard-fields"><label>{locale === "zh-CN" ? "案例名称" : "Case title"}<input value={caseTitle} onChange={event => setCaseTitle(event.target.value)} placeholder={locale === "zh-CN" ? "例如：Armour 设备信息验证" : "Example: Armour device validation"}/></label><label>{locale === "zh-CN" ? "平台" : "Platform"}<select value={casePlatform} onChange={event => setCasePlatform(event.target.value as CasePlatform)}><option value="android">Android</option><option value="native">Native</option><option value="protocol">Protocol</option><option value="general">General</option></select></label><label className="wide">{locale === "zh-CN" ? "案例描述" : "Description"}<textarea value={caseDescription} onChange={event => setCaseDescription(event.target.value)} placeholder={locale === "zh-CN" ? "简单说明这个 CASE 要解决什么问题…" : "What should this case accomplish?"}/></label></div>}
      {(["apk", "project", "materials"] as CaseSourceKind[]).includes(caseSource) && <div className={`case-source-selection ${caseSourcePaths.length ? "has-selection" : "empty"}`}><div><strong>{caseSourcePaths.length ? (locale === "zh-CN" ? `已选择 ${caseSourcePaths.length} 项` : `${caseSourcePaths.length} selected`) : (locale === "zh-CN" ? "尚未选择输入" : "No input selected")}</strong>{caseSourcePaths.length ? caseSourcePaths.map(item => <span title={item} key={item}>{item}</span>) : <span>{caseSource === "apk" ? (locale === "zh-CN" ? "请选择要补充到当前 CASE 的 APK、XAPK 或 APKS 文件。" : "Choose an APK, XAPK, or APKS file to add to this CASE.") : caseSource === "project" ? (locale === "zh-CN" ? "请选择工程或源码目录。" : "Choose a project or source directory.") : (locale === "zh-CN" ? "请选择一个或多个分析材料文件。" : "Choose one or more analysis material files.")}</span>}</div><button type="button" disabled={caseWizardBusy} onClick={() => void chooseCaseSource(caseSource)}><FolderOpen size={13}/>{caseSourcePaths.length ? (locale === "zh-CN" ? "重新选择" : "Change") : caseSource === "project" ? (locale === "zh-CN" ? "选择目录" : "Choose directory") : (locale === "zh-CN" ? "选择文件" : "Choose files")}</button></div>}
      {caseSource === "device" && <div className="adb-package-picker">{caseWizardBusy ? <span>{locale === "zh-CN" ? "正在读取 ADB 应用…" : "Reading ADB packages…"}</span> : adbPackages.length ? <><input autoFocus value={adbPackageFilter} aria-label={locale === "zh-CN" ? "筛选 ADB 应用" : "Filter ADB packages"} placeholder={locale === "zh-CN" ? "输入包名、设备型号或序列号筛选" : "Filter by package, model, or serial"} onChange={event => { const value = event.target.value; const visible = filterAdbPackages(adbPackages, value); setAdbPackageFilter(value); if (selectedAdbPackage && !visible.some(item => `${item.serial}|${item.packageName}` === selectedAdbPackage)) setSelectedAdbPackage(""); }} onKeyDown={event => { if (event.key !== "Enter" || !visibleAdbPackages[0]) return; event.preventDefault(); const item = visibleAdbPackages[0]; const value = `${item.serial}|${item.packageName}`; setSelectedAdbPackage(value); if (caseWizardMode === "create") setCaseTitle(current => current || item.packageName); }}/><select size={6} value={selectedAdbPackage} aria-label={locale === "zh-CN" ? "ADB 应用列表" : "ADB package list"} onChange={event => { setSelectedAdbPackage(event.target.value); if (caseWizardMode === "create") setCaseTitle(current => current || event.target.value.split("|").at(-1)!); }}>{visibleAdbPackages.length ? visibleAdbPackages.map(item => <option value={`${item.serial}|${item.packageName}`} key={`${item.serial}-${item.packageName}`}>{item.packageName} · {item.model ?? item.serial}</option>) : <option value="" disabled>{locale === "zh-CN" ? "没有匹配的应用" : "No matching packages"}</option>}</select><span>{locale === "zh-CN" ? `显示 ${visibleAdbPackages.length} / ${adbPackages.length} 个应用` : `Showing ${visibleAdbPackages.length} of ${adbPackages.length} packages`}</span></> : null}</div>}
      {caseWizardError && <div className="analysis-error">{caseWizardError}</div>}
      <footer><button disabled={caseWizardBusy} onClick={() => setCaseWizardOpen(false)}>{t.cancel}</button><button className="primary" disabled={caseWizardBusy || (caseWizardMode === "create" && !caseTitle.trim()) || (caseWizardMode === "add" && (caseSource === "blank" || (!caseSourcePaths.length && !selectedAdbPackage)))} onClick={() => void submitCaseWizard()}>{caseWizardBusy ? (locale === "zh-CN" ? "处理中…" : "Working…") : caseWizardMode === "create" ? (locale === "zh-CN" ? "创建并打开" : "Create and open") : (locale === "zh-CN" ? "添加到案例" : "Add to case")}</button></footer>
    </section></div>, document.body)}
    {installOpen && createPortal(<div className="modal-backdrop" onMouseDown={() => !installLoading && setInstallOpen(false)}><section className="settings-modal install-modal" onMouseDown={event => event.stopPropagation()}><header><div><Smartphone size={18}/><strong>{locale === "zh-CN" ? "安装工作产物" : "Install work artifact"}</strong></div><button disabled={installLoading} onClick={() => setInstallOpen(false)}><X size={17}/></button></header><p>{locale === "zh-CN" ? "选择本次要安装的 APK 和目标设备。确认后将在后台安装，完成结果会显示在工作目录卡片中。" : "Choose an APK and target device. Installation runs in the background and reports the result on the work directory card."}</p>{installLoading ? <div className="install-loading"><RefreshCw size={16} className="spin"/>{locale === "zh-CN" ? "正在检测 ADB 设备并扫描 APK…" : "Detecting ADB devices and scanning APKs…"}</div> : <div className="install-fields"><label>{locale === "zh-CN" ? `目标设备${installDevices.filter(device => device.state === "device").length > 1 ? "（已连接多台）" : ""}` : "Target device"}<select value={selectedInstallDevice} onChange={event => setSelectedInstallDevice(event.target.value)}>{installDevices.map(device => <option disabled={device.state !== "device"} value={device.serial} key={device.serial}>{device.model ?? device.serial} · {device.serial} · {device.state}</option>)}</select></label><label>{locale === "zh-CN" ? "APK 产物" : "APK artifact"}<select value={selectedInstallApk} onChange={event => setSelectedInstallApk(event.target.value)}>{installApks.map(apkItem => <option value={apkItem.path} key={apkItem.path}>{apkItem.name} · {(apkItem.size / 1024 / 1024).toFixed(1)} MB · {new Date(apkItem.modifiedAt).toLocaleString(locale)}</option>)}</select></label>{selectedInstallApk && <code title={selectedInstallApk}>{selectedInstallApk}</code>}</div>}{installError && <div className="analysis-error">{installError}</div>}<footer><button disabled={installLoading} onClick={() => setInstallOpen(false)}>{t.cancel}</button><button className="primary" disabled={installLoading || !selectedInstallDevice || !selectedInstallApk} onClick={() => void confirmWorkInstall()}><Smartphone size={14}/>{locale === "zh-CN" ? "开始安装" : "Install"}</button></footer></section></div>, document.body)}
    {outputOpen && createPortal(<div className="modal-backdrop" onMouseDown={() => settings.outputRoot && setOutputOpen(false)}><section className="settings-modal output-modal" onMouseDown={event => event.stopPropagation()}><header><div><FolderOpen size={18}/><strong>{analysisText.outputRoot}</strong></div>{settings.outputRoot && <button onClick={() => setOutputOpen(false)}><X size={17}/></button>}</header><p>{analysisText.outputHint}</p><label>{analysisText.outputRoot}<div className="output-picker"><input readOnly value={settings.outputRoot} placeholder="D:\\reverse-results"/><button type="button" onClick={() => void chooseOutputRoot()}>{analysisText.browse}</button></div></label>{outputError && <div className="analysis-error">{analysisText.outputRequired}</div>}<footer><button className="primary" disabled={!settings.outputRoot.trim()} onClick={() => void saveOutputSettings()}>{t.save}</button></footer></section></div>, document.body)}
    {casesOpen && createPortal(<div className="modal-backdrop" onMouseDown={() => setCasesOpen(false)}><section className="settings-modal case-manager" onMouseDown={event => event.stopPropagation()}>
      <header><div><FolderOpen size={18}/><strong>{locale === "zh-CN" ? "切换案例" : "Switch case"}</strong></div><button onClick={() => setCasesOpen(false)}><X size={17}/></button></header>
      <p>{locale === "zh-CN" ? "案例会保留完整历史和产物。描述可用于区分同一应用的不同分析目的。删除会将完整案例目录移到 Windows 回收站。" : "Cases preserve their complete history and artifacts. Descriptions distinguish different goals for the same app. Deleting moves the complete directory to the Recycle Bin."}</p>
      {caseListError && <div className="analysis-error">{caseListError}</div>}
      <div className="case-list">{casesLoading ? <p>{locale === "zh-CN" ? "正在扫描结果目录…" : "Scanning result directories…"}</p> : cases.length ? cases.map(item => <article className={item.id === caseId ? "active" : ""} key={item.id}>
        <button type="button" className="case-select" onClick={() => void selectCase(item.id)}><div><strong>{item.title ?? item.id}</strong><span>{item.inputCount ? `${item.inputCount} ${locale === "zh-CN" ? "项输入" : "inputs"} · ${item.platform ?? "android"}` : item.target?.split(/[\\/]/).pop() ?? (locale === "zh-CN" ? "空白案例" : "Blank case")}</span><CaseWorkTags summary={item} locale={locale}/><p>{item.description || (locale === "zh-CN" ? "暂无案例描述" : "No case description")}</p></div><div><small>{item.works?.length ?? (item.analysisCategory ? 1 : 0)} {locale === "zh-CN" ? "个工作" : "works"}</small><time>{new Date(item.updatedAt).toLocaleString(locale)}</time><em>{item.artifactCount} {locale === "zh-CN" ? "项产物" : "artifacts"}</em></div></button>
        <div className="case-row-actions"><button type="button" title={locale === "zh-CN" ? "编辑描述" : "Edit description"} onClick={event => { event.stopPropagation(); editCaseDescription(item); }}><Pencil size={14}/></button><button type="button" disabled={Object.entries(sessionActivity).some(([key, activity]) => key.startsWith(`${item.id}:`) && activity.streaming)} title={locale === "zh-CN" ? "删除案例" : "Delete case"} onClick={event => { event.stopPropagation(); void deleteCase(item.id); }}><Trash2 size={15}/></button></div>
      </article>) : <p>{locale === "zh-CN" ? "当前结果目录中没有发现案例。" : "No cases were found in the current output directory."}</p>}</div>
    </section></div>, document.body)}
    {skillManagerOpen && <div className="modal-backdrop" onMouseDown={() => setSkillManagerOpen(false)}><section className="settings-modal skill-manager" onMouseDown={event => event.stopPropagation()}><header><div><BookOpen size={18}/><strong>{locale === "zh-CN" ? "Skills 管理" : "Skill manager"}</strong></div><button onClick={() => setSkillManagerOpen(false)}><X size={17}/></button></header><p>{locale === "zh-CN" ? "“内置/已安装”表示 Pi 已经可以选用，不表示本会话已经激活。第三方 Skill 会安装到 .pi/skills；安装前请核对来源和其中的脚本。" : "Bundled/Installed means Pi can use the skill; it does not mean the current session activated it. Third-party skills live under .pi/skills. Review their source and scripts."}</p><div className="skill-search"><input value={skillQuery} onChange={event => setSkillQuery(event.target.value)} onKeyDown={event => event.key === "Enter" && void findSkills()} placeholder={locale === "zh-CN" ? "搜索名称、说明，或粘贴 GitHub Skill 目录 URL" : "Search names/descriptions or paste a GitHub skill directory URL"}/><button onClick={() => void findSkills()} disabled={Boolean(skillBusy)}><RefreshCw size={14} className={skillBusy === "search" ? "spin" : ""}/>{locale === "zh-CN" ? "搜索" : "Search"}</button>{/^https:\/\/github\.com\//i.test(skillQuery.trim()) && <button className="install-url" onClick={() => void addSkill(skillQuery.trim())} disabled={Boolean(skillBusy)}>{locale === "zh-CN" ? "安装 URL" : "Install URL"}</button>}</div>{skillError && <div className="analysis-error">{skillError}</div>}<div className="skill-results">{skillBusy === "list" ? <p>{locale === "zh-CN" ? "正在读取 Skills…" : "Loading skills…"}</p> : skillResults.length ? skillResults.map(skill => <article key={`${skill.source}-${skill.id}`}><BookOpen size={17}/><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.source === "bundled" ? (locale === "zh-CN" ? "内置" : "Bundled") : skill.source === "installed" ? (locale === "zh-CN" ? "已安装" : "Installed") : skill.repository}</small></div><button disabled={skill.installed || Boolean(skillBusy)} onClick={() => void addSkill(skill.id)}>{skill.installed ? (skill.source === "bundled" ? (locale === "zh-CN" ? "内置" : "Bundled") : (locale === "zh-CN" ? "已安装" : "Installed")) : skillBusy === skill.id ? (locale === "zh-CN" ? "安装中" : "Installing") : (locale === "zh-CN" ? "安装" : "Install")}</button></article>) : <p>{locale === "zh-CN" ? "没有匹配的 Skill。可以粘贴 GitHub 中包含 SKILL.md 的目录地址。" : "No matching skill. Paste a GitHub directory URL containing SKILL.md."}</p>}</div></section></div>}
    {analysisOpen && <div className="modal-backdrop" onMouseDown={() => setAnalysisOpen(false)}><section className="settings-modal analysis-modal" onMouseDown={event => event.stopPropagation()}>
      <header><div><Activity size={18}/><strong>{analysisText.title}</strong></div><button onClick={() => setAnalysisOpen(false)}><X size={17}/></button></header>
      <p className="analysis-intro">{analysisText.hint}</p>
      {analysisHistory.length > 0 && <details className="analysis-history"><summary><span>{analysisText.recent}</span><small>{analysisHistory.length}</small><ChevronDown size={14}/></summary><div>{analysisHistory.map(request => <article key={request.id}><button type="button" className="history-reuse" onClick={() => { setAnalysisGoal(request.goal); setAnalysisImages([]); setAnalysisPastedTexts([]); if (request.category) setAnalysisCategory(request.category); setAnalysisError(""); }}><time>{new Date(request.createdAt).toLocaleString(locale)}</time><span>{request.goal}</span><small>{request.category ? categoryCopy[locale][request.category].label : analysisText.reuse}</small></button><button type="button" className="history-delete" title={locale === "zh-CN" ? "删除历史记录" : "Delete history entry"} onClick={() => void deleteAnalysisRequest(request.id)}><Trash2 size={13}/></button></article>)}</div></details>}
      <div className="analysis-section-tabs" role="tablist" aria-label={locale === "zh-CN" ? "功能分组" : "Feature groups"}>{categorySections.map(section => <button type="button" role="tab" aria-selected={analysisSection === section.id} className={analysisSection === section.id ? "selected" : ""} key={section.id} onClick={() => { setAnalysisSection(section.id); if (!section.categories.includes(analysisCategory)) setAnalysisCategory(section.categories[0]!); }}><strong>{locale === "zh-CN" ? section.zh : section.en}</strong><small>{section.categories.length}</small></button>)}</div>
      <div className="analysis-workbench">
        <nav className="analysis-categories" aria-label={locale === "zh-CN" ? "工作分类" : "Work categories"}><header><strong>{locale === "zh-CN" ? categorySections.find(section => section.id === analysisSection)?.zh : categorySections.find(section => section.id === analysisSection)?.en}</strong><span>{locale === "zh-CN" ? categorySections.find(section => section.id === analysisSection)?.descriptionZh : categorySections.find(section => section.id === analysisSection)?.descriptionEn}</span></header><div>{categorySections.find(section => section.id === analysisSection)!.categories.map(category => <button type="button" className={analysisCategory === category ? "selected" : ""} key={category} onClick={() => setAnalysisCategory(category)}><span><strong>{categoryCopy[locale][category].label}</strong><small>{categoryCopy[locale][category].description}</small></span><ChevronRight size={13}/></button>)}</div></nav>
        <div className={`analysis-objective ${analysisImages.length || analysisPastedTexts.length ? "has-request-attachments" : ""}`}><div className="analysis-category-detail"><strong>{categoryCopy[locale][analysisCategory].label}</strong><span>{categoryCopy[locale][analysisCategory].description}</span></div>{categoryInputAdvisory(analysisCategory, caseState?.inputs, locale) && <div className="analysis-input-advisory">{categoryInputAdvisory(analysisCategory, caseState?.inputs, locale)}</div>}<label>{analysisText.title}<textarea autoFocus value={analysisGoal} onChange={event => { setAnalysisGoal(event.target.value); setAnalysisError(""); }} onPaste={handleAnalysisPaste} placeholder={locale === "zh-CN" ? `${analysisText.placeholder}\n\n也可以直接粘贴图片或长文本。` : `${analysisText.placeholder}\n\nYou can also paste images or long text.`}/></label><div className="analysis-attachment-actions"><input ref={analysisImageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={event => { void addAnalysisImages(Array.from(event.target.files ?? [])); event.target.value = ""; }}/><button type="button" onClick={() => analysisImageInput.current?.click()}><Paperclip size={13}/>{locale === "zh-CN" ? "添加图片" : "Add images"}</button><span>{locale === "zh-CN" ? "可直接粘贴图片或长文本；长文本会自动转为附件" : "Paste images or long text; long text becomes an attachment"}</span></div>{(analysisPastedTexts.length > 0 || analysisImages.length > 0) && <div className="analysis-request-materials">{analysisPastedTexts.map(item => <article className="analysis-text-attachment" key={item.id}><button type="button" className="attachment-main" title={locale === "zh-CN" ? "查看完整文本" : "Preview full text"} onClick={() => showTextPreview(item.text, item.name)}><span className="pasted-text-icon"><Braces size={15}/></span><span><strong title={item.name}>{item.name}</strong><small>{item.text.length.toLocaleString()} {locale === "zh-CN" ? "字符" : "characters"}</small></span><ChevronRight size={12}/></button><button type="button" className="attachment-remove" title={locale === "zh-CN" ? "移除长文本" : "Remove long text"} onClick={() => setAnalysisPastedTexts(current => current.filter(value => value.id !== item.id))}><X size={11}/></button></article>)}{analysisImages.map((image, index) => { const source = `data:${image.mimeType};base64,${image.data}`; return <article className="analysis-image-attachment" key={`${image.name}-${index}`}><button type="button" className="attachment-main" title={locale === "zh-CN" ? "预览图片" : "Preview image"} onClick={() => showImagePreview(source, image.name)}><img src={source} alt={image.name}/><span title={image.name}>{image.name}</span></button><button type="button" className="attachment-remove" title={locale === "zh-CN" ? "移除图片" : "Remove image"} onClick={() => setAnalysisImages(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={11}/></button></article>; })}</div>}{analysisError && <div className="analysis-error">{analysisError}</div>}</div>
      </div>
      <footer><button onClick={() => setAnalysisOpen(false)}>{t.cancel}</button><button className="primary" disabled={!canSubmitWorkRequest(analysisGoal, analysisImages.length > 0 || analysisPastedTexts.length > 0)} onClick={() => void start()}><Play size={15}/>{analysisText.submit}</button></footer>
    </section></div>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="settings-modal" onMouseDown={e => e.stopPropagation()}><header><div><Settings size={18}/><strong>{t.settings}</strong></div><button onClick={() => setSettingsOpen(false)}><X size={17}/></button></header><p>{t.settingsHint}</p><label>{t.host}<input value={settings.baseUrl} onChange={e => { setSettings({ ...settings, baseUrl: e.target.value }); setModelOptions([]); setModelMessage(""); setModelMenuOpen(false); setModelFilter(""); }} placeholder="https://api.example.com/v1"/></label><label>{t.apiKey}<input type="password" value={settings.apiKey} onChange={e => { setSettings({ ...settings, apiKey: e.target.value }); setModelOptions([]); setModelMessage(""); setModelMenuOpen(false); setModelFilter(""); }} placeholder="sk-…"/></label><label>{t.modelId}<div className="model-selector"><div className="model-combobox"><input value={settings.modelId} onFocus={() => { if (modelOptions.length) { setModelFilter(""); setModelMenuOpen(true); } }} onChange={e => { setSettings({ ...settings, modelId: e.target.value }); setModelFilter(e.target.value); setModelMenuOpen(true); }} onKeyDown={e => { if (e.key === "Escape") setModelMenuOpen(false); if (e.key === "ArrowDown") { setModelFilter(""); setModelMenuOpen(true); } if (e.key === "Enter" && modelMenuOpen && filteredModels[0]) { e.preventDefault(); setSettings({ ...settings, modelId: filteredModels[0] }); setModelFilter(""); setModelMenuOpen(false); } }} placeholder="gpt-5.1-codex"/><button type="button" className="model-caret" disabled={modelOptions.length === 0} onClick={() => { setModelFilter(""); setModelMenuOpen(open => !open); }}><ChevronDown size={15}/></button>{modelMenuOpen && modelOptions.length > 0 && <div className="model-dropdown">{filteredModels.length ? filteredModels.map(id => <button type="button" className={id === settings.modelId ? "selected" : ""} key={id} onMouseDown={e => e.preventDefault()} onClick={() => { setSettings({ ...settings, modelId: id }); setModelFilter(""); setModelMenuOpen(false); }}>{id}<span>{id === settings.modelId ? "✓" : ""}</span></button>) : <div className="model-dropdown-empty">No matching models</div>}</div>}</div><button type="button" title={t.refreshModels} disabled={!settings.baseUrl.trim() || !settings.apiKey.trim() || modelsLoading} onClick={refreshModels}><RefreshCw size={15} className={modelsLoading ? "spin" : ""}/><span>{t.refreshModels}</span></button></div></label>{(modelsLoading || modelMessage) && <div className={`model-message ${modelMessage && modelOptions.length === 0 ? "error" : ""}`}>{modelsLoading ? t.refreshing : modelMessage}</div>}<footer><button onClick={() => setSettingsOpen(false)}>{t.cancel}</button><button className="primary" onClick={saveModelSettings}>{t.save}</button></footer></section></div>}
  </div>;
}

function ToolGroupTitle({ item, locale }: { item: TimelineItem; locale: Locale }) {
  const details = item.toolDetails ?? [{ title: item.title, body: item.body, output: item.output, status: item.status, at: item.at }];
  const counts = details.reduce((result, detail) => { result[toolAction(detail).kind] += 1; return result; }, { read: 0, write: 0, command: 0 });
  const parts = locale === "zh-CN"
    ? [counts.read && `读取 ${counts.read} 个文件`, counts.write && `写入 ${counts.write} 个文件`, counts.command && `运行 ${counts.command} 个命令`]
    : [counts.read && `Read ${counts.read} files`, counts.write && `Wrote ${counts.write} files`, counts.command && `Ran ${counts.command} commands`];
  const state = item.status === "running" ? (locale === "zh-CN" ? "执行中" : "Running") : item.status === "failed" ? (locale === "zh-CN" ? "含失败" : "Has failures") : "";
  return <>{parts.filter(Boolean).join(" · ")}{state ? ` · ${state}` : ""}</>;
}

function MessageAttachmentCards({ attachments, locale, onOpenFile, onOpenText }: { attachments?: HistoryMessageAttachment[]; locale: Locale; onOpenFile: (path: string) => void; onOpenText: (content: string, name: string) => void }) {
  if (!attachments?.length) return null;
  return <div className="message-attachments">{attachments.map((attachment, index) => {
    const canOpen = Boolean(attachment.path || attachment.content !== undefined);
    const content = <><span className="message-attachment-icon">{attachment.kind === "text" ? <Braces size={15}/> : <FileCode2 size={15}/>}</span><span><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.detail || (attachment.kind === "text" ? (locale === "zh-CN" ? "粘贴的长文本" : "Pasted text") : (locale === "zh-CN" ? "附件文件" : "Attached file"))}</small></span>{canOpen && <ChevronRight size={13}/>}</>;
    return canOpen
      ? <button type="button" title={attachment.content !== undefined ? (locale === "zh-CN" ? "打开完整文本" : "Open full text") : (locale === "zh-CN" ? "使用系统默认应用打开" : "Open with the system default application")} onClick={event => { event.stopPropagation(); if (attachment.content !== undefined) onOpenText(attachment.content, attachment.name); else if (attachment.path) onOpenFile(attachment.path); }} key={`${attachment.kind}-${attachment.name}-${index}`}>{content}</button>
      : <article key={`${attachment.kind}-${attachment.name}-${index}`}>{content}</article>;
  })}</div>;
}

function PromptQueuePanel({ items, expanded, locale, error, onToggle, onMove, onEdit, onDelete }: { items: PromptQueueItemView[]; expanded: boolean; locale: Locale; error?: string; onToggle: () => void; onMove: (id: string, direction: "up" | "down") => void; onEdit: (item: PromptQueueItemView) => void; onDelete: (id: string) => void }) {
  if (!items.length) return null;
  const queued = items.filter(item => item.status === "queued");
  return <section className={`prompt-queue ${expanded ? "expanded" : "collapsed"}`}><button type="button" className="prompt-queue-head" onClick={onToggle}><ChevronRight size={13}/><strong>{locale === "zh-CN" ? `任务队列 · ${items.length}` : `Task queue · ${items.length}`}</strong><span>{items.some(item => item.status === "running") ? (locale === "zh-CN" ? "正在执行" : "Running") : (locale === "zh-CN" ? "等待执行" : "Waiting")}</span></button>{expanded && <div className="prompt-queue-list">{items.map(item => { const queueIndex = queued.findIndex(value => value.id === item.id); return <article className={item.status} key={item.id}><i>{item.status === "running" ? <RefreshCw size={13} className="spin"/> : queueIndex + 1}</i><div><strong>{item.displayText}</strong><small>{item.imageCount ? `${item.imageCount} ${locale === "zh-CN" ? "张图片 · " : "images · "}` : ""}{new Date(item.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</small></div>{item.status === "queued" && <nav><button type="button" disabled={queueIndex <= 0} title={locale === "zh-CN" ? "上移" : "Move up"} onClick={() => onMove(item.id, "up")}><ArrowUp size={12}/></button><button type="button" disabled={queueIndex >= queued.length - 1} title={locale === "zh-CN" ? "下移" : "Move down"} onClick={() => onMove(item.id, "down")}><ArrowDown size={12}/></button><button type="button" title={locale === "zh-CN" ? "重新编辑" : "Edit"} onClick={() => onEdit(item)}><Pencil size={12}/></button><button type="button" title={locale === "zh-CN" ? "删除" : "Delete"} onClick={() => onDelete(item.id)}><Trash2 size={12}/></button></nav>}</article>; })}{error && <div className="prompt-queue-error">{error}</div>}</div>}</section>;
}

function ToolEventDetails({ item, locale }: { item: TimelineItem; locale: Locale }) {
  const details = item.toolDetails ?? [{ id: item.id, title: item.title, body: item.body, output: item.output, status: item.status, at: item.at }];
  const [openDetails, setOpenDetails] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string>();
  const toggle = (id: string) => setOpenDetails(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const copyDetail = async (id: string, detail: ToolDetail) => {
    await navigator.clipboard.writeText([detail.body && `INPUT\n${detail.body}`, detail.output && `OUTPUT\n${detail.output}`].filter(Boolean).join("\n\n"));
    setCopied(id); window.setTimeout(() => setCopied(value => value === id ? undefined : value), 1200);
  };
  return <div className="tool-detail-list" onClick={event => event.stopPropagation()}>{details.map((detail, index) => {
    const id = detail.id ?? `${detail.title}-${detail.at}-${index}`;
    const action = toolAction(detail);
    const expanded = openDetails.has(id);
    const label = action.kind === "read" ? (locale === "zh-CN" ? "读取" : "Read") : action.kind === "write" ? (locale === "zh-CN" ? "写入" : "Write") : (locale === "zh-CN" ? "运行" : "Ran");
    return <section className={`tool-detail ${action.kind} ${expanded ? "expanded" : "collapsed"}`} key={id}><button type="button" className="tool-summary" onClick={() => toggle(id)}><ChevronRight size={12}/><span><b>{label}</b> {action.subject}</span><time>{detail.at}</time><i className={detail.status === "failed" ? "failed" : "done"}>{detail.status === "failed" ? "✕" : "✓"}</i></button>{expanded && <div className="tool-full-detail"><button type="button" className="tool-copy" title={locale === "zh-CN" ? "复制完整内容" : "Copy full content"} onClick={() => void copyDetail(id, detail)}><Copy size={13}/>{copied === id ? (locale === "zh-CN" ? "已复制" : "Copied") : (locale === "zh-CN" ? "复制" : "Copy")}</button>{detail.body && <div><label>{action.kind === "command" ? "COMMAND / INPUT" : "INPUT"}</label><pre>{detail.body}</pre></div>}{detail.output && <div><label>OUTPUT</label><pre>{detail.output}</pre></div>}<footer className={detail.status === "failed" ? "failed" : "done"}>{detail.status === "failed" ? "✕ FAILED" : "✓ DONE"}</footer></div>}</section>;
  })}</div>;
}

function IntegratedTerminal({ visible, locale, caseId, tabs, activeId, onSelect, onNew, onClose, onWrite, onResize, onReady, onCopy, onClear }: { visible: boolean; locale: Locale; caseId?: string; tabs: TerminalTab[]; activeId?: string; onSelect: (id: string) => void; onNew: () => void; onClose: (id: string) => void; onWrite: (id: string, data: string) => void; onResize: (id: string, cols: number, rows: number) => void; onReady: (id: string, handle?: XtermHandle) => void; onCopy: (id: string) => void; onClear: (id: string) => void }) {
  const activeTab = tabs.find(tab => tab.id === activeId) ?? tabs[0];
  const [quickCommands, setQuickCommands] = useState<TerminalQuickCommand[]>(() => parseTerminalQuickCommands(localStorage.getItem("seagull.terminalQuickCommands")));
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickCommand, setQuickCommand] = useState("");
  const [editingQuickId, setEditingQuickId] = useState<string>();
  const [quickScope, setQuickScope] = useState<"global" | "case">("global");
  const [quickFilter, setQuickFilter] = useState<TerminalQuickCommandFilter>("available");
  const [quickSearch, setQuickSearch] = useState("");
  const [quickPaletteOpen, setQuickPaletteOpen] = useState(false);
  const [quickPaletteSearch, setQuickPaletteSearch] = useState("");
  const [quickPaletteIndex, setQuickPaletteIndex] = useState(0);
  const quickMenu = useRef<HTMLDivElement>(null);
  const terminalRoot = useRef<HTMLDivElement>(null);
  const quickPaletteInput = useRef<HTMLInputElement>(null);

  const availableQuickCommands = useMemo(() => filterTerminalQuickCommands(quickCommands, caseId, "available"), [quickCommands, caseId]);
  const visibleQuickCommands = useMemo(() => filterTerminalQuickCommands(quickCommands, caseId, quickFilter, quickSearch), [quickCommands, caseId, quickFilter, quickSearch]);
  const paletteQuickCommands = useMemo(() => filterTerminalQuickCommands(quickCommands, caseId, "available", quickPaletteSearch), [quickCommands, caseId, quickPaletteSearch]);
  const globalQuickCount = useMemo(() => quickCommands.filter(item => item.scope === "global").length, [quickCommands]);
  const caseQuickCount = useMemo(() => quickCommands.filter(item => item.scope === "case" && item.caseId === caseId).length, [quickCommands, caseId]);

  useEffect(() => { localStorage.setItem("seagull.terminalQuickCommands", JSON.stringify(quickCommands)); }, [quickCommands]);
  useEffect(() => {
    if (!visible) setQuickPaletteOpen(false);
  }, [visible]);
  useEffect(() => {
    if (!quickPaletteOpen) return;
    setQuickPaletteIndex(0);
    window.setTimeout(() => quickPaletteInput.current?.focus(), 0);
  }, [quickPaletteOpen, quickPaletteSearch]);
  useEffect(() => {
    if (!visible) return;
    const openPalette = (event: KeyboardEvent) => {
      if (!isTerminalQuickCommandShortcut(event) || !terminalRoot.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      setQuickOpen(false);
      setQuickPaletteSearch("");
      setQuickPaletteIndex(0);
      setQuickPaletteOpen(true);
    };
    document.addEventListener("keydown", openPalette, true);
    return () => document.removeEventListener("keydown", openPalette, true);
  }, [visible]);
  useEffect(() => {
    if (!quickOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!quickMenu.current?.contains(event.target as Node)) setQuickOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setQuickOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [quickOpen]);

  const resetQuickEditor = () => { setQuickEditorOpen(false); setEditingQuickId(undefined); setQuickName(""); setQuickCommand(""); setQuickScope("global"); };
  const createQuickCommand = () => { setEditingQuickId(undefined); setQuickName(""); setQuickCommand(""); setQuickScope(quickFilter === "case" && caseId ? "case" : "global"); setQuickEditorOpen(true); };
  const editQuickCommand = (item: TerminalQuickCommand) => { setEditingQuickId(item.id); setQuickName(item.name); setQuickCommand(item.command); setQuickScope(item.scope); setQuickEditorOpen(true); };
  const saveQuickCommand = () => {
    const name = quickName.trim();
    const command = quickCommand.trim();
    if (!name || !command) return;
    setQuickCommands(current => editingQuickId
      ? current.map(item => item.id === editingQuickId ? { ...item, name, command, scope: quickScope, caseId: quickScope === "case" ? caseId : undefined } : item)
      : [...current, { id: crypto.randomUUID(), name, command, scope: quickScope, caseId: quickScope === "case" ? caseId : undefined }].slice(-500));
    resetQuickEditor();
  };
  const runQuickCommand = (item: TerminalQuickCommand) => {
    if (!activeTab || activeTab.status !== "running") return;
    onWrite(activeTab.id, terminalCommandPayload(item.command));
    setQuickOpen(false);
    setQuickPaletteOpen(false);
  };

  return <div className="integrated-terminal" ref={terminalRoot}>
    <header>
      <div className="integrated-terminal-tabs">
        {tabs.map((tab, index) => <div className={`terminal-tab-item ${tab.id === activeTab?.id ? "active" : ""}`} key={tab.id}>
          <button type="button" className="terminal-tab-select" onClick={() => onSelect(tab.id)} title={tab.cwd}><TerminalSquare size={12}/><span>{tab.title || `${locale === "zh-CN" ? "终端" : "Terminal"} ${index + 1}`}</span><i className={tab.status}/></button>
          <button type="button" className="terminal-tab-close" title={locale === "zh-CN" ? "关闭终端" : "Close terminal"} onClick={() => onClose(tab.id)}><X size={11}/></button>
        </div>)}
        <button type="button" className="terminal-new" onClick={onNew} title={locale === "zh-CN" ? "在当前工作目录新建终端" : "New terminal in the current work directory"}>+</button>
      </div>
      <nav>
        <div className="terminal-quick-menu" ref={quickMenu}>
          <button type="button" className={quickOpen ? "active" : ""} title={locale === "zh-CN" ? "管理快捷命令；终端内按 Ctrl+K 快速执行" : "Manage quick commands; press Ctrl+K in the terminal to run one"} onClick={() => { setQuickOpen(value => !value); if (!quickCommands.length) setQuickEditorOpen(true); }}><Bookmark size={12}/>{locale === "zh-CN" ? "快捷命令" : "Quick commands"}<small>{availableQuickCommands.length}</small></button>
          {quickOpen && <section className="terminal-quick-popover">
            <header><div><Bookmark size={16}/><span><strong>{locale === "zh-CN" ? "快捷命令管理" : "Quick command manager"}</strong><small>{locale === "zh-CN" ? "全局命令跨案例可用，CASE 命令仅属于当前案例" : "Global commands work everywhere; CASE commands stay with this case"}</small></span></div><button type="button" onClick={createQuickCommand}>+ {locale === "zh-CN" ? "新增命令" : "Add command"}</button></header>
            <div className="terminal-quick-toolbar"><div className="terminal-quick-filters">{(["available", "global", "case"] as TerminalQuickCommandFilter[]).map(filter => <button type="button" className={quickFilter === filter ? "selected" : ""} disabled={filter === "case" && !caseId} onClick={() => setQuickFilter(filter)} key={filter}><span>{filter === "available" ? (locale === "zh-CN" ? "当前可用" : "Available") : filter === "global" ? (locale === "zh-CN" ? "全局" : "Global") : "CASE"}</span><small>{filter === "available" ? availableQuickCommands.length : filter === "global" ? globalQuickCount : caseQuickCount}</small></button>)}</div><div className="terminal-quick-search"><span>⌕</span><input value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder={locale === "zh-CN" ? "搜索名称或命令…" : "Search name or command…"}/>{quickSearch && <button type="button" title={locale === "zh-CN" ? "清空搜索" : "Clear search"} onClick={() => setQuickSearch("")}><X size={12}/></button>}</div></div>
            {quickEditorOpen && <div className="terminal-quick-editor">
              <div className="terminal-quick-scope"><span>{locale === "zh-CN" ? "保存范围" : "Scope"}<b>{locale === "zh-CN" ? `当前：${quickScope === "global" ? "全局" : "CASE"}` : `Selected: ${quickScope === "global" ? "Global" : "CASE"}`}</b></span><div role="radiogroup" aria-label={locale === "zh-CN" ? "快捷命令保存范围" : "Quick command scope"}><button type="button" role="radio" aria-checked={quickScope === "global"} className={quickScope === "global" ? "selected" : ""} onClick={() => setQuickScope("global")}><strong>{locale === "zh-CN" ? "全局快捷命令" : "Global command"}</strong><small>{locale === "zh-CN" ? "所有 CASE 都可使用" : "Available in every CASE"}</small></button><button type="button" role="radio" aria-checked={quickScope === "case"} disabled={!caseId} className={quickScope === "case" ? "selected" : ""} onClick={() => setQuickScope("case")}><strong>{locale === "zh-CN" ? "CASE 快捷命令" : "CASE command"}</strong><small>{caseId ? (locale === "zh-CN" ? `仅用于 ${caseId}` : `Only for ${caseId}`) : (locale === "zh-CN" ? "请先打开 CASE" : "Open a CASE first")}</small></button></div></div>
              <label>{locale === "zh-CN" ? "名称" : "Name"}<input autoFocus value={quickName} maxLength={80} onChange={event => setQuickName(event.target.value)} placeholder={locale === "zh-CN" ? "例如：查看 ADB 设备" : "Example: List ADB devices"}/></label>
              <label>{locale === "zh-CN" ? "命令" : "Command"}<textarea value={quickCommand} onChange={event => setQuickCommand(event.target.value)} placeholder="adb devices -l" onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveQuickCommand(); } }}/></label>
              <footer><span>{locale === "zh-CN" ? "Ctrl+Enter 保存" : "Ctrl+Enter to save"}</span><div><button type="button" onClick={resetQuickEditor}>{locale === "zh-CN" ? "取消" : "Cancel"}</button><button type="button" className="primary" disabled={!quickName.trim() || !quickCommand.trim() || (quickScope === "case" && !caseId)} onClick={saveQuickCommand}>{locale === "zh-CN" ? "保存" : "Save"}</button></div></footer>
            </div>}
            <div className="terminal-quick-list">{visibleQuickCommands.length ? visibleQuickCommands.map(item => <article key={item.id}>
              <button type="button" className="terminal-quick-run" disabled={!activeTab || activeTab.status !== "running"} onClick={() => runQuickCommand(item)} title={item.command}><Play size={13}/><span><strong>{item.name}<em className={item.scope}>{item.scope === "global" ? (locale === "zh-CN" ? "全局" : "GLOBAL") : "CASE"}</em></strong><code>{item.command}</code></span></button>
              <div><button type="button" title={locale === "zh-CN" ? "编辑" : "Edit"} onClick={() => editQuickCommand(item)}><Pencil size={11}/></button><button type="button" title={locale === "zh-CN" ? "删除" : "Delete"} onClick={() => { setQuickCommands(current => current.filter(value => value.id !== item.id)); if (editingQuickId === item.id) resetQuickEditor(); }}><Trash2 size={11}/></button></div>
            </article>) : !quickEditorOpen && <p>{quickSearch ? (locale === "zh-CN" ? "没有匹配的快捷命令。" : "No commands match your search.") : (locale === "zh-CN" ? "这个分类还没有快捷命令。" : "No commands in this category yet.")}</p>}</div>
          </section>}
        </div>
        <button type="button" disabled={!activeTab} onClick={() => activeTab && onCopy(activeTab.id)} title="Ctrl+Shift+C"><Copy size={12}/>{locale === "zh-CN" ? "复制全部" : "Copy all"}</button>
        <button type="button" disabled={!activeTab} onClick={() => activeTab && onClear(activeTab.id)}><Trash2 size={12}/>{locale === "zh-CN" ? "清屏" : "Clear"}</button>
      </nav>
    </header>
    {quickPaletteOpen && <div className="terminal-quick-palette-backdrop" onMouseDown={() => setQuickPaletteOpen(false)}><section className="terminal-quick-palette" role="dialog" aria-modal="true" aria-label={locale === "zh-CN" ? "选择快捷命令" : "Choose a quick command"} onMouseDown={event => event.stopPropagation()}>
      <header><div><Bookmark size={15}/><strong>{locale === "zh-CN" ? "执行快捷命令" : "Run quick command"}</strong></div><kbd>Ctrl K</kbd><button type="button" title={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => setQuickPaletteOpen(false)}><X size={14}/></button></header>
      <div className="terminal-quick-palette-search"><span>⌕</span><input ref={quickPaletteInput} value={quickPaletteSearch} onChange={event => setQuickPaletteSearch(event.target.value)} placeholder={locale === "zh-CN" ? "输入名称或命令筛选…" : "Filter by name or command…"} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setQuickPaletteOpen(false); } else if (event.key === "ArrowDown") { event.preventDefault(); setQuickPaletteIndex(index => Math.min(index + 1, Math.max(0, paletteQuickCommands.length - 1))); } else if (event.key === "ArrowUp") { event.preventDefault(); setQuickPaletteIndex(index => Math.max(0, index - 1)); } else if (event.key === "Enter" && paletteQuickCommands[quickPaletteIndex]) { event.preventDefault(); runQuickCommand(paletteQuickCommands[quickPaletteIndex]); } }}/></div>
      <div className="terminal-quick-palette-list" role="listbox">{paletteQuickCommands.length ? paletteQuickCommands.map((item, index) => <button type="button" role="option" aria-selected={index === quickPaletteIndex} className={index === quickPaletteIndex ? "selected" : ""} onMouseEnter={() => setQuickPaletteIndex(index)} onClick={() => runQuickCommand(item)} key={item.id}><Play size={12}/><span><strong>{item.name}<em className={item.scope}>{item.scope === "global" ? (locale === "zh-CN" ? "全局" : "GLOBAL") : "CASE"}</em></strong><code>{item.command}</code></span></button>) : <p>{locale === "zh-CN" ? "没有可用的快捷命令。" : "No quick commands are available."}</p>}</div>
      <footer><span>{locale === "zh-CN" ? "↑↓ 选择 · Enter 执行 · Esc 关闭" : "↑↓ select · Enter run · Esc close"}</span><button type="button" onClick={() => { setQuickPaletteOpen(false); setQuickFilter("available"); setQuickEditorOpen(false); setQuickOpen(true); }}>{locale === "zh-CN" ? "管理快捷命令" : "Manage commands"}</button></footer>
    </section></div>}
    {activeTab ? <>
      <div className="integrated-terminal-context"><span>{activeTab.status === "running" ? (locale === "zh-CN" ? "ConPTY 运行中" : "ConPTY running") : activeTab.status === "failed" ? (locale === "zh-CN" ? "异常" : "Failed") : (locale === "zh-CN" ? "已退出" : "Exited")}</span><code title={activeTab.cwd}>{activeTab.cwd}</code><small>{locale === "zh-CN" ? "Ctrl+K 快捷命令 · 选中后右键复制 · 右键粘贴" : "Ctrl+K quick commands · Select + right-click to copy · Right-click to paste"}</small></div>
      <div className="integrated-terminal-canvas">{tabs.map(tab => <XtermView key={tab.id} active={visible && tab.id === activeTab.id} onData={data => onWrite(tab.id, data)} onResize={(cols, rows) => onResize(tab.id, cols, rows)} onReady={handle => onReady(tab.id, handle)}/>)}</div>
    </> : <div className="integrated-terminal-empty"><TerminalSquare size={38}/><strong>{locale === "zh-CN" ? "没有打开的终端" : "No open terminals"}</strong><span>{locale === "zh-CN" ? "点击“新建终端”，或从工作概览、产物页创建终端。" : "Create one here, from the work overview, or from an artifact."}</span><button type="button" onClick={onNew}><TerminalSquare size={14}/>{locale === "zh-CN" ? "新建终端" : "New terminal"}</button></div>}
  </div>;
}

function Overview({ state, stages, phaseText, currentStageLabel, apk, t, locale, caseInputNotice, caseInputBusy, workActionBusy, workActionFeedback, onReconstruct, onRevealInput, onRemoveInput, onOpenDirectory, onBuild, onRebuild, onInstall, onIntegratedTerminal, onSystemTerminal }: { state?: CaseStateView; stages: Array<{ id: string; label: string; status: string }>; phaseText: Record<string, string>; currentStageLabel: string; apk?: string; t: typeof copy[Locale]; locale: Locale; caseInputNotice?: string; caseInputBusy?: string; workActionBusy?: "build" | "rebuild" | "install"; workActionFeedback?: { kind: "success" | "error"; message: string }; onReconstruct: () => void; onRevealInput: (inputId: string) => void; onRemoveInput: (inputId: string, name: string) => void; onOpenDirectory: () => void; onBuild: () => void; onRebuild: () => void; onInstall: () => void; onIntegratedTerminal: () => void; onSystemTerminal: () => void }) {
  const work = state?.works?.find(item => item.id === state.activeWorkId);
  const workArtifacts = work?.artifacts ?? state?.artifacts ?? [];
  const inherited = work?.upstreamWorkIds?.length ?? 0;
  const workDirectory = work?.run.workspaceDir ?? work?.run.taskDir;
  const visibleInputs = [...(state?.inputs ?? [])].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
  const showProjectActions = supportsAndroidProjectActions(work?.category ?? state?.analysisCategory);
  const heroText = work?.goal ?? state?.analysisGoal ?? state?.description ?? work?.title ?? state?.title ?? apk?.split(/[\\/]/).pop() ?? (locale === "zh-CN" ? "当前 CASE 尚未开始工作，可以从右上角创建工作。" : "No Work has started in this CASE yet.");
  return <div className="overview-grid">
    <section className="hero-card overview-hero"><div><span>{locale === "zh-CN" ? "当前工作" : "CURRENT WORK"}</span><h2 title={heroText}>{heroText}</h2><footer><div>{state?.analysisCategory && <em>{categoryCopy[locale][state.analysisCategory].label}</em>}{caseInputNotice && <small className="case-input-success" title={caseInputNotice}>✓ {caseInputNotice}</small>}</div>{visibleInputs.length > 0 && <div className="hero-input-list" aria-label={locale === "zh-CN" ? "案例输入" : "Case inputs"}>{visibleInputs.map(input => { const inputLocation = input.path ?? input.packageName ?? input.metadata?.serial; return <div className={`hero-input ${input.type === "apk" ? "apk" : ""}`} title={`${caseInputTypeLabel(input.type, locale)} · ${input.name}${inputLocation ? ` · ${inputLocation}` : ""}`} key={input.id}><Paperclip size={11}/><small>{caseInputTypeLabel(input.type, locale)}</small><strong>{input.name}</strong><nav>{input.path && <button type="button" disabled={Boolean(caseInputBusy)} onClick={() => onRevealInput(input.id)} title={locale === "zh-CN" ? "打开文件所在目录" : "Reveal input in file explorer"}><FolderOpen size={11}/></button>}<button type="button" className="remove" disabled={Boolean(caseInputBusy)} onClick={() => onRemoveInput(input.id, input.name)} title={locale === "zh-CN" ? "从 CASE 移除此输入" : "Remove this input from the CASE"}>{caseInputBusy === input.id ? <RefreshCw size={11} className="spin"/> : <Trash2 size={11}/>}</button></nav></div>; })}</div>}</footer></div><Activity size={42}/></section>
    <section className="overview-summary">
      <article><span>{t.currentPhase.toUpperCase()}</span><div><strong>{currentStageLabel}</strong><small>{state?.activeRun ? new Date(state.activeRun.updatedAt).toLocaleString() : state ? new Date(state.updatedAt).toLocaleString() : t.waiting}</small></div></article>
      <article><span>{locale === "zh-CN" ? "本工作产物" : "WORK ARTIFACTS"}</span><div><strong>{workArtifacts.length}</strong><small>{t.persisted}</small></div></article>
      <article><span>{locale === "zh-CN" ? "继承工作" : "UPSTREAM WORKS"}</span><div><strong>{inherited}</strong><small>{locale === "zh-CN" ? "个已完成上游工作" : "completed upstream works"}</small></div></article>
    </section>
    <section className="work-directory-card"><div><span>{locale === "zh-CN" ? "工作目录" : "WORK DIRECTORY"}</span><strong title={workDirectory}>{workDirectory ?? (locale === "zh-CN" ? "当前工作尚未创建目录" : "No work directory yet")}</strong>{workActionFeedback && <small className={workActionFeedback.kind} title={workActionFeedback.message}>{workActionFeedback.kind === "success" ? "✓" : "!"} {workActionFeedback.message}</small>}</div><nav><button type="button" disabled={!workDirectory} onClick={onOpenDirectory}><FolderOpen size={13}/>{locale === "zh-CN" ? "打开" : "Open"}</button>{showProjectActions && <><BuildActionMenu locale={locale} disabled={!workDirectory || Boolean(workActionBusy)} busy={workActionBusy} onBuild={onBuild} onRebuild={onRebuild}/><button type="button" disabled={!workDirectory || Boolean(workActionBusy)} onClick={onInstall}>{workActionBusy === "install" ? <RefreshCw size={13} className="spin"/> : <Smartphone size={13}/>} {workActionBusy === "install" ? (locale === "zh-CN" ? "安装中" : "Installing") : (locale === "zh-CN" ? "安装" : "Install")}</button></>}<button type="button" disabled={!workDirectory} onClick={onIntegratedTerminal}><TerminalSquare size={13}/>{locale === "zh-CN" ? "应用内终端" : "Integrated terminal"}</button><button type="button" disabled={!workDirectory} onClick={onSystemTerminal}><Maximize2 size={13}/>{locale === "zh-CN" ? "系统终端" : "System terminal"}</button></nav></section>
    <section className="workflow-card"><div className="section-title"><Activity size={16}/><span>{t.pipeline}</span></div><div className="pipeline dynamic">{stages.map((stage, index) => <div className={`pipeline-step ${stage.status === "completed" ? "done" : stage.status}`} key={stage.id}><i>{stage.status === "completed" ? "✓" : stage.status === "skipped" ? "–" : stage.status === "failed" ? "!" : index + 1}</i><span>{phaseText[stage.id] ?? stage.label}</span></div>)}</div></section>
    {state?.analysisCategory === "deobfuscation" && state.activeRun?.status === "completed" && <section className="reconstruction-cta"><div><strong>{locale === "zh-CN" ? "反混淆成果已可用于下游工作" : "Deobfuscation artifacts are ready for downstream work"}</strong><span>{locale === "zh-CN" ? "创建独立工程并继承当前源码、资源、映射和验证结果。" : "Create an isolated project inheriting current source, resources, maps, and verification evidence."}</span></div><button className="primary" onClick={onReconstruct}><Play size={14}/>{locale === "zh-CN" ? "基于当前结果重构应用" : "Reconstruct from these results"}</button></section>}
  </div>;
}

function BuildActionMenu({ locale, disabled, busy, onBuild, onRebuild }: { locale: Locale; disabled: boolean; busy?: "build" | "rebuild" | "install"; onBuild: () => void; onRebuild: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const building = busy === "build" || busy === "rebuild";
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const run = (action: () => void) => { setOpen(false); action(); };
  return <div className={`work-directory-build-menu ${open ? "open" : ""}`} ref={root}>
    <button type="button" className="build-menu-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {building ? <RefreshCw size={13} className="spin"/> : <Play size={13}/>}<span>{busy === "rebuild" ? (locale === "zh-CN" ? "重新编译中" : "Rebuilding") : busy === "build" ? (locale === "zh-CN" ? "编译中" : "Building") : (locale === "zh-CN" ? "编译" : "Build")}</span><ChevronDown size={11}/>
    </button>
    {open && <div className="build-menu-options" role="menu">
      <button type="button" role="menuitem" onClick={() => run(onBuild)}><Play size={13}/><span><strong>{locale === "zh-CN" ? "增量编译" : "Incremental build"}</strong><small>{locale === "zh-CN" ? "保留缓存，快速构建" : "Keep caches for a faster build"}</small></span></button>
      <button type="button" role="menuitem" onClick={() => run(onRebuild)}><RefreshCw size={13}/><span><strong>{locale === "zh-CN" ? "重新编译" : "Clean rebuild"}</strong><small>{locale === "zh-CN" ? "先清理，再完整构建" : "Clean before a full build"}</small></span></button>
    </div>}
  </div>;
}

function WorkWorkbench({ state, locale, disabled, onRun, onOpenDirectory }: { state?: CaseStateView; locale: Locale; disabled: boolean; onRun: (label: string, instruction: string) => void; onOpenDirectory: () => void }) {
  const category = state?.analysisCategory ?? "report";
  const work = state?.works?.find(item => item.id === state.activeWorkId);
  const common = locale === "zh-CN"
    ? [{ label: "检查当前进度", instruction: "审计当前 Work 的计划、已完成阶段、阻塞项和缺失验收证据，只更新必要状态。" }, { label: "整理交付结果", instruction: "整理本 Work 的最终产物索引和使用说明，不重复执行已完成分析。" }]
    : [{ label: "Inspect progress", instruction: "Audit this Work's plan, completed stages, blockers, and missing acceptance evidence; update only necessary state." }, { label: "Prepare delivery", instruction: "Prepare this Work's artifact index and usage notes without repeating completed analysis." }];
  const specialized: Partial<Record<AnalysisCategory, Array<{ label: string; instruction: string }>>> = {
    "app-reconstruction": [{ label: "构建并测试", instruction: "构建当前重构工程，运行聚焦测试并修复本次构建阻塞。" }, { label: "行为一致性复验", instruction: "对照继承证据复验重构应用的关键行为差异。" }],
    "app-development": [{ label: "构建并测试", instruction: "构建当前 Android 工程并运行测试，修复本次构建阻塞。" }, { label: "设备验收", instruction: "安装并启动当前应用，按工作目标完成设备端验收。" }],
    "runtime-diagnostics": [{ label: "采集现场快照", instruction: "从当前 ADB 设备采集包状态、相关 logcat 和必要 dumpsys，保存到本 Work evidence。" }, { label: "定位根因", instruction: "关联现场证据与 JADX/IDA 代码路径，更新根因假设和复验步骤。" }],
    deobfuscation: [{ label: "复查可读性", instruction: "抽样复查反混淆源码可读性和残留阻塞，不满足时只处理失败区域。" }],
    "parameter-trace": [{ label: "继续回溯", instruction: "从当前追踪断点继续静态与动态参数来源回溯。" }],
    "algorithm-recovery": [{ label: "运行测试向量", instruction: "运行已登记测试向量，验证还原算法与原实现一致性。" }],
  };
  const actions = [...(specialized[category] ?? []), ...common];
  return <div className="work-workspace workbench" style={{ "--work-accent": workTypes[category].accent } as React.CSSProperties}><header><div><span>{locale === "zh-CN" ? "当前工作类型" : "Work type"}</span><strong>{categoryCopy[locale][category].label}</strong></div><p>{categoryCopy[locale][category].description}</p></header><section className="workbench-context"><div><span>{locale === "zh-CN" ? "工作目录" : "Work directory"}</span><code>{work?.run.taskDir ?? work?.run.workspaceDir ?? "—"}</code></div><button type="button" onClick={onOpenDirectory}><FolderOpen size={14}/>{locale === "zh-CN" ? "打开目录" : "Open directory"}</button></section><section className="workbench-actions"><div className="section-title"><TerminalSquare size={15}/>{locale === "zh-CN" ? "快捷操作" : "Quick actions"}</div><div>{actions.map(action => <button type="button" disabled={disabled || !work} key={action.label} onClick={() => onRun(action.label, action.instruction)}><Play size={14}/><span><strong>{action.label}</strong><small>{action.instruction}</small></span><ChevronRight size={14}/></button>)}</div></section></div>;
}

function ValidationView({ state, locale, disabled, onRun }: { state?: CaseStateView; locale: Locale; disabled: boolean; onRun: (stage: { id: string; label: string; successCriteria?: string }) => void }) {
  const stages = state?.activeRun?.stages ?? [];
  const validation = stages.filter(stage => /verify|valid|test|build|install|launch|replay|report/i.test(`${stage.id} ${stage.label} ${stage.route ?? ""}`));
  const shown = validation.length ? validation : stages;
  return <div className="validation-view"><header><ShieldCheck size={20}/><div><strong>{locale === "zh-CN" ? "验证与验收" : "Validation"}</strong><span>{locale === "zh-CN" ? "集中查看成功条件、执行状态和阻塞项" : "Review success criteria, execution state, and blockers"}</span></div></header><div>{shown.length ? shown.map(stage => <article className={stage.status} key={stage.id}><i>{stage.status === "completed" ? "✓" : stage.status === "failed" ? "!" : stage.status === "skipped" ? "–" : "○"}</i><div><strong>{stage.label}</strong><span>{stage.successCriteria ?? (locale === "zh-CN" ? "尚未登记验收标准" : "No acceptance criterion recorded")}</span><small>{stage.route ?? "Pi"}</small></div><b>{stage.status}</b><button disabled={disabled} onClick={() => onRun(stage)}><RefreshCw size={12}/>{locale === "zh-CN" ? "复验" : "Rerun"}</button></article>) : <p>{locale === "zh-CN" ? "工作规划完成后，验证项会显示在这里。" : "Validation items appear after planning."}</p>}</div></div>;
}

function ArtifactContentPreview({ filename, content, emptyText }: { filename?: string; content: string; emptyText: string }) {
  if (artifactPreviewKind(filename) === "markdown" && content) return <div className="artifact-preview artifact-markdown-preview"><MarkdownMessage content={content}/></div>;
  return <pre className="artifact-preview">{content || emptyText}</pre>;
}

function Evidence({ state, selected, content, onOpen, onOpenDefault, onReveal, onTerminal, t, locale }: { state?: CaseStateView; selected?: string; content: string; onOpen: (file: string) => void; onOpenDefault: (file: string) => void; onReveal: (file: string) => void; onTerminal: (file: string) => void; t: typeof copy[Locale]; locale: Locale }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, DirectoryEntryInfo[]>>({});
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useState<"current" | "inherited">("current");
  const work = state?.works?.find(item => item.id === state.activeWorkId);
  const currentArtifacts = work ? (work.artifacts ?? []) : (state?.artifacts ?? []);
  const inheritedArtifacts = work?.artifactSnapshot ?? [];
  useEffect(() => { setScope("current"); setExpanded(new Set()); setChildren({}); }, [state?.activeWorkId]);
  const roots = useMemo(() => {
    const artifacts = scope === "current" ? currentArtifacts : inheritedArtifacts;
    const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    const directories = artifacts.filter(file => state?.artifactTypes?.[file] === "directory").map(normalize);
    return artifacts
      .filter(file => !directories.some(directory => normalize(file).startsWith(directory + "/")))
      .map(file => ({ name: file.split(/[\\/]/).pop() ?? file, path: file, type: state?.artifactTypes?.[file] === "directory" ? "directory" as const : "file" as const }))
      .sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
  }, [scope, currentArtifacts, inheritedArtifacts, state?.artifactTypes]);
  const toggleDirectory = async (directory: string) => {
    if (expanded.has(directory)) { setExpanded(current => { const next = new Set(current); next.delete(directory); return next; }); return; }
    setExpanded(current => new Set(current).add(directory));
    if (children[directory]) return;
    setLoading(current => new Set(current).add(directory));
    try { const entries = await window.mobileReverse.listDirectory(directory); setChildren(current => ({ ...current, [directory]: entries })); }
    catch (error) { setChildren(current => ({ ...current, [directory]: [{ name: error instanceof Error ? error.message : String(error), path: `${directory}#error`, type: "file" }] })); }
    finally { setLoading(current => { const next = new Set(current); next.delete(directory); return next; }); }
  };
  const renderNode = (node: DirectoryEntryInfo, depth = 0): ReactNode => {
    const isDirectory = node.type === "directory";
    const isExpanded = expanded.has(node.path);
    return <div className="artifact-tree-node" key={node.path}><button style={{ paddingLeft: `${8 + depth * 16}px` }} className={`${selected === node.path ? "active" : ""} ${node.type}`} onClick={() => { onOpen(node.path); if (isDirectory) void toggleDirectory(node.path); }}>{isDirectory ? (isExpanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>) : <span className="tree-indent"/>}{isDirectory ? <FolderOpen size={15}/> : <FileCode2 size={15}/>}<span>{node.name}</span>{isDirectory && <small>DIR</small>}</button>{isDirectory && isExpanded && <div className="artifact-tree-children">{loading.has(node.path) ? <div className="tree-loading" style={{ paddingLeft: `${28 + depth * 16}px` }}>Loading…</div> : (children[node.path] ?? []).map(child => renderNode(child, depth + 1))}</div>}</div>;
  };
  return <div className="evidence-view"><div className="artifact-list artifact-tree"><div className="section-title"><ScrollText size={16}/><span>{t.artifactList}</span></div>{work && <div className="artifact-scope-tabs"><button type="button" className={scope === "current" ? "active" : ""} onClick={() => setScope("current")}>{locale === "zh-CN" ? "当前工作" : "Current"}<small>{currentArtifacts.length}</small></button><button type="button" className={scope === "inherited" ? "active" : ""} disabled={!inheritedArtifacts.length} onClick={() => setScope("inherited")}>{locale === "zh-CN" ? "继承产物" : "Inherited"}<small>{inheritedArtifacts.length}</small></button></div>}{roots.length ? roots.map(root => renderNode(root)) : <div className="muted pad">{scope === "current" ? t.noEvidence : (locale === "zh-CN" ? "当前工作没有继承上游产物。" : "This Work has no inherited artifacts.")}</div>}</div><section className="artifact-preview-pane"><header><div><FileCode2 size={14}/><span title={selected}>{selected?.split(/[\\/]/).pop() ?? (locale === "zh-CN" ? "未选择产物" : "No artifact selected")}</span></div><nav><button type="button" disabled={!selected} onClick={() => selected && onOpenDefault(selected)} title={locale === "zh-CN" ? "使用系统默认程序打开" : "Open with the default application"}><FileCode2 size={13}/>{locale === "zh-CN" ? "打开文件" : "Open"}</button><button type="button" disabled={!selected} onClick={() => selected && onReveal(selected)} title={locale === "zh-CN" ? "在资源管理器中打开所在目录" : "Reveal in file explorer"}><FolderOpen size={13}/>{locale === "zh-CN" ? "所在目录" : "Reveal"}</button><button type="button" disabled={!selected} onClick={() => selected && onTerminal(selected)} title={locale === "zh-CN" ? "在产物所在目录打开终端" : "Open a terminal in the artifact directory"}><TerminalSquare size={13}/>{locale === "zh-CN" ? "终端" : "Terminal"}</button></nav></header><ArtifactContentPreview filename={selected} content={content} emptyText={t.selectEvidence}/></section></div>;
}

function Report({ artifact, content, t }: { artifact?: string; content: string; t: typeof copy[Locale] }) {
  if (!artifact) return <div className="empty-panel"><FileCode2 size={38}/><h2>{t.report}</h2><p>{t.noReport}</p></div>;
  return <article className="report-view"><header><FileCode2 size={18}/><div><span>{t.reportFile}</span><strong>{artifact.split(/[\\/]/).pop()}</strong></div></header><div className="report-markdown-preview"><MarkdownMessage content={content}/></div></article>;
}

function EmptyPanel({ title, t }: { title: string; t: typeof copy[Locale] }) { return <div className="empty-panel"><Braces size={38}/><h2>{title} {t.workspaceSuffix}</h2><p>{t.future}</p></div>; }
