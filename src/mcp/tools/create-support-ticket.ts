import { createHash } from "node:crypto";

import * as z from "zod";

import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/lib/constants";
import { isDeliverableEmail, normaliseEmail, normaliseReference } from "@/lib/normalise";
import { dateInZone, daysBetween } from "@/lib/time";

import { lenientInput } from "../lenient-input";
import type { ConversationState, Repository, ToolDefinition } from "../types";
import { invalid } from "./shared";

type Input = {
  customer_id?: string;
  category: string;
  priority?: string;
  summary: string;
  conversation_id?: string;
  transaction_id?: string;
  payout_id?: string;
  contact_email?: string;
  use_email_on_file?: boolean;
};

const RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function idempotencyKey(parts: (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");
}

export type LinkedRecords = { transactionId: string | null; payoutId: string | null; reportedReference: string | null; priorityFloor: "normal" | "high"; floorReason: string | null };

/**
 * Links the references the caller gave to real records, and works out the
 * priority floor from them: a failed or review-required record, or a passed
 * estimate, is at least high (DESIGN §7.3). Only the verified owner's records
 * are linked: the floor's reason names a record's status, and an unverified
 * caller learns nothing about a record (DESIGN §7.2). Anything else is kept as
 * reported text, never linked, for the team to look up.
 */
export async function linkRecords(repository: Repository, raw: { transaction_id?: string; payout_id?: string }, state: ConversationState | null, now: Date): Promise<LinkedRecords> {
  const linked: LinkedRecords = { transactionId: null, payoutId: null, reportedReference: null, priorityFloor: "normal", floorReason: null };
  const reported: string[] = [];
  const raise = (reason: string) => {
    linked.priorityFloor = "high";
    linked.floorReason ??= reason;
  };

  if (raw.transaction_id) {
    const reference = normaliseReference(raw.transaction_id, "TXN");
    const row = reference.ok ? await repository.findTransaction(reference.id) : null;
    if (row && state?.verifiedCustomerId === row.customer_id) {
      linked.transactionId = row.transaction_id;
      const today = dateInZone(now);
      if (row.status === "failed" || row.status === "review required") raise(`${row.transaction_id} is ${row.status}`);
      else if (row.estimated_arrival && ["processing", "delayed"].includes(row.status) && daysBetween(row.estimated_arrival, today) > 0) raise(`${row.transaction_id} is past its estimate`);
    } else {
      reported.push(reference.ok ? reference.id : raw.transaction_id);
    }
  }
  if (raw.payout_id) {
    const reference = normaliseReference(raw.payout_id, "PAY");
    const row = reference.ok ? await repository.findPayout(reference.id) : null;
    if (row && state?.verifiedCustomerId === row.customer_id) {
      linked.payoutId = row.payout_id;
      if (row.status === "failed" || row.status === "review required") raise(`${row.payout_id} is ${row.status}`);
    } else {
      reported.push(reference.ok ? reference.id : raw.payout_id);
    }
  }
  linked.reportedReference = reported.length ? reported.join(", ").slice(0, 80) : null;
  return linked;
}

export const createSupportTicket: ToolDefinition<Input> = {
  name: "create_support_ticket",
  title: "Open a support ticket",
  description:
    "Log an issue for the support team to follow up, when the caller needs someone to look at something (a failed or late payment, a record that contradicts what the caller says). " +
    "Include the transaction or payout reference when the caller gave one. Before calling, ask where to email the caller a confirmation and read the address back; pass it as contact_email, " +
    "or use_email_on_file for a verified caller who wants the email on the account, or neither if the caller wants no email. " +
    "The system sets the priority floor and tells the caller the reference and whether a confirmation is coming; do not say either yourself.",
  wireInput: lenientInput({
    customer_id: { type: "string", description: "Only if the caller was verified this call." },
    category: { type: "string", required: true, description: "One of: payment, payout, invoice, account, compliance, dispute, refund, cancellation, other.", enum: TICKET_CATEGORIES },
    priority: { type: "string", required: true, description: "Your proposal: low, normal, high or urgent. The system may raise it.", enum: TICKET_PRIORITIES },
    summary: { type: "string", required: true, description: "What the caller reported and what the records showed, in one or two sentences, for the support team." },
    conversation_id: { type: "string", required: true, description: "This conversation. The system fills it from the call; any value works." },
    transaction_id: { type: "string", description: "The transaction reference, if the caller gave one." },
    payout_id: { type: "string", description: "The payout reference, if the caller gave one." },
    contact_email: { type: "string", description: "Where to email the caller's confirmation, after reading it back to them. Omit when use_email_on_file is true or the caller wants no email." },
    use_email_on_file: { type: "boolean", description: "True for a verified caller who wants the confirmation sent to the email on the account." },
  }),
  strictInput: z.object({
    customer_id: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1),
    priority: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(5).max(1500),
    conversation_id: z.string().trim().optional(),
    transaction_id: z.string().trim().min(1).optional(),
    payout_id: z.string().trim().min(1).optional(),
    contact_email: z.string().trim().optional(),
    use_email_on_file: z.boolean().optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  purpose: (raw) => `Open a ${String(raw.category ?? "support")} ticket for the caller.`,

  invalidInput: (raw) =>
    invalid(
      typeof raw.summary !== "string" || raw.summary.trim().length < 5
        ? "summary is missing. Write one or two sentences for the support team about what the caller reported."
        : "category is missing. Use one of: payment, payout, invoice, account, compliance, dispute, refund, cancellation, other.",
      "invalid_input: ticket fields missing",
    ),

  async run({ input, context, state, repository }) {
    const category = (TICKET_CATEGORIES as readonly string[]).includes(input.category.toLowerCase()) ? input.category.toLowerCase() : "other";
    const proposed = input.priority && (TICKET_PRIORITIES as readonly string[]).includes(input.priority.toLowerCase()) ? input.priority.toLowerCase() : null;
    const linked = await linkRecords(repository, input, state, context.clock());
    const priority = RANK[linked.priorityFloor]! > RANK[proposed ?? "normal"]! ? linked.priorityFloor : (proposed ?? "normal");

    // The model's customer_id counts only if it is the verified caller, or on a
    // direct MCP session where there is no call to verify against.
    let directCustomer: string | null = null;
    if (context.via === "mcp_direct" && input.customer_id) {
      const reference = normaliseReference(input.customer_id, "CUS");
      if (reference.ok) directCustomer = (await repository.findCustomer(reference.id))?.customer_id ?? null;
    }
    const customerId = state?.verifiedCustomerId ?? directCustomer;

    // The confirmation's address (DESIGN §10.5): the one the caller read back, or
    // the one on file. Never promised for an address that cannot receive mail.
    let contactEmail: string | null = null;
    if (input.use_email_on_file) {
      if (!state?.verifiedCustomerId) return invalid("use_email_on_file needs a verified caller. Ask where to send the confirmation and read it back, or open the ticket without one.", "invalid_input: email on file without verification");
      contactEmail = (await repository.findCustomer(state.verifiedCustomerId))?.contact_email.toLowerCase() ?? null;
    } else if (input.contact_email) {
      contactEmail = normaliseEmail(input.contact_email);
      if (!contactEmail) return invalid("The email didn't validate. Ask the caller to spell it, then read it back.", "invalid_input: email did not validate");
    }
    const confirmation = !contactEmail ? "not_requested" : isDeliverableEmail(contactEmail) ? "pending" : "skipped_undeliverable";

    if (input.conversation_id && context.conversationId && input.conversation_id !== context.conversationId) {
      await repository.logEvent({
        conversationId: context.conversationId,
        turnId: context.turnId,
        eventType: "conversation_id_mismatch",
        summary: "create_support_ticket named a different conversation; the call's own id was used.",
        metadata: { given: input.conversation_id.slice(0, 64) },
        source: "system",
      });
    }

    const key = idempotencyKey([
      context.conversationId ?? "direct",
      category,
      linked.transactionId,
      linked.payoutId,
      linked.reportedReference,
      context.conversationId ? null : input.summary,
    ]);
    // Reserve, then act (rule 11): the ticket and its confirmation job are written
    // together; the outbox sends the email, so the call never waits on it.
    const { ticket, created } = await repository.createTicket({
      conversationId: context.conversationId,
      customerId,
      transactionId: linked.transactionId,
      payoutId: linked.payoutId,
      reportedReference: linked.reportedReference,
      category,
      priority,
      proposedPriority: proposed,
      summary: input.summary,
      source: context.via === "agent" ? "agent" : "mcp_direct",
      idempotencyKey: key,
      contactEmail,
      confirmation,
    });
    const emailing = ticket.confirmation_status === "pending" || ticket.confirmation_status === "sent";
    return {
      status: "ok",
      isError: false,
      payload: {
        ticket_id: ticket.id,
        ticket_ref: ticket.ticket_ref,
        status: ticket.status,
        category: ticket.category,
        priority: ticket.priority,
        priority_raised: priority !== (proposed ?? "normal") ? linked.floorReason : null,
        created,
        // queued: the outbox is sending the caller a confirmation. none: no email was asked
        // for, or the address cannot receive mail, so nothing is said about one.
        confirmation_email: emailing ? "queued" : "none",
        message: "The system tells the caller the ticket reference and whether a confirmation email is coming. Do not say either yourself.",
      },
      summary: `${created ? "created" : "existing"} ${ticket.ticket_ref}: ${category}, ${ticket.priority}, confirmation ${ticket.confirmation_status}`,
    };
  },
};
