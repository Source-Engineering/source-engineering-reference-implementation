/**
 * Mock model adapter. Deterministic; for development and testing.
 *
 * The mock adapter:
 * - Always succeeds (returns a canned answer derived from the question)
 * - Records the prompt it received
 * - Exposes its name and version for the COTS context
 */

import type { ModelAdapter } from "../build-cots.js";

export class MockModelAdapter implements ModelAdapter<unknown, unknown> {
  readonly name = "mock-model";
  readonly version = "0.1.0";

  async complete(prompt: string): Promise<string> {
    // The mock returns a deterministic, summarised version of the prompt.
    // The "summary" is the first 280 characters of the prompt, trimmed.
    const summary = prompt.replace(/\s+/g, " ").trim().slice(0, 280);
    return `Summary: ${summary}`;
  }
}
