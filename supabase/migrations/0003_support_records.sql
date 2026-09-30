-- The rest of the runtime records (DESIGN §9.2): tickets, escalations, the
-- outbox, retrieval, knowledge chunks, evaluations and console logins.

-- vector is already installed in public on this project; it is referenced as public.vector.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- References people can say: T-4001, E-2001.
create sequence support_agent.ticket_ref_seq start 4001;
create sequence support_agent.escalation_ref_seq start 2001;

create table support_agent.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ticket_ref text not null unique default ('T-' || nextval('support_agent.ticket_ref_seq')),
  conversation_id uuid null references support_agent.conversations (id),
  customer_id text null references support_agent.customers (customer_id),
  transaction_id text null references support_agent.transactions (transaction_id),
  payout_id text null references support_agent.payouts (payout_id),
  -- What the caller said when it matched no record: kept, never linked.
  reported_reference text null,
  category text not null check (category in ('payment', 'payout', 'invoice', 'account', 'compliance', 'dispute', 'refund', 'cancellation', 'other')),
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  -- The model proposes; code sets the floor (DESIGN §7.3).
  proposed_priority text null check (proposed_priority in ('low', 'normal', 'high', 'urgent')),
  summary text not null,
  status text not null default 'open' check (status in ('open', 'in progress', 'closed')),
  source text not null default 'agent' check (source in ('agent', 'system', 'mcp_direct')),
  -- Vapi retries and interruptions double-fire tools; this is where idempotency lives.
  idempotency_key text not null unique
);

create index support_tickets_conversation_idx on support_agent.support_tickets (conversation_id);

create table support_agent.escalations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  escalation_ref text not null unique default ('E-' || nextval('support_agent.escalation_ref_seq')),
  ticket_id uuid not null references support_agent.support_tickets (id),
  conversation_id uuid null references support_agent.conversations (id),
  customer_id text null references support_agent.customers (customer_id),
  user_name text not null,
  user_email text not null,
  category text not null check (category in ('compliance', 'account', 'dispute', 'payment', 'other')),
  -- The AI summary the escalation Google Doc asks for.
  reason text not null,
  preferred_time_text text null,
  timezone text null,
  requested_start timestamptz null,
  call_booked boolean not null default false,
  -- Set only when Cal.com returned a booking.
  appointment_time timestamptz null,
  cal_booking_uid text null unique,
  booking_status text not null default 'not_requested' check (booking_status in ('not_requested', 'pending', 'booked', 'failed', 'skipped_eval')),
  booking_error text null,
  notification_status text not null default 'pending' check (notification_status in ('pending', 'sent', 'failed', 'skipped_eval')),
  status text not null default 'open' check (status in ('open', 'in progress', 'closed')),
  idempotency_key text not null unique
);

create index escalations_status_idx on support_agent.escalations (status, appointment_time);

alter table support_agent.conversations
  add constraint conversations_escalation_fk foreign key (escalation_id) references support_agent.escalations (id);

-- The console's only write is a status change, and every one is a row.
create table support_agent.escalation_status_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  escalation_id uuid not null references support_agent.escalations (id),
  from_status text not null,
  to_status text not null check (to_status in ('open', 'in progress', 'closed')),
  changed_by text not null
);

-- The outbox (DESIGN §10.1). Claimed with FOR UPDATE SKIP LOCKED inside a
-- transaction, which is safe on the transaction pooler.
create table support_agent.jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('book_callback', 'notify_escalation', 'notify_alert')),
  ref_id uuid not null,
  -- One job per thing to do: book this escalation, notify about it, notify about this alert now.
  dedupe_key text not null unique,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text null
);

create index jobs_due_idx on support_agent.jobs (next_attempt_at) where status = 'pending';

create table support_agent.kb_chunks (
  -- A stable hash of the section path, so logs keep pointing at the same thing across re-ingests.
  chunk_id text not null,
  kb_version text not null,
  created_at timestamptz not null default now(),
  source_title text not null,
  section_path text not null,
  text text not null,
  source_summary text not null,
  embedding public.vector(1536) null,
  embedding_model text null,
  fts tsvector generated always as (to_tsvector('english', section_path || ' ' || text)) stored,
  -- Older versions are marked inactive, never deleted, so old retrieval logs still resolve.
  active boolean not null default true,
  primary key (chunk_id, kb_version)
);

create unique index kb_chunks_one_active_idx on support_agent.kb_chunks (chunk_id) where active;
create index kb_chunks_fts_idx on support_agent.kb_chunks using gin (fts);

