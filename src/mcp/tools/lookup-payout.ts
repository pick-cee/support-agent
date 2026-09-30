import * as z from "zod";

import { normaliseReference } from "@/lib/normalise";
import { dateInZone, daysBetween } from "@/lib/time";

import { lenientInput } from "../lenient-input";
import type { PayoutRecord, ToolDefinition } from "../types";
import { COMPLIANCE_TERMS, invalid, mentionsCompliance, refused, refusedAfterEscalation } from "./shared";

const ASK = "Ask the caller for the payout reference, which starts with P A Y, or the transaction reference, which starts with T X N.";

/**
 * payouts.csv has no summary column, so code writes one from the status and
 * the failure reason, and never names compliance (DESIGN §7.3, agreed
 * 2026-09-29). The linked transaction's summary was rejected: TXN-9003's is
 * part staff instruction and names compliance.
 */
export function payoutSummary(payout: PayoutRecord): string {
  const compliance = mentionsCompliance(payout.failure_reason);
  switch (payout.status) {
    case "scheduled":
      return "This payout is scheduled.";
    case "processing":
      return "This payout is processing.";
    case "completed":
      return "This payout has completed.";
    case "failed":
      return compliance || !payout.failure_reason ? "This payout failed and needs review by a specialist." : `This payout failed because ${payout.failure_reason}.`;
    case "review required":
      return "This payout needs review by a specialist.";
    default:
      return "This payout's status needs checking by a specialist.";
  }
}

export const lookupPayout: ToolDefinition<{ payout_id?: string; transaction_id?: string | number }> = {
  name: "lookup_payout",
  title: "Look up a payout",
  description:
    "Look up a contractor or vendor payout by its payout reference (for example PAY-7002) or by the transaction it belongs to. " +
    "Returns status, scheduled date, a customer-safe failure reason and summary. Amount, currency and recipient are withheld unless the caller is the verified owner. " +
    "requires_escalation true means a specialist must handle it: say it needs review by a specialist and offer that, never explaining why.",
  wireInput: lenientInput({
    payout_id: { type: "string", description: "The payout reference the caller gave, for example PAY-7002." },
    transaction_id: { type: "string", description: "The transaction reference, when the caller gave that instead." },
  }),
  strictInput: z
    .object({ payout_id: z.string().trim().min(1).optional(), transaction_id: z.union([z.string().trim().min(1), z.number().int().nonnegative()]).optional() })
    .refine((value) => value.payout_id !== undefined || value.transaction_id !== undefined),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  purpose: (raw) => {
    const payout = normaliseReference(raw.payout_id, "PAY");
    const transaction = normaliseReference(raw.transaction_id, "TXN");
    if (payout.ok) return `Look up payout ${payout.id} for the caller.`;
    if (transaction.ok) return `Look up the payout for transaction ${transaction.id}.`;
    return "Look up a payout for the caller (no usable reference given).";
  },

  invalidInput: () => invalid(`Neither payout_id nor transaction_id was given. ${ASK}`, "invalid_input: no reference"),

  async run({ input, context, state, repository }) {
    const payoutRef = input.payout_id === undefined ? null : normaliseReference(input.payout_id, "PAY");
    const transactionRef = input.transaction_id === undefined ? null : normaliseReference(input.transaction_id, "TXN");
    const byPayout = payoutRef?.ok ? payoutRef.id : null;
    const byTransaction = transactionRef?.ok ? transactionRef.id : null;
    if (!byPayout && !byTransaction) {
      return payoutRef && !payoutRef.ok && payoutRef.reason === "wrong_kind" && payoutRef.kind === "TXN"
        ? invalid("That is a transaction reference. Pass it as transaction_id instead.", "invalid_input: TXN reference in payout_id")
        : invalid(`No payout or transaction reference could be read. ${ASK}`, "invalid_input: no usable reference");
    }

    const searched = byPayout ?? byTransaction!;
    if (state?.escalated) return refusedAfterEscalation(searched);

    const payout = byPayout ? await repository.findPayout(byPayout) : await repository.findPayoutByTransaction(byTransaction!);
    if (!payout) {
      return {
        status: "not_found",
        isError: false,
        payload: { found: false, reason: "not_found", normalised_id: searched, message: `There is no payout for ${searched} on record. Read the reference back to the caller and ask them to check it.` },
        summary: `not_found ${searched}`,
      };
    }

    if (state?.verifiedCustomerId && state.verifiedCustomerId !== payout.customer_id) {
      return refused(
        "not_on_your_account",
        "That reference is not on the verified caller's account. Say you can't find it on their account. Do not say whether it exists.",
        `refused ${searched}: not on the verified caller's account`,
      );
    }

    const disclosed = state?.verifiedCustomerId === payout.customer_id;
    const today = dateInZone(context.clock());
    const etaPassed = payout.status !== "completed" && payout.status !== "failed" && daysBetween(payout.scheduled_for, today) > 0;
    const compliance = mentionsCompliance(payout.failure_reason);
    const requiresEscalation = payout.status === "review required" || compliance;

    const payload = {
      found: true,
      payout_id: payout.payout_id,
      transaction_id: payout.transaction_id,
      status: payout.status,
      scheduled_for: payout.scheduled_for,
      // Customer-safe per the schema guide, except that a compliance reason is routed, never explained.
      failure_reason: payout.failure_reason,
      support_summary: payoutSummary(payout),
      recipient_name: disclosed ? payout.recipient_name : null,
      amount: disclosed ? payout.amount : null,
      currency: disclosed ? payout.currency : null,
      eta_passed: etaPassed,
      days_since_scheduled: etaPassed ? daysBetween(payout.scheduled_for, today) : null,
      checked_on: today,
      disclosure: disclosed ? "verified_owner" : "unverified",
      withheld: !disclosed,
      requires_escalation: requiresEscalation,
      do_not_speak: compliance ? ["failure_reason"] : [],
      sensitive_terms: requiresEscalation ? COMPLIANCE_TERMS : [],
    };
    return { status: "ok", isError: false, payload, summary: `found ${payout.payout_id}: ${payout.status}${requiresEscalation ? ", requires escalation" : ""}, ${payload.disclosure}` };
  },
};
