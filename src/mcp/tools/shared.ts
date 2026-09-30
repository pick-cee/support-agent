import type { ToolOutcome } from "../types";

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

// A record under compliance review is routed, never explained (DESIGN §7.3).
// Tools name the words a reply must not use; the gates remove sentences that do.
export const COMPLIANCE_TERMS = ["compliance"];

export function mentionsCompliance(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => typeof value === "string" && /complian/i.test(value));
}
