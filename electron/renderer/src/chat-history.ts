import { visibleOperatorMessage } from "../../work-session.js";

/**
 * Pi stores the exact prompt it receives. Some prompts prepend work routing and
 * continuity instructions which are useful to the agent but are not the text
 * typed by the operator. Convert those stored prompts back to their user-facing
 * representation when rebuilding the timeline after an application restart.
 */
export function visibleUserHistoryText(value: string): string | undefined {
  return visibleOperatorMessage(value);
}

export type HistoryMessageAttachment = {
  kind: "text" | "file";
  name: string;
  detail?: string;
  path?: string;
  content?: string;
};

export type HistoryImageAttachment = {
  source: string;
  mimeType: string;
};

export type VisibleUserHistoryMessage = {
  text?: string;
  attachments: HistoryMessageAttachment[];
  imageNames: string[];
};

const attachmentMarker = /^\[(PASTED_TEXT_ATTACHMENTS|FILE_ATTACHMENTS|IMAGE_ATTACHMENTS)\]\s*$/gm;

function pastedTextAttachments(value: string): HistoryMessageAttachment[] {
  const headers = [...value.matchAll(/^## Text \d+:\s*(.+?)\s*$/gm)];
  return headers.map((header, index) => {
    const start = (header.index ?? 0) + header[0].length;
    const end = headers[index + 1]?.index ?? value.length;
    const text = value.slice(start, end).replace(/^\r?\n/, "").trimEnd();
    return {
      kind: "text",
      name: header[1]?.trim() || `Text ${index + 1}`,
      detail: `${text.length.toLocaleString()} characters`,
      content: text,
    };
  });
}

function fileAttachments(value: string): HistoryMessageAttachment[] {
  return value.split(/\r?\n/).flatMap(line => {
    const match = /^\s*-\s+(.+?)\s+\((\d+) bytes\)\s*$/.exec(line);
    if (!match) return [];
    const filePath = match[1]!;
    const name = filePath.split(/[\\/]/).at(-1) || filePath;
    return [{ kind: "file" as const, name, path: filePath, detail: `${Number(match[2]).toLocaleString()} bytes` }];
  });
}

function imageAttachmentNames(value: string): string[] {
  return value.split(/\r?\n/).flatMap(line => {
    const match = /^\s*-\s+(.+?)(?:\s+\(image\/[^)]+\))?\s*$/.exec(line);
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  });
}

/** Convert the persisted prompt protocol back into the message the operator
 * saw: plain text plus compact attachment cards. This also repairs existing
 * sessions which previously rendered attachment payloads as message text. */
export function parseVisibleUserHistoryMessage(value: string): VisibleUserHistoryMessage | undefined {
  const visible = visibleUserHistoryText(value);
  if (!visible) return undefined;
  const markers = [...visible.matchAll(attachmentMarker)];
  if (!markers.length) return { text: visible, attachments: [], imageNames: [] };

  const attachments: HistoryMessageAttachment[] = [];
  const imageNames: string[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? visible.length;
    const section = visible.slice(start, end).replace(/^\r?\n/, "");
    if (marker[1] === "PASTED_TEXT_ATTACHMENTS") attachments.push(...pastedTextAttachments(section));
    if (marker[1] === "FILE_ATTACHMENTS") attachments.push(...fileAttachments(section));
    if (marker[1] === "IMAGE_ATTACHMENTS") imageNames.push(...imageAttachmentNames(section));
  }
  const text = visible.slice(0, markers[0]!.index).trim() || undefined;
  return { text, attachments, imageNames };
}

/** Restore image blocks from Pi's persisted multimodal message content. */
export function historyImageAttachments(content: unknown): HistoryImageAttachment[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap(block => {
    if (!block || typeof block !== "object") return [];
    const value = block as Record<string, unknown>;
    if (value.type !== "image" || typeof value.data !== "string" || !value.data) return [];
    const mimeType = typeof value.mimeType === "string" && value.mimeType.startsWith("image/") ? value.mimeType : "image/png";
    return [{ source: `data:${mimeType};base64,${value.data}`, mimeType }];
  });
}

function historyContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
    .filter(block => block.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

export function historyNeedsFinalResponse(messages: unknown[]): boolean {
  let sawVisibleUser = false;
  let finalTextAfterUser = false;
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown };
    if (message.role === "user") {
      const hasImage = Array.isArray(message.content) && message.content.some(block => Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "image");
      if (!visibleUserHistoryText(historyContentText(message.content)) && !hasImage) continue;
      sawVisibleUser = true;
      finalTextAfterUser = false;
      continue;
    }
    if (!sawVisibleUser || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    if (message.content.some(block => Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "text" && String((block as Record<string, unknown>).text ?? "").trim())) finalTextAfterUser = true;
  }
  return sawVisibleUser && !finalTextAfterUser;
}
