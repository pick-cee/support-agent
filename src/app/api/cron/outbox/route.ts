import "server-only";

import { idleTextConversations } from "@/agent/turn-store";
import { raiseAlert } from "@/lib/alerts";
import { bearerMatches } from "@/lib/auth";
import { TEXT_IDLE_CLOSE_BATCH, TEXT_IDLE_CLOSE_MINUTES } from "@/lib/constants";
import { finishConversation } from "@/lib/conversation-end";
import { requireEnv } from "@/lib/env";
import { runDueJobs } from "@/lib/outbox";
import { sideEffectsMode } from "@/mcp/services";

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
  const result = await runDueJobs(sideEffectsMode());
  // A closed tab sends no end-of-call report: idle typed conversations are closed here,
  // so a customer who left mid-escalation still gets a follow-up ticket.
  let closed = 0;
  for (const id of await idleTextConversations(TEXT_IDLE_CLOSE_MINUTES, TEXT_IDLE_CLOSE_BATCH)) {
    if (await finishConversation(id, { followUps: true, endedReason: "idle" })) closed += 1;
  }
  return Response.json({ ok: true, ...result, text_conversations_closed: closed });
}

export { handle as GET, handle as POST };
