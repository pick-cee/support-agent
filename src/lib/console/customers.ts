import "server-only";

import { queryDb } from "@/lib/db";

// Customers in the console (DESIGN §14): who a conversation was with, and
// everything RelayPay support has done with them. The console is the team's,
// behind the console password, so it shows what the agent never may: the
// contact's email and the internal support note. Eval runs are left out.

export type CustomerProfile = {
  customer_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  plan: string;
  account_status: string;
  region: string;
  kyc_status: string;
  support_notes: string | null;
};

const PROFILE = "c.customer_id, c.company_name, c.contact_name, c.contact_email, c.plan, c.account_status, c.region, c.kyc_status, c.support_notes";

/** Not an eval run's: the queue and the history are for real customers only. */
const REAL_CONVERSATION = (column: string) => `not exists (select 1 from support_agent.conversations ev where ev.id = ${column} and ev.channel = 'eval')`;

export async function customerProfile(customerId: string): Promise<CustomerProfile | null> {
  if (!/^CUS-\d+$/.test(customerId)) return null;
  const result = await queryDb<CustomerProfile>(`select ${PROFILE} from support_agent.customers c where c.customer_id = $1`, [customerId]);
  return result.rows[0] ?? null;
}

export type CustomerSummary = CustomerProfile & { conversations: number; last_contact: string | null; open_tickets: number; open_escalations: number };

/** Every customer, the most recently in touch first. */
export async function customerSummaries(): Promise<CustomerSummary[]> {
  const result = await queryDb<CustomerSummary>(
    `select ${PROFILE},
            (select count(*) from support_agent.conversations v where v.verified_customer_id = c.customer_id and v.channel <> 'eval')::int as conversations,
            (select max(v.created_at) from support_agent.conversations v where v.verified_customer_id = c.customer_id and v.channel <> 'eval')::text as last_contact,
            (select count(*) from support_agent.support_tickets t
              where t.customer_id = c.customer_id and t.status <> 'closed' and ${REAL_CONVERSATION("t.conversation_id")})::int as open_tickets,
            (select count(*) from support_agent.escalations e
              where (e.customer_id = c.customer_id or lower(e.user_email) = lower(c.contact_email)) and e.status <> 'closed' and ${REAL_CONVERSATION("e.conversation_id")})::int as open_escalations
       from support_agent.customers c
      order by last_contact desc nulls last, c.company_name`,
  );
  return result.rows;
}

export type CustomerHistory = {
  profile: CustomerProfile;
  conversations: { id: string; created_at: string; channel: string; final_status: string | null; turn_count: number; first_words: string | null }[];
  tickets: { id: string; ticket_ref: string; category: string; priority: string; status: string; summary: string; created_at: string; confirmation_status: string; conversation_id: string | null }[];
  escalations: { id: string; escalation_ref: string; category: string; status: string; reason: string; appointment_time: string | null; timezone: string | null; booking_status: string; created_at: string; matched_by_email: boolean }[];
  transactions: { transaction_id: string; transaction_type: string; amount: string; currency: string; destination_country: string; status: string; created_at: string; estimated_arrival: string | null }[];
  payouts: { payout_id: string; transaction_id: string; recipient_name: string; amount: string; currency: string; status: string; scheduled_for: string; failure_reason: string | null }[];
};

/** One customer and everything support has done with them, newest first. */
export async function customerHistory(customerId: string): Promise<CustomerHistory | null> {
  const profile = await customerProfile(customerId);
  if (!profile) return null;
  const [conversations, tickets, escalations, transactions, payouts] = await Promise.all([
    queryDb<CustomerHistory["conversations"][number]>(
      `select v.id, v.created_at::text, v.channel, v.final_status, v.turn_count,
              (select t.user_text from support_agent.conversation_turns t where t.conversation_id = v.id order by t.turn_index limit 1) as first_words
         from support_agent.conversations v
        where v.verified_customer_id = $1 and v.channel <> 'eval'
        order by v.created_at desc limit 50`,
      [customerId],
    ),
    queryDb<CustomerHistory["tickets"][number]>(
      `select t.id, t.ticket_ref, t.category, t.priority, t.status, t.summary, t.created_at::text, t.confirmation_status, t.conversation_id
         from support_agent.support_tickets t
        where t.customer_id = $1 and ${REAL_CONVERSATION("t.conversation_id")}
        order by t.created_at desc limit 50`,
      [customerId],
    ),
    // An unverified caller who gave the customer's own email is shown too, and marked.
    queryDb<CustomerHistory["escalations"][number]>(
      `select e.id, e.escalation_ref, e.category, e.status, e.reason, e.appointment_time::text, e.timezone, e.booking_status, e.created_at::text,
              (e.customer_id is distinct from $1) as matched_by_email
         from support_agent.escalations e
        where (e.customer_id = $1 or lower(e.user_email) = lower($2)) and ${REAL_CONVERSATION("e.conversation_id")}
        order by e.created_at desc limit 50`,
      [customerId, profile.contact_email],
    ),
    queryDb<CustomerHistory["transactions"][number]>(
      `select transaction_id, transaction_type, amount::text, currency, destination_country, status, created_at::text, estimated_arrival::text
         from support_agent.transactions where customer_id = $1 order by created_at desc`,
      [customerId],
    ),
    queryDb<CustomerHistory["payouts"][number]>(
      `select payout_id, transaction_id, recipient_name, amount::text, currency, status, scheduled_for::text, failure_reason
         from support_agent.payouts where customer_id = $1 order by scheduled_for desc`,
      [customerId],
    ),
  ]);
  return { profile, conversations: conversations.rows, tickets: tickets.rows, escalations: escalations.rows, transactions: transactions.rows, payouts: payouts.rows };
}
