export interface TerminalQuickCommand {
  id: string;
  name: string;
  command: string;
  scope: "global" | "case";
  caseId?: string;
}

export type TerminalQuickCommandFilter = "available" | "global" | "case";

export function parseTerminalQuickCommands(value: string | null): TerminalQuickCommand[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): TerminalQuickCommand[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<TerminalQuickCommand>;
      const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 100) : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 80) : "";
      const command = typeof candidate.command === "string" ? candidate.command.trim().slice(0, 20_000) : "";
      const scope = candidate.scope === "case" && typeof candidate.caseId === "string" && candidate.caseId.trim() ? "case" : "global";
      const caseId = scope === "case" ? candidate.caseId!.trim().slice(0, 160) : undefined;
      return id && name && command ? [{ id, name, command, scope, ...(caseId ? { caseId } : {}) }] : [];
    }).slice(0, 500);
  } catch {
    return [];
  }
}

export function filterTerminalQuickCommands(commands: TerminalQuickCommand[], caseId: string | undefined, filter: TerminalQuickCommandFilter, query = ""): TerminalQuickCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  return commands.filter(item => {
    const inScope = filter === "global"
      ? item.scope === "global"
      : filter === "case"
        ? item.scope === "case" && Boolean(caseId) && item.caseId === caseId
        : item.scope === "global" || (item.scope === "case" && Boolean(caseId) && item.caseId === caseId);
    if (!inScope) return false;
    return !needle || item.name.toLocaleLowerCase().includes(needle) || item.command.toLocaleLowerCase().includes(needle);
  });
}

export function terminalCommandPayload(command: string): string {
  return `${command.trim().replace(/\r?\n/g, "\r")}\r`;
}

export function isTerminalQuickCommandShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase() === "k";
}
