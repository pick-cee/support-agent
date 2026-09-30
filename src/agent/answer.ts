import * as z from "zod";

// The structured answer (DESIGN §6.2). The model writes spoken_text; it never
// writes reference numbers, booked times or emails it read from a tool. Those
// are appended by code (§6.4). Length is not in the schema: an over-long
// answer is trimmed mechanically, not retried (§6.3, "Length and form").

export const ANSWER_TYPES = ["answer", "clarify", "lookup_result", "ticket_created", "escalate", "collect_details", "decline", "closing"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

// How an answer rests on the knowledge (DESIGN §8): "direct" when a chunk says
// it; "inferred" when it follows from what the chunks say without being stated.
// Code adds a sentence to an inferred answer saying the agent is not certain.
export const GROUNDINGS = ["direct", "inferred"] as const;

export const answerSchema = z.object({
  answer_type: z.enum(ANSWER_TYPES),
  spoken_text: z.string(),
  kb_chunk_ids: z.array(z.string()),
  grounding: z.enum(GROUNDINGS).default("direct"),
  confidence_note: z.string(),
  needs_human: z.boolean(),
});

export type Answer = z.input<typeof answerSchema>;

export const answerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer_type", "spoken_text", "kb_chunk_ids", "grounding", "confidence_note", "needs_human"],
  properties: {
    answer_type: { type: "string", enum: [...ANSWER_TYPES] },
    spoken_text: { type: "string", description: "What the caller hears. At most three short sentences, plain words, no lists, no markdown." },
    kb_chunk_ids: { type: "array", items: { type: "string" }, description: "chunk_id values from search_knowledge_base results in this turn that the answer rests on." },
    grounding: {
      type: "string",
      enum: [...GROUNDINGS],
      description: "direct: a chunk states the answer. inferred: the answer follows from the chunks but none states it; the system then adds that you are not certain, so spoken_text must not say it. Use direct for anything that is not an answer.",
    },
    confidence_note: { type: "string", description: "One short sentence: what this answer rests on, or what is uncertain." },
    needs_human: { type: "boolean" },
  },
};
