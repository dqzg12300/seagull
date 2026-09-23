export type SearchableChatItem = {
  id: string;
  kind?: string;
  title?: string;
  body?: string;
  output?: string;
  expanded?: boolean;
  attachments?: Array<{ name?: string; detail?: string; content?: string }>;
  imageNames?: string[];
  toolDetails?: Array<{ title?: string; body?: string; output?: string }>;
};

export function searchableChatText(item: SearchableChatItem): string {
  const isTool = item.kind === "tool";
  return [
    item.title,
    !isTool ? item.body : undefined,
    !isTool ? item.output : undefined,
    ...(item.imageNames ?? []),
    // Attachment contents are not rendered in the timeline card. Search only
    // what the operator can actually see before opening the attachment.
    ...(item.attachments ?? []).flatMap(attachment => [attachment.name, attachment.detail]),
    // A collapsed tool group must not expose its hidden commands to chat
    // search. When the group is open, only the visible command summaries are
    // indexed; full input/output remains excluded until explicitly inspected.
    ...(item.expanded ? (item.toolDetails ?? []).map(detail => detail.title) : []),
  ].filter(Boolean).join("\n");
}

export function chatSearchMatchIds(items: SearchableChatItem[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return items.filter(item => searchableChatText(item).toLocaleLowerCase().includes(needle)).map(item => item.id);
}

export function stepChatSearchIndex(current: number, total: number, direction: -1 | 1): number {
  if (total <= 0) return 0;
  return (Math.max(0, current) + direction + total) % total;
}
