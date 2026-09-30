import "server-only";

import { consoleWriteAllowed, json, readJson, UUID } from "@/lib/console/request";
import { setTeamEntryActive } from "@/lib/team-knowledge";

export const runtime = "nodejs";

/** Switches a team answer or notice off (out of search at once) or back on. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);
  const body = await readJson(request);
  if (typeof body?.active !== "boolean") return json({ error: "invalid" }, 400);
  return (await setTeamEntryActive(id, body.active)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
