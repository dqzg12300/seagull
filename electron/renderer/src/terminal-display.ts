export const TERMINAL_CLEAR_INPUT = "\x0c";

export function terminalResizeKey(cols: number, rows: number): string {
  return `${Math.max(2, Math.floor(cols))}x${Math.max(1, Math.floor(rows))}`;
}

export function shouldReportTerminalResize(previous: string, cols: number, rows: number): boolean {
  return terminalResizeKey(cols, rows) !== previous;
}
