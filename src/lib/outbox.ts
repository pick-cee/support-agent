import "server-only";

import { raiseAlert } from "@/lib/alerts";
import { calCreateBooking, CalError, calFindBooking, type CalConfig } from "@/lib/cal";
import { JOB_BACKOFF_MINUTES, JOB_MAX_ATTEMPTS, OUTBOX_BATCH_SIZE } from "@/lib/constants";
import { queryDb } from "@/lib/db";
import { appBaseUrl, optionalEnv } from "@/lib/env";
import { buildAlertEmail } from "@/lib/email/notices";
import { buildHandoffEmail } from "@/lib/handoff-email";
import { recipientsFor } from "@/lib/notifications";
import { sendEmail } from "@/lib/resend";

// The outbox (DESIGN §10.1). A job is claimed by one statement that moves it
// to running, so two workers never run the same job, and that is safe on the
// transaction pooler. Whatever fails goes back to pending with backoff; after
// JOB_MAX_ATTEMPTS it is dead and a critical alert goes out.

export type SideEffectsMode = "live" | "sandbox";

type Job = {
  id: string;
  kind: "book_callback" | "notify_escalation" | "notify_alert";
  ref_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  /** The escalation belongs to an eval conversation: never booked or emailed, whoever runs the job. */
  for_eval: boolean;
};

/** A failure that no retry will fix (missing configuration, a slot someone else took). */
class FinalError extends Error {}

export function calConfig(): CalConfig | null {
  const apiKey = optionalEnv("CAL_API_KEY");
  const eventTypeId = Number(optionalEnv("CAL_EVENT_TYPE_ID"));
  return apiKey && Number.isInteger(eventTypeId) && eventTypeId > 0 ? { apiKey, eventTypeId } : null;
}

type EscalationRow = {
  id: string;
  escalation_ref: string;
  ticket_ref: string;
  conversation_id: string | null;
  customer_id: string | null;
  category: string;
  reason: string;
  user_name: string;
  user_email: string;
  timezone: string | null;
  requested_start: string | null;
  call_booked: boolean;
  appointment_time: string | null;
  booking_status: string;
  booking_error: string | null;
  cal_booking_uid: string | null;
  notification_status: string;
  preferred_time_text: string | null;
};

async function loadEscalation(id: string): Promise<EscalationRow> {
  const result = await queryDb<EscalationRow>(
    `select e.id, e.escalation_ref, t.ticket_ref, e.conversation_id, e.customer_id, e.category, e.reason, e.user_name, e.user_email,
            e.timezone, e.requested_start::text, e.call_booked, e.appointment_time::text, e.booking_status, e.booking_error,
            e.cal_booking_uid, e.notification_status, e.preferred_time_text
       from support_agent.escalations e join support_agent.support_tickets t on t.id = e.ticket_id
      where e.id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new FinalError(`escalation ${id} not found`);
  return result.rows[0];
}

async function setBooking(id: string, fields: { status: string; error?: string | null; uid?: string | null; start?: string | null }): Promise<void> {
  await queryDb(
    `update support_agent.escalations
        set booking_status = $2, booking_error = $3,
            cal_booking_uid = coalesce($4, cal_booking_uid),
            appointment_time = coalesce($5::timestamptz, appointment_time),
            call_booked = ($2 = 'booked'), updated_at = now()
      where id = $1`,
    [id, fields.status, fields.error ?? null, fields.uid ?? null, fields.start ?? null],
  );
}

async function bookCallback(job: Job, mode: SideEffectsMode): Promise<void> {
  const escalation = await loadEscalation(job.ref_id);
  if (escalation.cal_booking_uid || escalation.booking_status === "booked") return;
  if (mode === "sandbox") return setBooking(escalation.id, { status: "skipped_eval" });
  if (!escalation.requested_start) return setBooking(escalation.id, { status: "not_requested" });

  const config = calConfig();
  if (!config) {
    await setBooking(escalation.id, { status: "failed", error: "the booking calendar is not configured" });
    await raiseAlert({ type: "booking_failed", severity: "critical", fingerprint: "booking_failed:not_configured", message: "A callback could not be booked: CAL_API_KEY or CAL_EVENT_TYPE_ID is missing.", context: { escalation_ref: escalation.escalation_ref } });
    return;
  }

  const start = new Date(escalation.requested_start);
  // No idempotency key at Cal.com: a retry after an unknown outcome adopts the booking if it was made.
  if (job.attempts > 1 && job.last_error?.includes("[outcome unknown]")) {
    const existing = await calFindBooking(config, { email: escalation.user_email, start, escalationId: escalation.id });
    if (existing) return setBooking(escalation.id, { status: "booked", uid: existing.uid, start: existing.start });
  }
  try {
    const booking = await calCreateBooking(config, {
      start,
      name: escalation.user_name,
      email: escalation.user_email,
      timeZone: escalation.timezone ?? "Africa/Lagos",
      metadata: { escalation_id: escalation.id, escalation_ref: escalation.escalation_ref },
    });
    await setBooking(escalation.id, { status: "booked", uid: booking.uid, start: booking.start });
  } catch (error) {
    if (error instanceof CalError && !error.outcomeUnknown && error.status !== null && error.status < 500 && error.status !== 429) {
      // The slot went, or Cal.com refused the booking: retrying the same slot will not help.
      await setBooking(escalation.id, { status: "failed", error: "the chosen time was no longer available" });
      await raiseAlert({ type: "booking_failed", severity: "warning", fingerprint: `booking_failed:${escalation.id}`, message: `Callback for ${escalation.escalation_ref} could not be booked; the specialist must arrange a time.`, context: { error: error.message.slice(0, 300) } });
      return;
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}${error instanceof CalError && error.outcomeUnknown ? " [outcome unknown]" : ""}`);
  }
}

