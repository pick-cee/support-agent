import { describe, expect, it } from "vitest";

import { buildTicketConfirmationEmail } from "./ticket-confirmation";

describe("the customer's ticket confirmation", () => {
  const email = buildTicketConfirmationEmail({ ticket_ref: "T-4012", created_at: "2026-10-02T13:05:00Z" });

  it("names the reference and when it was logged, in Lagos time", () => {
    expect(email.subject).toBe("We've logged your request (T-4012)");
    expect(email.text).toContain("T-4012");
    expect(email.text).toContain("2 October 2026");
    expect(email.text).toContain("Lagos time");
    expect(email.html).toContain('src="cid:relaypay-logo"');
  });

  it("says a person will get back to them, and carries nothing written for the team", () => {
    expect(email.text).toMatch(/a person will look into it and get back to you/);
    expect(email.text).not.toMatch(/categor|complian|priority|summary/i);
  });
});
