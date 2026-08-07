import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { terminalContextAction } from "./terminal-clipboard.js";
import { shouldReportTerminalResize, terminalResizeKey } from "./terminal-display.js";
import "@xterm/xterm/css/xterm.css";

const darkTerminalTheme = {
  background: "#080e12", foreground: "#c5d3d9", cursor: "#28d1b4", cursorAccent: "#080e12", selectionBackground: "#27564f99",
  black: "#10171c", brightBlack: "#637680", red: "#e06c75", brightRed: "#ff7b86", green: "#6fcf97", brightGreen: "#82e6aa",
  yellow: "#e5c07b", brightYellow: "#f2d58d", blue: "#61afef", brightBlue: "#7bc1f5", magenta: "#c678dd", brightMagenta: "#da8df0",
  cyan: "#28cdb1", brightCyan: "#52e4ca", white: "#c8d4da", brightWhite: "#f1f6f8",
};

const lightTerminalTheme = {
  background: "#f8fbfc", foreground: "#26363e", cursor: "#078b79", cursorAccent: "#f8fbfc", selectionBackground: "#58b8a74d",
  black: "#2c3940", brightBlack: "#657780", red: "#b83242", brightRed: "#d94a59", green: "#28794a", brightGreen: "#34985c",
  yellow: "#8a6818", brightYellow: "#a98222", blue: "#236aa1", brightBlue: "#3786bf", magenta: "#7b4794", brightMagenta: "#9658b2",
  cyan: "#087f72", brightCyan: "#0ca28f", white: "#dfe7ea", brightWhite: "#ffffff",
};

function terminalTheme() {
  return document.documentElement.dataset.theme === "light" ? lightTerminalTheme : darkTerminalTheme;
}

export interface XtermHandle {
  write(data: string): void;
  clear(): void;
  copyAll(): string;
  focus(): void;
}

interface XtermViewProps {
  active: boolean;
  onData(data: string): void;
  onResize(cols: number, rows: number): void;
  onReady(handle?: XtermHandle): void;
}

export function XtermView({ active, onData, onResize, onReady }: XtermViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const fitAndResizeRef = useRef<() => void>(() => undefined);
  const lastReportedSize = useRef("");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      convertEol: false,
      disableStdin: false,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      smoothScrollDuration: 80,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const fitAndResize = () => {
      if (element.clientWidth < 10 || element.clientHeight < 10) return;
      try { fit.fit(); } catch { return; }
      if (shouldReportTerminalResize(lastReportedSize.current, terminal.cols, terminal.rows)) {
        lastReportedSize.current = terminalResizeKey(terminal.cols, terminal.rows);
        onResize(terminal.cols, terminal.rows);
      }
    };
    fitAndResizeRef.current = fitAndResize;
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(fitAndResize));
    resizeObserver.observe(element);
    const dataSubscription = terminal.onData(onData);
    const binarySubscription = terminal.onBinary(onData);
    const pasteClipboard = () => navigator.clipboard.readText().then(text => {
      if (text) terminal.paste(text);
      terminal.focus();
    }).catch(() => undefined);
    terminal.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
        if (terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection()).then(() => terminal.clearSelection()).catch(() => undefined);
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyV") {
        void pasteClipboard();
        return false;
      }
      return true;
    });
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const action = terminalContextAction(terminal.hasSelection() ? terminal.getSelection() : "");
      if (action.type === "copy") {
        void navigator.clipboard.writeText(action.text).then(() => {
          terminal.clearSelection();
          terminal.focus();
        }).catch(() => undefined);
      } else void pasteClipboard();
    };
    element.addEventListener("contextmenu", handleContextMenu);
    const handle: XtermHandle = {
      write: data => terminal.write(data),
      clear: () => {
        terminal.clearSelection();
        terminal.clear();
        terminal.write("\x1b[2J\x1b[3J\x1b[H");
        terminal.focus();
      },
      copyAll: () => {
        const buffer = terminal.buffer.active;
        const lines: string[] = [];
        for (let index = 0; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
        return lines.join("\n").replace(/\n+$/g, "");
      },
      focus: () => terminal.focus(),
    };
    onReady(handle);
    requestAnimationFrame(fitAndResize);
    return () => {
      onReady(undefined);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      element.removeEventListener("contextmenu", handleContextMenu);
      dataSubscription.dispose();
      binarySubscription.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
      fitAndResizeRef.current = () => undefined;
      lastReportedSize.current = "";
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fitAndResizeRef.current();
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.focus();
      }
    });
  }, [active]);

  return <div className={`xterm-session ${active ? "active" : "inactive"}`} ref={container}/>;
}
