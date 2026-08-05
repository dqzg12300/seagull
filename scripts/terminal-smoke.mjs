import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.versions.electron) {
  const { default: electronPath } = await import("electron");
  const result = spawnSync(electronPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const pty = await import("node-pty");
const windows = process.platform === "win32";
const executable = windows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
const args = windows ? ["-NoLogo", "-NoProfile"] : ["-i"];
const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
const terminal = pty.spawn(executable, args, {
  name: "xterm-256color",
  cols: 100,
  rows: 24,
  cwd: process.cwd(),
  env: environment,
  useConpty: windows,
});
let output = "";
const timeout = setTimeout(() => {
  try { terminal.kill(); } catch { /* already exited */ }
  console.error("terminal smoke timed out");
  process.exit(1);
}, 10_000);
terminal.onData(data => {
  output += data;
  if (!output.includes("__SEAGULL_PTY_OK__")) return;
  clearTimeout(timeout);
  try { terminal.kill(); } catch { /* process may exit first */ }
  console.log(`terminal smoke ok: Electron ${process.versions.electron}, ABI ${process.versions.modules}, ConPTY ${windows}`);
  process.exit(0);
});
terminal.onExit(({ exitCode }) => {
  if (!output.includes("__SEAGULL_PTY_OK__")) {
    clearTimeout(timeout);
    console.error(`terminal exited before marker (code ${exitCode})`);
    process.exit(1);
  }
});
terminal.write(windows ? "Write-Output __SEAGULL_PTY_OK__\r" : "printf '__SEAGULL_PTY_OK__\\n'\r");
