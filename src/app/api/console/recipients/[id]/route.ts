import "server-only";

import { consoleWriteAllowed, json, readJson, UUID } from "@/lib/console/request";
import { NOTIFICATION_KINDS, removeRecipient, updateRecipient, type NotificationKind } from "@/lib/notifications";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Changes which emails someone receives, or pauses them (active). */
export async function PATCH(request: Request, context: Params): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid" }, 400);
  const changes: Partial<Record<NotificationKind | "active", boolean>> = {};
  for (const key of [...NOTIFICATION_KINDS, "active" as const]) if (typeof body[key] === "boolean") changes[key] = body[key];
  const recipient = await updateRecipient(id, changes);
  return recipient ? json({ recipient }) : json({ error: "not_found" }, 404);
}

export async function DELETE(request: Request, context: Params): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);
  return (await removeRecipient(id)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
