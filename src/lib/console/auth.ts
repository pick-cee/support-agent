import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { visitorKey } from "@/lib/auth";
import { CONSOLE_LOCKOUT_MINUTES, CONSOLE_MAX_FAILED_LOGINS, CONSOLE_SESSION_HOURS } from "@/lib/constants";
import { queryDb } from "@/lib/db";
import { requireEnv } from "@/lib/env";

// Console access (DESIGN §14): a password, stored only as a scrypt hash
// (CONSOLE_PASSWORD_HASH), gives a signed, httpOnly, same-site-strict cookie.
// Five failed logins from one IP in 15 minutes lock that IP out for 15 minutes.

export const SESSION_COOKIE = "relaypay_console";

// Colons, not dollar signs: Next loads .env with variable expansion, and a
// hash written as scrypt$salt$hash reached the server with "$salt" and "$hash"
// expanded to nothing, so the right password was refused (FAILURES.md).
export function hashPassword(password: string, salt = randomBytes(16).toString("base64url")): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string): string {
  return createHmac("sha256", requireEnv("CONSOLE_SESSION_SECRET")).update(value).digest("base64url");
}

export function newSessionValue(now = Date.now()): string {
  const expires = String(now + CONSOLE_SESSION_HOURS * 3_600_000);
  return `${expires}.${sign(expires)}`;
}

export function sessionValid(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) < now) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${process.env.VERCEL ? "; Secure" : ""}`;
}

/** Every console page calls this first. */
export async function requireConsoleSession(): Promise<void> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionValid(value)) redirect("/console/login");
}

/** The IP is stored only as a keyed hash. */
export function ipHash(request: Request): string {
  return visitorKey(request);
}

export async function lockedOut(ip: string): Promise<boolean> {
  const result = await queryDb<{ failures: number }>(
    `select count(*)::int as failures from support_agent.console_login_attempts
      where ip_hash = $1 and not succeeded and attempted_at > now() - make_interval(mins => $2)`,
    [ip, CONSOLE_LOCKOUT_MINUTES],
  );
  return (result.rows[0]?.failures ?? 0) >= CONSOLE_MAX_FAILED_LOGINS;
}

export async function recordAttempt(ip: string, succeeded: boolean): Promise<void> {
  await queryDb(`insert into support_agent.console_login_attempts (ip_hash, succeeded) values ($1, $2)`, [ip, succeeded]);
}
