import "server-only";

import { idleTextConversations } from "@/agent/turn-store";
import { TEXT_IDLE_CLOSE_BATCH, TEXT_IDLE_CLOSE_MINUTES } from "@/lib/constants";
import { finishConversation } from "@/lib/conversation-end";
import { runDueJobs } from "@/lib/outbox";

// One pass of the outbox worker (DESIGN §10.1), shared by /api/cron/outbox
// (pg_cron, once deployed) and the local timer in src/instrumentation.ts.
// Jobs are claimed with `for update skip locked`, so two runners never take
// the same job.
export async function runOutbox(): Promise<{ ran: number; recovered: number; text_conversations_closed: number }> {
  const result = await runDueJobs("live");
  // A closed tab sends no end-of-call report: idle typed conversations are closed here,
  // so a customer who left mid-escalation still gets a follow-up ticket.
  let closed = 0;
  for (const id of await idleTextConversations(TEXT_IDLE_CLOSE_MINUTES, TEXT_IDLE_CLOSE_BATCH)) {
    if (await finishConversation(id, { followUps: true, endedReason: "idle" })) closed += 1;
  }
  return { ...result, text_conversations_closed: closed };
}
