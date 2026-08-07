import type { ImageAttachment, PromptQueueItemView } from "./shared.js";

export interface StoredPromptQueueItem extends PromptQueueItemView {
  agentText: string;
  images?: ImageAttachment[];
}

export function promptQueueView(item: StoredPromptQueueItem): PromptQueueItemView {
  const { agentText: _agentText, images, ...view } = item;
  return { ...view, imageCount: images?.length ?? view.imageCount ?? 0 };
}

export function replaceQueuedPromptDisplay(item: StoredPromptQueueItem, displayText: string, updatedAt: string): StoredPromptQueueItem {
  const nextDisplay = displayText.trim();
  if (!nextDisplay) throw new Error("Queued message cannot be empty");
  const index = item.displayText ? item.agentText.lastIndexOf(item.displayText) : -1;
  const agentText = index < 0
    ? item.agentText
    : `${item.agentText.slice(0, index)}${nextDisplay}${item.agentText.slice(index + item.displayText.length)}`;
  return { ...item, agentText, displayText: nextDisplay, updatedAt };
}

export function moveQueuedPrompt(items: StoredPromptQueueItem[], promptId: string, direction: "up" | "down"): StoredPromptQueueItem[] {
  const index = items.findIndex(item => item.id === promptId && item.status === "queued");
  if (index < 0) return items;
  const queuedIndexes = items.flatMap((item, itemIndex) => item.status === "queued" ? [itemIndex] : []);
  const position = queuedIndexes.indexOf(index);
  const targetIndex = queuedIndexes[position + (direction === "up" ? -1 : 1)];
  if (targetIndex === undefined) return items;
  const result = [...items];
  [result[index], result[targetIndex]] = [result[targetIndex]!, result[index]!];
  return result;
}
