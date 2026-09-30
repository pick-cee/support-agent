import { describe, expect, it } from "vitest";

import { maskEmails, redactInput } from "./redact";

describe("maskEmails", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmails("send to amara@lagosledger.example now")).toBe("send to a***@lagosledger.example now");
  });
});

describe("redactInput", () => {
  it("masks emails at any depth and leaves other values alone", () => {
    expect(redactInput({ user_email: "efua@accrastack.example", nested: { list: ["x@y.example"] }, count: 2 })).toEqual({
      user_email: "e***@accrastack.example",
      nested: { list: ["x***@y.example"] },
      count: 2,
    });
  });

  it("cuts very long strings", () => {
    expect(redactInput("a".repeat(400), 10)).toBe(`${"a".repeat(10)}...`);
  });
});
