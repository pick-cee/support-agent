-- Typed messages on the web page (DESIGN §13, added 2026-09-29 at Akin's
-- request): a customer can type instead of speaking, through the same turn
-- runner and checks as a call. Its conversations use channel 'text'. The
-- caller identifier is a keyed hash of the visitor's IP address, never the
-- address itself, and it is used only to limit how fast one visitor can send.

alter table support_agent.conversations drop constraint conversations_channel_check;
alter table support_agent.conversations
  add constraint conversations_channel_check check (channel in ('web', 'phone', 'text', 'eval', 'mcp_direct'));

create index conversations_text_visitor_idx on support_agent.conversations (caller_identifier, created_at desc) where channel = 'text';
