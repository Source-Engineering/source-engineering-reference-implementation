/**
 * Layer 1 (Typed Model) entry point. Composes a decision-type with a model
 * adapter and produces a COTS-shaped DecisionRecord.
 *
 * Implements the v0.1 contract at
 * https://github.com/Source-Engineering/source-engineering-architecture/blob/main/layer-contracts/layer-1-typed-model.md
 */

import type { Cots } from "../cots.js";
import { buildCots, type DecisionTypeDefinition, type ModelAdapter, type CotsBuildInput } from "../build-cots.js";

export class Layer1<Q = unknown, A = unknown> {
  constructor(
    public readonly decisionType: DecisionTypeDefinition<Q, A>,
    public readonly model: ModelAdapter<Q, A>
  ) {}

  /**
   * Invoke the layer. Returns a COTS-shaped response.
   *
   * @param question The typed question (already validated by the decision-type).
   * @param sourceArtifacts The source universe.
   * @param options Optional constraints and feedback surfaces.
   */
  async invoke(
    question: Q,
    sourceArtifacts: CotsBuildInput<Q, A>["sourceArtifacts"],
    options: Pick<CotsBuildInput<Q, A>, "constraints" | "feedbackSurfaces"> = {}
  ): Promise<Cots> {
    return buildCots({
      decisionType: this.decisionType,
      question,
      sourceArtifacts,
      model: this.model,
      ...options,
    });
  }
}
