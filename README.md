# Reference Implementation

> Working reference code for the Source Engineering discipline. TypeScript.

This repository holds the discipline's reference implementation. It is a minimal-viable framework that demonstrates the COTS schema and the four-layer stack in action. The reference implementation is the discipline's shippable surface: every other tool, conformance test, and case study is built against this surface.

## Quick start

```bash
npm install
npm test
npm run example:legal-summarization
```

The example runs the legal-summarization decision-type against the mock adapter and produces a COTS at `examples/output/legal-summarization.cots.json`. The conformance suite can then validate the COTS:

```bash
cd ../source-engineering-conformance
node dist/cli.js validate ../source-engineering-reference-implementation/examples/output/legal-summarization.cots.json
```

Expected output:

```
Status: PASS
Errors: 0
Warnings: 0
```

## Architecture

The reference implementation has four layers (one per the discipline's reference architecture):

- `src/layer1/` - the typed-model layer. Composes a `DecisionTypeDefinition` with a `ModelAdapter` to produce a COTS.
- `src/layer2/`, `src/layer3/`, `src/layer4/` - the runtime-validation, business-guardrails, and audit-trail layers. Stubbed at v0.1; the v0.1 blueprint floors Layer 1 only. See `Source-Engineering/source-engineering-architecture/blueprints/v0.1/`.

## Adapters

The reference implementation accepts any `ModelAdapter`. Two adapters ship:

- `src/adapters/mock-adapter.ts` -- a deterministic adapter for development and testing. No API key required.
- `src/adapters/anthropic-adapter.ts` -- the Anthropic API adapter. Activated when `ANTHROPIC_API_KEY` is set. To use it: `export ANTHROPIC_API_KEY=sk-...` and replace the mock adapter with the Anthropic adapter in your code.

## Decision-types

Two decision-types are implemented:

- `src/decision-types/legal-summarization.ts` - the legal-document summarisation decision-type.
- `src/decision-types/transaction-routing.ts` - the financial-transaction routing decision-type.

Each decision-type implements the contract from `Source-Engineering/source-engineering-specifications/decision-types/`.

## Examples

- `src/examples/legal-summarization.ts` - runs the legal-summarization decision-type and produces a COTS.
- `src/examples/transaction-routing.ts` - runs the transaction-routing decision-type and produces a COTS.

## Tests

`tests/layer1.test.ts` runs the Layer 1 conformance test cases (TC-L1-01..07) plus tests for the decision-types. Mirrors the discipline's canonical test cases.

## Provenance

- `Source-Engineering/source-engineering-specifications/cots/README.md` - the COTS schema.
- `Source-Engineering/source-engineering-architecture/layer-contracts/layer-1-typed-model.md` - the Layer 1 contract.
- `Source-Engineering/source-engineering-architecture/blueprints/v0.1/README.md` - the v0.1 floor.

## Status

This is the reference implementation slice (Phase 3). Layer 1 is fully implemented; Layers 2-4 are stubbed with the v0.1 floor. The two seeded decision-types (legal-summarization, transaction-routing) are working.

## License

Apache-2.0. See [LICENSE](LICENSE).
