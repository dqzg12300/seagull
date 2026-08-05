import { readFile } from "node:fs/promises";
import path from "node:path";

export type StdioServerConfig = {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type HttpServerConfig = {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = (StdioServerConfig | HttpServerConfig) & {
  enabled?: boolean;
  timeoutMs?: number;
  toolPrefix?: string;
};

export type MobileReverseConfig = {
  caseRoot: string;
  mcpServers: Record<string, McpServerConfig>;
};

const DEFAULT_CONFIG: MobileReverseConfig = {
  caseRoot: ".pi/cases",
  mcpServers: {},
};

export async function loadConfig(cwd: string): Promise<MobileReverseConfig> {
  const candidates = [
    path.join(cwd, ".pi", "mobile-reverse.json"),
    path.join(cwd, ".pi", "mcp.local.json"),
  ];
  for (const filename of candidates) {
    try {
      const parsed = JSON.parse(await readFile(filename, "utf8")) as Partial<MobileReverseConfig>;
      return {
        caseRoot: process.env.SEAGULL_CASE_ROOT ?? parsed.caseRoot ?? DEFAULT_CONFIG.caseRoot,
        mcpServers: parsed.mcpServers ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const fallback = structuredClone(DEFAULT_CONFIG);
  if (process.env.SEAGULL_CASE_ROOT) fallback.caseRoot = process.env.SEAGULL_CASE_ROOT;
  return fallback;
}

export function safeToolPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "tool";
}
