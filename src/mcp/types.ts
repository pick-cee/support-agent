import type * as z from "zod";

import type { Clock } from "@/lib/time";

export type ToolStatus = "ok" | "not_found" | "refused" | "invalid_input" | "error";
export type ToolVia = "agent" | "mcp_direct";

/**
 * Who is calling. The conversation and turn come from the per-turn headers
 * the turn runner sets (X-RelayPay-Conversation, X-RelayPay-Turn), or from
 * the stdio session, never from an id the model typed.
 */
export type ToolContext = {
  conversationId: string | null;
  turnId: string | null;
  via: ToolVia;
  clock: Clock;
};

/** A callback time find_callback_slots offered, kept on the conversation (FAILURES 37). */
export type OfferedSlot = { start_utc: string; speakable: string; timezone: string };

export type ConversationState = {
  id: string;
  verifiedCustomerId: string | null;
  escalated: boolean;
  /** Failed identity checks this conversation; at VERIFY_MAX_FAILURES lookups close (DESIGN §7.2). */
  verificationFailures: number;
  /** The callback times last offered on this conversation; empty before any search. */
  offeredSlots: OfferedSlot[];
};

export type CustomerRecord = {
  customer_id: string;
  company_name: string;
  company_key: string;
  contact_name: string;
  contact_email: string;
  plan: string;
  account_status: string;
  region: string;
  kyc_status: string;
  support_notes: string | null;
};

export type TransactionRecord = {
  transaction_id: string;
  customer_id: string;
  transaction_type: string;
  amount: string;
  currency: string;
  destination_country: string | null;
  status: string;
  created_at: string;
  estimated_arrival: string | null;
  support_summary: string | null;
};

export type PayoutRecord = {
  payout_id: string;
  transaction_id: string;
  customer_id: string;
  recipient_name: string;
  amount: string;
  currency: string;
  status: string;
  scheduled_for: string;
  failure_reason: string | null;
};

export type KbHit = {
  chunk_id: string;
  source_title: string;
  section_path: string;
  source_summary: string;
  text: string;
  /** Cosine similarity with embeddings; a BM25 score in degraded or memory mode. */
  score: number;
};

export type KbSearchResult = {
  hits: KbHit[];
  /** What the threshold is applied to: the top hit's cosine similarity, or its lexical score when degraded. */
  topScore: number | null;
  degraded: boolean;
  kbVersion: string | null;
  embeddingModel: string | null;
  /** Set when search must refuse, for example mixed embedding models (DESIGN §8). */
  refusal?: string;
};

export type RetrievalLog = {
  conversationId: string | null;
  turnId: string | null;
  query: string;
  chunkIdsReturned: string[];
  sourceTitles: string[];
  sourceSummaries: string[];
  topScore: number | null;
  found: boolean;
  degraded: boolean;
  kbVersion: string | null;
  embeddingModel: string | null;
};

export type TicketInput = {
  conversationId: string | null;
  customerId: string | null;
  transactionId: string | null;
  payoutId: string | null;
  reportedReference: string | null;
  category: string;
  priority: string;
  proposedPriority: string | null;
  summary: string;
  source: "agent" | "system" | "mcp_direct";
  idempotencyKey: string;
  /** Where the customer's confirmation goes (DESIGN §10.5); none for a ticket an escalation opens. */
  contactEmail?: string | null;
  /** pending queues the confirmation; skipped_undeliverable records why none was sent. */
  confirmation?: "not_requested" | "pending" | "skipped_undeliverable";
};

export type TicketRecord = {
  id: string;
  ticket_ref: string;
  status: string;
  priority: string;
  category: string;
  created_at: string;
  confirmation_status: string;
};

export type EscalationInput = {
  conversationId: string | null;
  ticketId: string | null;
  /** Used to open a ticket when none was given, so every escalation is on the queue. */
  ticket: Omit<TicketInput, "idempotencyKey"> & { idempotencyKey: string };
  customerId: string | null;
  userName: string;
  userEmail: string;
  category: string;
  reason: string;
  preferredTimeText: string | null;
  timezone: string | null;
  requestedStart: Date | null;
  bookingRequested: boolean;
  idempotencyKey: string;
};

export type EscalationRecord = {
  id: string;
  escalation_ref: string;
  ticket_id: string;
  ticket_ref: string;
  status: string;
  call_booked: boolean;
  appointment_time: string | null;
  booking_status: string;
  booking_error: string | null;
  notification_status: string;
  timezone: string | null;
  requested_start: string | null;
  user_name: string;
  user_email: string;
  category: string;
  reason: string;
  customer_id: string | null;
  conversation_id: string | null;
  cal_booking_uid: string | null;
  created_at: string;
};

