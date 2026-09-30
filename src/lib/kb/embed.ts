import "server-only";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_TIMEOUT_MS, OPENAI_EMBEDDINGS_URL } from "@/lib/constants";
import { requireEnv } from "@/lib/env";

/** OpenAI text-embedding-3-small, 1536 dimensions (DESIGN §8). Throws on any failure; callers decide on degraded mode. */
export async function embed(inputs: string[], timeoutMs = EMBEDDING_TIMEOUT_MS): Promise<number[][]> {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs, dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenAI embeddings returned ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { data: { index: number; embedding: number[] }[]; model: string };
  const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error(`OpenAI returned ${vectors.length} embeddings of the wrong shape for ${inputs.length} inputs`);
  }
  return vectors;
}

/** pgvector's text form. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
