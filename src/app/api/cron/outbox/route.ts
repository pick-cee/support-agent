import "server-only";

import { raiseAlert } from "@/lib/alerts";
import { bearerMatches } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import { runOutbox } from "@/lib/outbox-worker";

// The outbox worker (DESIGN §10.1). Supabase pg_cron calls it every minute
// through pg_net with the shared secret, because Vercel Hobby cron only runs
// daily. Scheduled by npm run db:schedule-outbox.
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    await raiseAlert({ type: "auth_failure", severity: "warning", fingerprint: "auth_failure:cron", message: "A request reached the outbox worker without the cron secret." });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: true, ...(await runOutbox()) });
}

export { handle as GET, handle as POST };
