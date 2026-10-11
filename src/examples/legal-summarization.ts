/**
 * Example: produce a COTS for a legal document summarisation.
 *
 * Run:
 *   node dist/examples/legal-summarization.js
 *
 * The COTS is written to examples/output/legal-summarization.cots.json
 * and can be validated against the conformance suite.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Layer1 } from "../layer1/layer1.js";
import { MockModelAdapter } from "../adapters/mock-adapter.js";
import { LegalSummarizationDecisionType } from "../decision-types/legal-summarization.js";
import type { SourceArtifact } from "../cots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const main = async () => {
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

  const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
  const cots = await layer1.invoke(
    {
      document: {
        uri: "https://example.com/contracts/2026-001.pdf",
        media_type: "application/pdf",
        language: "en",
        jurisdiction: "US-NY",
      },
      summary_intent: "executive",
      audience: "attorney",
    },
    [sourceArtifact]
  );

  const outPath = resolve(__dirname, "..", "..", "examples", "output", "legal-summarization.cots.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(cots, null, 2));
  console.log(`COTS written to ${outPath}`);
  console.log(`Decision text: ${cots.decisions[0].decision_text.slice(0, 100)}...`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