async function notifyEscalation(job: Job, mode: SideEffectsMode): Promise<void> {
  const escalation = await loadEscalation(job.ref_id);
  if (escalation.notification_status === "sent") return;
  if (mode === "sandbox") {
    await queryDb(`update support_agent.escalations set notification_status = 'skipped_eval', updated_at = now() where id = $1`, [escalation.id]);
    return;
  }
  const customer = escalation.customer_id
    ? (await queryDb<{ customer_id: string; company_name: string; plan: string; account_status: string; kyc_status: string; support_notes: string | null }>(
        `select customer_id, company_name, plan, account_status, kyc_status, support_notes from support_agent.customers where customer_id = $1`,
        [escalation.customer_id],
      )).rows[0] ?? null
    : null;
  const turns = escalation.conversation_id
    ? (await queryDb<{ user_text: string; spoken_text: string | null }>(
        `select user_text, spoken_text from support_agent.conversation_turns where conversation_id = $1 order by turn_index desc limit 4`,
        [escalation.conversation_id],
      )).rows.reverse()
    : [];
  const toolCalls = escalation.conversation_id
    ? (await queryDb<{ tool_name: string; status: string; result_summary: string | null }>(
        `select tool_name, status, result_summary from support_agent.tool_calls where conversation_id = $1 order by created_at limit 20`,
        [escalation.conversation_id],
      )).rows
    : [];
  // Nobody to tell is a setup problem, not a passing fault: retrying cannot fix it.
  // The escalation says why, and the console shows it until someone is added.
  const to = await recipientsFor("escalations");
  if (!to.length) {
    await queryDb(`update support_agent.escalations set notification_status = 'failed', notification_error = 'nobody is set to receive escalation emails', updated_at = now() where id = $1`, [escalation.id]);
    await raiseAlert({
      type: "notification_failed",
      severity: "critical",
      fingerprint: "notification_failed:no_recipients",
      message: `${escalation.escalation_ref} was not emailed: nobody is set to receive escalation emails. Add someone in the console's Settings.`,
      context: { escalation_ref: escalation.escalation_ref },
    });
    return;
  }
  const email = buildHandoffEmail({
    escalation,
    customer,
    callerLines: turns.map((turn) => turn.user_text).filter(Boolean),
    agentLines: turns.map((turn) => turn.spoken_text ?? "").filter(Boolean),
    toolCalls,
    consoleUrl: escalation.conversation_id ? `${appBaseUrl()}/console/conversations/${escalation.conversation_id}` : null,
    manageUrl: `${appBaseUrl()}/console/settings`,
  });
  await sendEmail({ to, ...email, idempotencyKey: `escalation:${escalation.id}` });
  await queryDb(`update support_agent.escalations set notification_status = 'sent', notification_error = null, updated_at = now() where id = $1`, [escalation.id]);
}

async function notifyAlert(job: Job): Promise<void> {
  const alert = (
    await queryDb<{ id: string; type: string; severity: string; message: string; context: Record<string, unknown>; occurrences: number; first_seen: string; last_seen: string }>(
      `select id, type, severity, message, context, occurrences, first_seen::text, last_seen::text from support_agent.alerts where id = $1`,
      [job.ref_id],
    )
  ).rows[0];
  if (!alert) return;
  const to = await recipientsFor(alert.severity === "critical" ? "critical_alerts" : "warning_alerts");
  // Nobody to email: the alert stays undelivered, and the console's banner says so and why.
  if (!to.length) return;
  const email = buildAlertEmail(alert, { consoleUrl: `${appBaseUrl()}/console/alerts`, manageUrl: `${appBaseUrl()}/console/settings` });
  await sendEmail({ to, ...email, idempotencyKey: String(job.payload.idempotency_key ?? job.id) });
  await queryDb(`update support_agent.alerts set notified_at = now() where id = $1`, [alert.id]);
}

