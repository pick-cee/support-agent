-- Who receives the system's emails (DESIGN §10.3, §14; added 2026-09-30 at
-- Akin's request, replacing the SUPPORT_INBOX_EMAIL variable). The team adds
-- and removes people in the console, and chooses per person which emails they
-- get: escalation handoffs, critical alerts, warnings.

create table support_agent.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 254),
  name text null check (name is null or length(name) <= 120),
  escalations boolean not null default true,
  critical_alerts boolean not null default true,
  warning_alerts boolean not null default false,
  active boolean not null default true
);

create unique index notification_recipients_email_idx on support_agent.notification_recipients (lower(email));

alter table support_agent.notification_recipients enable row level security;
revoke all on support_agent.notification_recipients from public, anon, authenticated;

-- Why a handoff email was not sent, when it was not: for example, nobody is set
-- to receive escalation emails. Shown in the console beside the escalation.
alter table support_agent.escalations add column notification_error text null;
