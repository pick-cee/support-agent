import { describe, expect, it } from "vitest";

import { SPOKEN } from "@/app/copy";
import { DAILY_AGENT_BUDGET_USD, MAX_TURNS_PER_CALL, MAX_USER_CHARS } from "@/lib/constants";

import { END_CALL_PHRASE } from "../../vapi/assistant";
import { checkBeforeModel } from "./cheap-checks";
import { channelOf, redactVapiPayload, sseChunk, transcriptOf, vapiRequestSchema } from "./vapi-protocol";

describe("checkBeforeModel", () => {
  it.each([[""], ["   "], ["uh"], ["Um..."], ["hmm, uh"], ["mm"]])("answers %j without a model", (userText) => {
    expect(checkBeforeModel({ userText, turnIndex: 0, spentTodayUsd: 0 })).toEqual({ action: "reply", text: SPOKEN.didNotCatch, reason: "empty", answerType: "clarify" });
  });

  it("lets a real request through", () => {
    expect(checkBeforeModel({ userText: "Uh, can you check TXN-9001?", turnIndex: 0, spentTodayUsd: 0 })).toEqual({ action: "run", userText: "Uh, can you check TXN-9001?", truncated: false });
  });

  it("closes politely at the turn limit and declines past the daily budget", () => {
    expect(checkBeforeModel({ userText: "hello", turnIndex: MAX_TURNS_PER_CALL, spentTodayUsd: 0 })).toMatchObject({ reason: "max_turns" });
    expect(checkBeforeModel({ userText: "hello", turnIndex: 1, spentTodayUsd: DAILY_AGENT_BUDGET_USD })).toMatchObject({ reason: "budget" });
  });

  it.each([["No, thank you. That's all. Goodbye."], ["Uh, no. Thank you. That will be all."], ["Bye!"], ["That's everything, have a good day"], ["no thanks that is all"]])("says goodbye to %j at once, with the phrase that ends the call", (userText) => {
    expect(checkBeforeModel({ userText, turnIndex: 2, spentTodayUsd: 0, lastAnswerType: "answer" })).toEqual({ action: "reply", text: `${SPOKEN.quickGoodbye} ${SPOKEN.goodbye}`, reason: "goodbye", answerType: "closing" });
  });

  it.each([
    ["That's all, but can you also check TXN-9001?"],
    ["Thanks, what about payouts?"],
    ["Thank you"],
    ["Goodbye? Wait, one more thing"],
    ["That's all I wanted to ask about fees and I need to know about refunds for my payout from last week please"],
  ])("sends %j to the agent: it may carry another request", (userText) => {
    expect(checkBeforeModel({ userText, turnIndex: 2, spentTodayUsd: 0, lastAnswerType: "answer" }).action).toBe("run");
  });

  it("never says goodbye while callback details are being taken, or on the first turn", () => {
    expect(checkBeforeModel({ userText: "No, that's all.", turnIndex: 3, spentTodayUsd: 0, lastAnswerType: "collect_details" }).action).toBe("run");
    expect(checkBeforeModel({ userText: "Goodbye", turnIndex: 0, spentTodayUsd: 0 }).action).toBe("run");
  });

  it("keeps the end-call phrase inside the goodbye, so saying it always ends the call", () => {
    expect(SPOKEN.goodbye.toLowerCase()).toContain(END_CALL_PHRASE.toLowerCase());
  });

  it("keeps the last characters of an over-long turn and says so", () => {
    const result = checkBeforeModel({ userText: `${"x".repeat(MAX_USER_CHARS)} the end`, turnIndex: 0, spentTodayUsd: 0 });
    expect(result).toMatchObject({ action: "run", truncated: true });
    expect(result.action === "run" && result.userText.endsWith("the end") && result.userText.length === MAX_USER_CHARS).toBe(true);
  });
});

describe("the Vapi protocol", () => {
  const body = vapiRequestSchema.parse({
    model: "relaypay",
    stream: true,
    messages: [
      { role: "system", content: "ignored" },
      { role: "assistant", content: "Hi, this is RelayPay support." },
      { role: "user", content: [{ type: "text", text: "Check TXN-9001" }] },
    ],
    call: { id: "call_123", type: "webCall", extra: "kept" },
  });

  it("reads the transcript without system messages", () => {
    expect(transcriptOf(body)).toEqual([
      { role: "agent", text: "Hi, this is RelayPay support." },
      { role: "caller", text: "Check TXN-9001" },
    ]);
    expect(channelOf(body)).toBe("web");
  });

  it("drops the flush tokens Vapi echoes back in the assistant's lines", () => {
    const echoed = vapiRequestSchema.parse({ messages: [{ role: "assistant", content: "One moment while I check that.<flush /> TXN-9001 is processing.<flush />" }], call: { id: "c" } });
    expect(transcriptOf(echoed)).toEqual([{ role: "agent", text: "One moment while I check that. TXN-9001 is processing." }]);
  });

  it("rejects a body without a call id", () => {
    expect(vapiRequestSchema.safeParse({ messages: [], call: {} }).success).toBe(false);
  });

  it("writes an OpenAI-shaped SSE chunk", () => {
    const line = sseChunk("turn-1", "Hello.");
    expect(line.startsWith("data: ")).toBe(true);
    expect(line.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(line.slice(6))).toMatchObject({ id: "turn-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hello." }, finish_reason: null }] });
    expect(JSON.parse(sseChunk("turn-1", null, "stop").slice(6)).choices[0]).toEqual({ index: 0, delta: {}, finish_reason: "stop" });
  });

  it("keeps a payload's shape and drops its values", () => {
    expect(redactVapiPayload({ call: { id: "call_123", type: "webCall" }, customer: { number: "+2348012345678" }, messages: [{ role: "user", content: "my email is a@b.co" }] })).toEqual({
      call: { id: "<string 8>", type: "webCall" },
      customer: { number: "<string 14>" },
      messages: [{ role: "user", content: "<string 18>" }],
    });
  });
});
