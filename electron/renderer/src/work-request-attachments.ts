import type { ImageAttachment } from "../../shared.js";

export type WorkRequestTextAttachment = { name: string; text: string };

export function workRequestAttachmentContext(texts: WorkRequestTextAttachment[], images: ImageAttachment[]): string {
  return [
    texts.length
      ? `\n\n[PASTED_TEXT_ATTACHMENTS]\n${texts.map((item, index) => `## Text ${index + 1}: ${item.name.replace(/\r?\n/g, " ")}\n${item.text}`).join("\n\n")}`
      : "",
    images.length
      ? `\n\n[IMAGE_ATTACHMENTS]\n${images.map(image => `- ${image.name.replace(/\r?\n/g, " ")} (${image.mimeType})`).join("\n")}`
      : "",
  ].join("");
}

export function workRequestGoal(value: string, hasAttachments: boolean, locale: "zh-CN" | "en-US"): string {
  const goal = value.trim();
  if (!hasAttachments || goal.length >= 10) return goal;
  const attachmentInstruction = locale === "zh-CN"
    ? "请结合附加的长文本和图片材料，规划并完成本次工作。"
    : "Use the attached long text and images to plan and complete this work.";
  return goal ? `${goal}\n\n${attachmentInstruction}` : attachmentInstruction;
}

export function canSubmitWorkRequest(value: string, hasAttachments: boolean): boolean {
  return value.trim().length >= 10 || hasAttachments;
}
