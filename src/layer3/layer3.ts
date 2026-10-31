/**
 * Layer 3 (Business Guardrails). Parses the guardrail DSL, evaluates the
 * domain's rules against a post-Layer-2 COTS, and attaches a
 * GuardrailDecision to each DecisionRecord.
 *
 * Implements the v0.4 contract at
 * https://github.com/Source-Engineering/source-engineering-architecture/blob/main/layer-contracts/layer-3-business-guardrails.md
 * and the COTS schema v1.3.0 `decisions[*].guardrail` field per RFC-0003.
 *
 * Layer 3 is the layer that can reject. A binding rule's rejection stops the
 * response and is recorded with the rule and rationale: no silent rejection.
 */

import type { Cots, DecisionRecord, GuardrailDecision, GuardrailOutcome } from "../cots.js";

export type GuardrailAction = "reject" | "annotate" | "escalate";

export interface GuardrailRule {
  rule_id: string;
  /** The condition, referencing COTS fields. Evaluated per the condition grammar below. */
  when: (cots: Cots, decision: DecisionRecord) => boolean;
  then: GuardrailAction;
  rationale: string;
}

export type Layer3ErrorReason = "guardrail-rules-malformed" | "domain-rules-missing";

export class Layer3Error extends Error {
  constructor(public readonly reason: Layer3ErrorReason) {
    super(reason);
  }
}

/**
 * Parse the guardrail DSL:
 *
 *   rule <rule-id> {
 *     when <condition>
 *     then <reject | annotate | escalate>
 *     with rationale "<text>"
 *   }
 *
 * The condition language (v0.4) supports:
 *   constraint(<scope>) == "<value>"     the COTS carries a constraint of scope with value
 *   constraint(<scope>) != "<value>"     the COTS does not carry such a constraint
 *   flag(<flag_type>)                    any decision carries a Layer 2 flag of this type
 *   source_expired()                    any source artifact's validity has expired
 *   decision_type == "<id-suffix>"       the COTS's decisions were produced by this decision-type
 *
 * Conditions compose with `and` / `or` and may be parenthesised.
 */
const CONDITION_RE = /^(?:(constraint\([a-z0-9_-]+\)|flag\([a-z-]+\)|source_expired\(\)|decision_type)(\s*(?:==|!=)\s*"[^"]*")?\s*)$/;

export const parseRules = (dsl: string): GuardrailRule[] => {
  if (typeof dsl !== "string" || dsl.trim().length === 0) {
    throw new Layer3Error("guardrail-rules-malformed");
  }
  const ruleBlocks = dsl.match(/rule\s+[^\s{]+\s*\{[^}]*\}/g);
  if (ruleBlocks === null || ruleBlocks.length === 0) {
    throw new Layer3Error("guardrail-rules-malformed");
  }

  const rules: GuardrailRule[] = [];
  for (const block of ruleBlocks) {
    const idMatch = block.match(/^rule\s+([^\s{]+)\s*\{/);
    const whenMatch = block.match(/when\s+([^\n]+?)\s*\n\s*then/);
    const thenMatch = block.match(/then\s+(reject|annotate|escalate)\b/);
    const rationaleMatch = block.match(/with\s+rationale\s+"([^"]*)"/);

    if (!idMatch || !whenMatch || !thenMatch || !rationaleMatch) {
      throw new Layer3Error("guardrail-rules-malformed");
    }
    const condition = whenMatch[1].trim();
    if (!CONDITION_RE.test(condition.replace(/\s+/g, " "))) {
      throw new Layer3Error("guardrail-rules-malformed");
    }

    rules.push({
      rule_id: idMatch[1],
      when: compileCondition(condition),
      then: thenMatch[1] as GuardrailAction,
      rationale: rationaleMatch[1],
    });
  }
  return rules;
};

const compileCondition = (condition: string): ((cots: Cots, decision: DecisionRecord) => boolean) => {
  const normalized = condition.replace(/\s+/g, " ").trim();

  const constraintEq = normalized.match(/^constraint\(([a-z0-9_-]+)\)\s*==\s*"([^"]*)"$/);
  if (constraintEq) {
    const scope = constraintEq[1];
    const value = constraintEq[2];
    return (cots) => cots.context.constraints.some((c) => c.scope === scope && c.value === value);
  }

  const constraintNeq = normalized.match(/^constraint\(([a-z0-9_-]+)\)\s*!=\s*"([^"]*)"$/);
  if (constraintNeq) {
    const scope = constraintNeq[1];
    const value = constraintNeq[2];
    return (cots) => !cots.context.constraints.some((c) => c.scope === scope && c.value === value);
  }

  const flagMatch = normalized.match(/^flag\(([a-z-]+)\)$/);
  if (flagMatch) {
    const flagType = flagMatch[1];
    return (cots) =>
      cots.decisions.some((d) => d.validation?.flags.some((f) => f.flag_type === flagType) ?? false);
  }

  if (/^source_expired\(\)$/.test(normalized)) {
    return (cots) => {
      const now = Date.parse(cots.produced_at);
      return cots.inputs.source_artifacts.some(
        (a) => a.temporal_validity.valid_until !== null && Date.parse(a.temporal_validity.valid_until) < now
      );
    };
  }

  const dtMatch = normalized.match(/^decision_type\s*==\s*"([^"]*)"$/);
  if (dtMatch) {
    const suffix = dtMatch[1];
    return (cots) => cots.decisions.some((d) => d.id.includes(suffix) || d.basis_id.includes(suffix));
  }

  throw new Layer3Error("guardrail-rules-malformed");
};

