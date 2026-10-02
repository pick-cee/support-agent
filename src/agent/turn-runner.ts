import { FILLER_PHRASES, SPOKEN, VOICE_TO_TYPED } from "@/app/copy";
import type { AlertInput } from "@/lib/alerts";
import type { OfferedSlot } from "@/mcp/types";
import { REPAIR_MIN_MS, TURN_DEADLINE_MS } from "@/lib/constants";

import type { Answer, AnswerType } from "./answer";
import { codeSentences } from "./code-sentences";
import { runGates, type GateResult, type GateVerdict } from "./gates";
import type { AgentErrorKind, AgentRun, RunAgentOptions } from "./run-agent";
import { splitSentences, toSpeech, toText, type SpeechStripped } from "./speech";
import { systemPrompt, turnPrompt, type TranscriptLine } from "./system-prompt";

// One caller turn, from transcript to spoken text (DESIGN §5 steps 6 to 9).
// No database access here: the route and the eval runner persist the outcome,
// which keeps the whole path testable with a fake agent. The eval runner calls
// this same function (DESIGN §18.2).

export type TurnRequest = {
  transcript: TranscriptLine[];
  turnIndex: number;
  conversationId: string;
  turnId: string;
  verified: boolean;
  escalated: boolean;
  clarifyStreak: number;
  /** Callback times offered on an earlier turn, from the conversation row (FAILURES 37). */
  offeredSlots?: OfferedSlot[];
  model: string;
  now: Date;
  /** Aborts when the caller interrupts or disconnects. */
  signal: AbortSignal;
  /** Streams a piece of speech to the caller as it is ready. */
  emit: (text: string) => void;
  runAgent: (options: RunAgentOptions) => Promise<AgentRun>;
  /** Voice by default. A typed turn gets no filler, and its reply is formatted for reading. */
  channel?: "voice" | "text";
  deadlineMs?: number;
  repairMinMs?: number;
};

export type TurnOutcome = {
  status: "ok" | "error" | "interrupted";
  spokenText: string | null;
  answerType: AnswerType | null;
  replySource: "agent" | "fallback" | null;
  confidenceNote: string | null;
  /** For an answer: stated by the knowledge (direct) or worked out from it (inferred). */
  grounding: "direct" | "inferred" | null;
  kbChunkIds: string[];
  gateResults: GateResult[];
  repaired: boolean;
  fallbackUsed: boolean;
  fillerUsed: boolean;
  error: string | null;
  errorKind: AgentErrorKind | "deadline" | null;
  model: string;
  usage: AgentRun["usage"] | null;
  costEstimateUsd: number;
  ttftMs: number | null;
  totalMs: number;
  timings: Record<string, number | null>;
  speechStripped: SpeechStripped | null;
  mcpStatus: string | null;
  toolCalls: AgentRun["toolCalls"];
  alerts: AlertInput[];
  nextClarifyStreak: number;
};

