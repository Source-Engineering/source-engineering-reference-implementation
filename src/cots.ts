/**
 * Re-export of the COTS type definitions, derived from the discipline's
 * canonical model. Implementations consume this module to type their
 * COTS-shaped artefacts.
 *
 * See: https://github.com/Source-Engineering/source-engineering-model
 * See: https://github.com/Source-Engineering/source-engineering-specifications/blob/main/cots/README.md
 */

export type URI = string;
export type ISO8601 = string;
export type SHA256 = string;
export type CalibratedScore = number;

export type CotsVersion = `${number}.${number}.${number}`;

export interface Cots {
  cots_version: CotsVersion;
  cots_id: URI;
  produced_at: ISO8601;
  produced_by: { system_name: string; system_version: string };
  inputs: { source_artifacts: SourceArtifact[] };
  context: Context;
  decisions: DecisionRecord[];
  evidence: { evidence_chain: EvidenceChainEntry[] };
  validation: { feedback_surfaces: FeedbackSurface[] };
}

export interface SourceArtifact {
  id: URI;
  origin: { system_name: string; system_version: string; configuration_hash: string };
  version: { content_hash: SHA256; issued_at: ISO8601 };
  authority: { asserted_by: string; trust_score: CalibratedScore };
  temporal_validity: { valid_from: ISO8601; valid_until: ISO8601 | null };
  content_reference?: { uri: string; media_type: string };
}

export interface Context {
  model: { model_name: string; model_version: string };
  parameters: {
    temperature: number;
    top_p: number;
    prompt_cache_id: string | null;
    tool_budget: number;
    retrieval_depth: number;
    additional?: Record<string, string | number | boolean>;
  };
  constraints: Constraint[];
}

export interface Constraint {
  id: URI;
  type: string;
  scope: string;
  value: string;
}

export type ValidationStatusValue =
  | "pending" | "validated" | "contested" | "appealed" | "superseded";

export type ClaimType = "factual" | "normative" | "predictive" | "evaluative";
export type Polarity = "supports" | "contradicts" | "contextualises";
export type Action = "created" | "appealed" | "rerun" | "corrected" | "escalated" | "superseded";

export interface DecisionRecord {
  id: URI;
  decision_text: string;
  basis_id: URI;
  evidence_chain_ref: URI;
  validation_status: { status: ValidationStatusValue; last_changed_at: ISO8601; last_changed_by: string };
  responsible_authority: { authority_id: string; authority_type: "human" | "organisational" | "automated" };
  audit_history: AuditEntry[];
  created_at: ISO8601;
}

export interface AuditEntry {
  id: URI;
  action: Action;
  performed_by: string;
  performed_at: ISO8601;
  notes: string;
}

export interface EvidenceChainEntry {
  decision_id: URI;
  supporting_evidence: EvidenceItem[];
  contradicting_evidence: EvidenceItem[];
  claims: Claim[];
}

export interface Claim {
  id: URI;
  decision_record_id: URI;
  claim_text: string;
  claim_type: ClaimType;
  supporting_evidence: URI[];
  contradicting_evidence: URI[];
}

export interface EvidenceItem {
  id: URI;
  claim_id: URI;
  source_id: URI;
  transformation: { operation: string; inputs: string[]; output: string; recorded_at: ISO8601 };
  uncertainty: { calibrated_score: CalibratedScore; basis: string };
  polarity: Polarity;
}

export interface FeedbackSurface {
  id: URI;
  type: "appeal" | "rerun" | "correction";
  target: URI;
  endpoint: string;
  description: string;
}
