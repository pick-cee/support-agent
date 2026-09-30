import { describe, expect, it } from "vitest";

import { EMAIL } from "@/app/copy";

import { buildAlertEmail, buildTestEmail } from "./notices";

const alert = {
  type: "booking_failed",
  severity: "critical",
  message: "Cal.com refused the booking for E-2001.",
  context: { escalation_ref: "E-2001", status: 422, empty: "" },
  occurrences: 3,
  first_seen: "2026-09-30T08:05:00Z",
  last_seen: "2026-09-30T08:20:00Z",
};

describe("alert and test emails", () => {
  it("renders an alert with its facts in Lagos time, the logo and a link to the console", () => {
    const email = buildAlertEmail(alert, { consoleUrl: "https://example.test/console/alerts", manageUrl: "https://example.test/console/settings" });
    expect(email.subject).toBe(EMAIL.alert.subject("critical", "booking_failed"));
    expect(email.text).toContain("30 Sept, 09:05 Lagos time");
    expect(email.text).toContain("Escalation ref");
    // Empty context values are left out rather than shown blank.
    expect(email.text).not.toMatch(/Empty/);
    expect(email.html).toContain('src="cid:relaypay-logo"');
    expect(email.html).toContain("https://example.test/console/alerts");
    expect(email.text).toContain(EMAIL.reasons.critical);
  });

  it("says why it came when it went to the last known list because the database was down", () => {
    expect(buildAlertEmail(alert, { consoleUrl: null, manageUrl: null }, true).text).toContain(EMAIL.reasons.direct);
  });

  it("lists what a recipient signed up for in the test email, or says nothing is chosen", () => {
    const links = { consoleUrl: "https://example.test/console", manageUrl: "https://example.test/console/settings" };
    const some = buildTestEmail({ name: "Akin", escalations: true, critical_alerts: false, warning_alerts: true }, links);
    expect(some.text).toContain(EMAIL.test.kinds.escalations);
    expect(some.text).toContain(EMAIL.test.kinds.warning);
    expect(some.text).not.toContain(EMAIL.test.kinds.critical);
    expect(buildTestEmail({ name: null, escalations: false, critical_alerts: false, warning_alerts: false }, links).text).toContain(EMAIL.test.none);
  });
});
