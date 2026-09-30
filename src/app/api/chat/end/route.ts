import "server-only";

import * as z from "zod";

import { loadTextConversation } from "@/agent/turn-store";
import { finishConversation, safeSummary } from "@/lib/conversation-end";
import { sameOrigin } from "@/lib/same-origin";

// The customer ends a typed conversation (DESIGN §13): the same final status,
// summary and follow-up ticket a call's end-of-call report produces, then what
// the page may show. Idempotent: ending twice changes nothing and returns the
// same summary. A tab closed without ending is closed by the outbox worker.
export const runtime = "nodejs";

const bodySchema = z.object({ conversationId: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "bad_request" }, { status: 403, headers });
  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    raw = undefined;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400, headers });

  try {
    const conversation = await loadTextConversation(parsed.data.conversationId);
    if (!conversation) return Response.json({ error: "not_found" }, { status: 404, headers });
    await finishConversation(conversation.id, { followUps: true, endedReason: "customer-ended" });
    return Response.json(await safeSummary(conversation.id), { headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "text_end_failed", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
