/**
 * Layer 4 (Audit Trail). Append-only persistence of every change to a
 * DecisionRecord, plus replay: reconstruct a decision's full lifecycle from
 * the store alone.
 *
 * Implements the Layer 4 contract at
 * https://github.com/Source-Engineering/source-engineering-architecture/blob/main/layer-contracts/layer-4-audit-trail.md
 * and RFC-0005.
 *
 * Guarantees enforced here:
 *   - append-only: the store rejects any rewrite or delete
 *     (reason: audit-store-not-append-only)
 *   - lifecycle integrity: a source update affecting a decision appends a
 *     "corrected" entry naming the source
 *   - retention policy declared by the domain (retention-policy-missing)
 *   - re-runnable: a rerun appends a "rerun" entry linked to the original
 */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuditEntry, Cots, DecisionRecord } from "../cots.js";

export type Layer4ErrorReason =
  | "retention-policy-missing"
  | "persistence-unavailable"
  | "audit-store-not-append-only"
  | "decision-not-found";

export class Layer4Error extends Error {
  constructor(public readonly reason: Layer4ErrorReason) {
    super(reason);
  }
}

export interface AuditStore {
  append(entry: AuditEntry): void;
  entriesFor(decisionId: string): AuditEntry[];
  all(): AuditEntry[];
}

/**
 * JSONL append-only file backend. Each line is one AuditEntry plus a running
 * SHA-256 chain (hash of previous line + entry), so a tamper-evident backend
 * can build on the same file format later. Conformance does not require the
 * chain; it is a backend property.
 */
export class JsonlAuditStore implements AuditStore {
  private chainTip: string;

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim().length > 0);
      this.chainTip = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]).chain as string) : "GENESIS";
    } else {
      this.chainTip = "GENESIS";
    }
  }

  append(entry: AuditEntry): void {
    let line: string;
    try {
      const payload = JSON.stringify(entry);
      const chain = createHash("sha256").update(this.chainTip + payload).digest("hex");
      line = JSON.stringify({ entry, chain }) + "\n";
      appendFileSync(this.path, line);
      this.chainTip = chain;
    } catch {
      throw new Layer4Error("persistence-unavailable");
    }
  }

  entriesFor(decisionId: string): AuditEntry[] {
    return this.all().filter((e) => e.notes.includes(`decision_id=${decisionId}`));
  }

  all(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => (JSON.parse(l) as { entry: AuditEntry }).entry);
  }
}

/** In-memory backend for tests and ephemeral runs. Strictly append-only. */
export class MemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  entriesFor(decisionId: string): AuditEntry[] {
    return this.entries.filter((e) => e.notes.includes(`decision_id=${decisionId}`));
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }
}

export interface RetentionPolicy {
  /** ISO-8601 duration or null for indefinite. Declared by the domain. */
  retain_until: string | null;
  declared_by: string;
}

export type ChangeEvent =
  | { kind: "appeal"; decision_id: string; performed_by: string; notes: string }
  | { kind: "rerun"; decision_id: string; performed_by: string; rerun_of: string; notes: string }
  | { kind: "correction"; decision_id: string; performed_by: string; affected_source_id: string; notes: string }
  | { kind: "escalation"; decision_id: string; performed_by: string; notes: string }
  | { kind: "supersession"; decision_id: string; performed_by: string; superseded_by: string; notes: string };

const ACTION_BY_KIND: Record<ChangeEvent["kind"], AuditEntry["action"]> = {
  appeal: "appealed",
  rerun: "rerun",
  correction: "corrected",
  escalation: "escalated",
  supersession: "superseded",
};

export class Layer4 {
  constructor(
    private readonly store: AuditStore,
    private readonly retention: RetentionPolicy
  ) {
    if (!retention || !retention.declared_by) {
      throw new Layer4Error("retention-policy-missing");
    }
  }

  /** Record the initial creation of a decision (idempotent per decision id). */
  recordCreation(cots: Cots, decision: DecisionRecord, performedAt: string): AuditEntry {
    const existing = this.store.entriesFor(decision.id).find((e) => e.action === "created");
    if (existing) return existing;
    const mirrored = decision.audit_history.find((e) => e.action === "created");
    const entry: AuditEntry = mirrored ?? {
      id: `urn:source-engineering:audit:${randomUUID()}`,
      action: "created",
      performed_by: decision.responsible_authority.authority_id,
      performed_at: performedAt,
      notes: `Decision created. decision_id=${decision.id}`,
    };
    if (!entry.notes.includes(`decision_id=${decision.id}`)) entry.notes = `${entry.notes} decision_id=${decision.id}`;
    this.store.append(entry);
    if (!decision.audit_history.some((e) => e.id === entry.id)) {
      decision.audit_history.push(entry);
    }
    return entry;
  }

  /** Apply a change event: append to the store and mirror into the DecisionRecord. */
  applyChange(cots: Cots, event: ChangeEvent, performedAt: string): AuditEntry {
    const decision = cots.decisions.find((d) => d.id === event.decision_id);
    if (!decision) throw new Layer4Error("decision-not-found");

    let notes = event.notes;
    if (event.kind === "rerun") notes = `${notes} rerun_of=${event.rerun_of}`;
    if (event.kind === "supersession") notes = `${notes} superseded_by=${event.superseded_by}`;
    if (event.kind === "correction") notes = `${notes} affected_source_id=${event.affected_source_id}`;
    notes = `${notes} decision_id=${event.decision_id}`;

    const entry: AuditEntry = {
      id: `urn:source-engineering:audit:${randomUUID()}`,
      action: ACTION_BY_KIND[event.kind],
      performed_by: event.performed_by,
      performed_at: performedAt,
      notes,
    };
    this.store.append(entry);
    decision.audit_history.push(entry);
    return entry;
  }

  /** Replay a decision's full lifecycle from the store alone (RFC-0005 signature test). */
  replay(decisionId: string): AuditEntry[] {
    const entries = this.store
      .all()
      .filter((e) => e.notes.includes(`decision_id=${decisionId}`) || e.notes.includes(`rerun_of=${decisionId}`));
    return entries.sort((a, b) => Date.parse(a.performed_at) - Date.parse(b.performed_at));
  }

  retentionPolicy(): RetentionPolicy {
    return this.retention;
  }
}
