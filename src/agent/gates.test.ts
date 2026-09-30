import { describe, expect, it } from "vitest";

import { SPOKEN } from "@/app/copy";

import type { Answer } from "./answer";
import { codeSentences } from "./code-sentences";
import { runGates, type GateInput } from "./gates";
import type { ToolCallRecord } from "./run-agent";

const NOW = new Date("2026-09-29T10:00:00Z");

// What lookup_transaction really returned for TXN-9001 to an unverified caller on 2026-09-29.
const TXN_9001: ToolCallRecord = {
  id: "toolu_1",
  name: "lookup_transaction",
  input: { transaction_id: "TXN-9001" },
  isError: false,
  result: {
    found: true,
    transaction_id: "TXN-9001",
    customer_id: null,
    type: "outgoing payout",
    status: "processing",
    amount: null,
    currency: null,
    estimated_arrival: "2026-08-19",
    support_summary: "Payout is processing within the normal expected window.",
    summary_outdated: true,
    eta_known: true,
    eta_passed: true,
    days_since_eta: 41,
    checked_on: "2026-09-29",
    disclosure: "unverified",
    withheld: true,
    requires_escalation: false,
  },
};

function answer(overrides: Partial<Answer>): Answer {
  return { answer_type: "lookup_result", spoken_text: "", kb_chunk_ids: [], confidence_note: "", needs_human: false, ...overrides };
}

function gate(overrides: Partial<GateInput> & { answer: Answer }): ReturnType<typeof runGates> {
  return runGates({ toolCalls: [], callerTexts: ["Can you check transaction TXN-9001?"], escalated: false, clarifyStreak: 0, ...overrides });
}

function failedGates(verdict: ReturnType<typeof runGates>): string[] {
  return verdict.results.filter((result) => !result.passed).map((result) => result.gate);
}

