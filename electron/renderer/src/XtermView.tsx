import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

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
      theme: {
        background: "#080e12",
        foreground: "#c5d3d9",
        cursor: "#28d1b4",
        cursorAccent: "#080e12",
        selectionBackground: "#27564f99",
        black: "#10171c",
        brightBlack: "#637680",
        red: "#e06c75",
        brightRed: "#ff7b86",
        green: "#6fcf97",
        brightGreen: "#82e6aa",
        yellow: "#e5c07b",
        brightYellow: "#f2d58d",
        blue: "#61afef",
        brightBlue: "#7bc1f5",
        magenta: "#c678dd",
        brightMagenta: "#da8df0",
        cyan: "#28cdb1",
        brightCyan: "#52e4ca",
        white: "#c8d4da",
        brightWhite: "#f1f6f8",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    terminalRef.current = terminal;
    fitRef.current = fit;

    let lastSize = "";
    const fitAndResize = () => {
      if (element.clientWidth < 10 || element.clientHeight < 10) return;
      try { fit.fit(); } catch { return; }
      const nextSize = `${terminal.cols}x${terminal.rows}`;
      if (nextSize !== lastSize) {
        lastSize = nextSize;
        onResize(terminal.cols, terminal.rows);
      }
    };
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(fitAndResize));
    resizeObserver.observe(element);
    const dataSubscription = terminal.onData(onData);
    const binarySubscription = terminal.onBinary(onData);
    terminal.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
        if (terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyV") {
        void navigator.clipboard.readText().then(text => onData(text));
        return false;
      }
      return true;
    });
    const handle: XtermHandle = {
      write: data => terminal.write(data),
      clear: () => { terminal.clear(); terminal.focus(); },
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
      resizeObserver.disconnect();
      dataSubscription.dispose();
      binarySubscription.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* hidden during a route transition */ }
      const terminal = terminalRef.current;
      if (terminal) {
        onResize(terminal.cols, terminal.rows);
        terminal.focus();
      }
    });
  }, [active]);

  return <div className={`xterm-session ${active ? "active" : "inactive"}`} ref={container}/>;
}
