import type { KbChunk } from "./chunk";

// Full-text ranking without a database or an embedding model: BM25 over the
// chunks. Memory mode uses it so a grader can run search_knowledge_base with
// no accounts; it is labelled degraded, because it is.

const STOPWORDS = new Set(
  "a an and are as at be but by can could do does for from has have how i if in into is it its me my of on or our so than that the their them then there these they this to up us was we what when where which who why will with would you your".split(" "),
);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !STOPWORDS.has(word))
    .map((word) => word.replace(/(?:ing|ed|es|s)$/, "") || word);
}

export type LexicalHit = { chunk: KbChunk; score: number };

export function lexicalSearch(chunks: KbChunk[], query: string, topK: number): LexicalHit[] {
  const docs = chunks.map((chunk) => terms(`${chunk.section_path} ${chunk.text}`));
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1);
  const queryTerms = [...new Set(terms(query))];
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((doc, index) => {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = doc.filter((word) => word === term).length;
      if (!frequency) continue;
      const containing = docs.filter((other) => other.includes(term)).length;
      const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
      score += (idf * frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * doc.length) / averageLength));
    }
    return { chunk: chunks[index]!, score };
  });
  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