describe("gates, with the outputs Phase 0 actually produced", () => {
  it("drops the sentence that repeats TXN-9001's outdated summary and keeps the rest", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ spoken_text: "I found TXN-9001. It is an outgoing payout and the status is processing. The payout is proceeding within the normal expected window." }),
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.text).toBe("I found TXN-9001. It is an outgoing payout and the status is processing.");
    expect(verdict.results.find((result) => result.gate === "stale_summary")).toMatchObject({ cleanup: true });
  });

  it("drops the model's own sentence about the passed estimate, and the review it invented, because code speaks the estimate", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      covers: codeSentences([TXN_9001], NOW).covers,
      answer: answer({
        spoken_text: "I found TXN-9001. It's an outgoing payout that is currently processing. The estimated arrival date has passed, so this needs review by a specialist to check what's happening.",
      }),
    });
    expect(verdict.text).toBe("I found TXN-9001. It's an outgoing payout that is currently processing.");
    expect(verdict.results.find((result) => result.gate === "eta_by_code")).toMatchObject({ cleanup: true });
  });

  it("drops a review the record does not show, as Haiku said it twice in Phase 0", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ spoken_text: "Your payout TXN-9001 is still showing as processing. This needs review by a specialist, so please go to the RelayPay dashboard and contact support from there so they can help." }),
    });
    expect(verdict.text).toBe("Your payout TXN-9001 is still showing as processing.");
    expect(verdict.results.find((result) => result.gate === "review_claim")).toMatchObject({ cleanup: true });
  });

  it("drops the same claim when the model labels the turn a decline", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ answer_type: "decline", spoken_text: "I can see TXN-9001 is an outgoing payout that is still processing. This needs review by a specialist on the RelayPay dashboard." }),
    });
    expect(verdict.text).toBe("I can see TXN-9001 is an outgoing payout that is still processing.");
  });

  // The Bitcoin eval on 2026-09-29 spoke "I can't answer that confidently, because I
  // don't have approved information on Bitcoin payments. Would you like that?" The
  // cleanup had removed the specialist offer between them, and did not record it,
  // so the middle sentence here is a reconstruction of what the prompt asks for.
  const BITCOIN_DECLINE = "I can't answer that confidently, because I don't have approved information on Bitcoin payments. I can arrange for a specialist to follow up. Would you like that?";
  const EMPTY_SEARCH: ToolCallRecord = { id: "k", name: "search_knowledge_base", input: { query: "Can I pay a supplier in Bitcoin or cryptocurrency?" }, isError: false, result: { found: false, chunks: [] } };

  it("keeps a specialist offer on a decline, which is what the prompt asks for", () => {
    const verdict = gate({ callerTexts: ["Can I pay a supplier in Bitcoin?"], toolCalls: [EMPTY_SEARCH], answer: answer({ answer_type: "decline", spoken_text: BITCOIN_DECLINE }) });
    expect(verdict.text).toBe(BITCOIN_DECLINE);
    expect(verdict.results.find((result) => result.gate === "review_claim")).toEqual({ gate: "review_claim", passed: true });
  });

  it("still drops a review claim on a decline, even one phrased beside an offer", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ answer_type: "decline", spoken_text: "TXN-9001 is still processing. I can arrange a specialist, since this payment needs review." }),
    });
    expect(verdict.text).toBe("TXN-9001 is still processing.");
  });

  it("does not treat an offer as allowed outside a decline", () => {
    const verdict = gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 is still processing. I can arrange for a specialist to look into it." }) });
    expect(verdict.text).toBe("TXN-9001 is still processing.");
  });

  it("removes the model's own sign-off from a closing reply, because code adds the goodbye", () => {
    // The typed test on 2026-09-30 showed "Thanks for contacting RelayPay." and then code's goodbye.
    const verdict = gate({ callerTexts: ["Thanks, that's all I needed."], answer: answer({ answer_type: "closing", spoken_text: "You're welcome. Thanks for contacting RelayPay." }) });
    expect(verdict.text).toBe("You're welcome.");
    expect(verdict.results.find((result) => result.gate === "goodbye_by_code")).toMatchObject({ cleanup: true });
  });

  it("leaves a thank-you alone when the reply is not closing", () => {
    const text = "Thanks for waiting. TXN-9001 is still processing.";
    expect(gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: text }) }).text).toBe(text);
  });

  it("keeps a clarifying question that mentions a specialist, because a question claims nothing", () => {
    // Haiku's reply in the refund eval (2026-09-29): removing it left nothing, and the caller heard the decline fallback.
    const text = "I need to understand. Are you saying your company name is Friday, or are you telling me when you'd prefer a specialist to call you back?";
    expect(gate({ callerTexts: ["Friday at 10am."], answer: answer({ answer_type: "clarify", spoken_text: text }) }).text).toBe(text);
  });

  it("still drops a question that claims a review is needed", () => {
    const verdict = gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 is still processing. Did you know it needs review by a specialist?" }) });
    expect(verdict.text).toBe("TXN-9001 is still processing.");
  });

  it("removes a bare follow-up question with the sentence it pointed at, and records both", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ spoken_text: "TXN-9001 is still processing. This needs review by a specialist. Would you like that?" }),
    });
    expect(verdict.text).toBe("TXN-9001 is still processing.");
    expect(verdict.results.find((result) => result.gate === "review_claim")?.detail).toBe(
      'removed 2 sentence(s) claiming a review the record does not show: "This needs review by a specialist." "Would you like that?"',
    );
  });

  it("keeps a follow-up question that stands on its own", () => {
    const verdict = gate({
      toolCalls: [TXN_9001],
      answer: answer({ spoken_text: "TXN-9001 is still processing. This needs review by a specialist. Would you like me to open a ticket so someone checks it?" }),
    });
    expect(verdict.text).toBe("TXN-9001 is still processing. Would you like me to open a ticket so someone checks it?");
  });

  it("keeps the review sentence when the record requires escalation", () => {
    const review: ToolCallRecord = { ...TXN_9001, result: { ...TXN_9001.result!, transaction_id: "TXN-9003", eta_passed: false, summary_outdated: false, requires_escalation: true } };
    const text = "TXN-9003 needs review by a specialist.";
    expect(gate({ callerTexts: ["check TXN-9003"], toolCalls: [review], answer: answer({ spoken_text: text }) }).text).toBe(text);
  });

  it("keeps sentences about arrival when no estimate has passed", () => {
    const onTime = { ...TXN_9001, result: { ...TXN_9001.result!, eta_passed: false, summary_outdated: false, estimated_arrival: null, eta_known: false } };
    expect(gate({ toolCalls: [onTime], answer: answer({ spoken_text: "There's no estimated arrival on the record." }) }).text).toBe("There's no estimated arrival on the record.");
  });

  it("lets code add the stale-estimate sentence the model may not write", () => {
    expect(codeSentences([TXN_9001], NOW)).toEqual({ sentences: [SPOKEN.staleEta("19 August", "processing")], covers: { eta: true, ticket: false, booking: false } });
    expect(codeSentences([TXN_9001], NOW).sentences[0]).toBe("The record showed an estimated arrival of 19 August, which has passed, and it's still processing.");
  });

  it("adds no stale-estimate sentence for a payment that completed", () => {
    const completed = { ...TXN_9001, result: { ...TXN_9001.result!, status: "completed", eta_passed: false } };
    expect(codeSentences([completed], NOW).sentences).toEqual([]);
  });

  it("speaks the ticket reference, and a booked time only when Cal.com booked it", () => {
    const ticket: ToolCallRecord = { id: "t", name: "create_support_ticket", input: {}, isError: false, result: { ticket_ref: "T-4001", created: true } };
    expect(codeSentences([ticket], NOW).sentences).toEqual(["I've opened a ticket for this. Your reference is T-4001."]);
    const booked: ToolCallRecord = { id: "e", name: "create_escalation", input: {}, isError: false, result: { escalation_ref: "E-2001", call_booked: true, appointment_time: "2026-10-06T13:00:00.000Z", timezone: "Africa/Lagos" } };
    expect(codeSentences([booked], NOW).sentences).toEqual(["A specialist will call you on Tuesday 6 October at 2 PM Lagos time. You'll get a confirmation email from our booking system."]);
    const pending: ToolCallRecord = { ...booked, result: { escalation_ref: "E-2001", call_booked: false, appointment_time: null, booking_status: "failed" } };
    expect(codeSentences([pending], NOW).sentences).toEqual([SPOKEN.callbackByEmail]);
  });

  it("removes the model's own ticket reference and booking talk when code says them", () => {
    const ticket: ToolCallRecord = { id: "t", name: "create_support_ticket", input: {}, isError: false, result: { ticket_ref: "T-4001", created: true } };
    const verdict = gate({
      toolCalls: [ticket],
      covers: { eta: false, ticket: true, booking: false },
      answer: answer({ answer_type: "ticket_created", spoken_text: "I understand the invoice payment failed. I've opened ticket T-4001 for you." }),
    });
    expect(verdict.text).toBe("I understand the invoice payment failed.");
  });

  it("removes sentences using a term the record says not to explain", () => {
    const payout: ToolCallRecord = { id: "p", name: "lookup_payout", input: {}, isError: false, result: { found: true, payout_id: "PAY-7002", requires_escalation: true, sensitive_terms: ["compliance"] } };
    const verdict = gate({
      callerTexts: ["What is happening with payout PAY-7002?"],
      toolCalls: [payout],
      answer: answer({ spoken_text: "PAY-7002 needs review by a specialist. It is held for a compliance review. Would you like a specialist to call you?" }),
    });
    expect(verdict.text).toBe("PAY-7002 needs review by a specialist. Would you like a specialist to call you?");
  });
});

