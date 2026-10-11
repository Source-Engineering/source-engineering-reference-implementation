/**
 * The transaction-routing decision-type. A working implementation of
 * https://github.com/Source-Engineering/source-engineering-specifications/blob/main/decision-types/finance/transaction-routing.md
 *
 * Question shape:
 *   {
 *     transaction: { id: string, amount: number, currency: string, origin?: string, metadata?: object },
 *     destinations: Array<{ id: string, name?: string, constraints?: object }>
 *   }
 *
 * Answer shape: { destination_id: string }
 */

import { z } from "zod";
import type { DecisionTypeDefinition } from "../build-cots.js";

const QuestionSchema = z.object({
  transaction: z.object({
    id: z.string(),
    amount: z.number(),
    currency: z.string(),
    origin: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  destinations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        constraints: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(2),
});

export type TransactionRoutingQuestion = z.infer<typeof QuestionSchema>;
export type TransactionRoutingAnswer = { destination_id: string };

export const TransactionRoutingDecisionType: DecisionTypeDefinition<
  TransactionRoutingQuestion,
  TransactionRoutingAnswer
> = {
  id: "urn:source-engineering:decision-type:transaction-routing:0.1.0",
  name: "Transaction Routing",
  version: "0.1.0",

  validateQuestion(question: unknown): TransactionRoutingQuestion {
    return QuestionSchema.parse(question);
  },

  renderPrompt(question: TransactionRoutingQuestion): string {
    return [
      `Route the transaction ${question.transaction.id} (amount: ${question.transaction.amount} ${question.transaction.currency}).`,
      `Available destinations:`,
      ...question.destinations.map(
        (d) => `  - ${d.id}${d.name ? ` (${d.name})` : ""}`
      ),
      `Respond with JSON in the form: {"destination_id": "<id>"}.`,
    ].join("\n");
  },

  parseAnswer(raw: string): TransactionRoutingAnswer {
    const cleaned = raw.trim();
    // Try JSON parse first
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.destination_id === "string") {
        return { destination_id: parsed.destination_id };
      }
    } catch {
      // fall through
    }
    // Try to extract from markdown-style
    const match = cleaned.match(/destination_id["']?\s*:\s*["']([^"']+)["']/);
    if (match) {
      return { destination_id: match[1] };
    }
    throw new Error(`Could not parse transaction-routing answer: ${cleaned}`);
  },
};
