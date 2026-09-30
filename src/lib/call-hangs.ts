import "server-only";

import { raiseAlert, type AlertInput } from "@/lib/alerts";
import { HANG_ALERT_MIN_CALLS, HANG_ALERT_WINDOW_MINUTES } from "@/lib/constants";
import { queryDb } from "@/lib/db";

/**
 * The alert for calls going quiet, or null while it is not a pattern. One
 * fingerprint for all calls, so a run of slow calls is one alert, counted, and
 * at most one email per ALERT_RENOTIFY_MINUTES (DESIGN §15).
 */
export function hangAlert(quietCalls: number, callId: string | null): AlertInput | null {
  if (quietCalls < HANG_ALERT_MIN_CALLS) return null;
  return {
    type: "vapi_hang",
    severity: "warning",
    fingerprint: "vapi_hang",
    message: `${quietCalls} voice calls in the last ${HANG_ALERT_WINDOW_MINUTES} minutes had a caller waiting in silence for an answer (Vapi's hang notice).`,
    context: { quiet_calls: quietCalls, window_minutes: HANG_ALERT_WINDOW_MINUTES, last_call_id: callId },
  };
}

/**
 * Vapi's "hang": a caller waited in silence for the assistant. Each one is
 * recorded on its call. Only a pattern is emailed: one alert per call emailed
 * the team after every slow call, including each of our own test calls
 * (FAILURES 50), and a single slow reply is nothing anyone can act on.
 */
export async function recordHang(conversationId: string | null, callId: string | null): Promise<void> {
  await queryDb(
    `insert into support_agent.conversation_events (conversation_id, event_type, summary, metadata, source)
     values ($1, 'vapi_hang', 'Vapi reported the caller waiting in silence for an answer.', $2, 'system')`,
    [conversationId, JSON.stringify({ call_id: callId })],
  );
  const result = await queryDb<{ calls: number }>(
    `select count(distinct coalesce(conversation_id::text, metadata->>'call_id'))::int as calls
       from support_agent.conversation_events
      where event_type = 'vapi_hang' and created_at > now() - make_interval(mins => $1)`,
    [HANG_ALERT_WINDOW_MINUTES],
  );
  const alert = hangAlert(result.rows[0]?.calls ?? 0, callId);
  if (alert) await raiseAlert(alert);
}