describe("evidence", () => {
  it("rejects a lookup result when no lookup ran this turn, and falls back to asking for the reference", () => {
    const verdict = gate({ answer: answer({ spoken_text: "TXN-9001 is processing." }) });
    expect(failedGates(verdict)).toEqual(["evidence"]);
    expect(verdict.fallback).toEqual({ text: SPOKEN.fallbackLookup, answerType: "clarify" });
  });

  it("rejects a lookup result when the lookup found nothing", () => {
    const missing: ToolCallRecord = { ...TXN_9001, result: { found: false, reason: "not_found", normalised_id: "TXN-9001" } };
    expect(failedGates(gate({ toolCalls: [missing], answer: answer({ spoken_text: "It is processing." }) }))).toEqual(["evidence"]);
  });

  it("rejects an answer with no knowledge search, and a ticket or escalation claimed without the tool", () => {
    expect(failedGates(gate({ answer: answer({ answer_type: "answer", spoken_text: "Fees vary by corridor." }) }))).toEqual(["evidence"]);
    expect(failedGates(gate({ answer: answer({ answer_type: "ticket_created", spoken_text: "I've opened a ticket." }) }))).toEqual(["evidence"]);
    expect(failedGates(gate({ answer: answer({ answer_type: "escalate", spoken_text: "A specialist will call you." }) }))).toEqual(["evidence"]);
  });

  it("accepts an answer only when every cited chunk was returned this turn", () => {
    const search: ToolCallRecord = { id: "s", name: "search_knowledge_base", input: {}, isError: false, result: { found: true, chunks: [{ chunk_id: "faq-fees", text: "Fees vary." }] } };
    expect(gate({ toolCalls: [search], answer: answer({ answer_type: "answer", spoken_text: "Fees vary.", kb_chunk_ids: ["faq-fees"] }) }).passed).toBe(true);
    expect(failedGates(gate({ toolCalls: [search], answer: answer({ answer_type: "answer", spoken_text: "Fees vary.", kb_chunk_ids: ["faq-other"] }) }))).toEqual(["evidence"]);
  });

  // What search_knowledge_base returned for "Can I give my accountant their own login?" (top 0.376).
  const looseSearch: ToolCallRecord = {
    id: "s2",
    name: "search_knowledge_base",
    input: {},
    isError: false,
    result: { found: false, chunks: [], related: [{ chunk_id: "features-team", text: "Team member access with role-based permissions." }] },
  };

  it("accepts an inferred answer that rests on a related section", () => {
    const verdict = gate({ toolCalls: [looseSearch], answer: answer({ answer_type: "answer", grounding: "inferred", spoken_text: "Team members can have their own access.", kb_chunk_ids: ["features-team"] }) });
    expect(verdict.passed).toBe(true);
  });

  it("says a direct answer resting on a related section as inferred, rather than rejecting it", () => {
    // Sonnet called "Cryptocurrency payments" in the related limitations section direct, twice (eval, 2026-09-30).
    const verdict = gate({ toolCalls: [looseSearch], answer: answer({ answer_type: "answer", grounding: "direct", spoken_text: "Team members can have their own access.", kb_chunk_ids: ["features-team"] }) });
    expect(verdict.passed).toBe(true);
    expect(verdict.grounding).toBe("inferred");
    expect(verdict.results.find((result) => result.gate === "evidence")?.detail).toMatch(/said as inferred/);
  });

  it("keeps a direct answer direct when every cited section was found", () => {
    const found: ToolCallRecord = { id: "s3", name: "search_knowledge_base", input: {}, isError: false, result: { found: true, chunks: [{ chunk_id: "faq-fees", text: "Fees vary." }] } };
    expect(gate({ toolCalls: [found], answer: answer({ answer_type: "answer", spoken_text: "Fees vary.", kb_chunk_ids: ["faq-fees"] }) }).grounding).toBe("direct");
    expect(gate({ toolCalls: [found, looseSearch], answer: answer({ answer_type: "answer", spoken_text: "Fees vary.", kb_chunk_ids: ["faq-fees", "features-team"] }) }).grounding).toBe("inferred");
    expect(gate({ answer: answer({ answer_type: "clarify", spoken_text: "Which payment?" }) }).grounding).toBeNull();
  });

  it("rejects an inferred answer citing a section the search did not return", () => {
    const verdict = gate({ toolCalls: [looseSearch], answer: answer({ answer_type: "answer", grounding: "inferred", spoken_text: "Team members can have their own access.", kb_chunk_ids: ["features-other"] }) });
    expect(failedGates(verdict)).toEqual(["evidence"]);
  });
});

