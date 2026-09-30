-- The runtime records a call writes from its first turn (DESIGN §9.2).
-- Every table has id and created_at; that is the timestamp the PRD asks for.

create table support_agent.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vapi_call_id text unique,
  channel text not null check (channel in ('web', 'phone', 'eval', 'mcp_direct')),
  -- The phone number when there is one. Stored, never used as proof of identity.
  caller_identifier text null,
  started_at timestamptz null,
  ended_at timestamptz null,
  ended_reason text null,
  -- Computed in code at the end of the call (DESIGN §2.10). Nobody types it.
  final_status text null check (final_status in ('resolved', 'ticket_created', 'escalated', 'abandoned', 'failed')),
  summary text null,
  verified_customer_id text null references support_agent.customers (customer_id),
  -- The escalations table arrives in Phase 5; its foreign key is added then.
  escalation_id uuid null,
  clarify_streak integer not null default 0 check (clarify_streak >= 0),
  turn_count integer not null default 0 check (turn_count >= 0),
  -- Real billing, from Vapi's end-of-call report.
  vapi_cost_usd numeric(12, 4) null,
  -- The Agent SDK's client-side estimate. Labelled as one everywhere; never added to Vapi's cost.
  agent_cost_estimate_usd numeric(12, 6) not null default 0,
  raw_end_report jsonb null
);

create index conversations_created_idx on support_agent.conversations (created_at desc);

create table support_agent.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  conversation_id uuid not null references support_agent.conversations (id),
  turn_index integer not null check (turn_index >= 0),
  -- Vapi retries and interruptions resend a turn; the latest attempt is kept.
  attempt integer not null default 1 check (attempt >= 1),
  user_text text not null,
  user_text_truncated boolean not null default false,
  spoken_text text null,
  answer_type text null check (answer_type in ('answer', 'clarify', 'lookup_result', 'ticket_created', 'escalate', 'collect_details', 'decline', 'closing')),
  -- Who wrote what was spoken: the agent (after the gates), a fixed fallback, or a cheap check with no model.
  reply_source text null check (reply_source in ('agent', 'fallback', 'cheap_check')),
  confidence_note text null,
  kb_chunk_ids text[] not null default '{}',
  gate_results jsonb not null default '[]',
  repaired boolean not null default false,
  fallback_used boolean not null default false,
  filler_used boolean not null default false,
  status text not null default 'in_progress' check (status in ('in_progress', 'ok', 'error', 'interrupted')),
  error text null,
  model text null,
  input_tokens integer null,
  output_tokens integer null,
  cache_read_tokens integer null,
  cache_write_tokens integer null,
  -- The SDK's estimate, labelled as one.
  cost_estimate_usd numeric(12, 6) null,
  -- Time to the first streamed token (filler or answer), and to the final text.
  ttft_ms integer null,
  total_ms integer null,
  -- Phase 0 measurements and the SDK's own timing fields, as reported.
  timings jsonb not null default '{}',
  unique (conversation_id, turn_index)
);

create table support_agent.tool_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid null references support_agent.conversations (id),
  turn_id uuid null references support_agent.conversation_turns (id),
  tool_name text not null,
  -- Built by code from the input, never written by the model.
  purpose text not null,
  -- Emails masked.
  input_redacted jsonb not null default '{}',
  result_summary text null,
  status text not null check (status in ('ok', 'not_found', 'refused', 'invalid_input', 'error')),
  error_message text null,
  duration_ms integer not null check (duration_ms >= 0),
  via text not null check (via in ('agent', 'mcp_direct'))
);

create index tool_calls_conversation_idx on support_agent.tool_calls (conversation_id, created_at);
create index tool_calls_turn_idx on support_agent.tool_calls (turn_id);

create table support_agent.conversation_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid null references support_agent.conversations (id),
  turn_id uuid null references support_agent.conversation_turns (id),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]*$'),
  summary text not null,
  metadata jsonb not null default '{}',
  -- agent: from log_conversation_event. system: written by the server itself.
  source text not null check (source in ('agent', 'system'))
);

create index conversation_events_conversation_idx on support_agent.conversation_events (conversation_id, created_at);

-- One row per distinct problem, counted, so a broken dependency is one alert
-- and not one per call (DESIGN §10.4). Delivery by email arrives in Phase 5.
create table support_agent.alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  fingerprint text not null unique,
  message text not null,
  context jsonb not null default '{}',
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  notified_at timestamptz null
);

alter table support_agent.conversations enable row level security;
alter table support_agent.conversation_turns enable row level security;
alter table support_agent.tool_calls enable row level security;
alter table support_agent.conversation_events enable row level security;
alter table support_agent.alerts enable row level security;

revoke all on
  support_agent.conversations,
  support_agent.conversation_turns,
  support_agent.tool_calls,
  support_agent.conversation_events,
  support_agent.alerts
from public, anon, authenticated;
