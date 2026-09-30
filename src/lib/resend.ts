import "server-only";

import { RESEND_API_URL, RESEND_TIMEOUT_MS } from "@/lib/constants";
import { optionalEnv } from "@/lib/env";

/** The admin addresses that receive handoffs and alerts: SUPPORT_INBOX_EMAIL, comma-separated. */
export function supportInbox(): string[] {
  return (optionalEnv("SUPPORT_INBOX_EMAIL") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address));
}

export type Email = { to: string[]; subject: string; text: string; html: string; idempotencyKey: string };

/**
 * Sends through Resend. The idempotency key makes a retried job safe: Resend
 * returns the first send instead of sending twice (keys last 24 hours).
 */
export async function sendEmail(email: Email): Promise<{ id: string }> {
  const apiKey = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("RESEND_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("Resend is not configured: RESEND_API_KEY and RESEND_FROM_EMAIL are required");
  if (!email.to.length) throw new Error("No recipients: set SUPPORT_INBOX_EMAIL to one or more admin addresses, comma-separated");
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from, to: email.to.slice(0, 50), subject: email.subject, text: email.text, html: email.html }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { id: string };
}
