import { describe, expect, it } from "vitest";

import { MEMORY_RELATED_MIN_SCORE, RELATED_MIN_SCORE, RELATED_TOP_K, RETRIEVAL_MIN_SCORE } from "@/lib/constants";

import type { KbHit, KbSearchResult } from "../types";
import { clearsThreshold, relatedHits } from "./search-knowledge-base";

function hit(chunkId: string, score: number): KbHit {
  return { chunk_id: chunkId, source_title: "FAQ", section_path: `FAQ > ${chunkId}`, source_summary: "", text: "", score };
}

function result(scores: number[], degraded = false): KbSearchResult {
  const hits = scores.map((score, index) => hit(`c${index}`, score));
  return { hits, topScore: hits[0]?.score ?? null, degraded, kbVersion: "v", embeddingModel: degraded ? null : "text-embedding-3-small" };
}

describe("search thresholds", () => {
  it("finds at the calibrated threshold and not just under it", () => {
    // Null only before calibration; it has been calibrated (DESIGN §8).
    expect(RETRIEVAL_MIN_SCORE).not.toBeNull();
    expect(clearsThreshold(result([RETRIEVAL_MIN_SCORE!]))).toBe(true);
    // The Bitcoin question scored 0.388 in one eval run: related, not found.
    expect(clearsThreshold(result([0.388]))).toBe(false);
    expect(clearsThreshold(result([]))).toBe(false);
  });

  it("keeps loosely related hits above the related floor, at most RELATED_TOP_K of them", () => {
    const loose = result([0.376, 0.35, 0.33, RELATED_MIN_SCORE, RELATED_MIN_SCORE - 0.01]);
    const related = relatedHits(loose);
    expect(related.map((h) => h.chunk_id)).toEqual(["c0", "c1", "c2", "c3"].slice(0, RELATED_TOP_K));
    expect(related.every((h) => h.score >= RELATED_MIN_SCORE)).toBe(true);
  });

  it("returns nothing related when every hit is noise", () => {
    expect(relatedHits(result([RELATED_MIN_SCORE - 0.05, 0.1]))).toEqual([]);
  });

  it("uses the lexical floor when search is degraded to full text", () => {
    expect(relatedHits(result([MEMORY_RELATED_MIN_SCORE, MEMORY_RELATED_MIN_SCORE - 0.1], true)).map((h) => h.chunk_id)).toEqual(["c0"]);
  });
});
