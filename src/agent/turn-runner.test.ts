import { describe, expect, it } from "vitest";

import { FILLER_PHRASES, SPOKEN, TYPED } from "@/app/copy";

import type { Answer } from "./answer";
import type { AgentRun, RunAgentOptions, ToolCallRecord } from "./run-agent";
import { runTurn, type TurnRequest } from "./turn-runner";

const NOW = new Date("2026-09-29T10:00:00Z");

const TXN_9001: ToolCallRecord = {
  id: "toolu_1",
  name: "lookup_transaction",
  input: { transaction_id: "TXN-9001" },
  isError: false,
  result: {
    found: true,
    transaction_id: "TXN-9001",
    type: "outgoing payout",
    status: "processing",
    estimated_arrival: "2026-08-19",
    support_summary: "Payout is processing within the normal expected window.",
    summary_outdated: true,
    eta_known: true,
    eta_passed: true,
    withheld: true,
    amount: null,
  },
};

function agentRun(overrides: Partial<AgentRun>): AgentRun {
  return {
    answer: null,
    error: null,
    resultSubtype: "success",
    toolCalls: [],
    mcpStatus: "connected",
    model: "claude-haiku-4-5-20251001",
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costEstimateUsd: 0.007,
    timings: {},
    ...overrides,
  };
}

function answer(overrides: Partial<Answer>): Answer {
  return { answer_type: "lookup_result", spoken_text: "", kb_chunk_ids: [], confidence_note: "From the lookup.", needs_human: false, ...overrides };
}

function request(fake: (options: RunAgentOptions) => Promise<AgentRun>, overrides: Partial<TurnRequest> = {}): { request: TurnRequest; spoken: string[] } {
  const spoken: string[] = [];
  return {
    spoken,
    request: {
      transcript: [
        { role: "agent", text: "Hi, this is RelayPay support." },
        { role: "caller", text: "Can you check transaction TXN-9001?" },
      ],
      turnIndex: 0,
      conversationId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
      verified: false,
      escalated: false,
      clarifyStreak: 0,
      model: "claude-haiku-4-5-20251001",
      now: NOW,
      signal: new AbortController().signal,
      emit: (text) => spoken.push(text),
      runAgent: fake,
      fillerAfterMs: 10_000,
      ...overrides,
    },
  };
}

