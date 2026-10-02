import * as z from "zod";

import { BOOKING_HORIZON_DAYS, BUSINESS_TIMEZONE, ESCALATION_CATEGORIES, ESCALATION_TOOL_TIMEOUT_MS } from "@/lib/constants";
import { normaliseEmail } from "@/lib/normalise";
import { isValidZone, speakSlot } from "@/lib/zones";

import { lenientInput } from "../lenient-input";
import type { EscalationRecord, ToolDefinition } from "../types";
import { idempotencyKey } from "./create-support-ticket";
import { invalid } from "./shared";

type Input = {
  ticket_id?: string;
  customer_id?: string;
  user_name: string;
  user_email?: string;
  category: string;
  reason: string;
  preferred_time?: string;
  slot_start_utc?: string;
  timezone?: string;
  use_email_on_file?: boolean;
};

const MIN_LEAD_MS = 5 * 60_000;

/** Code-built, from what the records say: never "booked" unless Cal.com returned a booking (rule 11). */
export function followUpSummary(escalation: EscalationRecord): string {
  const zone = escalation.timezone ?? BUSINESS_TIMEZONE;
  const base = `Escalation ${escalation.escalation_ref} is ${escalation.status}, on ticket ${escalation.ticket_ref}.`;
  if (escalation.call_booked && escalation.appointment_time) return `${base} A specialist will call on ${speakSlot(new Date(escalation.appointment_time), zone)}.`;
  if (escalation.booking_status === "pending") return `${base} The callback is being booked; the specialist will confirm the time by email.`;
  if (escalation.booking_status === "skipped_eval") return `${base} Test run: no call was booked and no email was sent.`;
  return `${base} No call is booked; a specialist will email to arrange a time.`;
}

