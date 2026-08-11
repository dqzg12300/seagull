export interface IdentifiedTimelineItem {
  id: string;
}

export function upsertTimelineItem<T extends IdentifiedTimelineItem>(items: T[], item: T): T[] {
  const index = items.findIndex(current => current.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((current, currentIndex) => currentIndex === index ? { ...current, ...item } : current);
}
