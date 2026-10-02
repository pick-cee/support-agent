import { describe, expect, it } from "vitest";

import { companyKey, findReferences, firstNameKey, isDeliverableEmail, normaliseEmail, normaliseReference } from "./normalise";

describe("normaliseEmail", () => {
  it.each([
    ["amara at lagos ledger dot example", "amara@lagosledger.example"],
    ["Amara@LagosLedger.example", "amara@lagosledger.example"],
    ["amara at lagosledger dot example.", "amara@lagosledger.example"],
    ["efua underscore m at accra stack dot example", "efua_m@accrastack.example"],
    ["daniel dash k at nairobi ops dot co dot ke", "daniel-k@nairobiops.co.ke"],
    ["mailto:patrick@kigaliworks.example", "patrick@kigaliworks.example"],
  ])("reads %j as %s", (raw, email) => {
    expect(normaliseEmail(raw)).toBe(email);
  });

  it.each([["amara at lagos ledger"], ["not an email"], [""], [null], ["a@b"]])("rejects %j", (raw) => {
    expect(normaliseEmail(raw)).toBeNull();
  });
});

describe("companyKey and firstNameKey", () => {
  it("ignores case, spaces and punctuation in a company", () => {
    expect(companyKey("Lagos Ledger")).toBe("lagosledger");
    expect(companyKey("lagos-ledger.")).toBe("lagosledger");
    expect(companyKey("   ")).toBeNull();
  });

  it("keeps only the first name", () => {
    expect(firstNameKey("Amara Okafor")).toBe("amara");
    expect(firstNameKey("  amara ")).toBe("amara");
    expect(firstNameKey("")).toBeNull();
  });
});

describe("findReferences", () => {
  it("finds every prefixed reference in a sentence, however it was spoken", () => {
    expect(findReferences("I checked TXN-9001 and P A Y seven oh oh two for you")).toEqual(["TXN-9001", "PAY-7002"]);
  });

  it("counts a caller's bare digits as a transaction only when asked to", () => {
    expect(findReferences("it's nine zero zero one", { bareAsTransaction: true })).toEqual(["TXN-9001"]);
    expect(findReferences("it's nine zero zero one")).toEqual([]);
  });

  it("does not treat short numbers as references", () => {
    expect(findReferences("I paid 40 dollars on the 19th", { bareAsTransaction: true })).toEqual([]);
  });
});

describe("normaliseReference", () => {
  it.each([
    ["TXN-9001", "TXN-9001"],
    ["TXN9001", "TXN-9001"],
    ["txn 9001", "TXN-9001"],
    ["T X N 9001", "TXN-9001"],
    ["T. X. N. 9 0 0 1", "TXN-9001"],
    ["t-x-n-9-0-0-1", "TXN-9001"],
    ["txn nine zero zero one", "TXN-9001"],
    ["T X N nine oh oh one", "TXN-9001"],
    ["TXN nine double zero one", "TXN-9001"],
    ["TXN ninety oh one", "TXN-9001"],
    ["transaction 9001", "TXN-9001"],
    ["transaction number 9001", "TXN-9001"],
    ["the transaction TXN-9001 please", "TXN-9001"],
    ["9001", "TXN-9001"],
    ["nine zero zero one", "TXN-9001"],
  ])("reads %j as a transaction reference", (raw, id) => {
    expect(normaliseReference(raw, "TXN")).toEqual({ ok: true, id, kind: "TXN" });
  });

  it("accepts a bare number the model passed as a number", () => {
    expect(normaliseReference(9001, "TXN")).toEqual({ ok: true, id: "TXN-9001", kind: "TXN" });
  });

  it.each([
    ["PAY-7002", "PAY-7002"],
    ["pay 7002", "PAY-7002"],
    ["P A Y seven oh oh two", "PAY-7002"],
    ["payout seventy oh two", "PAY-7002"],
  ])("reads %j as a payout reference", (raw, id) => {
    expect(normaliseReference(raw, "PAY")).toEqual({ ok: true, id, kind: "PAY" });
  });

  it("does not turn a bare number into a payout reference", () => {
    expect(normaliseReference("7002", "PAY")).toEqual({ ok: false, reason: "no_digits" });
  });

  it("names the other kind when the caller gave a payout where a transaction was expected", () => {
    expect(normaliseReference("PAY-7002", "TXN")).toEqual({ ok: false, reason: "wrong_kind", kind: "PAY" });
  });

  it.each([[""], ["   "], [null], [undefined], [{}]])("treats %j as empty", (raw) => {
    expect(normaliseReference(raw, "TXN")).toEqual({ ok: false, reason: "empty" });
  });

  it.each([["my payment"], ["TXN"], ["the one from last week"]])("finds no reference in %j", (raw) => {
    expect(normaliseReference(raw, "TXN")).toEqual({ ok: false, reason: "no_digits" });
  });
});

describe("isDeliverableEmail", () => {
  it.each(["amara@lagosledger.example", "a@b.test", "x@foo.invalid", "me@localhost", "info@example.com", "info@example.org"])("treats %s as unable to receive mail", (email) => {
    expect(isDeliverableEmail(email)).toBe(false);
  });

  it.each(["akin@gmail.com", "amara@lagosledger.com", "ops@example-company.com", "team@examples.com"])("treats %s as deliverable", (email) => {
    expect(isDeliverableEmail(email)).toBe(true);
  });
});
