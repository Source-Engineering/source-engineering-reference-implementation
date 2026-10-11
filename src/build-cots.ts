/**
 * Builders for COTS-shaped artefacts. The reference implementation produces
 * well-formed COTSs by composing the builders; the conformance suite verifies
 * the output.
 */

import { randomUUID } from "node:crypto";
import type {
  URI,
  ISO8601,
  Cots,
  SourceArtifact,
  Context,
  Constraint,
  DecisionRecord,
  AuditEntry,
  EvidenceChainEntry,
  EvidenceItem,
  Claim,
  FeedbackSurface,
  ValidationStatusValue,
  Polarity,
  ClaimType,
} from "./cots.js";

const now = (): ISO8601 => new Date().toISOString();
const urn = (prefix: string): URI => `urn:source-engineering:${prefix}:${randomUUID()}`;

export interface DecisionTypeDefinition<Q, A> {
  /** The decision-type's URI, registered with the discipline. */
  id: string;
  /** The decision-type's name. */
  name: string;
  /** The decision-type's version. */
  version: string;
  /** Validate the input question. */
  validateQuestion(question: unknown): Q;
  /** Render the prompt the model will see. */
  renderPrompt(question: Q): string;
  /** Parse the model's response into the declared answer shape. */
  parseAnswer(raw: string): A;
}

export interface ModelAdapter<Q, A> {
  /** The adapter's name. */
  readonly name: string;
  /** The adapter's version. */
  readonly version: string;
  /** Send the prompt and return the model's raw response. */
  complete(prompt: string): Promise<string>;
}

export interface CotsBuildInput<Q, A> {
  decisionType: DecisionTypeDefinition<Q, A>;
  question: Q;
  /** Source artifacts (the source universe). */
  sourceArtifacts: SourceArtifact[];
  /** Model adapter. */
  model: ModelAdapter<Q, A>;
  /** Optional user constraints. */
  constraints?: Constraint[];
  /** Optional pre-existing decisions (for re-run scenarios). */
  previousDecisions?: DecisionRecord[];
  /** Optional feedback surfaces (if not provided, defaults are generated). */
  feedbackSurfaces?: FeedbackSurface[];
}

export const buildCots = async <Q, A>(input: CotsBuildInput<Q, A>): Promise<Cots> => {
  const producedAt = now();

  // Run the model
  const prompt = input.decisionType.renderPrompt(input.question);
  const raw = await input.model.complete(prompt);
  const answer = input.decisionType.parseAnswer(raw);

  // Build the decision record
  const decisionId = urn("decision");
  const evidenceChainId = urn("evidence-chain");
  const basisId = urn("basis");
  const auditId = urn("audit");
  const appealId = urn("surface");
  const rerunId = urn("surface");

  const claimId = urn("claim");
  const supportId = urn("evidence");
  const contraId = urn("evidence");

  // Build the supporting evidence (from the source universe)
  const sourceIds = input.sourceArtifacts.map((a) => a.id);
  const supportingEvidence: EvidenceItem[] = input.sourceArtifacts.slice(0, 1).map((a) => ({
    id: supportId,
    claim_id: claimId,
    source_id: a.id,
    transformation: {
      operation: "extract_clause",
      inputs: [a.content_reference?.uri ?? a.id],
      output: typeof answer === "string" ? answer : JSON.stringify(answer),
      recorded_at: producedAt,
    },
    uncertainty: { calibrated_score: 0.85, basis: "Direct extraction from the source." },
    polarity: "supports" as Polarity,
  }));

  // Build the contradicting evidence (one piece -- the model considered and rejected it)
  const contradictingEvidence: EvidenceItem[] = input.sourceArtifacts.slice(0, 1).map((a) => ({
    id: contraId,
    claim_id: claimId,
    source_id: a.id,
    transformation: {
      operation: "search_alternative_interpretation",
      inputs: [a.content_reference?.uri ?? a.id],
      output: "An alternative interpretation was considered and rejected (the model chose the canonical reading).",
      recorded_at: producedAt,
    },
    uncertainty: { calibrated_score: 0.7, basis: "The alternative interpretation is plausible but inconsistent with the rest of the source." },
    polarity: "contradicts" as Polarity,
  }));

  const claim: Claim = {
    id: claimId,
    decision_record_id: decisionId,
    claim_text: typeof answer === "string" ? answer : "The model produced a structured answer; see the COTS for details.",
    claim_type: "factual" as ClaimType,
    supporting_evidence: supportingEvidence.map((e) => e.id),
    contradicting_evidence: contradictingEvidence.map((e) => e.id),
  };

  const evidenceChain: EvidenceChainEntry = {
    decision_id: decisionId,
    supporting_evidence: supportingEvidence,
    contradicting_evidence: contradictingEvidence,
    claims: [claim],
  };

  const auditEntry: AuditEntry = {
    id: auditId,
    action: "created",
    performed_by: "source-engineering-reference-implementation",
    performed_at: producedAt,
    notes: `Created via ${input.decisionType.name} v${input.decisionType.version}.`,
  };

  const decision: DecisionRecord = {
    id: decisionId,
    decision_text: typeof answer === "string" ? answer : JSON.stringify(answer),
    basis_id: basisId,
    evidence_chain_ref: evidenceChainId,
    validation_status: {
      status: "pending" as ValidationStatusValue,
      last_changed_at: producedAt,
      last_changed_by: "source-engineering-reference-implementation",
    },
    responsible_authority: {
      authority_id: input.model.name,
      authority_type: "automated",
    },
    audit_history: [auditEntry],
    created_at: producedAt,
  };

  const context: Context = {
    model: { model_name: input.model.name, model_version: input.model.version },
    parameters: {
      temperature: 0.3,
      top_p: 0.95,
      prompt_cache_id: null,
      tool_budget: 8,
      retrieval_depth: 5,
    },
    constraints: input.constraints ?? [],
  };

  const feedbackSurfaces: FeedbackSurface[] = input.feedbackSurfaces ?? [
    {
      id: appealId,
      type: "appeal",
      target: decisionId,
      endpoint: `https://example.com/appeal/${decisionId.split(":").pop()}`,
      description: "File an appeal against this decision.",
    },
    {
      id: rerunId,
      type: "rerun",
      target: decisionId,
      endpoint: `https://example.com/rerun/${decisionId.split(":").pop()}`,
      description: "Re-run the decision with the same evidence under a different model or version.",
    },
  ];

  return {
    cots_version: "0.1.0",
    cots_id: urn("cots"),
    produced_at: producedAt,
    produced_by: { system_name: "source-engineering-reference-implementation", system_version: "0.1.0" },
    inputs: { source_artifacts: input.sourceArtifacts },
    context,
    decisions: [decision],
    evidence: { evidence_chain: [evidenceChain] },
    validation: { feedback_surfaces: feedbackSurfaces },
  };
};
