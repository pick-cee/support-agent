import "dotenv/config";

import { codeSentences } from "../src/agent/code-sentences";
import type { ToolCallRecord } from "../src/agent/run-agent";
import { CAL_API_BASE } from "../src/lib/constants";
import { closePool, queryDb } from "../src/lib/db";
import { systemClock } from "../src/lib/time";
import { executeTool } from "../src/mcp/execute";
import { supabaseServices } from "../src/mcp/services";
import { supabaseRepository } from "../src/mcp/supabase-repository";
import { createEscalation } from "../src/mcp/tools/create-escalation";
import { findCallbackSlots } from "../src/mcp/tools/find-callback-slots";

// Phase 5's exit check (DESIGN §18.1), live:
//   A. A real escalation books a real Cal.com slot and the handoff email is sent.
//   B. With the Cal.com key removed, the caller hears the honest line and a
//      booking_failed alert is recorded (and emailed).
// The booking made in A is cancelled at the end, so the calendar is left as it was.
// Emails go to SUPPORT_INBOX_EMAIL, or Resend's test inbox (delivered@resend.dev)
// when it is not set. Usage: npm run phase5:check

const CANCEL_VERSION = "2026-02-25"; // POST /v2/bookings/{uid}/cancel, read 2026-09-29

async function escalate(label: string, attendee: string): Promise<{ result: Record<string, unknown>; deferred: Promise<void>[] }> {
  const conversationId = await supabaseRepository.createConversation("eval");
  const deferred: Promise<void>[] = [];
  const services = supabaseServices("live", (work) => void deferred.push(work()));
  const context = { conversationId, turnId: null, via: "agent" as const, clock: systemClock };
  const slots = await executeTool(findCallbackSlots, { preferred_time_text: "tomorrow at 3pm" }, context, supabaseRepository, services);
  const offered = slots.structuredContent as { requested_available?: boolean; requested_start_utc?: string; alternatives?: { start_utc: string }[]; timezone_used?: string };
  const start = offered.requested_available ? offered.requested_start_utc : offered.alternatives?.[0]?.start_utc;
  if (!start) throw new Error(`${label}: no slot offered: ${JSON.stringify(offered)}`);
  const result = await executeTool(
    createEscalation,
    { user_name: "Phase 5 check", user_email: attendee, category: "other", reason: `${label}: automated live check of booking and handoff. The booking is cancelled right after.`, slot_start_utc: start, timezone: offered.timezone_used },
    context,
    supabaseRepository,
    services,
  );
  return { result: result.structuredContent, deferred };
}

function spoken(result: Record<string, unknown>): string {
  const call: ToolCallRecord = { id: "x", name: "create_escalation", input: {}, isError: false, result };
  return codeSentences([call], new Date()).sentences.join(" ");
}

async function main(): Promise<void> {
  process.env.SUPPORT_INBOX_EMAIL ||= "delivered@resend.dev";
  const attendee = "delivered@resend.dev";
  const checks: [boolean, string][] = [];

  // A. Everything real.
  const a = await escalate("Part A", attendee);
  await Promise.all(a.deferred);
  const rowA = (
    await queryDb<{ escalation_ref: string; booking_status: string; cal_booking_uid: string | null; appointment_time: string | null; notification_status: string }>(
      `select escalation_ref, booking_status, cal_booking_uid, appointment_time::text, notification_status from support_agent.escalations where id = $1`,
      [a.result.escalation_id],
    )
  ).rows[0]!;
  console.log(`A: ${rowA.escalation_ref} booking ${rowA.booking_status} (${rowA.cal_booking_uid ?? "no uid"}) at ${rowA.appointment_time ?? "none"}, notification ${rowA.notification_status}`);
  console.log(`A: the caller hears: "${spoken(a.result)}"`);
  checks.push([rowA.booking_status === "booked" && Boolean(rowA.cal_booking_uid), "A real Cal.com booking was made"]);
  checks.push([rowA.notification_status === "sent", `The handoff email was sent to ${process.env.SUPPORT_INBOX_EMAIL}`]);
  checks.push([/will call you on/.test(spoken(a.result)), "The caller hears the booked time, written by code"]);

  // B. Cal.com key removed.
  const key = process.env.CAL_API_KEY;
  delete process.env.CAL_API_KEY;
  const since = new Date();
  let b: { result: Record<string, unknown>; deferred: Promise<void>[] } | null = null;
  try {
    // Slots cannot be read without the key either, so the slot is the one from A (cancelled below first).
    process.env.CAL_API_KEY = key;
    if (rowA.cal_booking_uid) await cancel(rowA.cal_booking_uid, key!);
    delete process.env.CAL_API_KEY;
    const conversationId = await supabaseRepository.createConversation("eval");
    const deferred: Promise<void>[] = [];
    const services = supabaseServices("live", (work) => void deferred.push(work()));
    const result = await executeTool(
      createEscalation,
      { user_name: "Phase 5 check", user_email: attendee, category: "other", reason: "Part B: live check with the Cal.com key removed.", slot_start_utc: rowA.appointment_time ?? new Date(Date.now() + 86_400_000).toISOString(), timezone: "Africa/Lagos" },
      { conversationId, turnId: null, via: "agent", clock: systemClock },
      supabaseRepository,
      services,
    );
    await Promise.all(deferred);
    b = { result: result.structuredContent, deferred };
  } finally {
    process.env.CAL_API_KEY = key;
  }
  const alert = (
    await queryDb<{ fingerprint: string; last_seen: string; notified_at: string | null }>(
      `select fingerprint, last_seen::text, notified_at::text from support_agent.alerts where type = 'booking_failed' and last_seen >= $1 order by last_seen desc limit 1`,
      [since.toISOString()],
    )
  ).rows[0];
  console.log(`B: booking ${String(b?.result.booking_status)}, the caller hears: "${spoken(b?.result ?? {})}"`);
  console.log(`B: alert ${alert ? `${alert.fingerprint}, notified ${alert.notified_at ?? "not yet"}` : "none"}`);
  checks.push([b?.result.booking_status === "failed", "Without the key, booking_status is failed"]);
  checks.push([spoken(b?.result ?? {}) === "A specialist will email you to arrange a time.", "Without the key, the caller hears the honest line"]);
  checks.push([Boolean(alert), "A booking_failed alert was recorded"]);

  console.log("");
  for (const [ok, says] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${says}`);
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}

async function cancel(uid: string, apiKey: string): Promise<void> {
  const response = await fetch(`${CAL_API_BASE}/v2/bookings/${uid}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "cal-api-version": CANCEL_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({ cancellationReason: "Automated Phase 5 live check; not a real callback." }),
  });
  console.log(`Cancelled the test booking ${uid}: HTTP ${response.status}`);
}

main()
  .catch((error: unknown) => {
    console.error("Phase 5 check failed:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
