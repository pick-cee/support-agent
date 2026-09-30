import { describe, expect, it } from "vitest";

import { dateInZone, daysBetween, isIsoDate } from "./time";

describe("dateInZone", () => {
  it("uses Lagos time, not UTC, to decide what today is", () => {
    // 23:30 UTC on 28 September is 00:30 on 29 September in Lagos (UTC+1).
    expect(dateInZone(new Date("2026-09-28T23:30:00Z"))).toBe("2026-09-29");
    expect(dateInZone(new Date("2026-09-28T22:30:00Z"))).toBe("2026-09-28");
  });
});

describe("daysBetween", () => {
  it("counts whole days, positive when the second date is later", () => {
    expect(daysBetween("2026-08-19", "2026-09-29")).toBe(41);
    expect(daysBetween("2026-09-29", "2026-08-19")).toBe(-41);
    expect(daysBetween("2026-09-29", "2026-09-29")).toBe(0);
  });
});

describe("isIsoDate", () => {
  it.each([["2026-08-19", true], ["2026-02-30", false], ["19 August", false], ["", false], [null, false]])("%j is %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});