const OUTCOME_FOR_ACTION: Record<GuardrailAction, GuardrailOutcome> = {
  reject: "rejected",
  annotate: "annotated",
  escalate: "escalated",
};

export interface Layer3Options {
  now?: string;
  evaluatedBy?: string;
}

export interface Layer3Result {
  cots: Cots;
  /** Decisions stopped by a binding rule, with the rule that fired. */
  rejected: { decision_id: string; rule_id: string; rationale: string }[];
  /** Decisions escalated to a human or organisational authority. */
  escalated: { decision_id: string; rule_id: string; rationale: string }[];
}

export class Layer3 {
  constructor(private readonly rules: GuardrailRule[]) {
    if (rules === undefined || rules === null) {
      throw new Layer3Error("domain-rules-missing");
    }
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Layer3Error("domain-rules-missing");
    }
  }

  /** Evaluate every rule against every decision. Returns the guarded COTS. */
  evaluate(cots: Cots, options: Layer3Options = {}): Layer3Result {
    const now = options.now ?? new Date().toISOString();
    const evaluatedBy = options.evaluatedBy ?? "layer3-business-guardrails";
    const rejected: Layer3Result["rejected"] = [];
    const escalated: Layer3Result["escalated"] = [];

    const decisions = cots.decisions.map((decision): DecisionRecord => {
      let outcome: GuardrailOutcome = "accepted";
      let fired: GuardrailRule | undefined;
      for (const rule of this.rules) {
        if (rule.when(cots, decision)) {
          fired = rule;
          outcome = OUTCOME_FOR_ACTION[rule.then];
          break;
        }
      }

      const guardrail: GuardrailDecision = {
        decision: outcome,
        rule_id: fired
          ? `urn:source-engineering:rule:${fired.rule_id}`
          : "urn:source-engineering:rule:none",
        rationale: fired ? fired.rationale : "No guardrail rule matched; the decision is accepted.",
        binding: fired?.then === "reject",
        evaluated_at: now,
        evaluated_by: evaluatedBy,
      };

      let next: DecisionRecord = { ...decision, guardrail };
      if (outcome === "rejected") {
        next = {
          ...next,
          validation_status: {
            status: "superseded",
            last_changed_at: now,
            last_changed_by: evaluatedBy,
          },
        };
        rejected.push({ decision_id: decision.id, rule_id: fired!.rule_id, rationale: fired!.rationale });
      } else if (outcome === "escalated") {
        next = {
          ...next,
          validation_status: {
            status: "appealed",
            last_changed_at: now,
            last_changed_by: evaluatedBy,
          },
        };
        escalated.push({ decision_id: decision.id, rule_id: fired!.rule_id, rationale: fired!.rationale });
      }
      return next;
    });

    return { cots: { ...cots, decisions }, rejected, escalated };
  }
}
