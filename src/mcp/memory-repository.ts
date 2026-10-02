import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { KB_SOURCE_PATH, RETRIEVAL_TOP_K } from "@/lib/constants";
import { parseCsv } from "@/lib/csv";
import { chunkKnowledgeBase, type KbDocument } from "@/lib/kb/chunk";
import { lexicalSearch } from "@/lib/kb/lexical";
import { firstNameKey } from "@/lib/normalise";

import type {
  CustomerRecord,
  EscalationInput,
  EscalationRecord,
  EventLog,
  PayoutRecord,
  Repository,
  RetrievalLog,
  TicketInput,
  TicketRecord,
  ToolCallLog,
  ToolServices,
  TransactionRecord,
} from "./types";

// The memory backend (DESIGN §7.1): seeded from the client's CSVs and the
// knowledge base file, writes kept in memory. A grader can run every tool
// with no accounts, no database and no keys. Search is full text only, and
// says so (degraded: true).

type Ticket = TicketRecord & TicketInput;
type Job = { id: string; kind: "book_callback" | "notify_escalation" | "notify_ticket"; ref_id: string; status: "pending" | "done" };

export type MemoryRepository = Repository & {
  readonly tickets: Ticket[];
  readonly escalations: EscalationRecord[];
  readonly jobs: Job[];
  readonly events: EventLog[];
  readonly toolCalls: ToolCallLog[];
  readonly retrievals: RetrievalLog[];
  readonly kb: KbDocument;
};

function load(root: string, file: string) {
  return parseCsv(readFileSync(path.join(root, "assets", "seed-data", file), "utf8")).rows;
}

const money = (value: string | null) => Number(value ?? 0).toFixed(2);

