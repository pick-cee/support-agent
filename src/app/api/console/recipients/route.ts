import "server-only";

import { consoleWriteAllowed, json, readJson } from "@/lib/console/request";
import { addRecipient } from "@/lib/notifications";

export const runtime = "nodejs";

/** Adds someone to the notification list (DESIGN §10.3). */
export async function POST(request: Request): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const body = await readJson(request);
  if (!body || typeof body.email !== "string") return json({ error: "invalid" }, 400);
  const result = await addRecipient({
    email: body.email,
    name: typeof body.name === "string" ? body.name : null,
    escalations: body.escalations !== false,
    critical_alerts: body.critical_alerts !== false,
    warning_alerts: body.warning_alerts === true,
  });
  return result.ok ? json({ recipient: result.recipient }, 201) : json({ error: result.reason }, result.reason === "exists" ? 409 : 400);
}
