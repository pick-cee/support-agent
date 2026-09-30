import "server-only";

import { ALERT_RENOTIFY_MINUTES } from "@/lib/constants";
import { queryDb } from "@/lib/db";

export type AlertType =
  | "auth_failure"
  | "bad_vapi_payload"
  | "agent_error"
  | "agent_timeout"
  | "agent_limit"
  | "mcp_unreachable"
  | "tool_error"
  | "retrieval_degraded"
  | "booking_failed"
  | "notification_failed"
  | "job_dead"
  | "budget_exceeded"
  | "vapi_hang"
  | "gate_fallback"
  | "abandoned_escalation"
  | "rate_limited";

export type AlertInput = {
  type: AlertType;
  severity: "info" | "warning" | "critical";
  /** Same fingerprint, same alert: counted, not repeated (DESIGN §10.4). */
  fingerprint: string;
  message: string;
  context?: Record<string, unknown>;
};

/**
 * Records a problem once and counts repeats. An email goes out through the
 * outbox only for a new alert, or one last notified more than
 * ALERT_RENOTIFY_MINUTES ago: one broken dependency sends one email, not one
 * per call. Never throws. When the database itself is down, it sends straight
 * through Resend and the Vercel log is the record.
 */
export async function raiseAlert(alert: AlertInput): Promise<void> {
  const context = alert.context ?? {};
  console.error(JSON.stringify({ event: "alert", ...alert, context }));
  let due: { id: string; bucket: number } | undefined;
  try {
    const result = await queryDb<{ id: string; due: boolean }>(
      `insert into support_agent.alerts (type, severity, fingerprint, message, context)
       values ($1, $2, $3, $4, $5)
       on conflict (fingerprint) do update
         set occurrences = support_agent.alerts.occurrences + 1,
             last_seen = now(),
             severity = excluded.severity,
             message = excluded.message,
             context = excluded.context
       returning id, (notified_at is null or notified_at < now() - make_interval(mins => $6)) as due`,
      [alert.type, alert.severity, alert.fingerprint, alert.message, JSON.stringify(context), ALERT_RENOTIFY_MINUTES],
    );
    const row = result.rows[0];
    if (row?.due) due = { id: row.id, bucket: Math.floor(Date.now() / (ALERT_RENOTIFY_MINUTES * 60_000)) };
  } catch (error) {
    console.error(JSON.stringify({ event: "alert_not_recorded", fingerprint: alert.fingerprint, error: error instanceof Error ? error.message : String(error) }));
    await sendDirect(alert);
    return;
  }
  if (!due || alert.severity === "info") return;

  try {
    const job = await queryDb<{ id: string }>(
      `insert into support_agent.jobs (kind, ref_id, dedupe_key, payload)
       values ('notify_alert', $1, $2, $3)
       on conflict (dedupe_key) do nothing returning id`,
      [due.id, `notify_alert:${due.id}:${due.bucket}`, JSON.stringify({ idempotency_key: `alert:${due.id}:${due.bucket}` })],
    );
    if (job.rows[0]) {
      const { runJobsNow } = await import("@/lib/outbox");
      await runJobsNow([job.rows[0].id], "live");
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "alert_notification_not_queued", fingerprint: alert.fingerprint, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function sendDirect(alert: AlertInput): Promise<void> {
  try {
    const { sendEmail, supportInbox } = await import("@/lib/resend");
    await sendEmail({
      to: supportInbox(),
      subject: `[RelayPay alert] ${alert.severity}: ${alert.type} (database unreachable)`,
      text: `${alert.message}\n\nThe database could not record this alert, so it was sent directly.`,
      html: `<p>${alert.message.replace(/</g, "&lt;")}</p><p>The database could not record this alert, so it was sent directly.</p>`,
      idempotencyKey: `direct:${alert.fingerprint}:${Math.floor(Date.now() / (ALERT_RENOTIFY_MINUTES * 60_000))}`,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "alert_not_delivered", fingerprint: alert.fingerprint, error: error instanceof Error ? error.message : String(error) }));
  }
}