describe("questions and the clarify streak", () => {
  it("falls back to a fixed question when a clarify does not end with one", () => {
    const verdict = gate({ answer: answer({ answer_type: "clarify", spoken_text: "Tell me whether it is incoming or outgoing." }) });
    expect(failedGates(verdict)).toEqual(["question"]);
    expect(verdict.fallback).toEqual({ text: SPOKEN.fallbackClarify, answerType: "clarify" });
  });

  it("moves the question to the end instead of rejecting the reply", () => {
    // Sonnet's reply in the typed escalation (2026-09-30): rejected twice, then the caller got the fallback.
    const verdict = gate({
      callerTexts: ["Yes, that's right."],
      answer: answer({ answer_type: "collect_details", spoken_text: "Thank you, Efua. When would you like the specialist to call you? Please include your time zone or city if you can." }),
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.text).toBe("Thank you, Efua. Please include your time zone or city if you can. When would you like the specialist to call you?");
    expect(verdict.results.find((result) => result.gate === "question_last")).toMatchObject({ cleanup: true });
  });

  it("keeps the question when a long reply is trimmed", () => {
    const long = `${"This is a long sentence about the account that goes on for a while. ".repeat(8)}Which payment do you mean?`;
    const verdict = gate({ answer: answer({ answer_type: "clarify", spoken_text: long }) });
    expect(verdict.text.endsWith("Which payment do you mean?")).toBe(true);
    expect(verdict.text.length).toBeLessThanOrEqual(450);
  });

  it("blocks a third clarifying question in a row", () => {
    expect(failedGates(gate({ clarifyStreak: 2, answer: answer({ answer_type: "clarify", spoken_text: "Which payment?" }) }))).toEqual(["clarify_streak"]);
  });

  it("keeps a clarify that failed another check a clarify, so the streak still counts it", () => {
    // Sonnet's second reply in the clarify_cap eval (2026-09-29), with references it made up as examples.
    const verdict = gate({
      clarifyStreak: 1,
      callerTexts: ["My payment is stuck.", "It's just not working."],
      answer: answer({ answer_type: "clarify", spoken_text: "Do you have a reference, like TXN-9001 or PAY-7002?" }),
    });
    expect(failedGates(verdict)).toEqual(["numbers", "references"]);
    expect(verdict.fallback).toEqual({ text: SPOKEN.fallbackClarify, answerType: "clarify" });
  });

  it("declines instead once the clarify cap is reached, whatever else failed", () => {
    const verdict = gate({ clarifyStreak: 2, callerTexts: ["It's just stuck."], answer: answer({ answer_type: "clarify", spoken_text: "Is it TXN-9001?" }) });
    expect(verdict.fallback).toEqual({ text: SPOKEN.fallbackDecline, answerType: "decline" });
  });
});

describe("numbers", () => {
  it("blocks an invented fee", () => {
    expect(failedGates(gate({ answer: answer({ answer_type: "decline", spoken_text: "The fee is 3 percent." }) }))).toEqual(["numbers"]);
  });

  it("blocks an invented timeline in words", () => {
    expect(failedGates(gate({ answer: answer({ answer_type: "decline", spoken_text: "It usually takes two business days." }) }))).toEqual(["numbers"]);
  });

  it("allows a timeline the knowledge base returned, said in words", () => {
    const search: ToolCallRecord = { id: "s", name: "search_knowledge_base", input: {}, isError: false, result: { found: true, chunks: [{ chunk_id: "faq-time", text: "International payouts usually take 2 to 5 business days." }] } };
    expect(gate({ toolCalls: [search], answer: answer({ answer_type: "answer", kb_chunk_ids: ["faq-time"], spoken_text: "International payouts usually take two to five business days." }) }).passed).toBe(true);
  });

  it("does not count 'one' that is not a quantity", () => {
    expect(gate({ answer: answer({ answer_type: "decline", spoken_text: "One of our specialists can help. One moment." }) }).passed).toBe(true);
  });

  it("allows numbers the caller said and numbers inside the record", () => {
    expect(gate({ callerTexts: ["Can it arrive by 9am tomorrow?"], answer: answer({ answer_type: "decline", spoken_text: "I can't promise 9am." }) }).passed).toBe(true);
    expect(gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "It was due 19 August." }) }).passed).toBe(true);
  });
});