export type ToolCallLog = {
  conversationId: string | null;
  turnId: string | null;
  toolName: string;
  purpose: string;
  inputRedacted: unknown;
  resultSummary: string;
  status: ToolStatus;
  errorMessage: string | null;
  durationMs: number;
  via: ToolVia;
};

export type EventLog = {
  conversationId: string | null;
  turnId: string | null;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  source: "agent" | "system";
};

/** Everything a tool reads or writes goes through here: Supabase in production, memory for graders. */
export interface Repository {
  readonly backend: "supabase" | "memory";
  conversationState(conversationId: string): Promise<ConversationState | null>;
  createConversation(channel: "mcp_direct" | "eval"): Promise<string>;
  setVerifiedCustomer(conversationId: string, customerId: string): Promise<void>;
  /** Counts one failed identity check and returns the conversation's total. */
  recordVerificationFailure(conversationId: string): Promise<number>;
  /** Replaces the callback times offered on the conversation with these. */
  setOfferedSlots(conversationId: string, slots: OfferedSlot[]): Promise<void>;

  /** Every customer that matches at least one identifier; code decides which, if any, two identifiers agree on. */
  findCustomerCandidates(identifiers: { customerId: string | null; email: string | null; companyKey: string | null; firstName: string | null }): Promise<CustomerRecord[]>;
  findCustomer(customerId: string): Promise<CustomerRecord | null>;
  findTransaction(transactionId: string): Promise<TransactionRecord | null>;
  findPayout(payoutId: string): Promise<PayoutRecord | null>;
  findPayoutByTransaction(transactionId: string): Promise<PayoutRecord | null>;

  searchKnowledge(query: string): Promise<KbSearchResult>;
  logRetrieval(entry: RetrievalLog): Promise<void>;

  /** Idempotent on the key: a retry returns the existing ticket with created false. A new ticket with a deliverable contact email also gets its confirmation job, in the same transaction. */
  createTicket(input: TicketInput): Promise<{ ticket: TicketRecord; created: boolean; jobIds: string[] }>;
  /** One transaction: the ticket if none, the escalation, the conversation marked escalated, and the outbox jobs. */
  createEscalation(input: EscalationInput): Promise<{ escalation: EscalationRecord; created: boolean; jobIds: string[] }>;
  findEscalation(escalationId: string): Promise<EscalationRecord | null>;

  logEvent(entry: EventLog): Promise<void>;
  logToolCall(entry: ToolCallLog): Promise<void>;
}

export type CalendarSlot = { start: Date };

/** The calendar behind callbacks: Cal.com in production (Phase 5), none in memory mode. */
export interface CalendarService {
  slots(input: { startUtc: Date; endUtc: Date; timeZone: string }): Promise<CalendarSlot[]>;
}

export type ToolServices = {
  calendar: CalendarService | null;
  /** Runs the given outbox jobs once, inline, with short timeouts (DESIGN §10.1). */
  runJobs: (jobIds: string[]) => Promise<void>;
  /** live books and emails for real; sandbox (evals) and memory record what would have happened. */
  sideEffects: "live" | "sandbox" | "memory";
};

export type ToolOutcome = {
  status: ToolStatus;
  /** Refusals and bad input are errors to the agent, with a sentence saying what to do next. A missing record is not. */
  isError: boolean;
  payload: Record<string, unknown>;
  /** One line for the tool_calls row. */
  summary: string;
  errorMessage?: string;
};

export type ToolRun<Input> = {
  input: Input;
  context: ToolContext;
  state: ConversationState | null;
  repository: Repository;
  services: ToolServices;
};

export type ToolDefinition<Input> = {
  name: string;
  title: string;
  description: string;
  wireInput: z.ZodType;
  strictInput: z.ZodType<Input>;
  /** readOnlyHint lets the client run a tool in parallel with others; only search and slot finding get it (CLAUDE.md). */
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  /** The tool's own deadline, when it differs from TOOL_RUN_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Built by code from the input for the log, never by the model. */
  purpose: (raw: Record<string, unknown>) => string;
  invalidInput: (raw: Record<string, unknown>) => ToolOutcome;
  run: (run: ToolRun<Input>) => Promise<ToolOutcome>;
};
