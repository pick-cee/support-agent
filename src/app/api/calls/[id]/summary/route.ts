import "server-only";

import { safeSummary } from "@/lib/conversation-end";
import { queryDb } from "@/lib/db";

// What the page may show after a call (DESIGN §13): the ticket reference, the
// escalation reference and a booked time. Never an account detail. Keyed by
// the Vapi call id, which is unguessable; anything else is a 404.
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const headers = { "Cache-Control": "no-store" };
  if (!/^[A-Za-z0-9-]{8,100}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers });

  const conversation = (await queryDb<{ id: string }>(`select id from support_agent.conversations where vapi_call_id = $1`, [id])).rows[0];
  if (!conversation) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json(await safeSummary(conversation.id), { headers });
}
