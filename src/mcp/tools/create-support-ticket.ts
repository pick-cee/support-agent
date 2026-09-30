import { createHash } from "node:crypto";

import * as z from "zod";

import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/lib/constants";
import { normaliseReference } from "@/lib/normalise";
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
};

const RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function idempotencyKey(parts: (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");
}

export type LinkedRecords = { transactionId: string | null; payoutId: string | null; reportedReference: string | null; priorityFloor: "normal" | "high"; floorReason: string | null };

/**
 * Links the references the caller gave to real records, and works out the
 * priority floor from them: a failed or review-required record, or a passed
 * estimate, is at least high (DESIGN §7.3). A reference that matches nothing
 * is kept as reported text, never linked.
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
    if (row && (!state?.verifiedCustomerId || state.verifiedCustomerId === row.customer_id)) {
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
    if (row && (!state?.verifiedCustomerId || state.verifiedCustomerId === row.customer_id)) {
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
    "Include the transaction or payout reference when the caller gave one. The system sets the priority floor and writes the reference the caller hears; do not say a ticket reference yourself.",
  wireInput: lenientInput({
    customer_id: { type: "string", description: "Only if the caller was verified this call." },
    category: { type: "string", required: true, description: "One of: payment, payout, invoice, account, compliance, dispute, refund, cancellation, other.", enum: TICKET_CATEGORIES },
    priority: { type: "string", required: true, description: "Your proposal: low, normal, high or urgent. The system may raise it.", enum: TICKET_PRIORITIES },
    summary: { type: "string", required: true, description: "What the caller reported and what the records showed, in one or two sentences, for the support team." },
    conversation_id: { type: "string", required: true, description: "This conversation. The system fills it from the call; any value works." },
    transaction_id: { type: "string", description: "The transaction reference, if the caller gave one." },
    payout_id: { type: "string", description: "The payout reference, if the caller gave one." },
  }),
  strictInput: z.object({
    customer_id: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1),
    priority: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(5).max(1500),
    conversation_id: z.string().trim().optional(),
    transaction_id: z.string().trim().min(1).optional(),
    payout_id: z.string().trim().min(1).optional(),
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
    });
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
        message: "The system tells the caller the ticket reference. Do not say it yourself.",
      },
      summary: `${created ? "created" : "existing"} ${ticket.ticket_ref}: ${category}, ${ticket.priority}`,
    };
  },
};
