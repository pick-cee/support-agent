import "server-only";

import { after } from "next/server";
import * as z from "zod";

import { SPOKEN, TYPED } from "@/app/copy";
import { checkBeforeModel } from "@/agent/cheap-checks";
import { runAgent } from "@/agent/run-agent";
import { toText } from "@/agent/speech";
import {
  agentSpendTodayUsd,
  beginTextTurn,
  createTextConversation,
  finishCheapTurn,
  finishTurn,
  lastAnswerType,
  loadTextConversation,
  recordTurnOnConversation,
  textMessagesInWindow,
  textTranscript,
  type TextConversationRow,
} from "@/agent/turn-store";
import { runTurn } from "@/agent/turn-runner";
import type { TranscriptLine } from "@/agent/system-prompt";
import { raiseAlert } from "@/lib/alerts";
import { visitorKey } from "@/lib/auth";
import { DEFAULT_AGENT_MODEL, TEXT_MESSAGE_MAX_CHARS, TEXT_MESSAGES_PER_WINDOW, TEXT_RATE_WINDOW_MINUTES, TEXT_TURN_DEADLINE_MS, TEXT_TURN_STALE_SECONDS } from "@/lib/constants";
import { optionalEnv } from "@/lib/env";
import { sameOrigin } from "@/lib/same-origin";

// Typed messages from the web page (DESIGN §13). The same turn runner, the
// same checks and the same records as a call; only the formatting differs.
// Public, so it is limited three ways: same origin only, a message budget per
// visitor, and the daily agent budget every customer turn counts against.
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ conversationId: z.uuid().optional(), message: z.string() });

export type ChatReply = { conversationId: string; reply: string; answerType: string | null };
export type ChatError = { error: "bad_request" | "empty" | "too_long" | "rate_limited" | "busy" | "ended" | "not_found" | "unavailable"; reply?: string };

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: ChatError["error"], status: number, reply?: string) => Response.json({ error, ...(reply ? { reply } : {}) } satisfies ChatError, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail("bad_request", 403);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail("bad_request", 400);
  const message = parsed.data.message.trim();
  if (!message) return fail("empty", 400);
  // Refused with the limit shown, rather than silently cut the way a long transcript is.
  if (message.length > TEXT_MESSAGE_MAX_CHARS) return fail("too_long", 400);

  const now = new Date();
  let conversation: TextConversationRow;
  let turn: { id: string; turn_index: number; attempt: number } | null;
  let history: { user_text: string; spoken_text: string | null }[];
  let spentToday: number;
  try {
    const visitor = visitorKey(request);
    if ((await textMessagesInWindow(visitor, TEXT_RATE_WINDOW_MINUTES)) >= TEXT_MESSAGES_PER_WINDOW) {
      after(() => raiseAlert({ type: "rate_limited", severity: "info", fingerprint: `rate_limited:text:${visitor}`, message: "A visitor hit the typed-message limit.", context: { per_window: TEXT_MESSAGES_PER_WINDOW, window_minutes: TEXT_RATE_WINDOW_MINUTES } }));
      return fail("rate_limited", 429);
    }
    const existing = parsed.data.conversationId ? await loadTextConversation(parsed.data.conversationId) : null;
    if (parsed.data.conversationId && !existing) return fail("not_found", 404);
    if (existing?.final_status) return fail("ended", 409);
    conversation = existing ?? (await createTextConversation(visitor));
    history = await textTranscript(conversation.id);
    spentToday = await agentSpendTodayUsd();
    turn = await beginTextTurn(conversation.id, message, TEXT_TURN_STALE_SECONDS);
  } catch (error) {
    console.error(JSON.stringify({ event: "database_unreachable", route: "chat", error: error instanceof Error ? error.message : String(error) }));
    after(() => raiseAlert({ type: "agent_error", severity: "critical", fingerprint: "database_unreachable", message: "The typed-message route could not reach the database." }));
    return fail("unavailable", 503, toText(SPOKEN.databaseDown, now).text);
  }
  if (!turn) return fail("busy", 409);

  const reply = (text: string, answerType: string | null) => Response.json({ conversationId: conversation.id, reply: text, answerType } satisfies ChatReply, { headers: NO_STORE });

  // Cheap checks, before any model: the turn cap, a plain goodbye and the daily budget.
  const previousAnswerType = turn.turn_index > 0 ? await lastAnswerType(conversation.id, turn.turn_index).catch(() => null) : null;
  const check = checkBeforeModel({ userText: message, turnIndex: turn.turn_index, spentTodayUsd: spentToday, lastAnswerType: previousAnswerType });
  if (check.action === "reply") {
    const typedText = check.reason === "max_turns" ? TYPED.tooManyTurns : check.reason === "empty" ? TYPED.didNotCatch : check.reason === "goodbye" ? `${SPOKEN.quickGoodbye} ${TYPED.goodbye}` : check.text;
    const text = toText(typedText, now).text;
    await finishCheapTurn(turn, { spokenText: text, answerType: check.answerType, reason: check.reason, ttftMs: 0 });
    await recordTurnOnConversation(conversation.id, { turnIndex: turn.turn_index, clarifyStreak: conversation.clarify_streak, costEstimateUsd: 0 });
    if (check.reason === "budget") {
      after(() => raiseAlert({ type: "budget_exceeded", severity: "critical", fingerprint: "budget_exceeded", message: `Today's estimated agent spend reached $${spentToday.toFixed(2)}; customers get the busy line.` }));
    }
    return reply(text, check.answerType);
  }

  const transcript: TranscriptLine[] = [{ role: "agent", text: TYPED.greeting }];
  for (const line of history) {
    transcript.push({ role: "caller", text: line.user_text });
    if (line.spoken_text) transcript.push({ role: "agent", text: line.spoken_text });
  }
  transcript.push({ role: "caller", text: check.userText });

  const outcome = await runTurn({
    transcript,
    turnIndex: turn.turn_index,
    conversationId: conversation.id,
    turnId: turn.id,
    verified: conversation.verified_customer_id !== null,
    escalated: conversation.escalation_id !== null,
    clarifyStreak: conversation.clarify_streak,
    offeredSlots: conversation.offered_slots ?? [],
    model: optionalEnv("AGENT_MODEL") ?? DEFAULT_AGENT_MODEL,
    now,
    signal: request.signal,
    emit: () => undefined,
    runAgent,
    channel: "text",
    deadlineMs: TEXT_TURN_DEADLINE_MS,
  });

  // Recorded before answering, so the next message's transcript includes this one.
  try {
    const current = await finishTurn(turn, outcome);
    await recordTurnOnConversation(conversation.id, { turnIndex: turn.turn_index, clarifyStreak: current ? outcome.nextClarifyStreak : null, costEstimateUsd: outcome.costEstimateUsd });
  } catch (error) {
    console.error(JSON.stringify({ event: "turn_not_recorded", turn_id: turn.id, error: error instanceof Error ? error.message : String(error) }));
  }
  const conversationId = conversation.id;
  after(async () => {
    for (const alert of outcome.alerts) await raiseAlert({ ...alert, context: { ...alert.context, conversation_id: conversationId, turn_id: turn.id } });
  });

  return reply(outcome.spokenText ?? toText(SPOKEN.systemTrouble, now).text, outcome.answerType);
}
