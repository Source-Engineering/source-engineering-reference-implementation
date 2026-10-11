/**
 * Example: produce a COTS for a transaction routing decision.
 *
 * Run:
 *   node dist/examples/transaction-routing.js
 *
 * The COTS is written to examples/output/transaction-routing.cots.json
 * and can be validated against the conformance suite.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Layer1 } from "../layer1/layer1.js";
import { MockModelAdapter } from "../adapters/mock-adapter.js";
import { TransactionRoutingDecisionType } from "../decision-types/transaction-routing.js";
import type { SourceArtifact } from "../cots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const main = async () => {
  const sourceArtifact: SourceArtifact = {
    id: "urn:source-engineering:source:routing-rules-2026-q4",
    origin: {
      system_name: "Acme Routing",
      system_version: "1.0.0",
      configuration_hash: "0000000000000000000000000000000000000000000000000000000000000002",
    },
    version: {
      content_hash: "3333333333333333333333333333333333333333333333333333333333333333",
      issued_at: "2026-10-01T00:00:00Z",
    },
    authority: { asserted_by: "acme-routing", trust_score: 0.9 },
    temporal_validity: { valid_from: "2026-10-01T00:00:00Z", valid_until: null },
    content_reference: { uri: "https://example.com/routing/rules-q4-2026.json", media_type: "application/json" },
  };

  const layer1 = new Layer1(TransactionRoutingDecisionType, new MockModelAdapter());
  const cots = await layer1.invoke(
    {
      transaction: {
        id: "txn-2026-10-11-001",
        amount: 25000,
        currency: "USD",
        origin: "us-east-1",
      },
      destinations: [
        { id: "domestic-fast", name: "US Domestic Fast" },
        { id: "international-slow", name: "International Slow" },
        { id: "domestic-batch", name: "US Domestic Batch" },
      ],
    },
    [sourceArtifact]
  );

  const outPath = resolve(__dirname, "..", "..", "examples", "output", "transaction-routing.cots.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(cots, null, 2));
  console.log(`COTS written to ${outPath}`);
  console.log(`Decision text: ${cots.decisions[0].decision_text.slice(0, 200)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
