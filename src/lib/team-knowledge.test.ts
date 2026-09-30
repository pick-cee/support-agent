import { describe, expect, it } from "vitest";

import { validateTeamInput } from "./team-knowledge";

describe("team knowledge input", () => {
  const answer = { kind: "answer" as const, title: "Payroll", body: "RelayPay does not run payroll; use contractor payouts." };

  it("accepts an answer and a notice with an end date", () => {
    expect(validateTeamInput(answer)).toBeNull();
    expect(validateTeamInput({ kind: "notice", title: "GBP payouts delayed", body: "GBP payouts are running a day late.", expiresAt: "2026-10-02T18:00:00Z" })).toBeNull();
  });

  it("names the field that is wrong", () => {
    expect(validateTeamInput({ ...answer, kind: "rumour" as never })).toBe("kind");
    expect(validateTeamInput({ ...answer, title: "  a " })).toBe("title");
    expect(validateTeamInput({ ...answer, title: "x".repeat(201) })).toBe("title");
    expect(validateTeamInput({ ...answer, body: "ok" })).toBe("body");
    expect(validateTeamInput({ ...answer, body: "x".repeat(2001) })).toBe("body");
    expect(validateTeamInput({ ...answer, kind: "notice", expiresAt: "next Friday" })).toBe("expires_at");
  });
});
