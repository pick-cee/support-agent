import { SPOKEN } from "@/app/copy";
import { DAILY_AGENT_BUDGET_USD, MAX_TURNS_PER_CALL, MAX_USER_CHARS } from "@/lib/constants";

// Checks that need no model (DESIGN §5 step 4). A model call to notice that
// the caller said nothing is money spent on nothing.

export type CheapCheck =
  | { action: "reply"; text: string; reason: "empty" | "max_turns" | "budget"; answerType: "clarify" | "closing" | "decline" }
  | { action: "run"; userText: string; truncated: boolean };

const FILLER_ONLY = /^(?:(?:u+h+|u+m+|h+m+|e+r+|a+h+|m+|e+h+|o+h+)[\s.,!?]*)+$/i;

export function checkBeforeModel(input: { userText: string; turnIndex: number; spentTodayUsd: number }): CheapCheck {
  const text = input.userText.trim();
  if (text === "" || FILLER_ONLY.test(text)) return { action: "reply", text: SPOKEN.didNotCatch, reason: "empty", answerType: "clarify" };
  if (input.turnIndex >= MAX_TURNS_PER_CALL) return { action: "reply", text: SPOKEN.tooManyTurns, reason: "max_turns", answerType: "closing" };
  if (input.spentTodayUsd >= DAILY_AGENT_BUDGET_USD) return { action: "reply", text: SPOKEN.busy, reason: "budget", answerType: "decline" };
  // The caller's latest words matter most, so the tail is kept.
  if (text.length > MAX_USER_CHARS) return { action: "run", userText: text.slice(-MAX_USER_CHARS), truncated: true };
  return { action: "run", userText: text, truncated: false };
}
