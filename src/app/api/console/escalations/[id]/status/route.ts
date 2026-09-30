import "server-only";

import { SESSION_COOKIE, sessionValid } from "@/lib/console/auth";
import { changeEscalationStatus } from "@/lib/console/queries";
import { sameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";

function cookieValue(request: Request): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

/** The console's only write (DESIGN §14): an escalation status change, recorded as a row. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request) || !sessionValid(cookieValue(request))) return new Response("Forbidden", { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  await changeEscalationStatus(id, String(form.get("status") ?? ""));
  const back = String(form.get("back") ?? "/console/escalations");
  return new Response(null, { status: 303, headers: { Location: new URL(back.startsWith("/console") ? back : "/console/escalations", request.url).toString() } });
}
