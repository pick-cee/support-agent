import * as z from "zod";

// The structured answer (DESIGN §6.2). The model writes spoken_text; it never
// writes reference numbers, booked times or emails it read from a tool. Those
// are appended by code (§6.4). Length is not in the schema: an over-long
// answer is trimmed mechanically, not retried (§6.3, "Length and form").

export const ANSWER_TYPES = ["answer", "clarify", "lookup_result", "ticket_created", "escalate", "collect_details", "decline", "closing"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const answerSchema = z.object({
  answer_type: z.enum(ANSWER_TYPES),
  spoken_text: z.string(),
  kb_chunk_ids: z.array(z.string()),
  confidence_note: z.string(),
  needs_human: z.boolean(),
});

export type Answer = z.infer<typeof answerSchema>;

export const answerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer_type", "spoken_text", "kb_chunk_ids", "confidence_note", "needs_human"],
  properties: {
    answer_type: { type: "string", enum: [...ANSWER_TYPES] },
    spoken_text: { type: "string", description: "What the caller hears. At most three short sentences, plain words, no lists, no markdown." },
    kb_chunk_ids: { type: "array", items: { type: "string" }, description: "chunk_id values from search_knowledge_base results in this turn that the answer rests on." },
    confidence_note: { type: "string", description: "One short sentence: what this answer rests on, or what is uncertain." },
    needs_human: { type: "boolean" },
  },
};
