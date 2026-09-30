import * as z from "zod";

import { MEMORY_RETRIEVAL_MIN_SCORE, RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } from "@/lib/constants";

import { lenientInput } from "../lenient-input";
import type { KbSearchResult, ToolDefinition } from "../types";
import { invalid } from "./shared";

/**
 * Whether the top hit clears the calibrated threshold (DESIGN §8). With
 * embeddings the threshold is on cosine similarity; full-text-only search
 * (memory mode, or degraded) uses the lexical floor.
 */
export function clearsThreshold(result: KbSearchResult): boolean {
  if (!result.hits.length || result.topScore === null) return false;
  const threshold = result.degraded ? MEMORY_RETRIEVAL_MIN_SCORE : RETRIEVAL_MIN_SCORE;
  return threshold === null ? true : result.topScore >= threshold;
}

export const searchKnowledgeBase: ToolDefinition<{ query: string }> = {
  name: "search_knowledge_base",
  title: "Search the approved knowledge base",
  description:
    "Search RelayPay's approved support knowledge. Call it before answering any product, pricing, fee, timeline, policy or compliance question. " +
    "found false means nothing approved covers it: do not answer from memory; decline and point to the support options in the RelayPay dashboard. " +
    "Cite the chunk_id of every chunk your answer rests on.",
  wireInput: lenientInput({
    // The threshold was calibrated on whole questions; Haiku's keyword lists scored
    // below it where Sonnet's question found the answer (0.370 against 0.694).
    query: { type: "string", required: true, description: "The caller's question as a whole sentence in plain words, not a list of keywords, for example 'What fees apply to international payments?'" },
  }),
  strictInput: z.object({ query: z.string().trim().min(2).max(500) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  purpose: (raw) => `Search approved knowledge for: ${String(raw.query ?? "").slice(0, 120)}`,

  invalidInput: () => invalid("query is missing. Pass the caller's question in plain words.", "invalid_input: query missing"),

  async run({ input, context, repository }) {
    const result = await repository.searchKnowledge(input.query);
    if (result.refusal) {
      return {
        status: "error",
        isError: true,
        payload: { found: false, reason: "search_unavailable", message: "Approved knowledge can't be searched right now. Decline, and offer the support options in the RelayPay dashboard." },
        summary: "error: search refused",
        errorMessage: result.refusal,
      };
    }
    const found = clearsThreshold(result);
    const hits = found ? result.hits.slice(0, RETRIEVAL_TOP_K) : [];
    await repository.logRetrieval({
      conversationId: context.conversationId,
      turnId: context.turnId,
      query: input.query,
      chunkIdsReturned: hits.map((hit) => hit.chunk_id),
      sourceTitles: hits.map((hit) => hit.source_title),
      sourceSummaries: hits.map((hit) => hit.source_summary),
      topScore: result.topScore,
      found,
      degraded: result.degraded,
      kbVersion: result.kbVersion,
      embeddingModel: result.embeddingModel,
    });
    const payload = {
      found,
      chunks: hits.map((hit) => ({
        chunk_id: hit.chunk_id,
        source_title: hit.source_title,
        section_path: hit.section_path,
        source_summary: hit.source_summary,
        text: hit.text,
        score: Math.round(hit.score * 1000) / 1000,
      })),
      kb_version: result.kbVersion,
      degraded: result.degraded,
      ...(found ? {} : { message: "Nothing in the approved knowledge covers this. Do not answer from memory. Decline, and point to the support options in the RelayPay dashboard." }),
    };
    return {
      status: found ? "ok" : "not_found",
      isError: false,
      payload,
      summary: found ? `found ${hits.length}: ${hits[0]!.section_path} (${payload.chunks[0]!.score}${result.degraded ? ", degraded" : ""})` : `not_found (top ${result.topScore?.toFixed(3) ?? "none"})`,
    };
  },
};