async function finish(job: Job, error: unknown): Promise<void> {
  if (!error) {
    await queryDb(`update support_agent.jobs set status = 'done', last_error = null, updated_at = now() where id = $1`, [job.id]);
    return;
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const final = error instanceof FinalError || job.attempts >= JOB_MAX_ATTEMPTS;
  if (!final) {
    const minutes = JOB_BACKOFF_MINUTES[Math.min(job.attempts - 1, JOB_BACKOFF_MINUTES.length - 1)]!;
    await queryDb(
      `update support_agent.jobs set status = 'pending', last_error = $2, next_attempt_at = now() + make_interval(mins => $3), updated_at = now() where id = $1`,
      [job.id, message, minutes],
    );
    if (job.attempts === 1 && job.kind === "notify_escalation") {
      await raiseAlert({ type: "notification_failed", severity: "warning", fingerprint: "notification_failed", message: "A handoff email failed and will be retried.", context: { job_id: job.id, error: message } });
    }
    return;
  }
  await queryDb(`update support_agent.jobs set status = 'dead', last_error = $2, updated_at = now() where id = $1`, [job.id, message]);
  if (job.kind === "book_callback") await setBooking(job.ref_id, { status: "failed", error: "the booking calendar did not answer" });
  if (job.kind === "notify_escalation") await queryDb(`update support_agent.escalations set notification_status = 'failed', updated_at = now() where id = $1`, [job.ref_id]);
  if (job.kind !== "notify_alert") {
    await raiseAlert({ type: "job_dead", severity: "critical", fingerprint: `job_dead:${job.kind}`, message: `A ${job.kind} job gave up after ${job.attempts} attempts.`, context: { job_id: job.id, ref_id: job.ref_id, error: message } });
  } else {
    // The alert channel itself is broken: the console banner and the Vercel log are what is left (DESIGN §10.4).
    console.error(JSON.stringify({ event: "alert_not_delivered", job_id: job.id, error: message }));
  }
}

async function runOne(job: Job, requested: SideEffectsMode): Promise<void> {
  // An eval job left pending (its sandboxed inline attempt failed) must not be
  // booked or emailed for real when a live worker picks it up later.
  const mode: SideEffectsMode = job.for_eval ? "sandbox" : requested;
  let error: unknown = null;
  try {
    if (job.kind === "book_callback") await bookCallback(job, mode);
    else if (job.kind === "notify_escalation") await notifyEscalation(job, mode);
    else await notifyAlert(job);
  } catch (caught) {
    error = caught;
  }
  await finish(job, error);
}

const CLAIM_COLUMNS = `id, kind, ref_id, payload, attempts, last_error,
  exists (select 1 from support_agent.escalations e join support_agent.conversations c on c.id = e.conversation_id
           where e.id::text = jobs.ref_id::text and c.channel = 'eval') as for_eval`;

/** Runs these jobs now, once each, if they are still pending. Used inline by create_escalation and raiseAlert. */
export async function runJobsNow(ids: string[], mode: SideEffectsMode): Promise<void> {
  for (const id of ids) {
    const claimed = await queryDb<Job>(
      `update support_agent.jobs set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = $1 and status = 'pending' returning ${CLAIM_COLUMNS}`,
      [id],
    );
    if (claimed.rows[0]) await runOne(claimed.rows[0], mode);
  }
}

/** The worker /api/cron/outbox runs every minute: due jobs, and jobs stuck running after a crash. */
export async function runDueJobs(mode: SideEffectsMode, limit = OUTBOX_BATCH_SIZE): Promise<{ ran: number; recovered: number }> {
  const recovered = await queryDb(
    `update support_agent.jobs set status = 'pending', updated_at = now() where status = 'running' and updated_at < now() - interval '5 minutes'`,
  );
  const claimed = await queryDb<Job>(
    `update support_agent.jobs set status = 'running', attempts = attempts + 1, updated_at = now()
      where id in (select id from support_agent.jobs where status = 'pending' and next_attempt_at <= now()
                    order by next_attempt_at limit $1 for update skip locked)
      returning ${CLAIM_COLUMNS}`,
    [limit],
  );
  for (const job of claimed.rows) await runOne(job, mode);
  return { ran: claimed.rows.length, recovered: recovered.rowCount ?? 0 };
}
