-- Verify before any lookup (DESIGN §7.2, changed 2026-10-02 at Akin's request).
-- Failed verification attempts are counted on the conversation, and the MCP
-- server closes lookups once VERIFY_MAX_FAILURES is reached: a caller cannot
-- keep guessing names and companies until one matches.
alter table support_agent.conversations
  add column if not exists verification_failures integer not null default 0 check (verification_failures >= 0);

-- A confirmation emailed to the customer when a ticket opens (DESIGN §10.5,
-- added 2026-10-02 at Akin's request). The address the caller gave and read
-- back, or the one on file; what happened to the email is recorded here.
alter table support_agent.support_tickets
  add column if not exists contact_email text null,
  add column if not exists confirmation_status text not null default 'not_requested'
    check (confirmation_status in ('not_requested', 'pending', 'sent', 'failed', 'skipped_eval', 'skipped_undeliverable')),
  add column if not exists confirmation_error text null;

-- The outbox gains a job kind for that email.
alter table support_agent.jobs drop constraint if exists jobs_kind_check;
alter table support_agent.jobs
  add constraint jobs_kind_check check (kind in ('book_callback', 'notify_escalation', 'notify_alert', 'notify_ticket'));