function failureAlert(kind: AgentErrorKind | "deadline", message: string, model: string): AlertInput {
  if (kind === "deadline") return { type: "agent_timeout", severity: "warning", fingerprint: "agent_timeout", message: "A turn hit its deadline and the caller heard the fallback.", context: { model } };
  if (kind === "limit") return { type: "agent_limit", severity: "warning", fingerprint: `agent_limit:${message}`, message: `A turn stopped at ${message}; usage was kept.`, context: { model } };
  return { type: "agent_error", severity: "critical", fingerprint: `agent_error:${kind}`, message: `The agent failed (${kind}) and the caller heard the fallback.`, context: { model, error: message.slice(0, 300) } };
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function addUsage(a: AgentRun["usage"], b: AgentRun["usage"]): AgentRun["usage"] {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}

/** The model's reply that a check stopped, kept on the first failed result so the console can show it. */
function withRejected(results: GateResult[], rejected: string): GateResult[] {
  const first = results.findIndex((result) => !result.passed);
  return first < 0 ? results : results.map((result, index) => (index === first ? { ...result, rejected: rejected.slice(0, 1000) } : result));
}

/**
 * Code's sentences go before a closing question, so the caller hears the
 * question last and knows it is their turn ("...What is your company name?
 * The record showed..." was the order in the benchmark).
 */
export function joinReply(modelText: string, codeText: string[]): string {
  if (!codeText.length) return modelText;
  const sentences = splitSentences(modelText);
  const last = sentences.at(-1);
  if (last?.endsWith("?")) return [...sentences.slice(0, -1), ...codeText, last].join(" ");
  return [modelText, ...codeText].filter(Boolean).join(" ");
}

export async function runTurn(request: TurnRequest): Promise<TurnOutcome> {
  const started = performance.now();
  const since = () => Math.round(performance.now() - started);
  const deadlineMs = request.deadlineMs ?? TURN_DEADLINE_MS;
  const typed = request.channel === "text";
  // The same sentences either way; a typed reply swaps the few voice-only lines and keeps references as written.
  const format = (text: string) => (typed ? toText(VOICE_TO_TYPED.reduce((out, [voice, written]) => out.split(voice).join(written), text), request.now) : toSpeech(text, request.now));
  let ttftMs: number | null = null;
  let spokeAlready = false;
  let finished = false;
  let fillerUsed = false;

  const emit = (text: string) => {
    if (!text || request.signal.aborted) return;
    ttftMs ??= since();
    request.emit(spokeAlready ? ` ${text}` : text);
    spokeAlready = true;
  };
  // Once per turn, from a fixed list, and it never claims anything (DESIGN §5 step 7).
  // Only when a lookup or search starts, so it is true: a timer once had the
  // caller hear "let me check that" before "goodbye" (Akin, 2026-09-30).
  // A reader sees the page's progress line instead.
  const speakFiller = () => {
    if (fillerUsed || finished) return;
    fillerUsed = true;
    emit(FILLER_PHRASES[request.turnIndex % FILLER_PHRASES.length]!);
  };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  let deadlineHit = false;
  const deadline = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, deadlineMs);

  const attempt = async (repair?: { previous: string; violations: string[] }): Promise<AgentRun> => {
    try {
      return await request.runAgent({
        prompt: turnPrompt(request.transcript, repair),
        systemPrompt: systemPrompt({ now: request.now, verified: request.verified, escalated: request.escalated, clarifyStreak: request.clarifyStreak, channel: request.channel, offeredSlots: request.offeredSlots }),
        model: request.model,
        conversationId: request.conversationId,
        turnId: request.turnId,
        abortController: controller,
        onFirstToolUse: typed ? undefined : speakFiller,
      });
    } catch (error) {
      return {
        answer: null,
        error: { kind: "sdk", message: error instanceof Error ? error.message : String(error) },
        resultSubtype: null,
        toolCalls: [],
        mcpStatus: null,
        model: request.model,
        usage: NO_USAGE,
        costEstimateUsd: 0,
        timings: {},
      };
    }
  };

  const callerTexts = request.transcript.filter((line) => line.role === "caller").map((line) => line.text);
  const gate = (answer: Answer, toolCalls: AgentRun["toolCalls"]): { verdict: GateVerdict; sentences: string[] } => {
    const code = codeSentences(toolCalls, request.now);
    const verdict = runGates({ answer, toolCalls, callerTexts, escalated: request.escalated, clarifyStreak: request.clarifyStreak, covers: code.covers, offeredSlots: request.offeredSlots?.map((slot) => slot.speakable) });
    return { verdict, sentences: code.sentences };
  };

  let run = await attempt();
  let toolCalls = run.toolCalls;
  let usage = run.usage;
  let cost = run.costEstimateUsd;
  let repaired = false;
  let checked = run.answer ? gate(run.answer, toolCalls) : null;
  const firstResults = checked && run.answer ? withRejected(checked.verdict.results, run.answer.spoken_text) : [];

  // One repair, only when there is time for it (DESIGN §6.3).
  if (run.answer && checked && !checked.verdict.passed && !request.signal.aborted && deadlineMs - since() > (request.repairMinMs ?? REPAIR_MIN_MS)) {
    const violations = checked.verdict.results.filter((result) => !result.passed).map((result) => result.detail ?? result.gate);
    const second = await attempt({ previous: run.answer.spoken_text, violations });
    usage = addUsage(usage, second.usage);
    cost += second.costEstimateUsd;
    toolCalls = [...toolCalls, ...second.toolCalls];
    if (second.answer) {
      run = { ...second, toolCalls };
      checked = gate(second.answer, toolCalls);
      repaired = true;
    }
  }

  finished = true;
  clearTimeout(deadline);
  request.signal.removeEventListener("abort", onAbort);

  const alerts: AlertInput[] = [];
  if (run.mcpStatus !== null && run.mcpStatus !== "connected") {
    alerts.push({ type: "mcp_unreachable", severity: "critical", fingerprint: "mcp_unreachable", message: `The agent's MCP server was ${run.mcpStatus} at the start of a turn.`, context: { model: request.model } });
  }
  const base = { model: request.model, usage, costEstimateUsd: cost, timings: run.timings, mcpStatus: run.mcpStatus, toolCalls, fillerUsed, repaired };

  // The caller moved on. Vapi handles the interruption; nothing more is said.
  if (request.signal.aborted) {
    return { ...base, status: "interrupted", spokenText: null, answerType: null, replySource: null, confidenceNote: null, grounding: null, kbChunkIds: [], gateResults: [], fallbackUsed: false, error: "interrupted by the caller", errorKind: "aborted", ttftMs, totalMs: since(), speechStripped: null, alerts, nextClarifyStreak: request.clarifyStreak };
  }

  if (run.error || !run.answer || !checked) {
    const kind: AgentErrorKind | "deadline" = deadlineHit ? "deadline" : (run.error?.kind ?? "sdk");
    const message = run.error?.message ?? "no answer";
    alerts.push(failureAlert(kind, message, request.model));
    // Something code already did this turn (a ticket, an escalation) is still said: it happened.
    const done = codeSentences(toolCalls, request.now).sentences;
    const speech = format([...done, done.length ? "" : SPOKEN.systemTrouble].filter(Boolean).join(" "));
    emit(speech.text);
    return { ...base, status: "error", spokenText: speech.text, answerType: done.length ? "escalate" : "decline", replySource: "fallback", confidenceNote: null, grounding: null, kbChunkIds: [], gateResults: firstResults, fallbackUsed: true, error: `${kind}: ${message}`.slice(0, 1000), errorKind: kind, ttftMs, totalMs: since(), speechStripped: speech.stripped, alerts, nextClarifyStreak: 0 };
  }

  const { verdict, sentences } = checked;
  const finalResults = repaired ? withRejected(verdict.results, run.answer.spoken_text) : firstResults;
  const results = repaired ? [...firstResults.filter((result) => !result.passed).map((result) => ({ ...result, detail: `before repair: ${result.detail ?? ""}` })), ...finalResults] : finalResults;
  let text: string;
  let answerType: AnswerType;
  let replySource: "agent" | "fallback";
  if (verdict.passed) {
    // The goodbye is fixed and listed in Vapi's endCallPhrases, so a closing reply ends the call.
    const goodbye = run.answer.answer_type === "closing" ? [SPOKEN.goodbye] : [];
    // An answer worked out rather than stated by the knowledge, or resting on a section under the
    // threshold, says so in code's words (DESIGN §8), before any closing question so the reply still ends on it.
    const hedge = verdict.grounding === "inferred" && verdict.text ? [SPOKEN.inferredHedge] : [];
    text = [joinReply(verdict.text, [...sentences, ...hedge]), ...goodbye].filter(Boolean).join(" ");
    answerType = run.answer.answer_type;
    replySource = "agent";
    // A closing reply whose words were all sign-off is just the goodbye; anything else left empty declines.
    if (!text) {
      text = SPOKEN.fallbackDecline;
      answerType = "decline";
      replySource = "fallback";
    }
  } else {
    // Whatever code wrote from a tool that succeeded still stands; the model's words do not.
    text = [...sentences, verdict.fallback!.text].join(" ");
    answerType = verdict.fallback!.answerType;
    replySource = "fallback";
    const failed = verdict.results.filter((result) => !result.passed).map((result) => result.gate);
    alerts.push({ type: "gate_fallback", severity: "warning", fingerprint: `gate_fallback:${failed.join("+")}`, message: `A fallback was spoken because ${failed.join(", ")} failed${repaired ? " after a repair" : ""}.`, context: { answer_type: run.answer.answer_type } });
  }

  const speech = format(text);
  emit(speech.text);
  return {
    ...base,
    status: "ok",
    spokenText: speech.text,
    answerType,
    replySource,
    confidenceNote: run.answer.confidence_note,
    grounding: replySource === "agent" && answerType === "answer" ? verdict.grounding : null,
    kbChunkIds: replySource === "agent" ? run.answer.kb_chunk_ids : [],
    gateResults: results,
    fallbackUsed: replySource === "fallback",
    error: null,
    errorKind: null,
    ttftMs,
    totalMs: since(),
    speechStripped: speech.stripped,
    alerts,
    nextClarifyStreak: answerType === "clarify" ? request.clarifyStreak + 1 : 0,
  };
}
