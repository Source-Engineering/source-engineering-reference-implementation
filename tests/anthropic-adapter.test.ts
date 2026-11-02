/**
 * Tests for the Anthropic adapter (dogfooding path). The real API is never
 * called in tests: fetch is stubbed. Verifies request shape, response
 * extraction, error handling, and the missing-key guard.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicModelAdapter } from "../src/adapters/anthropic-adapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnthropicModelAdapter", () => {
  it("throws a clear error when no API key is available", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicModelAdapter()).toThrow(/API key not found/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("sends the documented request shape and extracts text blocks", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            content: [
              { type: "text", text: "Summary: " },
              { type: "tool_use", name: "x" },
              { type: "text", text: "the contract." },
            ],
          }),
          { status: 200 }
        );
      })
    );
    const adapter = new AnthropicModelAdapter({ apiKey: "test-key", model: "claude-sonnet-4-5" });
    const out = await adapter.complete("Summarise this contract.");
    expect(out).toBe("Summary: the contract.");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("Summarise this contract.");
  });

  it("surfaces API errors with status and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 }))
    );
    const adapter = new AnthropicModelAdapter({ apiKey: "test-key" });
    await expect(adapter.complete("hi")).rejects.toThrow(/Anthropic API error 429/);
  });
});
