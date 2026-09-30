import "server-only";

import { raiseAlert } from "@/lib/alerts";
import { contactFromTranscript, finalStatus, summarise, type CallRecord, type FinalStatus } from "@/lib/call-summary";
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { queryDb } from "@/lib/db";
import { speakSlot } from "@/lib/zones";

// How a conversation ends, whatever the channel (DESIGN §11): a call's
// end-of-call report, a customer ending a typed conversation, an idle typed
// conversation closed by the outbox worker, or an eval scenario finishing.
// The final status and summary are written by code from what was recorded,
// never by a model, and only once.

export async function loadCall(conversationId: string): Promise<CallRecord> {
  const [turns, toolCalls, sections, tickets, escalations] = await Promise.all([
    queryDb<CallRecord["turns"][number]>(`select answer_type, status, user_text, reply_source from support_agent.conversation_turns where conversation_id = $1 order by turn_index`, [conversationId]),
    queryDb<CallRecord["toolCalls"][number]>(`select tool_name, status, result_summary from support_agent.tool_calls where conversation_id = $1 order by created_at`, [conversationId]),
    queryDb<{ section_path: string }>(
      `select distinct k.section_path from support_agent.retrieval_logs r cross join lateral unnest(r.chunk_ids_used) as used(chunk_id)
         join support_agent.kb_chunks k on k.chunk_id = used.chunk_id and k.kb_version = r.kb_version
        where r.conversation_id = $1`,
      [conversationId],
    ),
    queryDb<CallRecord["tickets"][number]>(`select ticket_ref, category from support_agent.support_tickets where conversation_id = $1 order by created_at`, [conversationId]),
    queryDb<CallRecord["escalations"][number]>(`select escalation_ref, category, call_booked, booking_status from support_agent.escalations where conversation_id = $1 order by created_at`, [conversationId]),
  ]);
  return { turns: turns.rows, toolCalls: toolCalls.rows, answeredSections: sections.rows.map((row) => row.section_path), tickets: tickets.rows, escalations: escalations.rows };
}

async function openFollowUpTicket(conversationId: string, kind: "abandoned" | "failed", call: CallRecord): Promise<void> {
  const contact = contactFromTranscript(call.turns.map((turn) => turn.user_text));
  const summary =
    kind === "abandoned"
      ? `Customer left during escalation. Contact they gave: ${contact ?? "none recorded"}. Their words: ${call.turns.map((turn) => `"${turn.user_text}"`).slice(-4).join(" ")}`
      : `The agent failed during this conversation and the customer got the fallback. Contact they gave: ${contact ?? "none recorded"}. Review the transcript in the console.`;
  await queryDb(
    `insert into support_agent.support_tickets (conversation_id, category, priority, summary, source, idempotency_key)
     values ($1, 'other', 'high', $2, 'system', $3) on conflict (idempotency_key) do nothing`,
    [conversationId, summary.slice(0, 1500), `${kind}:${conversationId}`],
  );
  await raiseAlert({
    type: kind === "abandoned" ? "abandoned_escalation" : "agent_error",
    severity: kind === "abandoned" ? "info" : "warning",
    fingerprint: `${kind}_call:${conversationId}`,
    message:
      kind === "abandoned"
        ? "A customer left while giving details for a specialist; a follow-up ticket was opened."
        : "A conversation ended after the agent failed; a follow-up ticket was opened.",
    context: { conversation_id: conversationId },
  });
}

/**
 * Writes the final status and summary, once. Nobody falls through the floor:
 * a customer who left mid-escalation, or a conversation where the agent
 * failed, leaves a ticket on the queue. Evals pass `followUps: false`, so a
 * test run never puts work on the support team's queue.
 */
export async function finishConversation(conversationId: string, options: { followUps: boolean; endedReason?: string | null }): Promise<FinalStatus | null> {
  const claimed = await queryDb(
    `update support_agent.conversations
        set ended_at = coalesce(ended_at, now()), ended_reason = coalesce(ended_reason, $2), updated_at = now()
      where id = $1 and final_status is null
      returning id`,
    [conversationId, options.endedReason ?? null],
  );
  if (!claimed.rowCount) return null;
  const call = await loadCall(conversationId);
  const status = finalStatus(call);
  if (options.followUps && (status === "abandoned" || status === "failed")) await openFollowUpTicket(conversationId, status, call);
  await queryDb(`update support_agent.conversations set final_status = $2, summary = $3, updated_at = now() where id = $1`, [conversationId, status, summarise(await loadCall(conversationId))]);
  return status;
}

export type SafeSummary = { ticket_ref: string | null; escalation_ref: string | null; callback: { booked: boolean; when: string | null } | null };

/** What the customer may see after a conversation (DESIGN §13): references and a booked time, never an account detail. */
export async function safeSummary(conversationId: string): Promise<SafeSummary> {
  const [ticket, escalation] = await Promise.all([
    queryDb<{ ticket_ref: string }>(`select ticket_ref from support_agent.support_tickets where conversation_id = $1 and source <> 'system' order by created_at desc limit 1`, [conversationId]),
    queryDb<{ escalation_ref: string; call_booked: boolean; appointment_time: string | null; timezone: string | null }>(
      `select escalation_ref, call_booked, appointment_time::text, timezone from support_agent.escalations where conversation_id = $1 order by created_at desc limit 1`,
      [conversationId],
    ),
  ]);
  const e = escalation.rows[0];
  return {
    ticket_ref: e ? null : (ticket.rows[0]?.ticket_ref ?? null),
    escalation_ref: e?.escalation_ref ?? null,
    callback: e ? { booked: e.call_booked, when: e.call_booked && e.appointment_time ? speakSlot(new Date(e.appointment_time), e.timezone ?? BUSINESS_TIMEZONE) : null } : null,
  };
}
