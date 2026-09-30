import { SPOKEN } from "@/app/copy";
import { DAILY_AGENT_BUDGET_USD, MAX_TURNS_PER_CALL, MAX_USER_CHARS, QUICK_GOODBYE_MAX_WORDS } from "@/lib/constants";

// Checks that need no model (DESIGN §5 step 4). A model call to notice that
// the caller said nothing is money spent on nothing, and on a call it is also
// seconds of silence.

export type CheapCheck =
  | { action: "reply"; text: string; reason: "empty" | "max_turns" | "budget" | "goodbye"; answerType: "clarify" | "closing" | "decline" }
  | { action: "run"; userText: string; truncated: boolean };

const FILLER_ONLY = /^(?:(?:u+h+|u+m+|h+m+|e+r+|a+h+|m+|e+h+|o+h+)[\s.,!?]*)+$/i;

// A caller who is plainly done. Anything that could be another request
// (a question, "but", "also", "can you") goes to the model instead.
const DONE = /\b(?:good ?bye|bye|that'?s all|that is all|that'?ll be all|that will be all|nothing else|that'?s everything|no more questions|have a (?:good|great|nice|lovely) (?:day|one|evening|night))\b/i;
const NOT_DONE = /\?|\b(?:but|also|another|one more|actually|wait|however|except|what about|how about|can you|could you|i need|i want|please check)\b/i;

/** The caller is saying goodbye, and nothing in the turn asks for more. */
export function isPlainGoodbye(text: string, lastAnswerType: string | null): boolean {
  // Mid-way through taking callback details, "that's all" may answer a question; the agent decides.
  if (lastAnswerType === "collect_details") return false;
  if (text.split(/\s+/).filter(Boolean).length > QUICK_GOODBYE_MAX_WORDS) return false;
  return DONE.test(text) && !NOT_DONE.test(text);
}

export function checkBeforeModel(input: { userText: string; turnIndex: number; spentTodayUsd: number; lastAnswerType?: string | null }): CheapCheck {
  const text = input.userText.trim();
  if (text === "" || FILLER_ONLY.test(text)) return { action: "reply", text: SPOKEN.didNotCatch, reason: "empty", answerType: "clarify" };
  if (input.turnIndex >= MAX_TURNS_PER_CALL) return { action: "reply", text: SPOKEN.tooManyTurns, reason: "max_turns", answerType: "closing" };
  // Said at once, with the fixed goodbye that ends the call (DESIGN §5 step 4).
  if (input.turnIndex > 0 && isPlainGoodbye(text, input.lastAnswerType ?? null)) return { action: "reply", text: `${SPOKEN.quickGoodbye} ${SPOKEN.goodbye}`, reason: "goodbye", answerType: "closing" };
  if (input.spentTodayUsd >= DAILY_AGENT_BUDGET_USD) return { action: "reply", text: SPOKEN.busy, reason: "budget", answerType: "decline" };
  // The caller's latest words matter most, so the tail is kept.
  if (text.length > MAX_USER_CHARS) return { action: "run", userText: text.slice(-MAX_USER_CHARS), truncated: true };
  return { action: "run", userText: text, truncated: false };
}
