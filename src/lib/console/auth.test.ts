import { describe, expect, it } from "vitest";

import { hashPassword, newSessionValue, sessionValid, verifyPassword } from "./auth";

process.env.CONSOLE_SESSION_SECRET = "test-secret-for-signing-sessions";

describe("console password", () => {
  it("verifies the right password and refuses a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("writes a hash with no dollar sign, which Next's .env expansion would eat", () => {
    expect(hashPassword("anything")).not.toContain("$");
  });

  it("refuses a malformed stored hash", () => {
    expect(verifyPassword("x", "scrypt$a$b")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});

describe("console session", () => {
  it("accepts its own signed session until it expires", () => {
    const now = Date.now();
    const value = newSessionValue(now);
    expect(sessionValid(value, now + 1000)).toBe(true);
    expect(sessionValid(value, now + 13 * 3_600_000)).toBe(false);
  });

  it("refuses a forged or edited session", () => {
    const value = newSessionValue();
    const [expires] = value.split(".");
    expect(sessionValid(`${Number(expires) + 100000}.${value.split(".")[1]}`)).toBe(false);
    expect(sessionValid("9999999999999.forged")).toBe(false);
    expect(sessionValid(undefined)).toBe(false);
  });
});
