import { VERIFY_MAX_FAILURES } from "@/lib/constants";

import type { ConversationState, ToolOutcome } from "../types";

export function invalid(message: string, summary: string, extra: Record<string, unknown> = {}): ToolOutcome {
  return { status: "invalid_input", isError: true, payload: { ok: false, error_code: "invalid_input", message, ...extra }, summary };
}

export function refused(reason: string, message: string, summary: string, extra: Record<string, unknown> = {}): ToolOutcome {
  return { status: "refused", isError: true, payload: { found: false, reason, message, ...extra }, summary };
}

/**
 * The escalation rules say the agent stops trying to solve the issue once it
 * has escalated. Enforced in the server, not requested in the prompt (rule 15).
 */
export function refusedAfterEscalation(what: string): ToolOutcome {
  return refused(
    "escalated",
    "This case is already with a specialist, so lookups are closed for this call. Tell the caller their specialist will cover it on the call.",
    `refused ${what}: conversation already escalated`,
  );
}

/** Identity checks failed VERIFY_MAX_FAILURES times this conversation: guessing stops here. */
export function verificationLocked(state: ConversationState | null): boolean {
  return (state?.verificationFailures ?? 0) >= VERIFY_MAX_FAILURES;
}

export function refusedLocked(what: string): ToolOutcome {
  return refused(
    "verification_locked",
    "The caller's identity could not be verified after several attempts, so lookups are closed for this conversation. Do not ask for more details. Say you can't verify the account on this call and offer a specialist.",
    `refused ${what}: verification locked after ${VERIFY_MAX_FAILURES} failed attempts`,
  );
}

/**
 * Verify before any lookup (DESIGN §7.2, changed 2026-10-02 at Akin's request):
 * an unverified caller learns nothing about a reference, not even whether it
 * exists, so a guessed TXN-9002 tells a stranger nothing. Null means go ahead.
 */
export function verifyFirst(state: ConversationState | null, what: string): ToolOutcome | null {
  if (verificationLocked(state)) return refusedLocked(what);
  if (state?.verifiedCustomerId) return null;
  return refused(
    "verify_first",
    "Records are only shared with a verified caller. Before looking this up, ask for any two of: their first name, their company name, the account email. Call lookup_customer with them, then look the reference up again. Do not say whether the reference exists.",
    `refused ${what}: caller not verified`,
    { ask_for: ["contact_name", "company_name", "email"] },
  );
}

/**
 * A verified caller asking about a reference that is not theirs, or that does
 * not exist, gets the same answer, so references cannot be probed. The log
 * keeps which it was.
 */
export function notOnAccount(reference: string, why: "missing" | "not_owned"): ToolOutcome {
  return {
    status: why === "missing" ? "not_found" : "refused",
    isError: false,
    payload: {
      found: false,
      reason: "not_on_your_account",
      normalised_id: reference,
      message: `${reference} is not on the caller's account. Read the reference back, say you can't find it on their account, and ask them to check it. Do not say whether it exists.`,
    },
    summary: why === "missing" ? `not_found ${reference}` : `refused ${reference}: not on the verified caller's account`,
  };
}

// A record under compliance review is routed, never explained (DESIGN §7.3).
// Tools name the words a reply must not use; the gates remove sentences that do.
export const COMPLIANCE_TERMS = ["compliance"];

export function mentionsCompliance(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => typeof value === "string" && /complian/i.test(value));
}
