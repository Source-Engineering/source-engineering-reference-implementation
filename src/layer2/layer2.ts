/**
 * Layer 2 (Runtime Validation). Takes a Layer 1 COTS plus operator-provided
 * calibration data, evaluates the runtime signals, and attaches a Validation
 * record to each DecisionRecord.
 *
 * Implements the v0.2 contract at
 * https://github.com/Source-Engineering/source-engineering-architecture/blob/main/layer-contracts/layer-2-runtime-validation.md
 * and the COTS schema v1.1.0 `decisions[*].validation` field per RFC-0001.
 *
 * Layer 2 does not reject; it flags. A flagged decision is still exposed to
 * Layer 3, which is the layer that can reject.
 */

import type { Cots, DecisionRecord, Context, ValidationRecord, DecisionOnValidation } from "../cots.js";

export type FlagType =
  | "drift-detected"
  | "segment-signal-divergence"
  | "parameter-set-out-of-range"
  | "temporal-validity-expired";

export interface CalibrationData {
  /** Per-segment calibration drift, measured as divergence from the calibrated baseline. */
  drift?: { segment: string; divergence: number; threshold: number }[];
  /** Parameter-set ranges the operator declares acceptable for this decision-type. */
  parameterSet?: { parameter: string; min: number; max: number }[];
  /** Segments the operator declares in-calibration; divergence on unlisted segments is a flag. */
  segments?: string[];
}

export interface Layer2Options {
  validatedBy?: string;
  now?: string;
}

export type Layer2ErrorReason = "calibration-data-missing" | "context-missing";

export class Layer2Error extends Error {
  constructor(public readonly reason: Layer2ErrorReason) {
    super(reason);
  }
}

const isIso8601 = (value: string): boolean => {
  return !Number.isNaN(Date.parse(value));
};

const validateDecision = (
  decision: DecisionRecord,
  context: Context,
  calibration: CalibrationData,
  now: string
): ValidationRecord => {
  const flags: ValidationRecord["flags"] = [];

  for (const d of calibration.drift ?? []) {
    if (d.divergence > d.threshold) {
      flags.push({
        flag_type: "drift-detected",
        message: `Calibration drift detected on segment '${d.segment}' (${d.divergence} divergence, threshold ${d.threshold}).`,
        detected_at: now,
      });
    }
  }

  if (calibration.segments !== undefined) {
    for (const d of calibration.drift ?? []) {
      if (d.divergence > 0 && !calibration.segments.includes(d.segment)) {
        flags.push({
          flag_type: "segment-signal-divergence",
          message: `Segment '${d.segment}' is outside the operator-declared in-calibration segments.`,
          detected_at: now,
        });
      }
    }
  }

  const ranges = calibration.parameterSet ?? [];
  const params: Record<string, number> = {
    temperature: context.parameters.temperature,
    top_p: context.parameters.top_p,
    tool_budget: context.parameters.tool_budget,
    retrieval_depth: context.parameters.retrieval_depth,
  };
  for (const range of ranges) {
    const value = params[range.parameter];
    if (value !== undefined && (value < range.min || value > range.max)) {
      flags.push({
        flag_type: "parameter-set-out-of-range",
        message: `Parameter '${range.parameter}' is ${value}; operator range is [${range.min}, ${range.max}].`,
        detected_at: now,
      });
    }
  }

  return {
    flags,
    decision_on_validation: flags.length > 0 ? "flagged" : "passed",
    validated_at: now,
    validated_by: "layer2-runtime-validation",
  };
};

const validateRecursiveChains = (cots: Cots, now: string): ValidationRecord["flags"] => {
  const flags: ValidationRecord["flags"] = [];
  const termination = cots.evidence.chain_termination;

  for (const chain of cots.evidence.evidence_chain) {
    const items = [...chain.supporting_evidence, ...chain.contradicting_evidence];
    const recursive = items.filter((item) => item.source_type === "model-generated");
    if (recursive.length > 0) {
      const policy = termination?.policy ?? "terminal";
      const admitted = policy === "bounded_recursion" || policy === "unbounded_recursion";
      flags.push({
        flag_type: "segment-signal-divergence",
        message: admitted
          ? `Recursive evidence chain: ${recursive.length} model-generated evidence item(s) under policy '${policy}'. The chain does not terminate at a human-readable source. (RFC-0002)`
          : `Recursive evidence chain under terminal policy: ${recursive.length} model-generated evidence item(s). The chain must resolve to human-authored sources. (RFC-0002)`,
        detected_at: now,
      });
    }
  }

  return flags;
};

export class Layer2 {
  constructor(private readonly calibration: CalibrationData) {}

  /**
   * Attach Validation records to every DecisionRecord in the COTS.
   * Throws Layer2Error on the contract's failure modes.
   */
  validate(cots: Cots, options: Layer2Options = {}): Cots {
    if (this.calibration === undefined || this.calibration === null) {
      throw new Layer2Error("calibration-data-missing");
    }
    if (cots.context === undefined || cots.context === null) {
      throw new Layer2Error("context-missing");
    }
    const now = options.now ?? new Date().toISOString();
    const validatedBy = options.validatedBy ?? "layer2-runtime-validation";

    const recursiveFlags = validateRecursiveChains(cots, now);

    const decisions = cots.decisions.map((decision) => {
      const record = validateDecision(decision, cots.context, this.calibration, now);
      const flags = [...record.flags, ...recursiveFlags];
      const decision_on_validation: DecisionOnValidation =
        flags.length > 0 ? (record.decision_on_validation === "escalated" ? "escalated" : "flagged") : "passed";
      return {
        ...decision,
        validation: { ...record, flags, decision_on_validation, validated_by: validatedBy },
      };
    });

    return { ...cots, decisions };
  }
}
