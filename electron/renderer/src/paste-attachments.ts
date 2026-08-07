export const PASTED_TEXT_ATTACHMENT_MIN_CHARACTERS = 5_000;
export const PASTED_TEXT_RESTORE_MAX_CHARACTERS = 25_000;
export const PASTED_TEXT_PREVIEW_CHARACTERS = 80;

export function shouldAttachPastedText(text: string): boolean {
  return text.length >= PASTED_TEXT_ATTACHMENT_MIN_CHARACTERS;
}

export function canRestorePastedText(text: string): boolean {
  return text.length >= PASTED_TEXT_ATTACHMENT_MIN_CHARACTERS
    && text.length <= PASTED_TEXT_RESTORE_MAX_CHARACTERS;
}

export function pastedTextPreview(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "Pasted text";
  if (normalized.length <= PASTED_TEXT_PREVIEW_CHARACTERS) return normalized;
  return `${normalized.slice(0, PASTED_TEXT_PREVIEW_CHARACTERS - 1)}…`;
}
