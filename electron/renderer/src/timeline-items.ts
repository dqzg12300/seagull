export interface IdentifiedTimelineItem {
  id: string;
}

export function upsertTimelineItem<T extends IdentifiedTimelineItem>(items: T[], item: T): T[] {
  const index = items.findIndex(current => current.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((current, currentIndex) => currentIndex === index ? { ...current, ...item } : current);
}

export interface TextTimelineItem extends IdentifiedTimelineItem {
  kind?: string;
  body?: string;
}

/** Append a provider's terminal fallback text only when the same answer is not
 * already present in the current turn. Some providers stream text and also
 * repeat the complete message in agent_end. */
export function appendUniqueAssistantFinal<T extends TextTimelineItem>(items: T[], finalText: string, create: () => T): T[] {
  const normalized = finalText.trim();
  if (!normalized) return items;
  let lastUserIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "user") { lastUserIndex = index; break; }
  }
  const alreadyRendered = items.slice(lastUserIndex + 1).some(item => item.kind === "assistant" && item.body?.trim() === normalized);
  return alreadyRendered ? items : [...items, create()];
}
