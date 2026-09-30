import "server-only";

import { changeEscalationStatus } from "@/lib/console/queries";
import { consoleWriteAllowed, json, readJson, UUID } from "@/lib/console/request";

export const runtime = "nodejs";

/**
 * An escalation status change (DESIGN §14), recorded as a row. The console's
 * status menu sends JSON and updates in place; a plain form post (no script)
 * still works and comes back to the page.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!consoleWriteAllowed(request)) return new Response("Forbidden", { status: 403 });
  const { id } = await context.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await readJson(request);
    const changed = await changeEscalationStatus(id, String(body?.status ?? ""));
    return json({ ok: changed });
  }
  const form = await request.formData();
  await changeEscalationStatus(id, String(form.get("status") ?? ""));
  const back = String(form.get("back") ?? "/console/escalations");
  return new Response(null, { status: 303, headers: { Location: new URL(back.startsWith("/console") ? back : "/console/escalations", request.url).toString() } });
}
