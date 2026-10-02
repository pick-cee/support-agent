import "server-only";

import { after } from "next/server";

import { SPOKEN } from "@/app/copy";
import { checkBeforeModel } from "@/agent/cheap-checks";
import { runAgent } from "@/agent/run-agent";
import { toSpeech } from "@/agent/speech";
import {
  agentSpendTodayUsd,
  beginTurn,
  finishCheapTurn,
  finishTurn,
  lastAnswerType,
  recordSystemEvent,
  recordTurnOnConversation,
  upsertConversation,
  type ConversationRow,
} from "@/agent/turn-store";
import { runTurn, type TurnOutcome } from "@/agent/turn-runner";
import { callerNumberOf, channelOf, redactVapiPayload, SSE_DONE, SSE_HEADERS, sseChunk, transcriptOf, VAPI_FLUSH, vapiRequestSchema } from "@/agent/vapi-protocol";
import { raiseAlert } from "@/lib/alerts";
import { bearerMatches } from "@/lib/auth";
import { DEFAULT_AGENT_MODEL } from "@/lib/constants";
import { optionalEnv, requireEnv } from "@/lib/env";

// Vapi's custom LLM (DESIGN §2.1, §5). Vapi sends each caller turn here and
// speaks what we stream back. Every path ends in speech: an answer that
// passed the gates, a fixed fallback, or a cheap-check line. Never dead air.
export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();

