/**
 * Tests for the Layer 3 (Business Guardrails) module: DSL parsing, rule
 * evaluation, GuardrailDecision attachment, and the contract's guarantees
 * (no silent rejection, binding/advisory distinction, status updates).
 *
 * See: RFC-0003 and the Layer 3 contract.
 */

import { describe, it, expect } from "vitest";
import { Layer1 } from "../src/layer1/layer1.js";
import { Layer2 } from "../src/layer2/layer2.js";
import { Layer3, Layer3Error, parseRules } from "../src/layer3/layer3.js";
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

const NOW = "2026-10-30T12:00:00Z";

const buildCots = async () => {
  const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
  return layer1.invoke(
    { document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" } },
    [SAMPLE_SOURCE],
    {
      constraints: [
        { id: "urn:source-engineering:constraint:c1", type: "jurisdiction", scope: "all_decisions", value: "US-NY" },
      ],
    }
  );
};

describe("Layer 3 rule parsing", () => {
  it("parses a well-formed rule block", () => {
    const rules = parseRules(`
      rule ny-jurisdiction-reject {
        when constraint(all_decisions) != "US-NY"
        then reject
        with rationale "Out-of-jurisdiction summaries require human sign-off."
      }
    `);
    expect(rules).toHaveLength(1);
    expect(rules[0].rule_id).toBe("ny-jurisdiction-reject");
    expect(rules[0].then).toBe("reject");
  });

  it("returns guardrail-rules-malformed for a malformed rule block", () => {
    expect(() => parseRules("rule broken { when ??? then reject }")).toThrow(Layer3Error);
    expect(() => parseRules("")).toThrow(Layer3Error);
  });

  it("returns guardrail-rules-malformed for an unknown condition", () => {
    expect(() =>
      parseRules(`rule bad {
        when something_weird("x")
        then reject
        with rationale "No."
      }`)
    ).toThrow(/guardrail-rules-malformed/);
  });
});

describe("Layer 3 evaluation", () => {
  it("rejects on a violated binding jurisdiction rule and updates validation_status", async () => {
    const cots = await buildCots();
    const layer3 = new Layer3(
      parseRules(`
        rule ny-only {
          when constraint(all_decisions) == "US-NY"
          then reject
          with rationale "The declared jurisdiction does not admit automated summarisation."
        }
      `)
    );
    const result = layer3.evaluate(cots, { now: NOW });
    const d = result.cots.decisions[0];
    expect(d.guardrail!.decision).toBe("rejected");
    expect(d.guardrail!.binding).toBe(true);
    expect(d.validation_status.status).toBe("superseded");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].rule_id).toBe("ny-only");
  });

  it("annotates on an advisory rule without binding force", async () => {
    const cots = await buildCots();
    const layer3 = new Layer3(
      parseRules(`
        rule flag-advisory {
          when flag(drift-detected)
          then annotate
          with rationale "Calibration drift was flagged at runtime; the reviewer should weigh this summary accordingly."
        }
      `)
    );
    const layer2 = new Layer2({ drift: [{ segment: "contract-law", divergence: 0.2, threshold: 0.1 }] });
    const flagged = layer2.validate(cots, { now: NOW });
    const result = layer3.evaluate(flagged, { now: NOW });
    const d = result.cots.decisions[0];
    expect(d.guardrail!.decision).toBe("annotated");
    expect(d.guardrail!.binding).toBe(false);
    expect(d.validation_status.status).toBe("pending");
    expect(result.rejected).toHaveLength(0);
  });

  it("escalates and sets the status to appealed", async () => {
    const cots = await buildCots();
    const layer3 = new Layer3(
      parseRules(`
        rule escalate-drift {
          when flag(drift-detected)
          then escalate
          with rationale "Drift detected; a human reviewer must sign off."
        }
      `)
    );
    const layer2 = new Layer2({ drift: [{ segment: "contract-law", divergence: 0.2, threshold: 0.1 }] });
    const flagged = layer2.validate(cots, { now: NOW });
    const result = layer3.evaluate(flagged, { now: NOW });
    const d = result.cots.decisions[0];
    expect(d.guardrail!.decision).toBe("escalated");
    expect(d.validation_status.status).toBe("appealed");
    expect(result.escalated).toHaveLength(1);
  });

  it("accepts when no rule matches, with a recorded rationale", async () => {
    const cots = await buildCots();
    const layer3 = new Layer3(
      parseRules(`
        rule eu-only {
          when constraint(all_decisions) == "EU-DE"
          then reject
          with rationale "Wrong jurisdiction for this rule to fire."
        }
      `)
    );
    const result = layer3.evaluate(cots, { now: NOW });
    const d = result.cots.decisions[0];
    expect(d.guardrail!.decision).toBe("accepted");
    expect(d.guardrail!.rationale).toContain("No guardrail rule matched");
    expect(result.rejected).toHaveLength(0);
  });

  it("returns domain-rules-missing for an empty rule set", () => {
    expect(() => new Layer3([])).toThrow(/domain-rules-missing/);
  });

  it("no silent rejection: the rejected decision is still present with its guardrail record", async () => {
    const cots = await buildCots();
    const layer3 = new Layer3(
      parseRules(`
        rule always {
          when constraint(all_decisions) == "US-NY"
          then reject
          with rationale "This rule fires for the fixture's jurisdiction."
        }
      `)
    );
    const result = layer3.evaluate(cots, { now: NOW });
    expect(result.cots.decisions).toHaveLength(cots.decisions.length);
    expect(result.cots.decisions[0].guardrail!.decision).toBe("rejected");
    expect(result.cots.decisions[0].guardrail!.rationale).toContain("jurisdiction");
  });
});
