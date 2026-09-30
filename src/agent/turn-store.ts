import "server-only";

import { queryDb } from "@/lib/db";

import type { TurnOutcome } from "./turn-runner";

// Every state change writes a row. The conversation holds the facts that must
// not depend on the model's memory: who is verified, whether the case is
// escalated, the clarify streak (DESIGN §2.2).

export type ConversationRow = {
  id: string;
  verified_customer_id: string | null;
  escalation_id: string | null;
  clarify_streak: number;
  turn_count: number;
};

export async function upsertConversation(input: { vapiCallId: string; channel: "web" | "phone" | "eval"; callerIdentifier: string | null }): Promise<ConversationRow> {
  const result = await queryDb<ConversationRow>(
    `insert into support_agent.conversations (vapi_call_id, channel, caller_identifier, started_at)
     values ($1, $2, $3, now())
     on conflict (vapi_call_id) do update
       set updated_at = now(),
           caller_identifier = coalesce(support_agent.conversations.caller_identifier, excluded.caller_identifier)
     returning id, verified_customer_id, escalation_id, clarify_streak, turn_count`,
    [input.vapiCallId, input.channel, input.callerIdentifier],
  );
  return result.rows[0]!;
}

// --- Typed messages (DESIGN §13) -------------------------------------------------------

export type TextConversationRow = ConversationRow & { channel: string; final_status: string | null };

export async function createTextConversation(visitor: string): Promise<TextConversationRow> {
  const result = await queryDb<TextConversationRow>(
    `insert into support_agent.conversations (channel, caller_identifier, started_at) values ('text', $1, now())
     returning id, channel, final_status, verified_customer_id, escalation_id, clarify_streak, turn_count`,
    [visitor],
  );
  return result.rows[0]!;
}

/** The conversation id is the customer's only handle on it: a UUID the server created and gave to that browser alone. */
export async function loadTextConversation(conversationId: string): Promise<TextConversationRow | null> {
  const result = await queryDb<TextConversationRow>(
    `select id, channel, final_status, verified_customer_id, escalation_id, clarify_streak, turn_count
       from support_agent.conversations where id = $1 and channel = 'text'`,
    [conversationId],
  );
  return result.rows[0] ?? null;
}

/** Everything said so far, oldest first, from the records: the browser's own copy is never trusted. */
export async function textTranscript(conversationId: string): Promise<{ user_text: string; spoken_text: string | null }[]> {
  const result = await queryDb<{ user_text: string; spoken_text: string | null }>(
    `select user_text, spoken_text from support_agent.conversation_turns where conversation_id = $1 and status <> 'in_progress' order by turn_index`,
    [conversationId],
  );
  return result.rows;
}

/**
 * The next turn, in one statement: its index is one past the last, and it is
 * refused while another turn in the same conversation is still being answered
 * (a double submit). Two racing inserts collide on the unique key; the loser
 * gets null too.
 */
