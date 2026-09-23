import { describe, expect, it } from "vitest";
import { modelApiName, modelListRequest, normalizeModelBaseUrl, parseModelIds } from "../electron/model-provider.js";

describe("model provider configuration", () => {
  it("adds /v1 to a root OpenAI-compatible gateway", () => {
    expect(normalizeModelBaseUrl("https://5yuantoken.org", "openai")).toBe("https://5yuantoken.org/v1");
    expect(modelListRequest({ baseUrl: "https://5yuantoken.org", apiKey: "secret", apiProtocol: "openai" })).toMatchObject({
      endpoint: "https://5yuantoken.org/v1/models",
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("uses the native Anthropic models endpoint and headers", () => {
    expect(normalizeModelBaseUrl("https://claude-relay.example/v1", "anthropic")).toBe("https://claude-relay.example");
    expect(modelListRequest({ baseUrl: "https://claude-relay.example/v1", apiKey: "secret", apiProtocol: "anthropic" })).toEqual({
      endpoint: "https://claude-relay.example/v1/models",
      headers: { Accept: "application/json", "x-api-key": "secret", "anthropic-version": "2023-06-01" },
    });
    expect(modelApiName("anthropic")).toBe("anthropic-messages");
  });

  it("parses both OpenAI and Anthropic model list shapes", () => {
    expect(parseModelIds({ data: [{ id: "claude-sonnet" }, { id: "claude-opus" }] })).toEqual(["claude-opus", "claude-sonnet"]);
    expect(parseModelIds({ models: ["gpt-b", { id: "gpt-a" }] })).toEqual(["gpt-a", "gpt-b"]);
  });
});
