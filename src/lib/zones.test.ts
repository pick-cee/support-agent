import { describe, expect, it } from "vitest";

import { resolveZone, speakSlot, zoneOffsetMinutes } from "./zones";

describe("resolveZone", () => {
  it("prefers the verified customer's region", () => {
    expect(resolveZone({ customerRegion: "Kenya", hint: "London" })).toEqual({ zone: "Africa/Nairobi", source: "customer_region", assumed: false });
  });

  it("uses a city or IANA name the caller gave", () => {
    expect(resolveZone({ hint: "Cape Town" })).toMatchObject({ zone: "Africa/Johannesburg", source: "caller_hint" });
    expect(resolveZone({ hint: "Accra time" })).toMatchObject({ zone: "Africa/Accra" });
    expect(resolveZone({ hint: "Europe/Lisbon" })).toMatchObject({ zone: "Europe/Lisbon" });
  });

  it("falls back to Lagos and says it assumed so", () => {
    expect(resolveZone({ hint: "somewhere" })).toEqual({ zone: "Africa/Lagos", source: "default", assumed: true });
  });
});

describe("zone arithmetic", () => {
  it("knows Lagos is UTC+1 and Nairobi UTC+3", () => {
    const at = new Date("2026-10-06T12:00:00Z");
    expect(zoneOffsetMinutes("Africa/Lagos", at)).toBe(60);
    expect(zoneOffsetMinutes("Africa/Nairobi", at)).toBe(180);
  });

  it("says a slot in the caller's zone, with the weekday computed from the date", () => {
    expect(speakSlot(new Date("2026-10-06T13:00:00Z"), "Africa/Lagos")).toBe("Tuesday 6 October at 2 PM Lagos time");
    expect(speakSlot(new Date("2026-10-07T13:30:00Z"), "Africa/Nairobi")).toBe("Wednesday 7 October at 4:30 PM Nairobi time");
  });
});