describe("privacy", () => {
  it("blocks an email the caller did not say", () => {
    expect(failedGates(gate({ answer: answer({ answer_type: "decline", spoken_text: "I'll write to efua@accrastack.example." }) }))).toEqual(["emails"]);
    expect(failedGates(gate({ answer: answer({ answer_type: "decline", spoken_text: "Is it efua at accrastack dot example?" }) }))).toEqual(["emails"]);
  });

  it("allows an email the caller said, read back", () => {
    expect(gate({ callerTexts: ["it's amara at lagosledger dot example"], answer: answer({ answer_type: "clarify", spoken_text: "Is that amara at lagosledger dot example?" }) }).passed).toBe(true);
  });

  it("does not read a sentence end as part of an email (the eval's real replies)", () => {
    const callerTexts = ["It's efua at accrastack dot example."];
    expect(gate({ callerTexts, answer: answer({ answer_type: "collect_details", spoken_text: "Thanks. That's efua at accrastack dot example. Is that right?" }) }).passed).toBe(true);
    const slots: ToolCallRecord = { id: "s", name: "find_callback_slots", input: {}, isError: false, result: { parsed: true, requested_available: true, requested_speakable: "Wednesday 30 September at 2 PM Lagos time" } };
    expect(gate({ callerTexts: ["Tomorrow at 2pm."], toolCalls: [slots], answer: answer({ answer_type: "collect_details", spoken_text: "I have Wednesday 30 September at 2 PM Lagos time. Is that okay?" }) }).passed).toBe(true);
  });

  it("asks a caller mid-collection to repeat, rather than starting over", () => {
    const verdict = gate({ answer: answer({ answer_type: "collect_details", spoken_text: "I'll write to efua@accrastack.example." }) });
    expect(verdict.fallback).toEqual({ text: SPOKEN.fallbackCollect, answerType: "collect_details" });
  });

  it("allows the read-back when speech split the caller's domain into words", () => {
    expect(gate({ callerTexts: ["my email is amara at lagos ledger dot example"], answer: answer({ answer_type: "collect_details", spoken_text: "Is that amara@lagosledger.example?" }) }).passed).toBe(true);
  });

  it("blocks a reference the caller did not say (its digits are unsupported numbers too)", () => {
    expect(failedGates(gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 is processing, and so is TXN-9003." }) }))).toEqual(["numbers", "references"]);
  });

  it("accepts a reference the caller gave only as digits", () => {
    expect(gate({ callerTexts: ["it's nine zero zero one"], toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 is an outgoing payout." }) }).passed).toBe(true);
  });

  it("blocks an amount for an unverified caller", () => {
    expect(failedGates(gate({ toolCalls: [TXN_9001], answer: answer({ spoken_text: "It's 2,400 US dollars." }) }))).toEqual(["numbers", "amounts"]);
  });

  it("allows the amount the lookup disclosed to the verified owner", () => {
    const verified: ToolCallRecord = { ...TXN_9001, result: { ...TXN_9001.result!, amount: "2400.00", currency: "USD", withheld: false, disclosure: "verified_owner" } };
    expect(gate({ toolCalls: [verified], answer: answer({ spoken_text: "It's 2400 USD." }) }).passed).toBe(true);
  });

  it("blocks six words from an internal note", () => {
    const customer: ToolCallRecord = { id: "c", name: "lookup_customer", input: {}, isError: false, result: { found: true, support_notes: "Account is under compliance review. Escalate account-specific questions." } };
    expect(failedGates(gate({ toolCalls: [customer], answer: answer({ spoken_text: "Your account is under compliance review, escalate account-specific questions." }) }))).toEqual(["internal_notes"]);
  });

  it("blocks account details after escalation", () => {
    expect(failedGates(gate({ escalated: true, toolCalls: [TXN_9001], answer: answer({ spoken_text: "TXN-9001 is processing." }) }))).toEqual(["after_escalation"]);
  });
});

describe("length", () => {
  it("trims an over-long answer mechanically and records it", () => {
    const long = Array.from({ length: 30 }, (_, index) => `This is sentence ${index === 0 ? "one" : "again"}.`).join(" ");
    const verdict = gate({ answer: answer({ answer_type: "decline", spoken_text: long }) });
    expect(verdict.passed).toBe(true);
    expect(verdict.text.length).toBeLessThanOrEqual(450);
    expect(verdict.results.find((result) => result.gate === "length")).toMatchObject({ cleanup: true });
  });
});
