import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { CaseStore } from "./case-store.js";
import type { McpServerConfig } from "./config.js";
import { safeToolPart } from "./config.js";

export type ServerStatus = { name: string; connected: boolean; tools: string[]; error?: string };

type ConnectedServer = { client: Client; transport: Transport; config: McpServerConfig; tools: string[] };

export class McpBridge {
  private readonly connections = new Map<string, ConnectedServer>();
  private readonly statuses = new Map<string, ServerStatus>();

  constructor(private readonly pi: ExtensionAPI, private readonly store: CaseStore) {}

  getStatus(): ServerStatus[] { return [...this.statuses.values()]; }

  async connectAll(configs: Record<string, McpServerConfig>): Promise<ServerStatus[]> {
    for (const [name, config] of Object.entries(configs)) {
      if (config.enabled === false) continue;
      await this.connect(name, config);
    }
    return this.getStatus();
  }

  async connect(name: string, config: McpServerConfig): Promise<void> {
    const status: ServerStatus = { name, connected: false, tools: [] };
    this.statuses.set(name, status);
    try {
      const transport = this.makeTransport(config);
      const client = new Client({ name: "pi-mobile-reverse", version: "0.1.0" });
      await client.connect(transport);
      const discovered = await client.listTools();
      const tools: string[] = [];
      for (const tool of discovered.tools) {
        const piName = `${safeToolPart(config.toolPrefix ?? name)}__${safeToolPart(tool.name)}`;
        tools.push(piName);
        const schema = Type.Unsafe((tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>) as TSchema;
        this.pi.registerTool({
          name: piName,
          label: `${name}: ${tool.name}`,
          description: `[MCP ${name}] ${tool.description ?? tool.name}`,
          promptSnippet: `Call ${tool.name} on the ${name} MCP server`,
          parameters: schema,
          execute: async (_id, params, signal) => {
            const started = Date.now();
            const timeoutMs = config.timeoutMs ?? 120_000;
            const timeout = AbortSignal.timeout(timeoutMs);
            const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
            const result = await client.callTool({ name: tool.name, arguments: params as Record<string, unknown> }, CallToolResultSchema, { signal: combined });
            const evidence = await this.store.recordToolCall(name, tool.name, params, result, Date.now() - started);
            const content = Array.isArray(result.content)
              ? result.content as Array<{ type: string; text?: string }>
              : [];
            const text = content
              .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
              .map(item => item.text).join("\n");
            return {
              content: [{ type: "text" as const, text: text || JSON.stringify(result.structuredContent ?? result, null, 2) }],
              details: { server: name, remoteTool: tool.name, isError: result.isError ?? false, evidence, raw: result },
            };
          },
        });
      }
      this.connections.set(name, { client, transport, config, tools });
      Object.assign(status, { connected: true, tools });
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.connections.values()].map(connection => connection.client.close()));
    this.connections.clear();
  }

  private makeTransport(config: McpServerConfig): Transport {
    if (config.transport === "stdio") {
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
        cwd: config.cwd,
        stderr: "pipe",
      });
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }
}
