import "server-only";

import { raiseAlert } from "@/lib/alerts";
import { EMBEDDING_MODEL, RETRIEVAL_TOP_K } from "@/lib/constants";
import { queryDb, withTransaction } from "@/lib/db";
import { embed, vectorLiteral } from "@/lib/kb/embed";
import { lexicalSearch } from "@/lib/kb/lexical";

import type {
  ConversationState,
  CustomerRecord,
  EscalationInput,
  EscalationRecord,
  EventLog,
  KbHit,
  KbSearchResult,
  OfferedSlot,
  PayoutRecord,
  Repository,
  RetrievalLog,
  TicketInput,
  TicketRecord,
  ToolCallLog,
  TransactionRecord,
} from "./types";

// Dates are selected as text: pg turns a date column into a JS Date at local
// midnight, and on a server east of UTC that prints as the day before.

const CUSTOMER_COLUMNS = "customer_id, company_name, company_key, contact_name, contact_email, plan, account_status, region, kyc_status, support_notes";
const TICKET_COLUMNS = "id, ticket_ref, status, priority, category, created_at::text, confirmation_status";
const ESCALATION_SELECT = `
  select e.id, e.escalation_ref, e.ticket_id, t.ticket_ref, e.status, e.call_booked, e.appointment_time::text, e.booking_status,
         e.booking_error, e.notification_status, e.timezone, e.requested_start::text, e.user_name, e.user_email, e.category, e.reason,
         e.customer_id, e.conversation_id, e.cal_booking_uid, e.created_at::text
    from support_agent.escalations e join support_agent.support_tickets t on t.id = e.ticket_id`;

type SearchRow = { chunk_id: string; kb_version: string; source_title: string; section_path: string; source_summary: string; text: string; similarity: number | null };

async function lexicalFallback(query: string, reason: string): Promise<KbSearchResult> {
  // Degraded mode (DESIGN §8): the embedding call failed, so rank on full text only.
  const rows = await queryDb<{ chunk_id: string; kb_version: string; source_title: string; section_path: string; source_summary: string; text: string }>(
    `select chunk_id, kb_version, source_title, section_path, source_summary, text from support_agent.kb_chunks where active`,
  );
  const hits = lexicalSearch(rows.rows, query, RETRIEVAL_TOP_K);
  await raiseAlert({ type: "retrieval_degraded", severity: "warning", fingerprint: "retrieval_degraded", message: "Knowledge search is running on full text only; embeddings failed.", context: { error: reason.slice(0, 300) } });
  return {
    hits: hits.map((hit) => ({ ...hit.chunk, score: hit.score })),
    topScore: hits[0]?.score ?? null,
    degraded: true,
    kbVersion: rows.rows[0]?.kb_version ?? null,
    embeddingModel: null,
  };
}