export const createEscalation: ToolDefinition<Input> = {
  name: "create_escalation",
  title: "Hand the case to a specialist",
  description:
    "Escalate to human support: account restrictions, compliance or verification concerns, disputes, refunds, cancellations, a frustrated caller, or anything needing judgment. " +
    "Collect the caller's name, an email (read it back first, or use_email_on_file for a verified caller who prefers not to spell it) and a preferred time, " +
    "then pass the start_utc of the slot the caller chose: from find_callback_slots this turn, or from the callback times offered listed in the call state, without searching again. This records the escalation, books the call and notifies the support team. " +
    "The system tells the caller the booked time or the email follow-up; do not state them yourself. After this, lookups are closed for the call.",
  wireInput: lenientInput({
    ticket_id: { type: "string", description: "An existing ticket from this call, if one was opened." },
    customer_id: { type: "string", description: "Ignored unless the caller was verified; the system uses the verified account." },
    user_name: { type: "string", required: true, description: "The caller's name as they gave it." },
    user_email: { type: "string", description: "The caller's email, after reading it back. Omit when use_email_on_file is true." },
    category: { type: "string", required: true, description: "One of: compliance, account, dispute, payment, other.", enum: ESCALATION_CATEGORIES },
    reason: { type: "string", required: true, description: "A short summary for the specialist: what the caller needs and what they were already told." },
    preferred_time: { type: "string", description: "The caller's preferred time, in their words." },
    slot_start_utc: { type: "string", description: "start_utc of the slot the caller chose, exactly as find_callback_slots returned it." },
    timezone: { type: "string", description: "timezone_used from find_callback_slots." },
    use_email_on_file: { type: "boolean", description: "True for a verified caller who wants the specialist to use the email on the account." },
  }),
  strictInput: z.object({
    ticket_id: z.string().trim().optional(),
    customer_id: z.string().trim().optional(),
    user_name: z.string().trim().min(1).max(120),
    user_email: z.string().trim().optional(),
    category: z.string().trim().min(1),
    reason: z.string().trim().min(3).max(2000),
    preferred_time: z.string().trim().max(200).optional(),
    slot_start_utc: z.string().trim().optional(),
    timezone: z.string().trim().optional(),
    use_email_on_file: z.boolean().optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  // It waits for the booking (up to CAL_TIMEOUT_MS) before it answers.
  timeoutMs: ESCALATION_TOOL_TIMEOUT_MS,

  purpose: (raw) => `Escalate a ${String(raw.category ?? "support")} case to a specialist${raw.slot_start_utc ? " and book a callback" : ""}.`,

  invalidInput: (raw) => {
    const missing = ["user_name", "category", "reason"].filter((field) => typeof raw[field] !== "string" || String(raw[field]).trim() === "");
    return invalid(`${missing.join(", ") || "a field"} is missing. Collect the caller's name, and give a category and a short reason.`, `invalid_input: ${missing.join(", ")}`);
  },

  async run({ input, context, state, repository, services }) {
    const category = (ESCALATION_CATEGORIES as readonly string[]).includes(input.category.toLowerCase()) ? input.category.toLowerCase() : "other";
    const customer = state?.verifiedCustomerId ? await repository.findCustomer(state.verifiedCustomerId) : null;

    // The email on file is used without anyone saying it (DESIGN §7.3).
    let email: string | null;
    if (input.use_email_on_file) {
      if (!customer) return invalid("use_email_on_file needs a verified caller. Ask the caller to say and spell their email.", "invalid_input: email on file without verification");
      email = customer.contact_email;
    } else {
      email = normaliseEmail(input.user_email);
      if (!email) return invalid("The email didn't validate. Ask the caller to spell it, then read it back.", "invalid_input: email did not validate");
    }

    const now = context.clock();
    let requestedStart: Date | null = null;
    let offeredZone: string | null = null;
    if (input.slot_start_utc) {
      const start = new Date(input.slot_start_utc);
      if (Number.isNaN(start.getTime()) || start.getTime() < now.getTime() + MIN_LEAD_MS || start.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000) {
        return invalid("slot_start_utc must be one of the start_utc values find_callback_slots offered in this call. Offer those times again.", "invalid_input: slot not bookable");
      }
      // Only a time this call was offered: never one the model made up.
      const offered = state?.offeredSlots ?? [];
      const match = offered.find((slot) => new Date(slot.start_utc).getTime() === start.getTime());
      if (offered.length && !match) {
        return invalid("That time was not one of the callback times offered on this call. Offer the times in the call state again, or search for a new time.", "invalid_input: slot not offered");
      }
      offeredZone = match?.timezone ?? null;
      requestedStart = start;
    }
    const timezone = input.timezone && isValidZone(input.timezone) ? input.timezone : offeredZone && isValidZone(offeredZone) ? offeredZone : BUSINESS_TIMEZONE;
    const conversationKey = context.conversationId ?? `direct:${email}`;

    const { escalation, created, jobIds } = await repository.createEscalation({
      conversationId: context.conversationId,
      ticketId: input.ticket_id ?? null,
      ticket: {
        conversationId: context.conversationId,
        customerId: customer?.customer_id ?? null,
        transactionId: null,
        payoutId: null,
        reportedReference: null,
        category: category === "payment" ? "payment" : category,
        priority: category === "compliance" || category === "account" ? "high" : "normal",
        proposedPriority: null,
        summary: `Escalated to a specialist: ${input.reason}`.slice(0, 1500),
        source: context.via === "agent" ? "agent" : "mcp_direct",
        idempotencyKey: idempotencyKey([conversationKey, "escalation-ticket", category]),
      },
      customerId: customer?.customer_id ?? null,
      userName: input.user_name,
      userEmail: email,
      category,
      reason: input.reason,
      preferredTimeText: input.preferred_time ?? null,
      timezone,
      requestedStart,
      bookingRequested: requestedStart !== null,
      idempotencyKey: idempotencyKey([conversationKey, "escalation", category]),
    });

    // Reserve, then act, then confirm (rule 11): the escalation exists before
    // anything goes to a third party, and a booking counts only once Cal.com returns one.
    if (created && jobIds.length) await services.runJobs(jobIds);
    const current = (await repository.findEscalation(escalation.id)) ?? escalation;

    return {
      status: "ok",
      isError: false,
      payload: {
        escalation_id: current.id,
        escalation_ref: current.escalation_ref,
        ticket_id: current.ticket_id,
        ticket_ref: current.ticket_ref,
        status: current.status,
        call_booked: current.call_booked,
        appointment_time: current.call_booked ? current.appointment_time : null,
        timezone: current.timezone,
        booking_status: current.booking_status,
        notification_status: current.notification_status,
        follow_up_summary: followUpSummary(current),
        created,
        message: "The system tells the caller what happens next. Confirm a specialist will follow up; do not state a time or a reference yourself.",
      },
      summary: `${created ? "created" : "existing"} ${current.escalation_ref}: ${category}, booking ${current.booking_status}, notification ${current.notification_status}`,
    };
  },
};
