import { SPOKEN } from "@/app/copy";
import { MAX_CLARIFY_STREAK, SPOKEN_TEXT_MAX_CHARS } from "@/lib/constants";
import { findReferences, normaliseEmail } from "@/lib/normalise";

import type { Answer, AnswerType } from "./answer";
import type { CodeSentences } from "./code-sentences";
import type { ToolCallRecord } from "./run-agent";
import { splitSentences, trimToLength } from "./speech";

// The checks that run on every answer before anything is spoken (DESIGN §6.3).
// Each reads the turn's own tool-call log (what the tools returned, from the
// SDK's stream), never the model's account of it. Pure functions: no I/O.
//
// Checks fail the answer (repair once, else a fixed fallback). Cleanups only
// ever remove sentences, so they cannot make an answer say more than the
// evidence; each is recorded with what it removed.

export type GateName =
  | "evidence"
  | "question"
  | "numbers"
  | "emails"
  | "references"
  | "amounts"
  | "internal_notes"
  | "after_escalation"
  | "clarify_streak"
  | "stale_summary"
  | "eta_by_code"
  | "booking_by_code"
  | "ticket_by_code"
  | "own_references"
  | "sensitive_terms"
  | "review_claim"
  | "goodbye_by_code"
  | "question_last"
  | "length";

export type GateResult = {
  gate: GateName;
  passed: boolean;
  detail?: string;
  cleanup?: boolean;
  /** On a failed check: the model's reply that was not spoken, so the console can show what was stopped. */
  rejected?: string;
};

export type GateInput = {
  answer: Answer;
  toolCalls: ToolCallRecord[];
  /** Every caller line in this conversation, this turn's included. */
  callerTexts: string[];
  escalated: boolean;
  clarifyStreak: number;
  /** What code will speak this turn, so the model's own version of it goes. */
  covers?: CodeSentences["covers"];
  /** The speakable callback times offered on this conversation: code wrote them, so repeating one is evidence-backed. */
  offeredSlots?: string[];
};

export type GateVerdict = {
  results: GateResult[];
  passed: boolean;
  /** For an answer: how it rests on the knowledge, as the evidence shows it, not as the model labelled it. */
  grounding: "direct" | "inferred" | null;
  /** The model's text after mechanical cleanups, when every check passed. */
  text: string;
  /** When a check failed: the fixed sentence to speak instead, and its answer type. */
  fallback: { text: string; answerType: AnswerType } | null;
};

const LOOKUP_TOOLS = new Set(["lookup_customer", "lookup_transaction", "lookup_payout"]);

function succeeded(call: ToolCallRecord): call is ToolCallRecord & { result: Record<string, unknown> } {
  return call.isError === false && call.result !== null;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

function ngrams(list: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index + size <= list.length; index += 1) grams.add(list.slice(index, index + size).join(" "));
  return grams;
}

function shareRun(text: string, source: string, size: number): boolean {
  const sourceGrams = ngrams(words(source), size);
  for (const gram of ngrams(words(text), size)) if (sourceGrams.has(gram)) return true;
  return false;
}

type SearchCall = ToolCallRecord & { result: Record<string, unknown> };

function chunkIds(call: SearchCall, key: "chunks" | "related"): (string | undefined)[] {
  return ((call.result[key] as { chunk_id?: string }[] | undefined) ?? []).map((chunk) => chunk.chunk_id);
}

/**
 * How an answer rests on the knowledge, decided from the evidence. A reply the
 * model called direct that cites a section which only came back as related
 * (under the threshold) is said as inferred, with the hedge, rather than
 * thrown away: Sonnet read "Cryptocurrency payments" in the related
 * limitations section, rightly called that direct, and the caller heard a
 * decline twice (eval, 2026-09-30). The search was not sure; the caller is told.
 */
export function effectiveGrounding(answer: Answer, toolCalls: ToolCallRecord[]): { grounding: "direct" | "inferred" | null; downgraded: boolean } {
  if (answer.answer_type !== "answer") return { grounding: null, downgraded: false };
  if (answer.grounding === "inferred") return { grounding: "inferred", downgraded: false };
  const searches = toolCalls.filter(succeeded).filter((call) => call.name === "search_knowledge_base");
  const found = new Set(searches.filter((call) => call.result.found === true).flatMap((call) => chunkIds(call, "chunks")));
  const related = new Set(searches.flatMap((call) => chunkIds(call, "related")));
  const cited = answer.kb_chunk_ids;
  const restsOnRelated = cited.length > 0 && cited.every((id) => found.has(id) || related.has(id)) && cited.some((id) => !found.has(id));
  return restsOnRelated ? { grounding: "inferred", downgraded: true } : { grounding: "direct", downgraded: false };
}

