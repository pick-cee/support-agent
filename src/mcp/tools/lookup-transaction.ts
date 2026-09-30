import * as z from "zod";

import { normaliseReference } from "@/lib/normalise";
import { dateInZone, daysBetween } from "@/lib/time";

import { lenientInput } from "../lenient-input";
import type { ToolDefinition } from "../types";
import { COMPLIANCE_TERMS, invalid, mentionsCompliance, refused, refusedAfterEscalation } from "./shared";

// Statuses where the money has not landed yet, so a date in the past is a
// problem to raise, not a promise to repeat (DESIGN §2.6).
const UNFINISHED = new Set(["processing", "delayed", "review required"]);

const ASK_FOR_REFERENCE = "Ask the caller for the transaction reference, which starts with T X N.";

export const lookupTransaction: ToolDefinition<{ transaction_id: string | number }> = {
  name: "lookup_transaction",
  title: "Look up a transaction",
  description:
    "Look up one transaction by its reference (for example TXN-9001) when the caller asks about a specific transaction. " +
    "Returns its status, type, estimated arrival and a customer-safe summary. Amount, currency and customer are withheld unless the caller is the verified owner. " +
    "eta_passed true means the estimated arrival date is in the past and the money has not landed; summary_outdated true means the summary predates that and must not be repeated. " +
    "requires_escalation true means a specialist must handle it: say it needs review by a specialist and offer that, without explaining why.",
  wireInput: lenientInput({
    transaction_id: { type: "string", required: true, description: "The reference the caller gave, as they said it, for example TXN-9001 or 'T X N nine zero zero one'." },
  }),
  strictInput: z.object({ transaction_id: z.union([z.string().trim().min(1), z.number().int().nonnegative()]) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  purpose: (raw) => {
    const reference = normaliseReference(raw.transaction_id, "TXN");
    return reference.ok ? `Look up transaction ${reference.id} for the caller.` : "Look up a transaction for the caller (no usable reference given).";
  },

  invalidInput: () => invalid(`transaction_id is missing. ${ASK_FOR_REFERENCE}`, "invalid_input: transaction_id missing"),

  async run({ input, context, state, repository }) {
    const reference = normaliseReference(input.transaction_id, "TXN");
    if (!reference.ok) {
      return reference.reason === "wrong_kind"
        ? invalid(`That is a ${reference.kind} reference, not a transaction. ${reference.kind === "PAY" ? "Use lookup_payout for it." : ASK_FOR_REFERENCE}`, `invalid_input: ${reference.kind} reference given`)
        : invalid(`transaction_id did not contain a reference. ${ASK_FOR_REFERENCE}`, "invalid_input: no reference in transaction_id");
    }
    if (state?.escalated) return refusedAfterEscalation(reference.id);

    const row = await repository.findTransaction(reference.id);
    if (!row) {
      return {
        status: "not_found",
        isError: false,
        payload: {
          found: false,
          reason: "not_found",
          normalised_id: reference.id,
          message: `There is no transaction ${reference.id} on record. Read the reference back to the caller and ask them to check it.`,
        },
        summary: `not_found ${reference.id}`,
      };
    }

    // A verified caller asking about someone else's reference learns nothing
    // about whether it exists.
    if (state?.verifiedCustomerId && state.verifiedCustomerId !== row.customer_id) {
      return refused(
        "not_on_your_account",
        "That reference is not on the verified caller's account. Say you can't find it on their account. Do not say whether it exists.",
        `refused ${reference.id}: not on the verified caller's account`,
      );
    }

    const disclosed = state?.verifiedCustomerId === row.customer_id;
    const today = dateInZone(context.clock());
    const etaKnown = row.estimated_arrival !== null;
    const etaPassed = etaKnown && UNFINISHED.has(row.status) && daysBetween(row.estimated_arrival!, today) > 0;
    const compliance = row.status === "review required" || mentionsCompliance(row.support_summary);

    const payload = {
      found: true,
      transaction_id: row.transaction_id,
      customer_id: disclosed ? row.customer_id : null,
      type: row.transaction_type,
      status: row.status,
      amount: disclosed ? row.amount : null,
      currency: disclosed ? row.currency : null,
      estimated_arrival: row.estimated_arrival,
      support_summary: row.support_summary,
      // The summary was written when the record was; once the estimate has
      // passed it can say "within the normal expected window" about a payment
      // 41 days late. Phase 0 heard the agent repeat exactly that.
      summary_outdated: etaPassed,
      eta_known: etaKnown,
      eta_passed: etaPassed,
      days_since_eta: etaPassed ? daysBetween(row.estimated_arrival!, today) : null,
      checked_on: today,
      disclosure: disclosed ? "verified_owner" : "unverified",
      withheld: !disclosed,
      requires_escalation: row.status === "review required",
      do_not_speak: ["customer_id", ...(compliance ? ["support_summary"] : [])],
      sensitive_terms: compliance ? COMPLIANCE_TERMS : [],
    };

    const eta = !etaKnown ? "no eta on record" : etaPassed ? `eta ${row.estimated_arrival} passed ${payload.days_since_eta} days ago` : `eta ${row.estimated_arrival}`;
    return { status: "ok", isError: false, payload, summary: `found ${row.transaction_id}: ${row.status}, ${eta}, ${payload.disclosure}` };
  },
};
