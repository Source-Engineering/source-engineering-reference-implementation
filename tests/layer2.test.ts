/**
 * Tests for the Layer 2 (Runtime Validation) module. Mirrors the conformance
 * suite's canonical test cases (TC-L2-01 .. TC-L2-06) and adds tests for the
 * reference implementation's own behaviour per the v0.2 contract:
 * https://github.com/Source-Engineering/source-engineering-architecture/blob/main/layer-contracts/layer-2-runtime-validation.md
 */

import { describe, it, expect } from "vitest";
import { Layer1 } from "../src/layer1/layer1.js";
import { Layer2, Layer2Error } from "../src/layer2/layer2.js";
import { MockModelAdapter } from "../src/adapters/mock-adapter.js";
import { LegalSummarizationDecisionType } from "../src/decision-types/legal-summarization.js";
import type { SourceArtifact } from "../src/cots.js";

const SAMPLE_SOURCE: SourceArtifact = {
  id: "urn:source-engineering:source:test-001",
  origin: { system_name: "Test", system_version: "1.0.0", configuration_hash: "0".repeat(64) },
  version: { content_hash: "1".repeat(64), issued_at: "2026-10-10T08:00:00Z" },
  authority: { asserted_by: "test", trust_score: 0.9 },
  temporal_validity: { valid_from: "2026-10-10T08:00:00Z", valid_until: null },
  content_reference: { uri: "https://example.com/test.pdf", media_type: "application/pdf" },
};

const buildCots = async () => {
  const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
  return layer1.invoke(
    { document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" } },
    [SAMPLE_SOURCE]
  );
};

const NOW = "2026-10-11T12:00:00Z";

describe("Layer 2 (Runtime Validation)", () => {
  it("TC-L2-01: attaches a well-formed Validation record to every decision", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2({ drift: [{ segment: "contract-law", divergence: 0.05, threshold: 0.1 }] });
    const validated = layer2.validate(cots, { now: NOW });
    for (const decision of validated.decisions) {
      expect(decision.validation).toBeDefined();
      expect(decision.validation!.decision_on_validation).toBe("passed");
      expect(decision.validation!.flags).toHaveLength(0);
      expect(decision.validation!.validated_at).toBe(NOW);
    }
  });

  it("TC-L2-01: raises drift-detected when divergence exceeds the threshold", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2({ drift: [{ segment: "contract-law", divergence: 0.14, threshold: 0.1 }] });
    const validated = layer2.validate(cots, { now: NOW });
    const flags = validated.decisions[0].validation!.flags;
    expect(flags.some((f) => f.flag_type === "drift-detected")).toBe(true);
    expect(validated.decisions[0].validation!.decision_on_validation).toBe("flagged");
  });

  it("raises segment-signal-divergence for drift on an operator-undeclared segment", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2({
      drift: [{ segment: "tort", divergence: 0.02, threshold: 0.1 }],
      segments: ["contract-law"],
    });
    const validated = layer2.validate(cots, { now: NOW });
    expect(
      validated.decisions[0].validation!.flags.some((f) => f.flag_type === "segment-signal-divergence")
    ).toBe(true);
  });

  it("raises parameter-set-out-of-range when a context parameter is outside the operator range", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2({ parameterSet: [{ parameter: "temperature", min: 0, max: 0.2 }] });
    const validated = layer2.validate(cots, { now: NOW });
    expect(
      validated.decisions[0].validation!.flags.some((f) => f.flag_type === "parameter-set-out-of-range")
    ).toBe(true);
  });

  it("does not reject: a flagged decision is still returned, not thrown", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2({ drift: [{ segment: "contract-law", divergence: 0.9, threshold: 0.1 }] });
    expect(() => layer2.validate(cots, { now: NOW })).not.toThrow();
    expect(layer2.validate(cots, { now: NOW }).decisions[0].validation!.decision_on_validation).toBe("flagged");
  });

  it("returns calibration-data-missing when calibration is absent", async () => {
    const cots = await buildCots();
    const layer2 = new Layer2(undefined as never);
    expect(() => layer2.validate(cots)).toThrow(Layer2Error);
    expect(() => layer2.validate(cots)).toThrow(/calibration-data-missing/);
  });

  it("returns context-missing when the COTS carries no context", async () => {
    const cots = await buildCots();
    const broken = { ...cots, context: undefined } as never;
    const layer2 = new Layer2({ drift: [] });
    expect(() => layer2.validate(broken)).toThrow(/context-missing/);
  });

  it("TC-L2-06: leaves a v1.0.0 COTS untouched (the field is optional; Layer 2 is opt-in)", async () => {
    const cots = await buildCots();
    expect(cots.decisions[0].validation).toBeUndefined();
  });
});
