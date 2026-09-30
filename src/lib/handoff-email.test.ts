import { describe, expect, it } from "vitest";

import { buildHandoffEmail, type HandoffInput } from "./handoff-email";

const base: HandoffInput = {
  escalation: {
    escalation_ref: "E-2001",
    ticket_ref: "T-4001",
    category: "account",
    reason: "Account restricted; caller frustrated that nobody has helped.",
    user_name: "Efua Mensah",
    user_email: "efua@accrastack.example",
    call_booked: true,
    appointment_time: "2026-10-06T13:00:00.000Z",
    booking_status: "booked",
    booking_error: null,
    cal_booking_uid: "abc123",
    timezone: "Africa/Lagos",
    preferred_time_text: "Tuesday at 2pm",
  },
  customer: { customer_id: "CUS-1003", company_name: "AccraStack", plan: "Scale", account_status: "restricted", kyc_status: "review required", support_notes: "Account is under compliance review." },
  callerLines: ["My account was restricted and nobody is helping me.", "Efua Mensah", "efua at accrastack dot example", "Tuesday at 2pm"],
  agentLines: ["I'm sorry. A specialist needs to look at this.", "What's the best email for you?", "Thanks."],
  toolCalls: [{ tool_name: "lookup_customer", status: "ok", result_summary: "verified CUS-1003" }],
  consoleUrl: "https://example.test/console/conversations/1",
  manageUrl: "https://example.test/console/settings",
};

describe("buildHandoffEmail", () => {
  it("puts the category, company and booked time in the subject", () => {
    expect(buildHandoffEmail(base).subject).toBe("[Escalation E-2001] account · AccraStack · callback Tue 6 Oct 14:00 Lagos time");
  });

  it("lays the body out in the order DESIGN §10.3 gives", () => {
    const { text } = buildHandoffEmail(base);
    const order = ["CALLER", "WHY", "THE CUSTOMER'S LAST WORDS", "WHAT WE ALREADY TOLD THEM", "WHAT WE LOOKED UP", "BOOKING"].map((heading) => text.indexOf(`${heading}\n`));
    expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]!))).toBe(true);
    expect(text).toContain("Verified as CUS-1003 (AccraStack)");
    expect(text).toContain("Booked for Tuesday 6 October at 2 PM Lagos time.");
    expect(text).toContain("Open the conversation: https://example.test/console/conversations/1");
    // The last three things the caller said, quoted.
    expect(text.match(/^ {2}"/gm)).toHaveLength(3 + 2);
  });

  it("says plainly when no call is booked, and why", () => {
    const { subject, text } = buildHandoffEmail({ ...base, customer: null, escalation: { ...base.escalation, call_booked: false, appointment_time: null, booking_status: "failed", booking_error: "the slot was taken" } });
    expect(subject).toBe("[Escalation E-2001] account · unverified caller · no callback booked");
    expect(text).toContain("Not booked: the slot was taken.");
    expect(text).toContain("Not verified");
  });

  it("escapes HTML and attaches the logo the HTML shows", () => {
    const email = buildHandoffEmail({ ...base, escalation: { ...base.escalation, reason: "<script>x</script>" } });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain('src="cid:relaypay-logo"');
    expect(email.attachments).toEqual([expect.objectContaining({ content_id: "relaypay-logo", filename: "relaypay-logo.png" })]);
    expect(email.attachments[0]!.content.length).toBeGreaterThan(1000);
  });
});