// --- checks --------------------------------------------------------------------------

function evidenceGate(input: GateInput): GateResult {
  const { answer, toolCalls, escalated } = input;
  const ok = (name: string) => toolCalls.filter(succeeded).filter((call) => call.name === name);
  switch (answer.answer_type) {
    case "answer": {
      // A direct answer rests on chunks a search found. An inferred one may also rest
      // on the loosely related chunks a search returned when nothing matched closely;
      // code then says the agent is not certain (DESIGN §8).
      const inferred = answer.grounding === "inferred";
      const searches = ok("search_knowledge_base").filter((call) => call.result.found === true || (inferred && chunkIds(call, "related").length > 0));
      if (!searches.length) return { gate: "evidence", passed: false, detail: inferred ? "inferred answer without any knowledge this turn to infer from" : "answer without a successful knowledge search this turn" };
      const returned = new Set(searches.flatMap((call) => [...chunkIds(call, "chunks"), ...(inferred ? chunkIds(call, "related") : [])]));
      const unknown = answer.kb_chunk_ids.filter((id) => !returned.has(id));
      if (!answer.kb_chunk_ids.length || unknown.length) return { gate: "evidence", passed: false, detail: `cited chunks not returned this turn: ${unknown.join(", ") || "none cited"}` };
      return { gate: "evidence", passed: true };
    }
    case "lookup_result":
      return toolCalls.some((call) => LOOKUP_TOOLS.has(call.name) && succeeded(call) && call.result.found === true)
        ? { gate: "evidence", passed: true }
        : { gate: "evidence", passed: false, detail: "lookup_result without a successful lookup this turn" };
    case "ticket_created":
      return ok("create_support_ticket").length || ok("create_escalation").length
        ? { gate: "evidence", passed: true }
        : { gate: "evidence", passed: false, detail: "ticket_created without create_support_ticket succeeding this turn" };
    case "escalate":
      return ok("create_escalation").length || escalated
        ? { gate: "evidence", passed: true }
        : { gate: "evidence", passed: false, detail: "escalate without create_escalation succeeding and without an escalated conversation" };
    default:
      return { gate: "evidence", passed: true };
  }
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  "twenty-one": 21, "twenty-two": 22, "twenty-three": 23, "twenty-four": 24, "twenty-five": 25, "twenty-six": 26, "twenty-seven": 27, "twenty-eight": 28, "twenty-nine": 29, thirty: 30,
};

// A number word counts only beside one of these or beside another number
// (agreed 2026-09-29, DESIGN §20): "one moment" and "one of our specialists"
// are not claims; "two business days" and "three percent" are.
const UNIT_WORDS = new Set([
  "day", "days", "business", "working", "calendar", "hour", "hours", "minute", "minutes", "week", "weeks", "month", "months", "year", "years",
  "percent", "per", "cent", "dollar", "dollars", "euro", "euros", "pound", "pounds", "naira", "cedi", "cedis", "shilling", "shillings", "rand", "franc", "francs",
  "usd", "eur", "gbp", "ngn", "kes", "ghs", "zar", "rwf", "am", "pm", "oclock", "times", "attempts", "transfers", "payments", "payouts",
]);
const JOINERS = new Set(["to", "and", "or", "of"]);

