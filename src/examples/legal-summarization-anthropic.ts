/**
 * Dogfooding example: produce a COTS from a REAL LLM call via the Anthropic
 * adapter (Advancement Plan Phase 5, publisher-side dogfooding).
 *
 * Run:
 *   export ANTHROPIC_API_KEY=sk-...
 *   npm run build
 *   npm run example:legal-summarization-anthropic
 *
 * The COTS is written to examples/output/legal-summarization-anthropic.cots.json
 * together with a run-record JSON (prompt, model, parameters, timestamps,
 * content hashes) so the example is recorded and reproducible. Validate the
 * COTS with the conformance suite:
 *
 *   (in source-engineering-conformance) node dist/cli.js validate <path>
 *   (in source-engineering-tools)       node dist/cli/se-trace.js explore <path> -o ./out
 *
 * Without ANTHROPIC_API_KEY the script exits with a clear message; the mock
 * example (example:legal-summarization) remains the offline path.
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Layer1 } from "../layer1/layer1.js";
import { AnthropicModelAdapter } from "../adapters/anthropic-adapter.js";
import { LegalSummarizationDecisionType } from "../decision-types/legal-summarization.js";
import type { SourceArtifact } from "../cots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const main = async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. This example performs a real LLM call and needs a key.\n" +
        "For the offline path, use: npm run example:legal-summarization"
    );
    process.exit(1);
  }

  const sourceArtifact: SourceArtifact = {
    id: "urn:source-engineering:source:example-contract-2026-001",
    origin: {
      system_name: "Acme Contracts",
      system_version: "1.0.0",
      configuration_hash: "0000000000000000000000000000000000000000000000000000000000000001",
    },
    version: {
      content_hash: "1111111111111111111111111111111111111111111111111111111111111111",
      issued_at: "2026-10-10T08:00:00Z",
    },
    authority: { asserted_by: "acme-contracts", trust_score: 0.95 },
    temporal_validity: { valid_from: "2026-10-10T08:00:00Z", valid_until: null },
    content_reference: { uri: "https://example.com/contracts/2026-001.pdf", media_type: "application/pdf" },
  };

  const question = {
    document: { uri: "https://example.com/contracts/2026-001.pdf", media_type: "application/pdf" },
  };

  const adapter = new AnthropicModelAdapter();
  const startedAt = new Date().toISOString();
  const layer1 = new Layer1(LegalSummarizationDecisionType, adapter);
  const cots = await layer1.invoke(question, [sourceArtifact]);
  const finishedAt = new Date().toISOString();

  const outDir = resolve(__dirname, "..", "..", "examples", "output");
  mkdirSync(outDir, { recursive: true });
  const cotsPath = resolve(outDir, "legal-summarization-anthropic.cots.json");
  writeFileSync(cotsPath, JSON.stringify(cots, null, 2));

  const runRecord = {
    kind: "se-dogfood-run-record",
    example: "legal-summarization-anthropic",
    adapter: { name: adapter.name, version: adapter.version },
    started_at: startedAt,
    finished_at: finishedAt,
    cots_id: cots.cots_id,
    cots_sha256: sha256(JSON.stringify(cots)),
    decision_text_sha256: sha256(cots.decisions[0].decision_text),
    note: "Recorded, reproducible run of the Anthropic adapter. Re-running with the same prompt and model version should produce the same COTS shape; the decision text may vary with the model.",
  };
  const recordPath = resolve(outDir, "legal-summarization-anthropic.run-record.json");
  writeFileSync(recordPath, JSON.stringify(runRecord, null, 2));

  console.log(`COTS written to ${cotsPath}`);
  console.log(`Run record written to ${recordPath}`);
  console.log(`Decision text (first 200 chars): ${cots.decisions[0].decision_text.slice(0, 200)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
