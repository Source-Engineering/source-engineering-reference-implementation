/**
 * Anthropic API adapter. Activated when ANTHROPIC_API_KEY is set.
 *
 * To use:
 *   export ANTHROPIC_API_KEY=sk-...
 *   import { AnthropicModelAdapter } from "./adapters/anthropic-adapter.js";
 *
 * The adapter is intentionally minimal: it sends the prompt to claude-sonnet-4-5
 * and returns the response text. It does not attempt to be a full wrapper; the
 * discipline's surface is the COTS, not the model API.
 */

import type { ModelAdapter } from "../build-cots.js";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model?: string;
  apiUrl?: string;
}

export class AnthropicModelAdapter implements ModelAdapter<unknown, unknown> {
  readonly name: string;
  readonly version: string;
  model: string;  // exposed for compatibility with the adapter interface
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(options: AnthropicAdapterOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic API key not found. Set ANTHROPIC_API_KEY or pass { apiKey } explicitly."
      );
    }
    this.apiKey = apiKey;
    const model = options.model ?? "claude-sonnet-4-5";
    this.model = model;
    this.name = model;
    this.version = "1.0.0";
    this.apiUrl = options.apiUrl ?? "https://api.anthropic.com/v1/messages";
  }

  async complete(prompt: string): Promise<string> {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return text;
  }
}