function numberTokens(text: string): string[] {
  // Digits spelled one by one ("9 0 0 1") are one number.
  const joined = text.replace(/\b\d(?: \d)+\b/g, (run) => run.replace(/ /g, ""));
  return joined.toLowerCase().replace(/o'clock/g, "oclock").match(/\d[\d,]*(?:\.\d+)?%?|[a-z]+(?:-[a-z]+)?/g) ?? [];
}

function normaliseNumber(token: string): string {
  const value = Number(token.replace(/[,%]/g, ""));
  return Number.isFinite(value) ? String(value) : token;
}

function isNumberToken(token: string | undefined): boolean {
  return token !== undefined && (/^\d/.test(token) || token in NUMBER_WORDS);
}

function numbersIn(texts: string[]): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    for (const token of numberTokens(text)) {
      if (/^\d/.test(token)) found.add(normaliseNumber(token));
      else if (token in NUMBER_WORDS) found.add(String(NUMBER_WORDS[token]));
    }
    // Numbers inside identifiers and dates: 2026-08-19 holds 2026, 8 and 19.
    for (const digits of text.match(/\d+/g) ?? []) found.add(normaliseNumber(digits));
  }
  return found;
}

function numbersGate(input: GateInput, evidence: string[]): GateResult {
  const allowed = numbersIn(evidence);
  const tokens = numberTokens(input.answer.spoken_text);
  const unsupported: string[] = [];
  tokens.forEach((token, index) => {
    if (/^\d/.test(token)) {
      if (!allowed.has(normaliseNumber(token))) unsupported.push(token);
      return;
    }
    if (!(token in NUMBER_WORDS)) return;
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    const claim =
      UNIT_WORDS.has(before ?? "") ||
      UNIT_WORDS.has(after ?? "") ||
      isNumberToken(before) ||
      isNumberToken(after) ||
      (JOINERS.has(after ?? "") && isNumberToken(tokens[index + 2])) ||
      (JOINERS.has(before ?? "") && isNumberToken(tokens[index - 2]));
    if (claim && !allowed.has(String(NUMBER_WORDS[token]))) unsupported.push(token);
  });
  return unsupported.length ? { gate: "numbers", passed: false, detail: `numbers not in this turn's evidence: ${unsupported.join(", ")}` } : { gate: "numbers", passed: true };
}

// An email written out, or spoken ("amara at lagos ledger dot example", where
// speech splits the domain), read through the same normaliser the tools use.
// Domain parts join only on the spoken word "dot" or a written "." with no
// space around it. With a looser pattern, "efua at accrastack dot example. Is
// that right?" read as efua@accrastack.example.is, and "2 PM Lagos time. Is
// that okay?" as an email, which blocked a correct read-back (eval, 2026-09-29).
const SPOKEN_EMAIL = /[a-z0-9._%+-]+\s+(?:at|@)\s+[a-z0-9-]+(?:\s+[a-z0-9-]+){0,3}?(?:\s+dot\s+[a-z0-9-]+|\.[a-z0-9-]+)+/gi;

function emailsIn(text: string): string[] {
  const written = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  const spoken = text.match(SPOKEN_EMAIL) ?? [];
  return [...written, ...spoken].map((candidate) => normaliseEmail(candidate)).filter((email): email is string => email !== null);
}

function emailsGate(input: GateInput): GateResult {
  const said = new Set(input.callerTexts.flatMap((text) => emailsIn(text)));
  const spoken = emailsIn(input.answer.spoken_text).filter((email) => !said.has(email));
  return spoken.length ? { gate: "emails", passed: false, detail: `email the caller did not say: ${spoken.join(", ")}` } : { gate: "emails", passed: true };
}

function referencesGate(input: GateInput): GateResult {
  const said = new Set(input.callerTexts.flatMap((text) => findReferences(text, { bareAsTransaction: true })));
  const spoken = findReferences(input.answer.spoken_text).filter((reference) => !said.has(reference));
  return spoken.length ? { gate: "references", passed: false, detail: `reference the caller did not say: ${spoken.join(", ")}` } : { gate: "references", passed: true };
}

// "2,400 US dollars" is the form toSpeech itself produces, so the nationality
// word between the number and the currency must not hide it (a test caught that).
const AMOUNT =
  /(?:[$£€₦]\s?\d)|(?:\d[\d,]*(?:\.\d+)?\s*(?:(?:us|u\.s\.|british|kenyan|ghanaian|rwandan|south african|nigerian)\s+)?(?:usd|eur|gbp|ngn|kes|ghs|zar|rwf|dollars?|euros?|pounds?|naira|cedis?|shillings?|rand|francs?)\b)|(?:\b(?:usd|eur|gbp|ngn|kes|ghs|zar|rwf)\s?\d)/i;

