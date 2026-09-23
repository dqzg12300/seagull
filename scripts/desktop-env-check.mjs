import { readFileSync } from "node:fs";

function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

if (isWsl()) {
  console.error(`
Seagull 是 Windows Electron 桌面应用，不能在 /mnt/c 下复用 Windows 的 node_modules。
Rollup、Electron 和 node-pty 都包含平台相关的原生依赖。

请改用 Windows PowerShell：
  cd C:\\Users\\standardsoftware\\Documents\\autoRe
  npm install --include=optional
  npm run app:dev

请勿让 Windows 与 WSL 共用同一个 node_modules 目录。
如需在 WSL 中构建，请在 WSL 自己的 Linux 文件系统中使用独立副本并重新安装依赖。
`);
  process.exit(1);
}