export function createMemoryRepository(root: string = process.cwd()): MemoryRepository {
  const customers = new Map<string, CustomerRecord>(
    load(root, "customers.csv").map((row) => [
      row.customer_id!,
      {
        customer_id: row.customer_id!,
        company_name: row.company_name!,
        company_key: row.company_name!.toLowerCase().replace(/[^a-z0-9]/g, ""),
        contact_name: row.contact_name!,
        contact_email: row.contact_email!,
        plan: row.plan!,
        account_status: row.account_status!,
        region: row.region!,
        kyc_status: row.kyc_status!,
        support_notes: row.support_notes ?? null,
      },
    ]),
  );
  const transactions = new Map<string, TransactionRecord>(
    load(root, "transactions.csv").map((row) => [
      row.transaction_id!,
      {
        transaction_id: row.transaction_id!,
        customer_id: row.customer_id!,
        transaction_type: row.transaction_type!,
        amount: money(row.amount ?? null),
        currency: row.currency!,
        destination_country: row.destination_country ?? null,
        status: row.status!,
        created_at: row.created_at!,
        estimated_arrival: row.estimated_arrival ?? null,
        support_summary: row.support_summary ?? null,
      },
    ]),
  );
  const payouts = new Map<string, PayoutRecord>(
    load(root, "payouts.csv").map((row) => [
      row.payout_id!,
      {
        payout_id: row.payout_id!,
        transaction_id: row.transaction_id!,
        customer_id: row.customer_id!,
        recipient_name: row.recipient_name!,
        amount: money(row.amount ?? null),
        currency: row.currency!,
        status: row.status!,
        scheduled_for: row.scheduled_for!,
        failure_reason: row.failure_reason ?? null,
      },
    ]),
  );
  const kb = chunkKnowledgeBase(readFileSync(path.join(root, KB_SOURCE_PATH), "utf8"));
  const conversations = new Map<string, { verifiedCustomerId: string | null; escalationId: string | null; verificationFailures: number }>();
  const tickets: Ticket[] = [];
  const escalations: EscalationRecord[] = [];
  const jobs: Job[] = [];
  const events: EventLog[] = [];
  const toolCalls: ToolCallLog[] = [];
  const retrievals: RetrievalLog[] = [];
  let ticketSeq = 4001;
  let escalationSeq = 2001;

  const insertTicket = (input: TicketInput): { ticket: Ticket; created: boolean; jobIds: string[] } => {
    const existing = tickets.find((ticket) => ticket.idempotencyKey === input.idempotencyKey);
    if (existing) return { ticket: existing, created: false, jobIds: [] };
    const confirmation = input.confirmation ?? "not_requested";
    const ticket: Ticket = { ...input, id: randomUUID(), ticket_ref: `T-${ticketSeq++}`, status: "open", created_at: new Date().toISOString(), confirmation_status: confirmation };
    tickets.push(ticket);
    const jobIds: string[] = [];
    if (confirmation === "pending") {
      const job: Job = { id: randomUUID(), kind: "notify_ticket", ref_id: ticket.id, status: "pending" };
      jobs.push(job);
      jobIds.push(job.id);
    }
    return { ticket, created: true, jobIds };
  };

  return {
    backend: "memory",
    tickets,
    escalations,
    jobs,
    events,
    toolCalls,
    retrievals,
    kb,

    async conversationState(id) {
      const conversation = conversations.get(id);
      return conversation ? { id, verifiedCustomerId: conversation.verifiedCustomerId, escalated: conversation.escalationId !== null, verificationFailures: conversation.verificationFailures } : null;
    },
    async createConversation() {
      const id = randomUUID();
      conversations.set(id, { verifiedCustomerId: null, escalationId: null, verificationFailures: 0 });
      return id;
    },
    async setVerifiedCustomer(id, customerId) {
      const conversation = conversations.get(id);
      if (conversation) conversation.verifiedCustomerId = customerId;
    },
    async recordVerificationFailure(id) {
      const conversation = conversations.get(id);
      if (!conversation) return 0;
      conversation.verificationFailures += 1;
      return conversation.verificationFailures;
    },
    async findCustomerCandidates(ids) {
      return [...customers.values()].filter(
        (record) =>
          record.customer_id === ids.customerId ||
          record.contact_email.toLowerCase() === ids.email ||
          record.company_key === ids.companyKey ||
          firstNameKey(record.contact_name) === ids.firstName,
      );
    },
    async findCustomer(id) {
      return customers.get(id) ?? null;
    },
    async findTransaction(id) {
      return transactions.get(id) ?? null;
    },
    async findPayout(id) {
      return payouts.get(id) ?? null;
    },
    async findPayoutByTransaction(id) {
      return [...payouts.values()].find((payout) => payout.transaction_id === id) ?? null;
    },
    async searchKnowledge(query) {
      const hits = lexicalSearch(kb.chunks, query, RETRIEVAL_TOP_K);
      return { hits: hits.map((hit) => ({ ...hit.chunk, score: hit.score })), topScore: hits[0]?.score ?? null, degraded: true, kbVersion: kb.kb_version, embeddingModel: null };
    },
    async logRetrieval(entry) {
      retrievals.push(entry);
    },
    async createTicket(input) {
      return insertTicket(input);
    },
    async createEscalation(input: EscalationInput) {
      const existing = escalations.find((escalation) => (escalation as EscalationRecord & { idempotency_key?: string }).idempotency_key === input.idempotencyKey);
      if (existing) return { escalation: existing, created: false, jobIds: [] };
      const given = input.ticketId ? tickets.find((ticket) => ticket.id === input.ticketId && ticket.conversationId === input.conversationId) : undefined;
      const ticket = given ?? insertTicket(input.ticket).ticket;
      const escalation: EscalationRecord & { idempotency_key: string } = {
        id: randomUUID(),
        escalation_ref: `E-${escalationSeq++}`,
        ticket_id: ticket.id,
        ticket_ref: ticket.ticket_ref,
        status: "open",
        call_booked: false,
        appointment_time: null,
        booking_status: input.bookingRequested ? "pending" : "not_requested",
        booking_error: null,
        notification_status: "pending",
        timezone: input.timezone,
        requested_start: input.requestedStart?.toISOString() ?? null,
        user_name: input.userName,
        user_email: input.userEmail,
        category: input.category,
        reason: input.reason,
        customer_id: input.customerId,
        conversation_id: input.conversationId,
        cal_booking_uid: null,
        created_at: new Date().toISOString(),
        idempotency_key: input.idempotencyKey,
      };
      escalations.push(escalation);
      const conversation = input.conversationId ? conversations.get(input.conversationId) : undefined;
      if (conversation) conversation.escalationId ??= escalation.id;
      const newJobs: Job[] = [
        ...(input.bookingRequested ? [{ id: randomUUID(), kind: "book_callback" as const, ref_id: escalation.id, status: "pending" as const }] : []),
        { id: randomUUID(), kind: "notify_escalation", ref_id: escalation.id, status: "pending" },
      ];
      jobs.push(...newJobs);
      events.push({ conversationId: input.conversationId, turnId: null, eventType: "escalation_created", summary: `Escalated (${input.category}) to a specialist.`, metadata: { escalation_id: escalation.id }, source: "system" });
      return { escalation, created: true, jobIds: newJobs.map((job) => job.id) };
    },
    async findEscalation(id) {
      return escalations.find((escalation) => escalation.id === id) ?? null;
    },
    async logEvent(entry) {
      events.push(entry);
    },
    async logToolCall(entry) {
      toolCalls.push(entry);
    },
  };
}

/** Memory mode books nothing and emails no one; it records that it would have (skipped_eval). */
export function memoryServices(repository: MemoryRepository): ToolServices {
  return {
    calendar: null,
    sideEffects: "memory",
    runJobs: async (ids) => {
      for (const job of repository.jobs.filter((candidate) => ids.includes(candidate.id) && candidate.status === "pending")) {
        const escalation = repository.escalations.find((candidate) => candidate.id === job.ref_id);
        if (escalation && job.kind === "book_callback") escalation.booking_status = "skipped_eval";
        if (escalation && job.kind === "notify_escalation") escalation.notification_status = "skipped_eval";
        const ticket = repository.tickets.find((candidate) => candidate.id === job.ref_id);
        if (ticket && job.kind === "notify_ticket") ticket.confirmation_status = "skipped_eval";
        job.status = "done";
      }
    },
  };
}
