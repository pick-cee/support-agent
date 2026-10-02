-- The callback times last offered on a conversation (DESIGN §5, FAILURES 37).
-- Each turn is a fresh agent run that sees the transcript but not earlier tool
-- results, so confirming a time used to cost a second slot search before the
-- booking, and that turn often passed the deadline. find_callback_slots
-- writes what it offered here; the next turn's call state lists them, and
-- create_escalation books only one of them.
alter table support_agent.conversations
  add column if not exists offered_slots jsonb null;
