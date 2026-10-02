import { SPOKEN, STATUS_PHRASES } from "@/app/copy";
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { isIsoDate } from "@/lib/time";
import { speakSlot } from "@/lib/zones";

import type { ToolCallRecord } from "./run-agent";
import { speakDate } from "./speech";

// The sentences the model never writes (DESIGN §6.4): reference numbers,
// booked times, dates computed from other dates. Code builds them from the
// tool result in this turn, so they are exactly what the records hold.

function ok(call: ToolCallRecord): call is ToolCallRecord & { result: Record<string, unknown> } {
  return call.isError === false && call.result !== null;
}

export type CodeSentences = {
  sentences: string[];
  /** What code spoke about, so the gates can remove the model's own version of it. */
  covers: { eta: boolean; ticket: boolean; booking: boolean };
};

export function codeSentences(toolCalls: ToolCallRecord[], now: Date): CodeSentences {
  const sentences: string[] = [];
  const covers = { eta: false, ticket: false, booking: false };
  const seen = new Set<string>();

  for (const call of toolCalls.filter(ok)) {
    const result = call.result;
    if (call.name === "lookup_transaction" && result.found === true && result.eta_passed === true && isIsoDate(result.estimated_arrival)) {
      const id = String(result.transaction_id);
      if (seen.has(id)) continue;
      seen.add(id);
      covers.eta = true;
      sentences.push(SPOKEN.staleEta(speakDate(result.estimated_arrival, now), STATUS_PHRASES[String(result.status)] ?? String(result.status)));
    }
    if (call.name === "lookup_payout" && result.found === true && result.eta_passed === true && isIsoDate(result.scheduled_for)) {
      const id = String(result.payout_id);
      if (seen.has(id)) continue;
      seen.add(id);
      covers.eta = true;
      sentences.push(SPOKEN.stalePayout(speakDate(result.scheduled_for, now), STATUS_PHRASES[String(result.status)] ?? String(result.status)));
    }
  }

  // An escalation opens its own ticket; the caller hears the escalation outcome, not two references.
  const escalation = [...toolCalls].reverse().find((call) => call.name === "create_escalation" && ok(call) && typeof call.result?.escalation_ref === "string");
  const ticket = [...toolCalls].reverse().find((call) => call.name === "create_support_ticket" && ok(call) && typeof call.result?.ticket_ref === "string");
  if (escalation?.result) {
    const result = escalation.result;
    covers.booking = true;
    // Never "booked" unless Cal.com returned a booking (rule 11).
    sentences.push(
      result.call_booked === true && typeof result.appointment_time === "string"
        ? SPOKEN.callbackBooked(speakSlot(new Date(result.appointment_time), typeof result.timezone === "string" ? result.timezone : BUSINESS_TIMEZONE))
        : SPOKEN.callbackByEmail,
    );
  } else if (ticket?.result) {
    covers.ticket = true;
    sentences.push(SPOKEN.ticketOpened(String(ticket.result.ticket_ref)));
    // Said only when the outbox has the email; never for an address that cannot receive it.
    if (ticket.result.confirmation_email === "queued") sentences.push(SPOKEN.ticketConfirmation);
  }
  return { sentences, covers };
}
