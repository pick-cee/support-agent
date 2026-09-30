import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";

import { EMBEDDING_MODEL, KB_SOURCE_PATH, RETRIEVAL_TOP_K } from "../src/lib/constants";
import { closePool, queryDb } from "../src/lib/db";
import { chunkKnowledgeBase } from "../src/lib/kb/chunk";
import { embed, vectorLiteral } from "../src/lib/kb/embed";
import { lexicalSearch } from "../src/lib/kb/lexical";

// Measures the retrieval threshold instead of picking one (DESIGN §8). For each
// candidate threshold on the top hit's score: an in-scope question is a hit
// when search reports found and an expected section is in the top results; an
// out-of-scope question is correct when search reports not found. Precision is
// about "found" being right; recall is about in-scope questions being answered.
// Declining is safer than answering wrongly, so the choice weights precision
// (F0.5), and the chosen value is written into the report with its numbers.

type Labelled = { kind: string; question: string; expected: string[] };
type Scored = Labelled & { top: number; sections: string[] };

function evaluate(rows: Scored[], threshold: number) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let wrongSection = 0;
  for (const row of rows) {
    const found = row.top >= threshold;
    const inScope = row.expected.length > 0;
    const right = row.sections.slice(0, RETRIEVAL_TOP_K).some((section) => row.expected.includes(section));
    if (found && inScope && right) truePositive += 1;
    else if (found && inScope) {
      falsePositive += 1;
      wrongSection += 1;
    } else if (found && !inScope) falsePositive += 1;
    else if (!found && inScope) falseNegative += 1;
  }
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
  const f05 = precision + recall ? (1.25 * precision * recall) / (0.25 * precision + recall) : 0;
  const outOfScopeFound = rows.filter((row) => !row.expected.length && row.top >= threshold).map((row) => row.question);
  return { threshold, precision, recall, f05, wrongSection, outOfScopeFound };
}

function table(label: string, rows: Scored[], thresholds: number[]): { text: string; best: ReturnType<typeof evaluate> } {
  const results = thresholds.map((threshold) => evaluate(rows, threshold));
  const best = results.reduce((a, b) => (b.f05 > a.f05 + 1e-9 || (Math.abs(b.f05 - a.f05) < 1e-9 && b.threshold > a.threshold) ? b : a));
  const lines = [
    `### ${label}`,
    "",
    "| threshold | precision | recall | F0.5 | wrong section found | out-of-scope found |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.threshold.toFixed(3)}${r === best ? " (chosen)" : ""} | ${r.precision.toFixed(3)} | ${r.recall.toFixed(3)} | ${r.f05.toFixed(3)} | ${r.wrongSection} | ${r.outOfScopeFound.length} |`,
    ),
    "",
    `Out-of-scope questions still found at the chosen threshold: ${best.outOfScopeFound.length ? best.outOfScopeFound.map((q) => `"${q}"`).join(", ") : "none"}.`,
    "",
    "Per question (top score, top section):",
    "",
    ...rows.map((row) => `- [${row.kind}] ${row.top.toFixed(3)} ${row.sections[0] ?? "(no hit)"}: "${row.question}"${row.expected.length && !row.sections.slice(0, RETRIEVAL_TOP_K).some((s) => row.expected.includes(s)) ? " MISSED" : ""}`),
  ];
  return { text: lines.join("\n"), best };
}

async function main(): Promise<void> {
  const set = (JSON.parse(readFileSync("evals/retrieval-set.json", "utf8")) as { questions: Labelled[] }).questions;
  const document = chunkKnowledgeBase(readFileSync(KB_SOURCE_PATH, "utf8"));

  // Semantic: the production path, embeddings plus the hybrid SQL function.
  const vectors = await embed(set.map((row) => row.question), 30_000);
  const semantic: Scored[] = [];
  for (const [index, row] of set.entries()) {
    const result = await queryDb<{ section_path: string; similarity: number | null }>(`select section_path, similarity from support_agent.search_kb($1::vector, $2, $3)`, [
      vectorLiteral(vectors[index]!),
      row.question,
      RETRIEVAL_TOP_K,
    ]);
    semantic.push({ ...row, top: Math.max(0, ...result.rows.map((hit) => hit.similarity ?? 0)), sections: result.rows.map((hit) => hit.section_path) });
  }

  // Lexical: memory mode and degraded mode.
  const lexical: Scored[] = set.map((row) => {
    const hits = lexicalSearch(document.chunks, row.question, RETRIEVAL_TOP_K);
    return { ...row, top: hits[0]?.score ?? 0, sections: hits.map((hit) => hit.chunk.section_path) };
  });

  const semanticThresholds = Array.from({ length: 31 }, (_, index) => 0.2 + index * 0.01);
  const lexicalThresholds = Array.from({ length: 25 }, (_, index) => 0.5 + index * 0.5);
  const semanticTable = table(`Hybrid search, threshold on the top cosine similarity (${EMBEDDING_MODEL})`, semantic, semanticThresholds);
  const lexicalTable = table("Full text only (memory and degraded mode), threshold on the top BM25 score", lexical, lexicalThresholds);

  const report = [
    "# Retrieval calibration",
    "",
    `Generated by \`npm run kb:calibrate\` on ${new Date().toISOString()}. Knowledge base ${document.kb_version.slice(0, 12)}, ${document.chunks.length} chunks, ${set.length} labelled questions (${set.filter((q) => q.expected.length).length} in scope, ${set.filter((q) => !q.expected.length).length} out of scope), top ${RETRIEVAL_TOP_K}.`,
    "",
    "A found in-scope question counts only when an expected section is in the top results. The chosen threshold maximises F0.5, which weights precision: declining is safer than answering wrongly.",
    "",
    semanticTable.text,
    "",
    lexicalTable.text,
    "",
  ].join("\n");
  writeFileSync("evals/retrieval-calibration.md", report);
  console.log(report.split("Per question")[0]);
  console.log(`Chosen: RETRIEVAL_MIN_SCORE = ${semanticTable.best.threshold.toFixed(2)} (precision ${semanticTable.best.precision.toFixed(3)}, recall ${semanticTable.best.recall.toFixed(3)})`);
  console.log(`Chosen: MEMORY_RETRIEVAL_MIN_SCORE = ${lexicalTable.best.threshold.toFixed(1)} (precision ${lexicalTable.best.precision.toFixed(3)}, recall ${lexicalTable.best.recall.toFixed(3)})`);
}

main()
  .catch((error: unknown) => {
    console.error("Calibration failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