export const supabaseRepository: Repository = {
  backend: "supabase",

  async conversationState(conversationId) {
    const result = await queryDb<{ id: string; verified_customer_id: string | null; escalation_id: string | null; verification_failures: number; offered_slots: OfferedSlot[] | null }>(
      "select id, verified_customer_id, escalation_id, verification_failures, offered_slots from support_agent.conversations where id = $1",
      [conversationId],
    );
    const row = result.rows[0];
    return row
      ? ({ id: row.id, verifiedCustomerId: row.verified_customer_id, escalated: row.escalation_id !== null, verificationFailures: row.verification_failures, offeredSlots: row.offered_slots ?? [] } satisfies ConversationState)
      : null;
  },

  async recordVerificationFailure(conversationId) {
    // One statement, so two parallel tool calls cannot both read the old count.
    const result = await queryDb<{ verification_failures: number }>(
      `update support_agent.conversations set verification_failures = verification_failures + 1, updated_at = now() where id = $1 returning verification_failures`,
      [conversationId],
    );
    return result.rows[0]?.verification_failures ?? 0;
  },

  async createConversation(channel) {
    const result = await queryDb<{ id: string }>(`insert into support_agent.conversations (channel, started_at) values ($1, now()) returning id`, [channel]);
    return result.rows[0]!.id;
  },

  async setVerifiedCustomer(conversationId, customerId) {
    await queryDb(`update support_agent.conversations set verified_customer_id = $2, updated_at = now() where id = $1`, [conversationId, customerId]);
  },

  async setOfferedSlots(conversationId, slots) {
    await queryDb(`update support_agent.conversations set offered_slots = $2, updated_at = now() where id = $1`, [conversationId, JSON.stringify(slots)]);
  },

  async findCustomerCandidates(ids) {
    const result = await queryDb<CustomerRecord>(
      `select ${CUSTOMER_COLUMNS} from support_agent.customers
        where customer_id = $1 or lower(contact_email) = $2 or company_key = $3 or lower(split_part(contact_name, ' ', 1)) = $4`,
      [ids.customerId, ids.email, ids.companyKey, ids.firstName],
    );
    return result.rows;
  },

  async findCustomer(customerId) {
    const result = await queryDb<CustomerRecord>(`select ${CUSTOMER_COLUMNS} from support_agent.customers where customer_id = $1`, [customerId]);
    return result.rows[0] ?? null;
  },

  async findTransaction(transactionId) {
    const result = await queryDb<TransactionRecord>(
      `select transaction_id, customer_id, transaction_type, amount::text as amount, currency, destination_country, status,
              created_at::text as created_at, estimated_arrival::text as estimated_arrival, support_summary
         from support_agent.transactions where transaction_id = $1`,
      [transactionId],
    );
    return result.rows[0] ?? null;
  },

  async findPayout(payoutId) {
    const result = await queryDb<PayoutRecord>(
      `select payout_id, transaction_id, customer_id, recipient_name, amount::text as amount, currency, status, scheduled_for::text as scheduled_for, failure_reason
         from support_agent.payouts where payout_id = $1`,
      [payoutId],
    );
    return result.rows[0] ?? null;
  },

  async findPayoutByTransaction(transactionId) {
    const result = await queryDb<PayoutRecord>(
      `select payout_id, transaction_id, customer_id, recipient_name, amount::text as amount, currency, status, scheduled_for::text as scheduled_for, failure_reason
         from support_agent.payouts where transaction_id = $1 order by payout_id limit 1`,
      [transactionId],
    );
    return result.rows[0] ?? null;
  },

  async searchKnowledge(query) {
    // Mixed embedding models make every similarity score fiction (Week 4): refuse, loudly.
    const models = await queryDb<{ embedding_model: string | null; chunks: number }>(
      `select embedding_model, count(*)::int as chunks from support_agent.kb_chunks where active group by embedding_model`,
    );
    if (!models.rows.length) return { hits: [], topScore: null, degraded: false, kbVersion: null, embeddingModel: null, refusal: "The knowledge base has not been ingested (npm run kb:ingest)." };
    const foreign = models.rows.filter((row) => row.embedding_model !== EMBEDDING_MODEL);
    if (foreign.length) {
      await raiseAlert({ type: "retrieval_degraded", severity: "critical", fingerprint: "retrieval_mixed_models", message: "Active knowledge chunks were embedded with a different model; search refused.", context: { models: models.rows } });
      return { hits: [], topScore: null, degraded: false, kbVersion: null, embeddingModel: null, refusal: `Active chunks embedded with ${foreign.map((row) => row.embedding_model ?? "nothing").join(", ")}, not ${EMBEDDING_MODEL}.` };
    }

    let vector: number[];
    try {
      [vector] = (await embed([query])) as [number[]];
    } catch (error) {
      return lexicalFallback(query, error instanceof Error ? error.message : String(error));
    }
    const result = await queryDb<SearchRow>(`select * from support_agent.search_kb($1::vector, $2, $3)`, [vectorLiteral(vector), query, RETRIEVAL_TOP_K]);
    const hits: KbHit[] = result.rows.map((row) => ({
      chunk_id: row.chunk_id,
      source_title: row.source_title,
      section_path: row.section_path,
      source_summary: row.source_summary,
      text: row.text,
      score: row.similarity ?? 0,
    }));
    // The threshold is on the top hit's cosine similarity, because that number means something on its own.
    const topScore = hits.length ? Math.max(...hits.map((hit) => hit.score)) : null;
    return { hits, topScore, degraded: false, kbVersion: result.rows[0]?.kb_version ?? null, embeddingModel: EMBEDDING_MODEL };
  },

  async logRetrieval(entry: RetrievalLog) {
    await queryDb(
      `insert into support_agent.retrieval_logs
         (conversation_id, turn_id, query, chunk_ids_returned, source_titles, source_summaries, top_score, found, degraded, kb_version, embedding_model)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [entry.conversationId, entry.turnId, entry.query, entry.chunkIdsReturned, entry.sourceTitles, entry.sourceSummaries, entry.topScore, entry.found, entry.degraded, entry.kbVersion, entry.embeddingModel],
    );
  },

  async createTicket(input: TicketInput) {
    return withTransaction(async (client) => {
      // Insert-or-return on the unique key: Vapi retries and interruptions double-fire tools.
      const inserted = await client.query<TicketRecord>(
        `insert into support_agent.support_tickets
           (conversation_id, customer_id, transaction_id, payout_id, reported_reference, category, priority, proposed_priority, summary, source, idempotency_key, contact_email, confirmation_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (idempotency_key) do nothing
         returning ${TICKET_COLUMNS}`,
        [
          input.conversationId,
          input.customerId,
          input.transactionId,
          input.payoutId,
          input.reportedReference,
          input.category,
          input.priority,
          input.proposedPriority,
          input.summary,
          input.source,
          input.idempotencyKey,
          input.contactEmail ?? null,
          input.confirmation ?? "not_requested",
        ],
      );
      const ticket = inserted.rows[0];
      if (!ticket) {
        const existing = await client.query<TicketRecord>(`select ${TICKET_COLUMNS} from support_agent.support_tickets where idempotency_key = $1`, [input.idempotencyKey]);
        return { ticket: existing.rows[0]!, created: false, jobIds: [] };
      }
      // Reserve, then act: the confirmation is a job beside the ticket, sent by the outbox.
      const jobIds: string[] = [];
      if (ticket.confirmation_status === "pending") {
        const job = await client.query<{ id: string }>(
          `insert into support_agent.jobs (kind, ref_id, dedupe_key) values ('notify_ticket', $1, $2) on conflict (dedupe_key) do nothing returning id`,
          [ticket.id, `notify_ticket:${ticket.id}`],
        );
        if (job.rows[0]) jobIds.push(job.rows[0].id);
      }
      return { ticket, created: true, jobIds };
    });
  },

  async createEscalation(input: EscalationInput) {
    return withTransaction(async (client) => {
      // 1. A ticket, so every escalation is on the queue.
      let ticketId: string | null = null;
      if (input.ticketId) {
        const given = await client.query<{ id: string }>(
          `select id from support_agent.support_tickets where id::text = $1 and (conversation_id is not distinct from $2)`,
          [input.ticketId, input.conversationId],
        );
        ticketId = given.rows[0]?.id ?? null;
      }
      if (!ticketId) {
        const t = input.ticket;
        const ticket = await client.query<{ id: string }>(
          `insert into support_agent.support_tickets
             (conversation_id, customer_id, transaction_id, payout_id, reported_reference, category, priority, proposed_priority, summary, source, idempotency_key)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (idempotency_key) do update set updated_at = now()
           returning id`,
          [t.conversationId, t.customerId, t.transactionId, t.payoutId, t.reportedReference, t.category, t.priority, t.proposedPriority, t.summary, t.source, t.idempotencyKey],
        );
        ticketId = ticket.rows[0]!.id;
      }

      // 2. The escalation, idempotent on conversation plus category.
      const inserted = await client.query<{ id: string }>(
        `insert into support_agent.escalations
           (ticket_id, conversation_id, customer_id, user_name, user_email, category, reason, preferred_time_text, timezone, requested_start, booking_status, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (idempotency_key) do nothing
         returning id`,
        [
          ticketId,
          input.conversationId,
          input.customerId,
          input.userName,
          input.userEmail,
          input.category,
          input.reason,
          input.preferredTimeText,
          input.timezone,
          input.requestedStart?.toISOString() ?? null,
          input.bookingRequested ? "pending" : "not_requested",
          input.idempotencyKey,
        ],
      );
      const created = inserted.rows.length === 1;
      const id = inserted.rows[0]?.id ?? (await client.query<{ id: string }>(`select id from support_agent.escalations where idempotency_key = $1`, [input.idempotencyKey])).rows[0]!.id;

      const jobIds: string[] = [];
      if (created) {
        // 3. The conversation is escalated: lookups are refused from here on.
        if (input.conversationId) {
          await client.query(`update support_agent.conversations set escalation_id = coalesce(escalation_id, $2), updated_at = now() where id = $1`, [input.conversationId, id]);
        }
        // 4. The outbox: a booking job if a slot was chosen, a notification job always.
        const jobs: [string, string][] = [...(input.bookingRequested ? [["book_callback", `book_callback:${id}`] as [string, string]] : []), ["notify_escalation", `notify_escalation:${id}`]];
        for (const [kind, dedupeKey] of jobs) {
          const job = await client.query<{ id: string }>(
            `insert into support_agent.jobs (kind, ref_id, dedupe_key) values ($1, $2, $3) on conflict (dedupe_key) do nothing returning id`,
            [kind, id, dedupeKey],
          );
          if (job.rows[0]) jobIds.push(job.rows[0].id);
        }
        await client.query(
          `insert into support_agent.conversation_events (conversation_id, event_type, summary, metadata, source)
           values ($1, 'escalation_created', $2, $3, 'system')`,
          [input.conversationId, `Escalated (${input.category}) to a specialist.`, JSON.stringify({ escalation_id: id, booking_requested: input.bookingRequested })],
        );
      }
      const escalation = (await client.query<EscalationRecord>(`${ESCALATION_SELECT} where e.id = $1`, [id])).rows[0]!;
      return { escalation, created, jobIds };
    });
  },

  async findEscalation(escalationId) {
    const result = await queryDb<EscalationRecord>(`${ESCALATION_SELECT} where e.id = $1`, [escalationId]);
    return result.rows[0] ?? null;
  },

  async logEvent(entry: EventLog) {
    await queryDb(
      `insert into support_agent.conversation_events (conversation_id, turn_id, event_type, summary, metadata, source) values ($1, $2, $3, $4, $5, $6)`,
      [entry.conversationId, entry.turnId, entry.eventType, entry.summary, JSON.stringify(entry.metadata), entry.source],
    );
  },

  async logToolCall(entry: ToolCallLog) {
    await queryDb(
      `insert into support_agent.tool_calls
         (conversation_id, turn_id, tool_name, purpose, input_redacted, result_summary, status, error_message, duration_ms, via)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [entry.conversationId, entry.turnId, entry.toolName, entry.purpose, JSON.stringify(entry.inputRedacted ?? {}), entry.resultSummary, entry.status, entry.errorMessage, entry.durationMs, entry.via],
    );
  },
};
