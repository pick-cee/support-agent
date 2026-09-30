import "server-only";

import { consoleWriteAllowed, json, readJson } from "@/lib/console/request";
import { createTeamEntry, validateTeamInput, type TeamInput } from "@/lib/team-knowledge";

export const runtime = "nodejs";

/** The team answers a question, or posts a service notice; the agent can use it at once (DESIGN §8). */
export async function POST(request: Request): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid" }, 400);
  const input: TeamInput = {
    kind: body.kind === "notice" ? "notice" : "answer",
    title: String(body.title ?? ""),
    body: String(body.body ?? ""),
    sourceQuestion: typeof body.source_question === "string" ? body.source_question : null,
    expiresAt: typeof body.expires_at === "string" && body.expires_at ? body.expires_at : null,
  };
  const problem = validateTeamInput(input);
  if (problem) return json({ error: "invalid", field: problem }, 400);
  try {
    return json({ entry: await createTeamEntry(input) }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "team_knowledge_not_saved", error: error instanceof Error ? error.message : String(error) }));
    return json({ error: "not_saved" }, 502);
  }
}
