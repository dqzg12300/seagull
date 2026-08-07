export type TerminalContextAction = { type: "copy"; text: string } | { type: "paste" };

/** Windows Terminal-style right-click behavior: copy an active selection;
 * otherwise paste the clipboard into the terminal. */
export function terminalContextAction(selection: string): TerminalContextAction {
  return selection ? { type: "copy", text: selection } : { type: "paste" };
}
