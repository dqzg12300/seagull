type MessageContentBlock = {
  type?: unknown;
  text?: unknown;
};

type AgentMessageLike = {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
};

function assistantMessages(value: unknown): AgentMessageLike[] {
  if (!value || typeof value !== "object") return [];
  const event = value as { type?: unknown; messages?: unknown };
  if (event.type !== "agent_end" || !Array.isArray(event.messages)) return [];
  return event.messages.filter((message): message is AgentMessageLike => Boolean(message) && typeof message === "object" && (message as AgentMessageLike).role === "assistant");
}

export function assistantMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as AgentMessageLike).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is MessageContentBlock => Boolean(block) && typeof block === "object")
    .filter(block => block.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

export function assistantMessageFailure(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const value = message as AgentMessageLike;
  if (value.role !== "assistant" || value.stopReason !== "error") return undefined;
  const detail = typeof value.errorMessage === "string" ? value.errorMessage.trim() : "";
  return detail || "The model provider ended the response with an error.";
}

export function latestAssistantFailure(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || (message as AgentMessageLike).role !== "assistant") continue;
    return assistantMessageFailure(message);
  }
  return undefined;
}

/** Return the user request that belongs to the latest terminal provider
 * failure. This is used to migrate queues written by older builds, which put
 * a failed running request back at the front of the persisted queue. */
export function latestFailedUserPromptText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  let failedAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || (message as AgentMessageLike).role !== "assistant") continue;
    if (!assistantMessageFailure(message)) return undefined;
    failedAssistantIndex = index;
    break;
  }
  if (failedAssistantIndex < 0) return undefined;
  for (let index = failedAssistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || (message as AgentMessageLike).role !== "user") continue;
    const text = assistantMessageText(message).trim();
    return text || undefined;
  }
  return undefined;
}

function terminalAssistantMessage(event: unknown): AgentMessageLike | undefined {
  return assistantMessages(event).at(-1);
}

export function agentTurnWillRetry(event: unknown): boolean {
  return Boolean(event && typeof event === "object" && (event as { type?: unknown }).type === "agent_end" && (event as { willRetry?: unknown }).willRetry === true);
}

/** The SDK reports provider failures inside the terminal assistant message rather
 * than as a thrown worker error. Consumers must inspect agent_end.messages or a
 * failed request otherwise looks like a successful, textless completion. */
export function agentTurnFailure(event: unknown): string | undefined {
  return assistantMessageFailure(terminalAssistantMessage(event));
}

/** Some OpenAI-compatible providers deliver a final message without streaming
 * text deltas. Recover that text from agent_end so the UI does not discard it. */
export function agentTurnText(event: unknown): string {
  return assistantMessageText(terminalAssistantMessage(event));
}
