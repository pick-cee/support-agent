import { describe, expect, it } from "vitest";

import { SPOKEN } from "@/app/copy";

import { codeSentences } from "./code-sentences";
import type { ToolCallRecord } from "./run-agent";

const NOW = new Date("2026-09-29T10:00:00Z");

function call(name: string, result: Record<string, unknown>, isError = false): ToolCallRecord {
  return { id: `toolu_${name}`, name, input: {}, isError, result };
}

// PAY-7001 as lookup_payout returns it: scheduled 18 August, still processing.
const PAY_7001 = call("lookup_payout", { found: true, payout_id: "PAY-7001", status: "processing", scheduled_for: "2026-08-18", eta_known: true, eta_passed: true });

describe("codeSentences", () => {
  it("says a passed payout date in code, from the record", () => {
    const { sentences, covers } = codeSentences([PAY_7001], NOW);
    expect(sentences).toEqual(["The payout was scheduled for 18 August, which has passed, and it's still processing."]);
    expect(covers.eta).toBe(true);
  });

  it("says nothing about a payout whose date has not passed", () => {
    const upcoming = call("lookup_payout", { found: true, payout_id: "PAY-7009", status: "scheduled", scheduled_for: "2026-10-06", eta_known: true, eta_passed: false });
    expect(codeSentences([upcoming], NOW).sentences).toEqual([]);
  });

  it("says each stale record once, however many times it was looked up", () => {
    expect(codeSentences([PAY_7001, PAY_7001], NOW).sentences).toHaveLength(1);
  });

  it("never says booked unless Cal.com returned a booking", () => {
    const notBooked = call("create_escalation", { escalation_ref: "E-2001", call_booked: false, appointment_time: "2026-09-30T13:00:00Z", timezone: "Africa/Lagos" });
    const { sentences, covers } = codeSentences([notBooked], NOW);
    expect(sentences).toEqual([SPOKEN.callbackByEmail]);
    expect(covers.booking).toBe(true);
  });

  it("speaks the escalation outcome, not the ticket it opened as well", () => {
    const ticket = call("create_support_ticket", { ticket_ref: "T-4001" });
    const escalation = call("create_escalation", { escalation_ref: "E-2001", call_booked: false });
    const { sentences, covers } = codeSentences([ticket, escalation], NOW);
    expect(sentences).toEqual([SPOKEN.callbackByEmail]);
    expect(covers).toMatchObject({ booking: true, ticket: false });
  });

  it("says the ticket reference from the tool result, and nothing from a failed call", () => {
    expect(codeSentences([call("create_support_ticket", { ticket_ref: "T-4001" })], NOW).sentences).toEqual([SPOKEN.ticketOpened("T-4001")]);
    expect(codeSentences([call("create_support_ticket", { ticket_ref: "T-4001" }, true)], NOW).sentences).toEqual([]);
  });

  it("says a confirmation email is coming only when the outbox has one queued", () => {
    expect(codeSentences([call("create_support_ticket", { ticket_ref: "T-4001", confirmation_email: "queued" })], NOW).sentences).toEqual([SPOKEN.ticketOpened("T-4001"), SPOKEN.ticketConfirmation]);
    expect(codeSentences([call("create_support_ticket", { ticket_ref: "T-4001", confirmation_email: "none" })], NOW).sentences).toEqual([SPOKEN.ticketOpened("T-4001")]);
  });
});
