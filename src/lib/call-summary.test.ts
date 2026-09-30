import { describe, expect, it } from "vitest";

import { contactFromTranscript, finalStatus, summarise, type CallRecord } from "./call-summary";

const base: CallRecord = { turns: [], toolCalls: [], answeredSections: [], tickets: [], escalations: [] };
const turn = (answer_type: string, status = "ok", reply_source = "agent") => ({ answer_type, status, reply_source, user_text: "x" });

describe("finalStatus", () => {
  it("is escalated, abandoned, failed, ticket_created or resolved, in that order", () => {
    expect(finalStatus({ ...base, turns: [turn("collect_details")], escalations: [{ escalation_ref: "E-2001", category: "account", call_booked: true, booking_status: "booked" }] })).toBe("escalated");
    expect(finalStatus({ ...base, turns: [turn("answer"), turn("collect_details")] })).toBe("abandoned");
    expect(finalStatus({ ...base, turns: [turn("answer", "error", "fallback")] })).toBe("failed");
    expect(finalStatus({ ...base, turns: [turn("ticket_created")], tickets: [{ ticket_ref: "T-4001", category: "invoice" }] })).toBe("ticket_created");
    expect(finalStatus({ ...base, turns: [turn("answer")] })).toBe("resolved");
  });
});

describe("summarise", () => {
  it("writes what happened from the records", () => {
    expect(
      summarise({
        ...base,
        turns: [turn("answer"), turn("lookup_result"), turn("ticket_created")],
        answeredSections: ["Frequently Asked Questions > How Does RelayPay Charge Fees?"],
        toolCalls: [{ tool_name: "lookup_transaction", status: "ok", result_summary: "found TXN-9001: processing, eta 2026-08-19 passed 41 days ago, unverified" }],
        tickets: [{ ticket_ref: "T-4001", category: "payment" }],
      }),
    ).toBe(
      "3 turns. Answered from FAQ: How Does RelayPay Charge Fees? Looked up transaction: found TXN-9001: processing, eta 2026-08-19 passed 41 days ago, unverified. Opened T-4001 (payment).",
    );
  });
});

describe("contactFromTranscript", () => {
  it("finds the last email the caller said, spoken or written", () => {
    expect(contactFromTranscript(["my name is Efua", "it's efua at accrastack dot example"])).toBe("efua at accrastack dot example");
    expect(contactFromTranscript(["write to a@b.co please"])).toBe("a@b.co");
    expect(contactFromTranscript(["no email here"])).toBeNull();
  });
});
