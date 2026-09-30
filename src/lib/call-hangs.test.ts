import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ quietCalls: 0, sql: [] as string[] }));

vi.mock("@/lib/db", () => ({
  queryDb: vi.fn(async (sql: string) => {
    db.sql.push(sql);
    return sql.includes("count(") ? { rows: [{ calls: db.quietCalls }], rowCount: 1 } : { rows: [], rowCount: 1 };
  }),
}));
vi.mock("@/lib/alerts", () => ({ raiseAlert: vi.fn(async () => undefined) }));

import { raiseAlert } from "@/lib/alerts";
import { HANG_ALERT_MIN_CALLS } from "@/lib/constants";
import { hangAlert, recordHang } from "./call-hangs";

beforeEach(() => {
  db.quietCalls = 0;
  db.sql = [];
  vi.mocked(raiseAlert).mockClear();
});

describe("calls going quiet", () => {
  it("records a single quiet call on the call, without emailing anyone", async () => {
    db.quietCalls = 1;
    await recordHang("conversation-1", "call-1");
    expect(db.sql[0]).toContain("insert into support_agent.conversation_events");
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("stays quiet below the threshold, however many times one call hung", () => {
    expect(hangAlert(HANG_ALERT_MIN_CALLS - 1, "call-2")).toBeNull();
  });

  it("raises one shared alert once enough different calls go quiet", async () => {
    db.quietCalls = HANG_ALERT_MIN_CALLS;
    await recordHang("conversation-3", "call-3");
    expect(raiseAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(raiseAlert).mock.calls[0]![0]).toMatchObject({ type: "vapi_hang", severity: "warning", fingerprint: "vapi_hang", context: { quiet_calls: HANG_ALERT_MIN_CALLS, last_call_id: "call-3" } });
  });

  it("uses the same fingerprint for every call, so a run of slow calls is one alert, not one per call", () => {
    expect(hangAlert(4, "a")?.fingerprint).toBe(hangAlert(9, "b")?.fingerprint);
  });
});
