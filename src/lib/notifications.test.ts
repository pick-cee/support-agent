import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ current: [] as Record<string, unknown>[], fail: false }));

vi.mock("@/lib/db", () => ({
  queryDb: vi.fn(async () => {
    if (rows.fail) throw new Error("connect ETIMEDOUT");
    return { rows: rows.current, rowCount: rows.current.length };
  }),
}));

import { addRecipient, coverage, lastKnownRecipientsFor, recipientsFor } from "./notifications";

const person = (email: string, kinds: Partial<Record<"escalations" | "critical_alerts" | "warning_alerts" | "active", boolean>>) => ({
  id: email,
  email,
  name: null,
  escalations: false,
  critical_alerts: false,
  warning_alerts: false,
  active: true,
  created_at: "2026-09-30",
  ...kinds,
});

describe("notification recipients", () => {
  beforeEach(() => {
    rows.fail = false;
    rows.current = [
      person("ops@relaypay.example", { escalations: true, critical_alerts: true }),
      person("lead@relaypay.example", { critical_alerts: true, warning_alerts: true }),
      person("away@relaypay.example", { escalations: true, critical_alerts: true, warning_alerts: true, active: false }),
    ];
  });

  it("sends each kind only to active people who chose it", async () => {
    expect(await recipientsFor("escalations")).toEqual(["ops@relaypay.example"]);
    expect(await recipientsFor("critical_alerts")).toEqual(["ops@relaypay.example", "lead@relaypay.example"]);
    expect(await recipientsFor("warning_alerts")).toEqual(["lead@relaypay.example"]);
  });

  it("counts coverage per kind, so the console can warn when nobody gets escalations", async () => {
    expect(await coverage()).toEqual({ escalations: 1, critical_alerts: 2, warning_alerts: 1 });
    rows.current = [];
    expect(await coverage()).toEqual({ escalations: 0, critical_alerts: 0, warning_alerts: 0 });
  });

  it("still addresses a critical alert from the last list read when the database is down", async () => {
    await recipientsFor("critical_alerts");
    rows.fail = true;
    await expect(recipientsFor("critical_alerts")).rejects.toThrow();
    expect(lastKnownRecipientsFor("critical_alerts")).toEqual(["ops@relaypay.example", "lead@relaypay.example"]);
  });

  it("rejects a malformed address before touching the database", async () => {
    rows.fail = true;
    const kinds = { escalations: true, critical_alerts: false, warning_alerts: false };
    expect(await addRecipient({ email: "not an email", name: null, ...kinds })).toEqual({ ok: false, reason: "invalid" });
    expect(await addRecipient({ email: `${"a".repeat(250)}@x.io`, name: null, ...kinds })).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a duplicate address, which the unique index turned into no row", async () => {
    rows.current = [];
    expect(await addRecipient({ email: "Ops@RelayPay.example", name: "Ops", escalations: true, critical_alerts: true, warning_alerts: false })).toEqual({ ok: false, reason: "exists" });
  });
});
