import { describe, expect, it } from "vitest";

import { systemPrompt } from "./system-prompt";

const NOW = new Date("2026-10-02T10:00:00Z");
const SLOT = { start_utc: "2026-10-03T13:00:00.000Z", speakable: "Saturday 3 October at 2 PM Lagos time", timezone: "Africa/Lagos" };

describe("systemPrompt state block", () => {
  it("lists the callback times already offered, with what create_escalation needs", () => {
    const state = systemPrompt({ now: NOW, verified: true, escalated: false, clarifyStreak: 0, offeredSlots: [SLOT] }).at(-1)!;
    expect(state).toContain("without searching again");
    expect(state).toContain("Saturday 3 October at 2 PM Lagos time: start_utc 2026-10-03T13:00:00.000Z, timezone Africa/Lagos");
  });

  it("leaves them out before any search and once the case is escalated", () => {
    expect(systemPrompt({ now: NOW, verified: false, escalated: false, clarifyStreak: 0 }).at(-1)).not.toContain("already offered");
    expect(systemPrompt({ now: NOW, verified: false, escalated: true, clarifyStreak: 0, offeredSlots: [SLOT] }).at(-1)).not.toContain("start_utc");
  });

  it("keeps the static part identical, so it stays cached across turns", () => {
    const before = systemPrompt({ now: NOW, verified: false, escalated: false, clarifyStreak: 0 })[0];
    const after = systemPrompt({ now: NOW, verified: true, escalated: false, clarifyStreak: 1, offeredSlots: [SLOT] })[0];
    expect(after).toBe(before);
  });
});
