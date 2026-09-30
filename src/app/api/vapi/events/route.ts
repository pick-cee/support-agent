import "server-only";

import { after } from "next/server";
import * as z from "zod";

import { raiseAlert } from "@/lib/alerts";
import { bearerMatches } from "@/lib/auth";
import { recordHang } from "@/lib/call-hangs";
import { finishConversation } from "@/lib/conversation-end";
import { queryDb } from "@/lib/db";
import { requireEnv } from "@/lib/env";

// Vapi's server messages (DESIGN §11): status-update, end-of-call-report and
// hang. Answers 200 at once and does the work after the response. Each
// message is idempotent: a duplicate changes nothing.
export const runtime = "nodejs";
export const maxDuration = 30;

const eventSchema = z.looseObject({
  message: z.looseObject({
    type: z.string(),
    call: z.looseObject({ id: z.string().min(1), type: z.string().optional() }).optional(),
    status: z.string().optional(),
    endedReason: z.string().optional(),
    cost: z.number().optional(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
  }),
});

type VapiEvent = z.infer<typeof eventSchema>["message"];

function channelOf(type: string | undefined): "web" | "phone" {
  return type === "inboundPhoneCall" || type === "outboundPhoneCall" ? "phone" : "web";
}

async function ensureConversation(callId: string, callType: string | undefined): Promise<string> {
  await queryDb(`insert into support_agent.conversations (vapi_call_id, channel) values ($1, $2) on conflict (vapi_call_id) do nothing`, [callId, channelOf(callType)]);
  return (await queryDb<{ id: string }>(`select id from support_agent.conversations where vapi_call_id = $1`, [callId])).rows[0]!.id;
}

async function onStatusUpdate(event: VapiEvent, callId: string): Promise<void> {
  await ensureConversation(callId, event.call?.type);
  if (event.status === "in-progress") {
    await queryDb(`update support_agent.conversations set started_at = coalesce(started_at, now()), updated_at = now() where vapi_call_id = $1`, [callId]);
  } else if (event.status === "ended") {
    await queryDb(`update support_agent.conversations set ended_at = coalesce(ended_at, now()), updated_at = now() where vapi_call_id = $1`, [callId]);
  }
}

/** Only the first report is applied; the final status and summary come from finishConversation (DESIGN §11). */
async function onEndOfCallReport(event: VapiEvent, callId: string): Promise<void> {
  const conversationId = await ensureConversation(callId, event.call?.type);
  // Only the first report is applied: a duplicate finds raw_end_report already set.
  const claimed = await queryDb(
    `update support_agent.conversations
        set ended_reason = $2, vapi_cost_usd = $3, raw_end_report = $4,
            started_at = coalesce(started_at, $5::timestamptz), ended_at = coalesce($6::timestamptz, ended_at, now()), updated_at = now()
      where vapi_call_id = $1 and raw_end_report is null`,
    [callId, event.endedReason ?? null, event.cost ?? null, JSON.stringify(event), event.startedAt ?? null, event.endedAt ?? null],
  );
  if (!claimed.rowCount) return;
  await finishConversation(conversationId, { followUps: true, endedReason: event.endedReason ?? null });
}

export async function POST(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), requireEnv("VAPI_SERVER_TOKEN"))) {
    after(() => raiseAlert({ type: "auth_failure", severity: "warning", fingerprint: "auth_failure:vapi_events", message: "A request reached the Vapi events endpoint without Vapi's server credential." }));
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    after(() => raiseAlert({ type: "bad_vapi_payload", severity: "warning", fingerprint: "bad_vapi_payload:events", message: "Vapi sent a server message we could not parse." }));
    return Response.json({ ok: false }, { status: 400 });
  }

  const event = parsed.data.message;
  const callId = event.call?.id;
  after(async () => {
    try {
      if (event.type === "hang") {
        await recordHang(callId ? await ensureConversation(callId, event.call?.type) : null, callId ?? null);
        return;
      }
      if (!callId) return;
      if (event.type === "status-update") await onStatusUpdate(event, callId);
      else if (event.type === "end-of-call-report") await onEndOfCallReport(event, callId);
    } catch (error) {
      console.error(JSON.stringify({ event: "vapi_event_not_recorded", type: event.type, call_id: callId, error: error instanceof Error ? error.message : String(error) }));
    }
  });
  return Response.json({ ok: true });
}
