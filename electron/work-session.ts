export interface WorkSessionLocator {
  id: string;
  title?: string;
  goal?: string;
  createdAt?: string;
  taskDir?: string;
  workspaceDir?: string;
}

export interface InheritedWorkConversation {
  id: string;
  title?: string;
  goal?: string;
  messages: unknown[];
}

export interface WorkInheritanceLocator {
  id: string;
  createdAt?: string;
  status?: string;
  upstreamWorkIds?: string[];
}

/** Resolve upstream Works while keeping explicit relationships authoritative.
 * Older CASE files did not persist upstreamWorkIds, so their completed Works
 * are inferred chronologically. */
export function resolveUpstreamWorkIds(works: WorkInheritanceLocator[], currentWorkId: string): string[] {
  const current = works.find(work => work.id === currentWorkId);
  if (!current) return [];
  if (current.upstreamWorkIds?.length) return [...current.upstreamWorkIds];
  const currentCreatedAt = Date.parse(current.createdAt ?? "");
  if (!Number.isFinite(currentCreatedAt)) return [];
  return works
    .filter(work => work.id !== currentWorkId && work.status === "completed")
    .filter(work => {
      const createdAt = Date.parse(work.createdAt ?? "");
      return Number.isFinite(createdAt) && createdAt < currentCreatedAt;
    })
    .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""))
    .map(work => work.id);
}

/** Persist chronological inheritance for legacy CASE files. */
export function applyLegacyWorkInheritance(works: WorkInheritanceLocator[]): boolean {
  let changed = false;
  for (const work of works) {
    if (work.upstreamWorkIds?.length) continue;
    const inferred = resolveUpstreamWorkIds(works, work.id);
    if (!inferred.length) continue;
    work.upstreamWorkIds = inferred;
    changed = true;
  }
  return changed;
}

type SessionEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  message?: { role?: string; content?: unknown };
  [key: string]: unknown;
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
    .filter(block => block.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

const OPERATOR_FOLLOW_UP = "Operator follow-up:";
const hiddenUserPrompts = ["/reverse-case-", "You are starting a goal-driven", "[SEAGULL_FINAL_RESPONSE_RECOVERY]", "[SEAGULL_VALIDATION_RERUN]", "[SEAGULL_WORKBENCH_ACTION]"];
const internalContextPrompts = ["[SEAGULL_WORK_CONTEXT]", "[SEAGULL_PROJECT_FOLLOW_UP]", "[SEAGULL_RECONSTRUCTION_FOLLOW_UP]"];

export function visibleOperatorMessage(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const explicitMarker = "[SEAGULL_USER_MESSAGE]";
  const explicitIndex = text.lastIndexOf(explicitMarker);
  if (explicitIndex >= 0) return text.slice(explicitIndex + explicitMarker.length).trim() || undefined;
  // Legacy planning envelopes predate the explicit marker. Preserve the
  // operator's actual first message while hiding the generated planning gate.
  if (text.startsWith("You are starting a goal-driven")) {
    const objectiveMarker = "The operator's objective is:";
    const objectiveIndex = text.lastIndexOf(objectiveMarker);
    if (objectiveIndex >= 0) return text.slice(objectiveIndex + objectiveMarker.length).trim() || undefined;
    return undefined;
  }
  if (hiddenUserPrompts.some(prefix => text.startsWith(prefix))) return undefined;
  if (!internalContextPrompts.some(prefix => text.startsWith(prefix))) return text;
  const followUpIndex = text.indexOf(OPERATOR_FOLLOW_UP);
  if (followUpIndex >= 0) return text.slice(followUpIndex + OPERATOR_FOLLOW_UP.length).trim() || undefined;
  if (text.startsWith("[SEAGULL_WORK_CONTEXT]")) {
    const separator = text.search(/\r?\n\s*\r?\n/);
    if (separator >= 0) return text.slice(separator).trim() || undefined;
  }
  return undefined;
}

function clipped(value: string, limit: number): string {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[truncated]`;
}

/** Build a cleaned full transcript plus a bounded digest suitable for hidden
 * system-prompt inheritance. Tool payloads/results and application-generated
 * routing prompts are excluded. */
export function buildInheritedWorkConversationContext(works: InheritedWorkConversation[]): { transcript: string; digest: string } {
  const fullSections: string[] = ["# Upstream Work conversation transcript", "", "Generated from persisted Pi Work sessions. Tool payloads and internal routing prompts are intentionally omitted."];
  const digestSections: string[] = ["# Upstream Work memory digest"];
  for (const work of works) {
    const conversation: Array<{ role: "Operator" | "Pi"; text: string }> = [];
    for (const raw of work.messages) {
      const message = raw as { role?: string; content?: unknown };
      if (message.role === "user") {
        const visible = visibleOperatorMessage(messageText(message.content));
        if (visible) conversation.push({ role: "Operator", text: visible });
      } else if (message.role === "assistant") {
        const text = messageText(message.content).trim();
        if (text) conversation.push({ role: "Pi", text });
      }
    }
    fullSections.push("", `## ${work.title ?? work.id}`, "", `- Work ID: ${work.id}`, `- Goal: ${work.goal ?? "—"}`, "", "### Clean conversation");
    if (!conversation.length) fullSections.push("", "No textual conversation was recovered for this Work.");
    for (const item of conversation) fullSections.push("", `**${item.role}**`, "", clipped(item.text, 12_000));

    const recent = conversation.slice(-10);
    digestSections.push("", `## ${work.title ?? work.id}`, `Work ID: ${work.id}`, `Goal: ${clipped(work.goal ?? "—", 1_200)}`);
    for (const item of recent) digestSections.push("", `${item.role}: ${clipped(item.text, 1_600)}`);
  }
  const digest = digestSections.join("\n");
  return { transcript: fullSections.join("\n"), digest: digest.length <= 40_000 ? digest : digest.slice(-40_000) };
}

