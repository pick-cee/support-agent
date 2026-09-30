import "server-only";

import { consoleWriteAllowed, json, UUID } from "@/lib/console/request";
import { buildTestEmail } from "@/lib/email/notices";
import { appBaseUrl } from "@/lib/env";
import { findRecipient } from "@/lib/notifications";
import { sendEmail } from "@/lib/resend";

export const runtime = "nodejs";

/** Sends one test email in the real template, so the team can see it arrive. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!consoleWriteAllowed(request)) return json({ error: "forbidden" }, 403);
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);
  const recipient = await findRecipient(id);
  if (!recipient) return json({ error: "not_found" }, 404);
  const email = buildTestEmail(recipient, { consoleUrl: `${appBaseUrl()}/console`, manageUrl: `${appBaseUrl()}/console/settings` });
  try {
    // A fresh key each time: a test is meant to arrive every time it is asked for.
    await sendEmail({ to: [recipient.email], ...email, idempotencyKey: `test:${recipient.id}:${Date.now()}` });
    return json({ ok: true });
  } catch (error) {
    console.error(JSON.stringify({ event: "test_email_failed", error: error instanceof Error ? error.message : String(error) }));
    return json({ error: "send_failed" }, 502);
  }
}
