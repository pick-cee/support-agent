import "server-only";

import { randomUUID } from "node:crypto";

import { EMBEDDING_MODEL } from "@/lib/constants";
import { queryDb, withTransaction } from "@/lib/db";
import { embed, vectorLiteral } from "@/lib/kb/embed";

// Knowledge the support team writes in the console (DESIGN §8, migration 0007):
// an answer to a question the agent could not answer, or a time-limited
// service notice. Saving embeds it and makes it searchable in the same step,
// as a kb_chunks row of origin "team", so the agent finds it exactly as it
// finds the knowledge base, and every retrieval log still resolves to it.

export type TeamKind = "answer" | "notice";

export type TeamEntry = {
  id: string;
  kind: TeamKind;
  title: string;
  body: string;
  source_question: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  times_used: number;
  /** A notice past its end date; decided by the database clock, not the page. */
  expired: boolean;
};

const TEAM_VERSION = "team";
const SOURCE_TITLES: Record<TeamKind, string> = { answer: "Support team answers", notice: "Service notices" };

function summary(body: string): string {
  const first = body.split(/(?<=[.!?])\s+/)[0] ?? body;
  return first.length > 160 ? `${first.slice(0, 157)}...` : first;
}

export async function listTeamKnowledge(): Promise<TeamEntry[]> {
  const result = await queryDb<TeamEntry>(
    `select t.id, t.kind, t.title, t.body, t.source_question, t.expires_at::text, t.active, t.created_at::text, t.updated_at::text,
            (t.expires_at is not null and t.expires_at <= now()) as expired,
            (select count(*)::int from support_agent.retrieval_logs r where t.chunk_id = any(r.chunk_ids_used)) as times_used
       from support_agent.team_knowledge t
      order by t.active desc, t.created_at desc`,
  );
  return result.rows;
}

export type TeamInput = { kind: TeamKind; title: string; body: string; sourceQuestion?: string | null; expiresAt?: string | null };

export function validateTeamInput(input: TeamInput): string | null {
  if (input.kind !== "answer" && input.kind !== "notice") return "kind";
  if (input.title.trim().length < 3 || input.title.trim().length > 200) return "title";
  if (input.body.trim().length < 3 || input.body.trim().length > 2000) return "body";
  if (input.expiresAt && Number.isNaN(new Date(input.expiresAt).getTime())) return "expires_at";
  return null;
}

/** Embeds first: if the embedding fails, nothing is saved, so nothing unsearchable looks live. */
export async function createTeamEntry(input: TeamInput): Promise<TeamEntry> {
  const title = input.title.trim();
  const body = input.body.trim();
  const sectionPath = `${SOURCE_TITLES[input.kind]} > ${title}`;
  const [vector] = (await embed([`${sectionPath}\n\n${body}`])) as [number[]];
  const id = randomUUID();
  const chunkId = `team-${id.slice(0, 12)}`;
  const expiresAt = input.kind === "notice" ? (input.expiresAt ?? null) : null;
  await withTransaction(async (client) => {
    await client.query(
      `insert into support_agent.team_knowledge (id, kind, title, body, source_question, expires_at, chunk_id) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.kind, title, body, input.sourceQuestion?.trim() || null, expiresAt, chunkId],
    );
    await client.query(
      `insert into support_agent.kb_chunks (chunk_id, kb_version, source_title, section_path, text, source_summary, embedding, embedding_model, active, origin, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7::vector, $8, true, 'team', $9)`,
      [chunkId, TEAM_VERSION, SOURCE_TITLES[input.kind], sectionPath, body, summary(body), vectorLiteral(vector), EMBEDDING_MODEL, expiresAt],
    );
  });
  const entry = (await listTeamKnowledge()).find((row) => row.id === id);
  if (!entry) throw new Error("The entry was saved but could not be read back");
  return entry;
}

/** Switching an entry off takes it out of search at once; it is kept, so old logs still resolve. */
export async function setTeamEntryActive(id: string, active: boolean): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query<{ chunk_id: string }>(`update support_agent.team_knowledge set active = $2, updated_at = now() where id = $1 returning chunk_id`, [id, active]);
    const chunkId = result.rows[0]?.chunk_id;
    if (!chunkId) return false;
    await client.query(`update support_agent.kb_chunks set active = $2 where chunk_id = $1 and kb_version = $3`, [chunkId, active, TEAM_VERSION]);
    return true;
  });
}