create table support_agent.retrieval_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid null references support_agent.conversations (id),
  turn_id uuid null references support_agent.conversation_turns (id),
  query text not null,
  chunk_ids_returned text[] not null default '{}',
  -- Marked by the turn runner from the answer's citations.
  chunk_ids_used text[] not null default '{}',
  source_titles text[] not null default '{}',
  source_summaries text[] not null default '{}',
  top_score double precision null,
  found boolean not null,
  degraded boolean not null default false,
  kb_version text null,
  embedding_model text null
);

create index retrieval_logs_turn_idx on support_agent.retrieval_logs (turn_id);

create table support_agent.eval_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  label text null,
  model text not null,
  git_sha text null,
  kb_version text null,
  side_effects_mode text not null check (side_effects_mode in ('sandbox', 'live')),
  passed integer null,
  total integer null,
  p50_ttfa_ms integer null,
  p95_ttfa_ms integer null,
  cost_estimate_usd numeric(12, 6) null
);

create table support_agent.evaluations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  eval_run_id uuid null references support_agent.eval_runs (id),
  scenario_key text not null,
  -- Exactly the evidence-table row name.
  test_case text not null,
  user_input text not null,
  expected_behavior text not null,
  actual_behavior text not null,
  passed boolean not null,
  notes text null,
  conversation_id uuid null references support_agent.conversations (id),
  channel text not null check (channel in ('eval', 'voice')),
  model text null,
  ttfa_ms integer null,
  cost_estimate_usd numeric(12, 6) null
);

create index evaluations_run_idx on support_agent.evaluations (eval_run_id);

create table support_agent.console_login_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip_hash text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);

create index console_login_attempts_ip_idx on support_agent.console_login_attempts (ip_hash, attempted_at);

-- Hybrid search in one function (DESIGN §8): cosine similarity and full-text
-- rank, fused by reciprocal rank. The full-text side ORs the query's words, so
-- a question phrased the way people talk still finds its section. The caller
-- applies the threshold to the top hit's cosine similarity.
create function support_agent.search_kb(query_embedding public.vector(1536), query_text text, match_count integer)
returns table (
  chunk_id text,
  kb_version text,
  source_title text,
  section_path text,
  source_summary text,
  text text,
  similarity double precision,
  text_rank real,
  rrf_score double precision
)
language sql
stable
set search_path = support_agent, public, extensions, pg_temp
as $$
  with query as (
    select nullif(replace(plainto_tsquery('english', coalesce(query_text, ''))::text, '&', '|'), '')::tsquery as tsq
  ),
  active as (
    select * from support_agent.kb_chunks where active
  ),
  semantic as (
    select a.chunk_id,
           1 - (a.embedding <=> query_embedding) as similarity,
           row_number() over (order by a.embedding <=> query_embedding) as rank
      from active a
     where query_embedding is not null and a.embedding is not null
  ),
  lexical as (
    select a.chunk_id,
           ts_rank_cd(a.fts, q.tsq) as text_rank,
           row_number() over (order by ts_rank_cd(a.fts, q.tsq) desc) as rank
      from active a, query q
     where q.tsq is not null and a.fts @@ q.tsq
  )
  select a.chunk_id, a.kb_version, a.source_title, a.section_path, a.source_summary, a.text,
         s.similarity, l.text_rank,
         coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as rrf_score
    from active a
    left join semantic s on s.chunk_id = a.chunk_id
    left join lexical l on l.chunk_id = a.chunk_id
   where s.chunk_id is not null or l.chunk_id is not null
   order by rrf_score desc, s.similarity desc nulls last
   limit greatest(match_count, 1)
$$;

revoke execute on function support_agent.search_kb(public.vector, text, integer) from public, anon, authenticated;

alter table support_agent.support_tickets enable row level security;
alter table support_agent.escalations enable row level security;
alter table support_agent.escalation_status_changes enable row level security;
alter table support_agent.jobs enable row level security;
alter table support_agent.kb_chunks enable row level security;
alter table support_agent.retrieval_logs enable row level security;
alter table support_agent.eval_runs enable row level security;
alter table support_agent.evaluations enable row level security;
alter table support_agent.console_login_attempts enable row level security;

revoke all on
  support_agent.support_tickets,
  support_agent.escalations,
  support_agent.escalation_status_changes,
  support_agent.jobs,
  support_agent.kb_chunks,
  support_agent.retrieval_logs,
  support_agent.eval_runs,
  support_agent.evaluations,
  support_agent.console_login_attempts
from public, anon, authenticated;

revoke all on sequence support_agent.ticket_ref_seq, support_agent.escalation_ref_seq from public, anon, authenticated;
