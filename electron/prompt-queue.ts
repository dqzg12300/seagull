import type { ImageAttachment, PromptQueueItemView } from "./shared.js";

export interface StoredPromptQueueItem extends PromptQueueItemView {
  agentText: string;
  images?: ImageAttachment[];
}

const finalResponseRecoveryMarker = "[SEAGULL_FINAL_RESPONSE_RECOVERY]";

export function isFinalResponseRecoveryPrompt(value: string): boolean {
  return value.trimStart().startsWith(finalResponseRecoveryMarker);
}

/** Keep at most one automatic recovery request in a session queue. Normal
 * operator prompts are never coalesced, even when their text is identical. */
export function dedupeFinalResponseRecoveryPrompts(items: StoredPromptQueueItem[]): StoredPromptQueueItem[] {
  let foundRecovery = false;
  return items.filter(item => {
    if (!isFinalResponseRecoveryPrompt(item.agentText)) return true;
    if (foundRecovery) return false;
    foundRecovery = true;
    return true;
  });
}

/** Remove one failed operator request restored by an older build, together
 * with automatic recovery prompts that can no longer refer to a valid turn. */
export function removeFailedPromptFromQueue(items: StoredPromptQueueItem[], agentText: string | undefined): StoredPromptQueueItem[] {
  let removedFailedPrompt = false;
  return items.filter(item => {
    if (isFinalResponseRecoveryPrompt(item.agentText)) return false;
    if (!removedFailedPrompt && agentText && item.status === "queued" && item.agentText.trim() === agentText.trim()) {
      removedFailedPrompt = true;
      return false;
    }
    return true;
  });
}

/** A recovery refers to the turn that just ended, so it must run before already
 * queued operator follow-ups. Appending it to the tail makes "previous turn"
 * point at the wrong request by the time it executes. */
export function insertPromptQueueItem(items: StoredPromptQueueItem[], entry: StoredPromptQueueItem): StoredPromptQueueItem[] {
  if (!isFinalResponseRecoveryPrompt(entry.agentText)) return [...items, entry];
  if (items.some(item => isFinalResponseRecoveryPrompt(item.agentText))) return items;
  const firstWaiting = items.findIndex(item => item.status === "queued");
  if (firstWaiting < 0) return [...items, entry];
  return [...items.slice(0, firstWaiting), entry, ...items.slice(firstWaiting)];
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