function amountsGate(input: GateInput): GateResult {
  if (!AMOUNT.test(input.answer.spoken_text)) return { gate: "amounts", passed: true };
  const disclosed = input.toolCalls.some((call) => succeeded(call) && call.result.withheld === false && call.result.amount !== null && call.result.amount !== undefined);
  return disclosed ? { gate: "amounts", passed: true } : { gate: "amounts", passed: false, detail: "an amount was spoken but no lookup this turn disclosed one to a verified owner" };
}

function internalNotesGate(input: GateInput): GateResult {
  const notes: string[] = [];
  for (const call of input.toolCalls) {
    const result = call.result;
    if (!result) continue;
    if (typeof result.support_notes === "string") notes.push(result.support_notes);
    const doNotSpeak = Array.isArray(result.do_not_speak) ? result.do_not_speak : [];
    for (const key of doNotSpeak) if (typeof key === "string" && typeof result[key] === "string") notes.push(result[key] as string);
  }
  return notes.some((note) => shareRun(input.answer.spoken_text, note, 6))
    ? { gate: "internal_notes", passed: false, detail: "six or more words match an internal field returned this turn" }
    : { gate: "internal_notes", passed: true };
}

// --- cleanups: they only remove -----------------------------------------------------

type Cleanup = { gate: GateName; applies: boolean; drop: (sentence: string) => boolean; why: string };

const ETA_TALK = /\b(estimat\w*|arriv\w*|eta|passed|overdue|late|due|scheduled)\b/i;
const BOOKING_TALK = /\b(book(?:ed|ing)?|call you|calling you|confirmation|email you|appointment)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;
const TICKET_TALK = /\b(ticket|reference)\b/i;
const OWN_REFERENCE = /\b[TE][-\s]?\d{4,}\b/;
const REVIEW_TALK = /\b(review\w*|specialist\w*|escalat\w*)\b/i;
// An offer of a specialist is what the prompt asks for on a decline; a claim
// that something needs or is under review is what the record must back.
const OFFER = /\b(i can|i could|i'd be happy to|would you like|do you want|shall i|if you(?:'d| would)? like|if you want)\b/i;
const REVIEW_CLAIM = /\b(needs?|needed|requires?|required|under|being|been|will be|is with)\b[^.?!]*\b(review\w*|escalat\w*)\b|\b(review\w*|escalat\w*)\b[^.?!]*\b(needed|required|pending|underway|in progress)\b/i;
// A question that only points back at the sentence before it ("Would you like
// that?") means nothing once that sentence is gone (the Bitcoin eval, 2026-09-29).
const BACK_REFERENCE = /^(would you like (that|this|me to(?: do that| arrange that)?)|shall i( do that| arrange that| set that up)?|do you want (that|this|me to(?: do that)?)|should i( do that)?|is that (okay|ok|all right|alright)|does that (work|sound good))\s*\??$/i;
const REMOVED_SENTENCE_MAX_CHARS = 200;
// A closing reply ends with the fixed goodbye code adds; the model's own sign-off would say it twice.
const GOODBYE_TALK = /\b(?:thanks|thank you) for (?:calling|contacting|reaching out|getting in touch|choosing)\b|\bgoodbye\b|\bhave a (?:great|good|nice|lovely) (?:day|evening|afternoon|morning|week)\b|\btake care\b/i;

