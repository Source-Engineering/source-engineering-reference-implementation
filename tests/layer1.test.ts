/**
 * Tests for the reference implementation. Mirrors the conformance suite's
 * canonical test cases (TC-L1-01 .. TC-L1-07) and adds tests for the
 * reference implementation's own behaviour.
 */

import { describe, it, expect } from "vitest";
import { Layer1 } from "../src/layer1/layer1.js";
import { MockModelAdapter } from "../src/adapters/mock-adapter.js";
import { LegalSummarizationDecisionType } from "../src/decision-types/legal-summarization.js";
import { TransactionRoutingDecisionType } from "../src/decision-types/transaction-routing.js";
import type { SourceArtifact } from "../src/cots.js";

const SAMPLE_SOURCE: SourceArtifact = {
  id: "urn:source-engineering:source:test-001",
  origin: { system_name: "Test", system_version: "1.0.0", configuration_hash: "0".repeat(64) },
  version: { content_hash: "1".repeat(64), issued_at: "2026-10-10T08:00:00Z" },
  authority: { asserted_by: "test", trust_score: 0.9 },
  temporal_validity: { valid_from: "2026-10-10T08:00:00Z", valid_until: null },
  content_reference: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
};

describe("Layer 1 (Typed Model)", () => {
  it("TC-L1-01: accepts a typed question that conforms to the registered decision-type's question schema", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    expect(cots).toBeDefined();
    expect(cots.decisions).toHaveLength(1);
  });

  it("TC-L1-03: the model's answer conforms to the registered decision-type's answer schema", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    // The legal-summarization answer is a string; the decision_text must be a string.
    expect(typeof cots.decisions[0].decision_text).toBe("string");
  });

  it("TC-L1-04: every claim in the decision record has at least one evidence item", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    for (const chain of cots.evidence.evidence_chain) {
      for (const claim of chain.claims) {
        expect(claim.supporting_evidence.length + claim.contradicting_evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("TC-L1-05: every evidence item has a source_id and a transformation", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    for (const chain of cots.evidence.evidence_chain) {
      for (const item of chain.supporting_evidence) {
        expect(item.source_id).toBeTruthy();
        expect(item.transformation).toBeDefined();
        expect(item.uncertainty).toBeDefined();
      }
    }
  });

  it("TC-L1-06: the decision record carries counter-evidence (one piece the model considered and rejected)", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    for (const chain of cots.evidence.evidence_chain) {
      expect(chain.contradicting_evidence.length).toBeGreaterThan(0);
    }
  });

  it("TC-L1-07: the COTS context records the runtime parameters", async () => {
    const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
    const cots = await layer1.invoke(
      {
        document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
      },
      [SAMPLE_SOURCE]
    );
    expect(cots.context.model.model_name).toBe("mock-model");
    expect(cots.context.model.model_version).toBe("0.1.0");
    expect(cots.context.parameters.temperature).toBe(0.3);
    expect(cots.context.parameters.top_p).toBe(0.95);
  });
});

describe("Legal summarization decision-type", () => {
  it("validates a legal summarization question", () => {
    const question = {
      document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
    };
    const validated = LegalSummarizationDecisionType.validateQuestion(question);
    expect(validated.document.uri).toBe("https://example.com/test.pdf");
  });

  it("rejects a malformed question", () => {
    expect(() => LegalSummarizationDecisionType.validateQuestion({ document: { uri: "not-a-url" } })).toThrow();
  });
});

describe("Transaction routing decision-type", () => {
  it("validates a transaction routing question", () => {
    const question = {
      transaction: { id: "txn-001", amount: 1000, currency: "USD" },
      destinations: [{ id: "a" }, { id: "b" }],
    };
    const validated = TransactionRoutingDecisionType.validateQuestion(question);
    expect(validated.transaction.id).toBe("txn-001");
  });

  it("rejects fewer than two destinations", () => {
    expect(() =>
      TransactionRoutingDecisionType.validateQuestion({
        transaction: { id: "txn-001", amount: 1000, currency: "USD" },
        destinations: [{ id: "a" }],
      })
    ).toThrow();
  });
});