/** A whole reply in one go, for paths that need no model. */
function sseReply(id: string, text: string): Response {
  const body = sseChunk(id, text) + sseChunk(id, null, "stop") + SSE_DONE;
  return new Response(body, { headers: SSE_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  const received = performance.now();

  // 1. Only Vapi, with the custom-llm credential.
  if (!bearerMatches(request.headers.get("authorization"), requireEnv("VAPI_LLM_TOKEN"))) {
    after(() =>
      raiseAlert({
        type: "auth_failure",
        severity: "warning",
        fingerprint: "auth_failure:vapi_llm",
        message: "A request reached the custom-LLM endpoint without Vapi's credential.",
        context: { user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null },
      }),
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. A body we cannot read means the Vapi assistant is misconfigured.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const parsed = vapiRequestSchema.safeParse(raw);
  if (!parsed.success) {
    after(() =>
      raiseAlert({
        type: "bad_vapi_payload",
        severity: "critical",
        fingerprint: "bad_vapi_payload:chat",
        message: "Vapi sent a custom-LLM body we could not parse. Check the assistant's model configuration.",
        context: { issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
      }),
    );
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const body = parsed.data;
  const transcript = transcriptOf(body);
  const lastCaller = [...transcript].reverse().find((line) => line.role === "caller");
  const turnIndex = Math.max(0, transcript.filter((line) => line.role === "caller").length - 1);
  const replyId = `chatcmpl-${body.call.id}-${turnIndex}`;

  // 3. The conversation row carries what must not depend on the model's memory.
  // 4. Cheap checks, before any model.
  let conversation: ConversationRow;
  let spentToday: number;
  let check: ReturnType<typeof checkBeforeModel>;
  let turn: { id: string; attempt: number };
  let userText: string;
  try {
    conversation = await upsertConversation({ vapiCallId: body.call.id, channel: channelOf(body), callerIdentifier: callerNumberOf(body) });
    const [spent, previousAnswerType] = await Promise.all([agentSpendTodayUsd(), turnIndex > 0 ? lastAnswerType(conversation.id, turnIndex) : Promise.resolve(null)]);
    spentToday = spent;
    check = checkBeforeModel({ userText: lastCaller?.text ?? "", turnIndex, spentTodayUsd: spentToday, lastAnswerType: previousAnswerType });
    userText = check.action === "run" ? check.userText : (lastCaller?.text ?? "");
    turn = await beginTurn({ conversationId: conversation.id, turnIndex, userText, truncated: check.action === "run" && check.truncated });
  } catch (error) {
    // The database is down: nothing can be recorded, so the Vercel log is the record.
    console.error(JSON.stringify({ event: "database_unreachable", route: "vapi_chat", call_id: body.call.id, error: error instanceof Error ? error.message : String(error) }));
    after(() => raiseAlert({ type: "agent_error", severity: "critical", fingerprint: "database_unreachable", message: "The custom-LLM route could not reach the database." }));
    return sseReply(replyId, toSpeech(SPOKEN.databaseDown, new Date()).text);
  }
  const truncated = check.action === "run" && check.truncated;

  if (turnIndex === 0 && turn.attempt === 1) {
    // Phase 0: the real path and payload shape, values redacted (DESIGN §12.2).
    const sample = { path: new URL(request.url).pathname, headers: [...request.headers.keys()].sort(), body: redactVapiPayload(raw) };
    after(() => recordSystemEvent({ conversationId: conversation.id, turnId: turn.id, eventType: "vapi_payload_sample", summary: "First custom-LLM request of the call, values redacted.", metadata: sample }).catch(() => undefined));
  }

  if (check.action === "reply") {
    const text = toSpeech(check.text, new Date()).text;
    const ttftMs = Math.round(performance.now() - received);
    after(async () => {
      if (await finishCheapTurn(turn, { spokenText: text, answerType: check.answerType, reason: check.reason, ttftMs })) {
        await recordTurnOnConversation(conversation.id, { turnIndex, clarifyStreak: conversation.clarify_streak, costEstimateUsd: 0 });
      }
      if (check.reason === "budget") {
        await raiseAlert({ type: "budget_exceeded", severity: "critical", fingerprint: "budget_exceeded", message: `Today's estimated agent spend reached $${spentToday.toFixed(2)}; callers hear the busy line.` });
      }
    });
    return sseReply(replyId, text);
  }

  // 5. Open the stream at once; 6 to 9 happen inside it.
  const caller = new AbortController();
  request.signal.addEventListener("abort", () => caller.abort(), { once: true });
  let resolveOutcome: (outcome: TurnOutcome) => void = () => undefined;
  const outcomePromise = new Promise<TurnOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The caller hung up or interrupted; the stream is already closed.
        }
      };
      const transcriptForTurn = truncated ? [...transcript.slice(0, -1), { role: "caller" as const, text: userText }] : transcript;
      const outcome = await runTurn({
        transcript: transcriptForTurn,
        turnIndex,
        conversationId: conversation.id,
        turnId: turn.id,
        verified: conversation.verified_customer_id !== null,
        escalated: conversation.escalation_id !== null,
        clarifyStreak: conversation.clarify_streak,
        offeredSlots: conversation.offered_slots ?? [],
        model: optionalEnv("AGENT_MODEL") ?? DEFAULT_AGENT_MODEL,
        now: new Date(),
        signal: caller.signal,
        // Each piece is spoken the moment it arrives: the filler while the lookup runs, then the answer.
        emit: (text) => send(sseChunk(replyId, `${text}${VAPI_FLUSH}`)),
        runAgent,
      });
      send(sseChunk(replyId, null, "stop"));
      send(SSE_DONE);
      try {
        controller.close();
      } catch {
        // Already closed by a cancel.
      }
      resolveOutcome(outcome);
    },
    cancel() {
      caller.abort();
    },
  });

  // 10. The turn record, after the caller has heard the answer.
  after(async () => {
    const outcome = await outcomePromise;
    try {
      const current = await finishTurn(turn, outcome);
      await recordTurnOnConversation(conversation.id, { turnIndex, clarifyStreak: current ? outcome.nextClarifyStreak : null, costEstimateUsd: outcome.costEstimateUsd });
    } catch (error) {
      console.error(JSON.stringify({ event: "turn_not_recorded", turn_id: turn.id, error: error instanceof Error ? error.message : String(error) }));
    }
    for (const alert of outcome.alerts) await raiseAlert({ ...alert, context: { ...alert.context, conversation_id: conversation.id, turn_id: turn.id } });
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