function normalized(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").toLowerCase();
}

function workMentionedBy(text: string, works: WorkSessionLocator[]): string | undefined {
  const haystack = normalized(text);
  const ranked = works
    .flatMap(work => [
      { id: work.id, value: normalized(work.id), priority: 3 },
      { id: work.id, value: normalized(work.taskDir), priority: 2 },
      { id: work.id, value: normalized(work.workspaceDir), priority: 2 },
      { id: work.id, value: normalized(work.goal), priority: 1 },
    ])
    .filter(candidate => candidate.value.length >= 8 && haystack.includes(candidate.value))
    .sort((a, b) => b.priority - a.priority || b.value.length - a.value.length);
  return ranked[0]?.id;
}

/**
 * Split the former CASE-wide Pi session into a linear history for one Work.
 * Work routing prompts contain a work id, task directory, project directory,
 * or the original goal. Once a Work is detected, following assistant/tool
 * messages remain attached to it until another Work routing prompt appears.
 */
export function selectLegacySessionForWork(rawEntries: unknown[], works: WorkSessionLocator[], targetWorkId: string): SessionEntry[] {
  const ordered = [...works].sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
  let currentWorkId = ordered[0]?.id;
  let sawMessage = false;
  const selected: SessionEntry[] = [];

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as SessionEntry;
    if (entry.type === "session") { selected.push(structuredClone(entry)); continue; }

    if (entry.type === "message") {
      sawMessage = true;
      if (entry.message?.role === "user") {
        const mentioned = workMentionedBy(messageText(entry.message.content), works);
        if (mentioned) currentWorkId = mentioned;
      }
    }

    // Model/thinking metadata before the first message is needed to reopen a
    // valid Pi session and is shared by every migrated Work.
    if ((!sawMessage && entry.type !== "message") || currentWorkId === targetWorkId) selected.push(structuredClone(entry));
  }

  if (!selected.some(entry => entry.type === "message")) return [];

  let parentId: string | null = null;
  return selected.map(entry => {
    if (entry.type === "session") return entry;
    const next = { ...entry, parentId };
    if (typeof next.id === "string") parentId = next.id;
    return next;
  });
}

/** Return every persisted message on the active branch, including messages
 * before Pi context compaction. Compaction controls model context size; it must
 * not truncate the user-facing chat transcript. */
export function sessionBranchMessages(rawEntries: unknown[]): unknown[] {
  return rawEntries
    .filter((entry): entry is SessionEntry => Boolean(entry) && typeof entry === "object")
    .filter(entry => entry.type === "message" && Boolean(entry.message))
    .map(entry => entry.message);
}
