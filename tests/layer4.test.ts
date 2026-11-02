/**
 * Tests for the Layer 4 (Audit Trail) module: append-only store behaviour,
 * change-event application, rerun linkage, retention policy, and replay.
 *
 * See: RFC-0005 and the Layer 4 contract.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layer1 } from "../src/layer1/layer1.js";
import { Layer4, JsonlAuditStore, MemoryAuditStore, Layer4Error } from "../src/layer4/layer4.js";
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

const RETENTION = { retain_until: null, declared_by: "test-domain" };

const buildCots = async () => {
  const layer1 = new Layer1(LegalSummarizationDecisionType, new MockModelAdapter());
  return layer1.invoke(
    { document: { uri: "https://example.com/test.pdf", media_type: "application/pdf" } },
    [SAMPLE_SOURCE],
    { constraints: [] }
  );
};

describe("Layer 4 (RFC-0005)", () => {
  it("requires a domain-declared retention policy", () => {
    expect(() => new Layer4(new MemoryAuditStore(), { retain_until: null, declared_by: "" })).toThrow(Layer4Error);
    try {
      new Layer4(new MemoryAuditStore(), { retain_until: null, declared_by: "" });
    } catch (e) {
      expect((e as Layer4Error).reason).toBe("retention-policy-missing");
    }
  });

  it("records creation once and mirrors it into the DecisionRecord", async () => {
    const cots = await buildCots();
    const store = new MemoryAuditStore();
    const layer4 = new Layer4(store, RETENTION);
    const d = cots.decisions[0];
    const e1 = layer4.recordCreation(cots, d, "2026-11-02T10:00:00Z");
    const e2 = layer4.recordCreation(cots, d, "2026-11-02T10:00:00Z");
    expect(e1.id).toBe(e2.id);
    expect(store.all().filter((e) => e.action === "created")).toHaveLength(1);
    expect(d.audit_history.some((e) => e.action === "created")).toBe(true);
  });

  it("appends change events and rejects unknown decisions", async () => {
    const cots = await buildCots();
    const layer4 = new Layer4(new MemoryAuditStore(), RETENTION);
    const d = cots.decisions[0];
    layer4.recordCreation(cots, d, "2026-11-02T10:00:00Z");
    const entry = layer4.applyChange(
      cots,
      { kind: "appeal", decision_id: d.id, performed_by: "reviewer-1", notes: "User appealed." },
      "2026-11-02T11:00:00Z"
    );
    expect(entry.action).toBe("appealed");
    expect(d.audit_history).toHaveLength(2);
    expect(() =>
      layer4.applyChange(cots, { kind: "appeal", decision_id: "urn:source-engineering:decision:nope", performed_by: "x", notes: "" }, "2026-11-02T11:00:00Z")
    ).toThrow(Layer4Error);
  });

  it("links a rerun to the original decision and replays the lifecycle", async () => {
    const cots = await buildCots();
    const store = new MemoryAuditStore();
    const layer4 = new Layer4(store, RETENTION);
    const d = cots.decisions[0];
    layer4.recordCreation(cots, d, "2026-11-02T10:00:00Z");
    layer4.applyChange(
      cots,
      { kind: "rerun", decision_id: d.id, performed_by: "reviewer-1", rerun_of: d.id, notes: "Re-run on model v2." },
      "2026-11-02T12:00:00Z"
    );
    const replay = layer4.replay(d.id);
    expect(replay).toHaveLength(2);
    const actions = replay.map((e) => e.action).sort();
    expect(actions).toEqual(["created", "rerun"]);
    const rerun = replay.find((e) => e.action === "rerun");
    expect(rerun?.notes).toContain(`rerun_of=${d.id}`);
  });

  it("records a correction naming the affected source", async () => {
    const cots = await buildCots();
    const layer4 = new Layer4(new MemoryAuditStore(), RETENTION);
    const d = cots.decisions[0];
    layer4.recordCreation(cots, d, "2026-11-02T10:00:00Z");
    const entry = layer4.applyChange(
      cots,
      { kind: "correction", decision_id: d.id, performed_by: "producer", affected_source_id: SAMPLE_SOURCE.id, notes: "Source updated." },
      "2026-11-02T13:00:00Z"
    );
    expect(entry.action).toBe("corrected");
    expect(entry.notes).toContain(`affected_source_id=${SAMPLE_SOURCE.id}`);
  });

  it("JsonlAuditStore persists append-only across instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "se-l4-"));
    try {
      const path = join(dir, "audit.jsonl");
      const cots = await buildCots();
      const d = cots.decisions[0];
      const l1 = new Layer4(new JsonlAuditStore(path), RETENTION);
      l1.recordCreation(cots, d, "2026-11-02T10:00:00Z");
      const l2 = new Layer4(new JsonlAuditStore(path), RETENTION);
      const replay = l2.replay(d.id);
      expect(replay).toHaveLength(1);
      expect(replay[0].action).toBe("created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