export async function beginTextTurn(conversationId: string, userText: string, staleSeconds: number): Promise<{ id: string; turn_index: number } | null> {
  try {
    const result = await queryDb<{ id: string; turn_index: number }>(
      `insert into support_agent.conversation_turns (conversation_id, turn_index, user_text)
       select $1, coalesce(max(turn_index) + 1, 0), $2 from support_agent.conversation_turns where conversation_id = $1
       having not exists (
         select 1 from support_agent.conversation_turns
          where conversation_id = $1 and status = 'in_progress' and updated_at > now() - make_interval(secs => $3)
       )
       returning id, turn_index`,
      [conversationId, userText, staleSeconds],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
}

/** Messages one visitor sent in the window, across all their typed conversations. */
export async function textMessagesInWindow(visitor: string, minutes: number): Promise<number> {
  const result = await queryDb<{ count: number }>(
    `select count(*)::int as count
       from support_agent.conversation_turns t join support_agent.conversations c on c.id = t.conversation_id
      where c.channel = 'text' and c.caller_identifier = $1 and t.created_at > now() - make_interval(mins => $2)`,
    [visitor, minutes],
  );
  return result.rows[0]?.count ?? 0;
}

/** Typed conversations nobody has touched for a while: the customer closed the tab. */
export async function idleTextConversations(idleMinutes: number, limit: number): Promise<string[]> {
  const result = await queryDb<{ id: string }>(
    `select id from support_agent.conversations
      where channel = 'text' and final_status is null and updated_at < now() - make_interval(mins => $1)
      order by updated_at limit $2`,
    [idleMinutes, limit],
  );
  return result.rows.map((row) => row.id);
}

/** A retried or re-sent turn keeps its row and counts the attempt; the latest attempt wins. */
export async function beginTurn(input: { conversationId: string; turnIndex: number; userText: string; truncated: boolean }): Promise<{ id: string; attempt: number }> {
  const result = await queryDb<{ id: string; attempt: number }>(
    `insert into support_agent.conversation_turns (conversation_id, turn_index, user_text, user_text_truncated)
     values ($1, $2, $3, $4)
     on conflict (conversation_id, turn_index) do update
       set attempt = support_agent.conversation_turns.attempt + 1,
           user_text = excluded.user_text,
           user_text_truncated = excluded.user_text_truncated,
           status = 'in_progress',
           spoken_text = null,
           error = null,
           updated_at = now()
     returning id, attempt`,
    [input.conversationId, input.turnIndex, input.userText, input.truncated],
  );
  return result.rows[0]!;
}

export async function finishTurn(turnId: string, outcome: TurnOutcome): Promise<void> {
  await queryDb(
    `update support_agent.conversation_turns
        set spoken_text = $2, answer_type = $3, reply_source = $4, confidence_note = $5, kb_chunk_ids = $6,
            gate_results = $7, repaired = $21, fallback_used = $8, filler_used = $9, status = $10, error = $11,
            model = $12, input_tokens = $13, output_tokens = $14, cache_read_tokens = $15, cache_write_tokens = $16,
            cost_estimate_usd = $17, ttft_ms = $18, total_ms = $19, timings = $20, updated_at = now()
      where id = $1`,
    [
      turnId,
      outcome.spokenText,
      outcome.answerType,
      outcome.replySource,
      outcome.confidenceNote,
      outcome.kbChunkIds,
      JSON.stringify(outcome.gateResults),
      outcome.fallbackUsed,
      outcome.fillerUsed,
      outcome.status,
      outcome.error,
      outcome.model,
      outcome.usage?.inputTokens ?? null,
      outcome.usage?.outputTokens ?? null,
      outcome.usage?.cacheReadTokens ?? null,
      outcome.usage?.cacheWriteTokens ?? null,
      outcome.costEstimateUsd,
      outcome.ttftMs,
      outcome.totalMs,
      JSON.stringify({ ...outcome.timings, mcp_status: outcome.mcpStatus, speech_stripped: outcome.speechStripped }),
      outcome.repaired,
    ],
  );
  // The retrieval log says which chunks the spoken answer actually rested on (DESIGN §7.3).
  if (outcome.kbChunkIds.length) {
    await queryDb(
      `update support_agent.retrieval_logs
          set chunk_ids_used = array(select unnest(chunk_ids_returned) intersect select unnest($2::text[]))
        where turn_id = $1`,
      [turnId, outcome.kbChunkIds],
    );
  }
}

/** A turn answered by a cheap check: no model, no cost. */
export async function finishCheapTurn(turnId: string, input: { spokenText: string; answerType: string; reason: string; ttftMs: number }): Promise<void> {
  await queryDb(
    `update support_agent.conversation_turns
        set spoken_text = $2, answer_type = $3, reply_source = 'cheap_check', status = 'ok', confidence_note = $4,
            ttft_ms = $5, total_ms = $5, cost_estimate_usd = 0, updated_at = now()
      where id = $1`,
    [turnId, input.spokenText, input.answerType, `No model call: ${input.reason}.`, input.ttftMs],
  );
}

export async function recordTurnOnConversation(conversationId: string, input: { turnIndex: number; clarifyStreak: number; costEstimateUsd: number }): Promise<void> {
  await queryDb(
    `update support_agent.conversations
        set turn_count = greatest(turn_count, $2), clarify_streak = $3,
            agent_cost_estimate_usd = agent_cost_estimate_usd + $4, updated_at = now()
      where id = $1`,
    [conversationId, input.turnIndex + 1, input.clarifyStreak, input.costEstimateUsd],
  );
}

/**
 * Today's estimated agent spend on customer conversations (calls and typed),
 * midnight to now in Lagos. An estimate, used only as a circuit breaker against
 * runaway public use, so eval runs (which an operator starts on purpose) do not
 * count against it.
 */
export async function agentSpendTodayUsd(): Promise<number> {
  const result = await queryDb<{ spent: string | null }>(
    `select coalesce(sum(t.cost_estimate_usd), 0)::text as spent
       from support_agent.conversation_turns t
       join support_agent.conversations c on c.id = t.conversation_id
      where c.channel in ('web', 'phone', 'text')
        and t.created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')`,
  );
  return Number(result.rows[0]?.spent ?? 0);
}

export async function recordSystemEvent(input: { conversationId: string | null; turnId?: string | null; eventType: string; summary: string; metadata?: unknown }): Promise<void> {
  await queryDb(
    `insert into support_agent.conversation_events (conversation_id, turn_id, event_type, summary, metadata, source)
     values ($1, $2, $3, $4, $5, 'system')`,
    [input.conversationId, input.turnId ?? null, input.eventType, input.summary, JSON.stringify(input.metadata ?? {})],
  );
}
