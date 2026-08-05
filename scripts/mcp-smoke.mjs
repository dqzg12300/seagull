import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const configPath = path.resolve(process.argv[2] ?? ".pi/mobile-reverse.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
let failed = false;

for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
  if (server.enabled === false || server.transport !== "stdio") continue;
  const client = new Client({ name: "seagull-mcp-smoke", version: "0.1.0" });
  try {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      cwd: server.cwd,
      env: server.env ? { ...process.env, ...server.env } : undefined,
      stderr: "pipe",
    });
    await client.connect(transport, { timeout: server.timeoutMs ?? 120_000 });
    const result = await client.listTools(undefined, { timeout: server.timeoutMs ?? 120_000 });
    console.log(`${name}: OK (${result.tools.length} tools)`);
    console.log(`  ${result.tools.map((tool) => tool.name).join(", ")}`);
  } catch (error) {
    failed = true;
    console.error(`${name}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.close().catch(() => {});
  }
}

if (failed) process.exitCode = 1;
