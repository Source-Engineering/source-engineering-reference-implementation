/**
 * The legal-summarization decision-type. A working implementation of
 * https://github.com/Source-Engineering/source-engineering-specifications/blob/main/decision-types/legal/legal-summarization.md
 *
 * Question shape:
 *   {
 *     document: { uri: string, media_type: string, language?: string, jurisdiction?: string },
 *     summary_intent?: "executive" | "clause-by-clause" | "risk-focused",
 *     audience?: "attorney" | "paralegal" | "in-house-counsel" | "business-stakeholder"
 *   }
 *
 * Answer shape: a string (the summary).
 */

import { z } from "zod";
import type { DecisionTypeDefinition } from "../build-cots.js";

const QuestionSchema = z.object({
  document: z.object({
    uri: z.string().url(),
    media_type: z.string(),
    language: z.string().optional(),
    jurisdiction: z.string().optional(),
  }),
  summary_intent: z.enum(["executive", "clause-by-clause", "risk-focused"]).optional(),
  audience: z.enum(["attorney", "paralegal", "in-house-counsel", "business-stakeholder"]).optional(),
});

export type LegalSummarizationQuestion = z.infer<typeof QuestionSchema>;

export const LegalSummarizationDecisionType: DecisionTypeDefinition<
  LegalSummarizationQuestion,
  string
> = {
  id: "urn:source-engineering:decision-type:legal-summarization:0.1.0",
  name: "Legal Document Summarisation",
  version: "0.1.0",

  validateQuestion(question: unknown): LegalSummarizationQuestion {
    return QuestionSchema.parse(question);
  },

  renderPrompt(question: LegalSummarizationQuestion): string {
    const intent = question.summary_intent ?? "executive";
    const audience = question.audience ?? "attorney";
    return [
      `Summarise the legal document at ${question.document.uri}.`,
      `Media type: ${question.document.media_type}.`,
      question.document.language ? `Language: ${question.document.language}.` : "",
      question.document.jurisdiction ? `Jurisdiction: ${question.document.jurisdiction}.` : "",
      `Summary intent: ${intent}.`,
      `Audience: ${audience}.`,
      "Provide a structured summary that an attorney can review and challenge.",
    ]
      .filter(Boolean)
      .join("\n");
  },

  parseAnswer(raw: string): string {
    return raw.trim();
  },
};
