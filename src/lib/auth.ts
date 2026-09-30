import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { requireEnv } from "@/lib/env";

/**
 * A visitor's IP address as a keyed hash: enough to count one visitor's
 * requests or login attempts, never the address itself. Keyed with the
 * console's session secret, so the hash is useless outside this deployment.
 */
export function visitorKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  return createHash("sha256").update(`${ip}:${requireEnv("CONSOLE_SESSION_SECRET")}`).digest("hex").slice(0, 32);
}

/**
 * Compares a presented bearer token with the expected one in constant time.
 * A length mismatch still does a comparison so timing does not reveal length.
 */
export function bearerMatches(authorizationHeader: string | null, expected: string): boolean {
  if (!authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return false;
  const left = Buffer.from(match[1]);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}
