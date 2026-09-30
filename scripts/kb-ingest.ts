import "dotenv/config";

import { readFileSync } from "node:fs";

import { EMBEDDING_MODEL, KB_SOURCE_PATH } from "../src/lib/constants";
import { closePool, queryDb, withTransaction } from "../src/lib/db";
import { chunkKnowledgeBase } from "../src/lib/kb/chunk";
import { embed, vectorLiteral } from "../src/lib/kb/embed";

// Turns the approved knowledge base into embedded chunks (DESIGN §8). The file
// is the client's and is only read. Idempotent: the same file gives the same
// version, and a re-run replaces nothing it does not need to. Chunks from older
// versions are marked inactive, never deleted, so old retrieval logs resolve.

async function main(): Promise<void> {
  const document = chunkKnowledgeBase(readFileSync(KB_SOURCE_PATH, "utf8"));
  const existing = await queryDb<{ chunks: number }>(
    `select count(*)::int as chunks from support_agent.kb_chunks where kb_version = $1 and embedding_model = $2 and embedding is not null`,
    [document.kb_version, EMBEDDING_MODEL],
  );
  let embedded = 0;
  if (existing.rows[0]?.chunks !== document.chunks.length) {
    // The section path goes in with the text: the headings are the questions callers ask.
    const vectors = await embed(document.chunks.map((chunk) => `${chunk.section_path}\n\n${chunk.text}`), 30_000);
    embedded = vectors.length;
    await withTransaction(async (client) => {
      for (const [index, chunk] of document.chunks.entries()) {
        await client.query(
          `insert into support_agent.kb_chunks (chunk_id, kb_version, source_title, section_path, text, source_summary, embedding, embedding_model, active)
           values ($1, $2, $3, $4, $5, $6, $7::vector, $8, false)
           on conflict (chunk_id, kb_version) do update
             set embedding = excluded.embedding, embedding_model = excluded.embedding_model, text = excluded.text,
                 source_summary = excluded.source_summary, section_path = excluded.section_path, source_title = excluded.source_title`,
          [chunk.chunk_id, document.kb_version, chunk.source_title, chunk.section_path, chunk.text, chunk.source_summary, vectorLiteral(vectors[index]!), EMBEDDING_MODEL],
        );
      }
    });
  }

  // Switch versions in one transaction: the old set goes inactive as the new one goes live.
  // Only the document's chunks: what the team wrote in the console is not part of it.
  await withTransaction(async (client) => {
    await client.query(`update support_agent.kb_chunks set active = false where active and origin = 'document' and kb_version <> $1`, [document.kb_version]);
    await client.query(`update support_agent.kb_chunks set active = true where kb_version = $1`, [document.kb_version]);
  });

  const check = await queryDb<{ active: number; models: string[]; versions: number; missing: number }>(
    `select count(*) filter (where active)::int as active,
            array_agg(distinct embedding_model) filter (where active) as models,
            count(distinct kb_version)::int as versions,
            count(*) filter (where active and embedding is null)::int as missing
       from support_agent.kb_chunks where origin = 'document'`,
  );
  const row = check.rows[0]!;
  const problems = [
    row.active !== document.chunks.length ? `${row.active} active chunks, expected ${document.chunks.length}` : null,
    row.models?.length !== 1 || row.models[0] !== EMBEDDING_MODEL ? `active chunks embedded with ${JSON.stringify(row.models)}` : null,
    row.missing ? `${row.missing} active chunks have no embedding` : null,
  ].filter(Boolean);
  if (problems.length) {
    console.error(`Ingest check failed: ${problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Knowledge base ${document.kb_version.slice(0, 12)}: ${document.chunks.length} chunks active, all embedded with ${EMBEDDING_MODEL}` +
      `${embedded ? ` (${embedded} embedded now)` : " (already embedded, nothing to do)"}. ${row.versions} version(s) kept.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Ingest failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