function cleanups(input: GateInput): Cleanup[] {
  const covers = input.covers ?? { eta: false, ticket: false, booking: false };
  const stale = input.toolCalls
    .filter(succeeded)
    .filter((call) => call.result.summary_outdated === true && typeof call.result.support_summary === "string")
    .map((call) => call.result.support_summary as string);
  const sensitive = [...new Set(input.toolCalls.filter(succeeded).flatMap((call) => (Array.isArray(call.result.sensitive_terms) ? (call.result.sensitive_terms as string[]) : [])))];
  const escalationPath = ["escalate", "collect_details"].includes(input.answer.answer_type);
  const declining = input.answer.answer_type === "decline";
  const kbSaysReview = input.toolCalls.some((call) => call.name === "search_knowledge_base" && succeeded(call) && REVIEW_TALK.test(JSON.stringify(call.result.chunks ?? [])));
  const reviewBacked = input.escalated || escalationPath || kbSaysReview || input.toolCalls.some((call) => succeeded(call) && (call.result.requires_escalation === true || call.result.routing === "escalate_account_questions"));

  return [
    // TXN-9001's CSV summary says "within the normal expected window" about a payment 41 days late (Phase 0, 3 of 3 runs).
    { gate: "stale_summary", applies: stale.length > 0, drop: (sentence) => stale.some((summary) => shareRun(sentence, summary, 4)), why: "repeating an outdated summary" },
    // Code owns dates computed from other dates (rule 5); Phase 0 heard the model repeat the passed estimate.
    { gate: "eta_by_code", applies: covers.eta, drop: (sentence) => ETA_TALK.test(sentence), why: "about the estimate, which code speaks" },
    { gate: "booking_by_code", applies: covers.booking, drop: (sentence) => BOOKING_TALK.test(sentence), why: "about the booking, which code speaks" },
    { gate: "ticket_by_code", applies: covers.ticket, drop: (sentence) => TICKET_TALK.test(sentence), why: "about the ticket, which code speaks" },
    // Our own ticket and escalation refs are added by code, never by the model (DESIGN §6.3).
    { gate: "own_references", applies: true, drop: (sentence) => OWN_REFERENCE.test(sentence), why: "stating a ticket or escalation reference" },
    // A record under compliance review is routed, never explained (DESIGN §7.3).
    { gate: "sensitive_terms", applies: sensitive.length > 0, drop: (sentence) => sensitive.some((term) => sentence.toLowerCase().includes(term.toLowerCase())), why: "using a term the record says not to explain" },
    // A claim with no number in it, which the number gate cannot see (DESIGN §19); Haiku made it three times in Phase 0.
    {
      gate: "review_claim",
      applies: !reviewBacked,
      // A question is not a claim either ("...or are you telling me when you'd like a
      // specialist to call?"): removing it once left a reply with nothing in it.
      drop: (sentence) => REVIEW_TALK.test(sentence) && !((sentence.trim().endsWith("?") || (declining && OFFER.test(sentence))) && !REVIEW_CLAIM.test(sentence)),
      why: "claiming a review the record does not show",
    },
    // "You're welcome. Thanks for contacting RelayPay." then code's goodbye: said twice (typed test, 2026-09-30).
    { gate: "goodbye_by_code", applies: input.answer.answer_type === "closing", drop: (sentence) => GOODBYE_TALK.test(sentence), why: "saying the goodbye, which code says" },
  ];
}

/** Which sentences a cleanup removes: its own, plus a bare question pointing back at one of them. */
function dropped(sentences: string[], drop: (sentence: string) => boolean): Set<number> {
  const indexes = new Set<number>();
  sentences.forEach((sentence, index) => {
    if (drop(sentence)) indexes.add(index);
    else if (indexes.has(index - 1) && BACK_REFERENCE.test(sentence.trim())) indexes.add(index);
  });
  return indexes;
}

function quoteRemoved(sentences: string[]): string {
  return sentences.map((sentence) => `"${sentence.length > REMOVED_SENTENCE_MAX_CHARS ? `${sentence.slice(0, REMOVED_SENTENCE_MAX_CHARS)}...` : sentence}"`).join(" ");
}

function fallbackFor(answer: Answer, failed: GateResult[]): { text: string; answerType: AnswerType } {
  // Mid-collection, a fallback asks for the last thing again rather than
  // restarting: asking for the caller's name after they gave it made the
  // eval's escalation loop without ever escalating.
  if (answer.answer_type === "collect_details") return { text: SPOKEN.fallbackCollect, answerType: "collect_details" };
  // A clarifying question that failed a check is replaced by the generic one, not
  // a decline: Sonnet's "for example TXN-9001" failed the reference check, the
  // decline reset the streak, and the clarify cap never applied (eval, 2026-09-29).
  if (answer.answer_type === "clarify" && !failed.some((result) => result.gate === "clarify_streak")) return { text: SPOKEN.fallbackClarify, answerType: "clarify" };
  if (answer.answer_type === "lookup_result" && failed.some((result) => result.gate === "evidence")) return { text: SPOKEN.fallbackLookup, answerType: "clarify" };
  if (answer.answer_type === "escalate" || answer.needs_human) return { text: SPOKEN.fallbackEscalate, answerType: "collect_details" };
  return { text: SPOKEN.fallbackDecline, answerType: "decline" };
}

