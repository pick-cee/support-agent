import { describe, expect, it } from "vitest";

import { readable } from "./use-voice-call";

describe("the call transcript's wording", () => {
  it.each([
    ["T X N 9 0 0 1 is an outgoing payout.", "TXN-9001 is an outgoing payout."],
    ["Can you check transaction TXN 9 0 0 1? Please?", "Can you check transaction TXN-9001? Please?"],
    ["Your reference is T 4 0 0 7.", "Your reference is T-4007."],
    ["One moment while I check that.<flush /> Fees vary.<flush />", "One moment while I check that. Fees vary."],
  ])("shows %j as %j", (spoken, shown) => {
    expect(readable(spoken)).toBe(shown);
  });

  it("leaves ordinary numbers alone", () => {
    expect(readable("It arrived on 19 August at 2 PM.")).toBe("It arrived on 19 August at 2 PM.");
  });
});
