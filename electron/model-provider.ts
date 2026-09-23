import type { AppSettings, ModelApiProtocol } from "./shared.js";

function cleanUrl(value: string): URL {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

export function normalizeModelBaseUrl(value: string, protocol: ModelApiProtocol): string {
  const url = cleanUrl(value);
  if (protocol === "openai") {
    if (url.pathname === "/") url.pathname = "/v1";
  } else if (url.pathname === "/v1" || url.pathname.endsWith("/v1")) {
    url.pathname = url.pathname.slice(0, -3) || "/";
  }
  return url.toString().replace(/\/$/, "");
}

export function modelApiName(protocol: ModelApiProtocol): "openai-completions" | "anthropic-messages" {
  return protocol === "anthropic" ? "anthropic-messages" : "openai-completions";
}

export function modelListRequest(settings: Pick<AppSettings, "baseUrl" | "apiKey" | "apiProtocol">): { endpoint: string; headers: Record<string, string> } {
  const protocol = settings.apiProtocol ?? "openai";
  const baseUrl = normalizeModelBaseUrl(settings.baseUrl, protocol);
  if (protocol === "anthropic") {
    return {
      endpoint: `${baseUrl}/v1/models`,
      headers: {
        Accept: "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
    };
  }
  return {
    endpoint: `${baseUrl}/models`,
    headers: { Accept: "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
  };
}

export function parseModelIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const body = value as { data?: unknown; models?: unknown };
  const entries = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return [...new Set(entries.flatMap(item => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && (item as { id: string }).id.trim()) return [(item as { id: string }).id.trim()];
    return [];
  }))].sort((a, b) => a.localeCompare(b));
}