describe("runTurn", () => {
  it("speaks the filler when the first tool starts, then the gated answer with the code-written estimate sentence", async () => {
    const { request: turn, spoken } = request(async (options) => {
      options.onFirstToolUse?.();
      return agentRun({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "I found TXN-9001. It's an outgoing payout. The payout is processing within the normal expected window." }) });
    });
    const outcome = await runTurn(turn);
    expect(spoken).toEqual([
      FILLER_PHRASES[0],
      " I found T X N 9 0 0 1. It's an outgoing payout. The record showed an estimated arrival of 19 August, which has passed, and it's still processing.",
    ]);
    expect(outcome).toMatchObject({ status: "ok", answerType: "lookup_result", replySource: "agent", fillerUsed: true, fallbackUsed: false, nextClarifyStreak: 0 });
    expect(outcome.ttftMs).not.toBeNull();
  });

  it("repairs once with the named violation, and speaks the repaired answer", async () => {
    const prompts: string[] = [];
    const { request: turn, spoken } = request(async (options) => {
      prompts.push(options.prompt);
      return prompts.length === 1
        ? agentRun({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 will arrive in 3 days." }) })
        : agentRun({ answer: answer({ spoken_text: "TXN-9001 is an outgoing payout that is still processing." }) });
    });
    const outcome = await runTurn(turn);
    expect(prompts[1]).toMatch(/rejected[\s\S]*numbers not in this turn's evidence: 3/);
    expect(outcome).toMatchObject({ repaired: true, replySource: "agent", fallbackUsed: false });
    expect(spoken.join("")).toContain("still processing. The record showed an estimated arrival of 19 August");
  });

  it("skips the repair when there is no time left for it", async () => {
    let calls = 0;
    const { request: turn } = request(async () => {
      calls += 1;
      return agentRun({ answer: answer({ spoken_text: "TXN-9001 will arrive in 3 days." }) });
    }, { repairMinMs: 60_000 });
    const outcome = await runTurn(turn);
    expect(calls).toBe(1);
    expect(outcome).toMatchObject({ repaired: false, fallbackUsed: true });
  });

  it("speaks the fallback and raises an alert when a gate fails", async () => {
    const { request: turn, spoken } = request(async () => agentRun({ answer: answer({ spoken_text: "TXN-9001 is processing and will arrive in 3 days." }) }), { repairMinMs: 60_000 });
    const outcome = await runTurn(turn);
    expect(spoken).toEqual([SPOKEN.fallbackLookup]);
    expect(outcome).toMatchObject({ replySource: "fallback", fallbackUsed: true, answerType: "clarify" });
    expect(outcome.alerts.map((alert) => alert.type)).toEqual(["gate_fallback"]);
  });

  it("never leaves dead air when the agent fails, and keeps the usage it reported", async () => {
    const { request: turn, spoken } = request(async () => agentRun({ error: { kind: "limit", message: "error_max_budget_usd" }, costEstimateUsd: 0.05 }));
    const outcome = await runTurn(turn);
    expect(spoken).toEqual([SPOKEN.systemTrouble]);
    expect(outcome).toMatchObject({ status: "error", errorKind: "limit", costEstimateUsd: 0.05, fallbackUsed: true });
    expect(outcome.alerts.map((alert) => alert.type)).toEqual(["agent_limit"]);
  });

  it("turns a thrown error into the spoken fallback, never a stack trace", async () => {
    const { request: turn, spoken } = request(async () => {
      throw new Error("spawn ENOENT /tmp/claude");
    });
    const outcome = await runTurn(turn);
    expect(spoken).toEqual([SPOKEN.systemTrouble]);
    expect(spoken.join(" ")).not.toMatch(/ENOENT/);
    expect(outcome).toMatchObject({ status: "error", errorKind: "sdk" });
  });

  it("stops at the deadline and says so as a timeout", async () => {
    const { request: turn, spoken } = request(
      (options) =>
        new Promise((resolve) => {
          options.abortController.signal.addEventListener("abort", () => resolve(agentRun({ error: { kind: "aborted", message: "aborted" } })));
        }),
      { deadlineMs: 20 },
    );
    const outcome = await runTurn(turn);
    expect(outcome).toMatchObject({ status: "error", errorKind: "deadline" });
    expect(spoken).toEqual([SPOKEN.systemTrouble]);
    expect(outcome.alerts.map((alert) => alert.type)).toEqual(["agent_timeout"]);
  });

  it("says nothing more when the caller interrupts", async () => {
    const caller = new AbortController();
    const { request: turn, spoken } = request(
      (options) =>
        new Promise((resolve) => {
          options.abortController.signal.addEventListener("abort", () => resolve(agentRun({ error: { kind: "aborted", message: "aborted" } })));
          setTimeout(() => caller.abort(), 5);
        }),
      { signal: caller.signal },
    );
    const outcome = await runTurn(turn);
    expect(outcome.status).toBe("interrupted");
    expect(spoken).toEqual([]);
  });

  it("speaks the filler on time when the agent is slow to start a tool", async () => {
    const { request: turn, spoken } = request(
      (options) =>
        new Promise((resolve) => {
          setTimeout(() => {
            options.onFirstToolUse?.();
            resolve(agentRun({ answer: answer({ answer_type: "decline", spoken_text: "I can't answer that from our records." }) }));
          }, 40);
        }),
      { fillerAfterMs: 5 },
    );
    await runTurn(turn);
    expect(spoken[0]).toBe(FILLER_PHRASES[0]);
    expect(spoken).toHaveLength(2);
  });

  it("raises a critical alert when the MCP server did not connect", async () => {
    const { request: turn } = request(async () => agentRun({ mcpStatus: "failed", answer: answer({ answer_type: "decline", spoken_text: "I can't check that right now." }) }));
    const outcome = await runTurn(turn);
    expect(outcome.alerts).toEqual([expect.objectContaining({ type: "mcp_unreachable", severity: "critical" })]);
  });

  it("ends every closing reply with the fixed goodbye that Vapi's endCallPhrases lists", async () => {
    const { request: turn, spoken } = request(async () => agentRun({ answer: answer({ answer_type: "closing", spoken_text: "You're welcome." }) }));
    const outcome = await runTurn(turn);
    expect(outcome).toMatchObject({ answerType: "closing", replySource: "agent" });
    expect(spoken.join("").trim()).toBe(`You're welcome. ${SPOKEN.goodbye}`);
  });

  it("puts code's sentences before the model's closing question, so the caller hears the question last", async () => {
    // Haiku's reply in the refund eval (2026-09-29), which code had followed with the estimate sentence.
    const { request: turn, spoken } = request(async () => agentRun({ toolCalls: [TXN_9001], answer: answer({ answer_type: "clarify", spoken_text: "I can check that for you. What is your company name?" }) }));
    await runTurn(turn);
    expect(spoken.join("").trim()).toBe("I can check that for you. The record showed an estimated arrival of 19 August, which has passed, and it's still processing. What is your company name?");
  });

  it("keeps the model's rejected reply on the failed check, so the console shows what was stopped", async () => {
    const { request: turn } = request(async () => agentRun({ answer: answer({ spoken_text: "TXN-9001 is processing and will arrive in 3 days." }) }), { repairMinMs: 60_000 });
    const outcome = await runTurn(turn);
    const failed = outcome.gateResults.filter((result) => !result.passed);
    expect(failed.map((result) => result.gate)).toEqual(["evidence", "numbers"]);
    // Once per reply, on the first failed check.
    expect(failed.map((result) => result.rejected ?? null)).toEqual(["TXN-9001 is processing and will arrive in 3 days.", null]);
  });

  it("answers a typed message with no filler, references as written, and the typed goodbye", async () => {
    const { request: turn, spoken } = request(
      async (options) => {
        options.onFirstToolUse?.();
        return agentRun({ toolCalls: [TXN_9001], answer: answer({ answer_type: "closing", spoken_text: "TXN-9001 is an outgoing payout that is still processing." }) });
      },
      { channel: "text", fillerAfterMs: 0 },
    );
    const outcome = await runTurn(turn);
    expect(outcome.fillerUsed).toBe(false);
    expect(spoken).toEqual([`TXN-9001 is an outgoing payout that is still processing. The record showed an estimated arrival of 19 August, which has passed, and it's still processing. ${TYPED.goodbye}`]);
  });

  it("swaps a voice-only fallback line for its typed version", async () => {
    const { request: turn, spoken } = request(async () => agentRun({ answer: answer({ answer_type: "collect_details", spoken_text: "Can I have your email TXN-9001" }) }), { channel: "text", repairMinMs: 60_000 });
    await runTurn(turn);
    expect(spoken).toEqual([TYPED.fallbackCollect]);
  });

  it("counts clarifying questions in a row", async () => {
    const { request: turn } = request(async () => agentRun({ answer: answer({ answer_type: "clarify", spoken_text: "Is it an incoming transfer, an outgoing payout or an invoice payment?" }) }), { clarifyStreak: 1 });
    expect((await runTurn(turn)).nextClarifyStreak).toBe(2);
  });
});