export function runGates(given: GateInput): GateVerdict {
  const { grounding, downgraded } = effectiveGrounding(given.answer, given.toolCalls);
  const input: GateInput = grounding ? { ...given, answer: { ...given.answer, grounding } } : given;
  const evidenceTexts = [...input.toolCalls.filter((call) => call.result).map((call) => JSON.stringify(call.result)), ...input.callerTexts, ...(input.offeredSlots ?? [])];
  const { answer } = input;
  const asksQuestion = answer.answer_type === "clarify" || answer.answer_type === "collect_details";
  const evidence = evidenceGate(input);

  const results: GateResult[] = [
    downgraded && evidence.passed ? { ...evidence, detail: "called direct, but a cited section came back only as related, so it is said as inferred, with the hedge" } : evidence,
    // A question anywhere will do: code moves it to the end below. Sonnet kept adding
    // "Please include your time zone." after its question, and rejecting that cost a
    // repair and then a fallback (typed test, 2026-09-30).
    asksQuestion && !splitSentences(answer.spoken_text.trim()).some((sentence) => sentence.endsWith("?"))
      ? { gate: "question", passed: false, detail: `${answer.answer_type} asks no question` }
      : { gate: "question", passed: true },
    numbersGate(input, evidenceTexts),
    emailsGate(input),
    referencesGate(input),
    amountsGate(input),
    internalNotesGate(input),
    input.escalated && input.toolCalls.some((call) => LOOKUP_TOOLS.has(call.name) && succeeded(call) && call.result.found === true)
      ? { gate: "after_escalation", passed: false, detail: "account details looked up after escalation" }
      : { gate: "after_escalation", passed: true },
    answer.answer_type === "clarify" && input.clarifyStreak >= MAX_CLARIFY_STREAK
      ? { gate: "clarify_streak", passed: false, detail: `a clarifying question after ${input.clarifyStreak} in a row` }
      : { gate: "clarify_streak", passed: true },
  ];

  const failed = results.filter((result) => !result.passed);
  if (failed.length) return { results, passed: false, grounding, text: "", fallback: fallbackFor(answer, failed) };

  let sentences = splitSentences(answer.spoken_text.trim());
  for (const cleanup of cleanups(input)) {
    if (!cleanup.applies) {
      results.push({ gate: cleanup.gate, passed: true });
      continue;
    }
    const drops = dropped(sentences, cleanup.drop);
    const removed = sentences.filter((_, index) => drops.has(index));
    results.push(
      removed.length
        ? { gate: cleanup.gate, passed: true, cleanup: true, detail: `removed ${removed.length} sentence(s) ${cleanup.why}: ${quoteRemoved(removed)}` }
        : { gate: cleanup.gate, passed: true },
    );
    sentences = sentences.filter((_, index) => !drops.has(index));
  }

  // The caller hears the question last, so they know it is their turn. It is
  // moved, never reworded, and it survives trimming: the rest is cut instead.
  let question: string | null = null;
  if (asksQuestion) {
    const index = sentences.map((sentence) => sentence.endsWith("?")).lastIndexOf(true);
    if (index < 0) {
      const lost: GateResult = { gate: "question", passed: false, detail: `the checks removed the only question from ${answer.answer_type}` };
      return { results: [...results, lost], passed: false, grounding, text: "", fallback: fallbackFor(answer, [lost]) };
    }
    question = sentences[index]!;
    if (index < sentences.length - 1) results.push({ gate: "question_last", passed: true, cleanup: true, detail: `moved the question to the end: "${question}"` });
    sentences = sentences.filter((_, position) => position !== index);
  }
  const room = question && question.length < SPOKEN_TEXT_MAX_CHARS / 2 ? SPOKEN_TEXT_MAX_CHARS - question.length - 1 : SPOKEN_TEXT_MAX_CHARS;
  const trimmed = trimToLength(sentences.join(" "), room);
  const text = [trimmed.text, question].filter(Boolean).join(" ");
  results.push(trimmed.trimmed ? { gate: "length", passed: true, cleanup: true, detail: `trimmed to ${text.length} characters` } : { gate: "length", passed: true });
  return { results, passed: true, grounding, text, fallback: null };
}
