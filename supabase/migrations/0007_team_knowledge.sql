-- The agent learns, with a person in the loop (DESIGN §8; added 2026-09-30 at
-- Akin's request). The console's knowledge page turns what the agent could not
-- answer into approved knowledge: the team writes an answer to a real
-- customer's question, or posts a time-limited service notice ("payouts to
-- Kenya are delayed today"). Each entry is embedded and searched exactly like
-- the knowledge base, labelled as coming from the support team. Nothing the
-- agent says becomes knowledge on its own: an unreviewed answer that turned
-- out wrong would be repeated to every later customer.

alter table support_agent.kb_chunks
  add column origin text not null default 'document' check (origin in ('document', 'team')),
  add column expires_at timestamptz null;

-- Whether an answer was stated by the knowledge or worked out from it; an
-- inferred answer is spoken with code's "not certain" sentence (DESIGN §8).
alter table support_agent.conversation_turns
  add column grounding text null check (grounding in ('direct', 'inferred'));

create table support_agent.team_knowledge (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('answer', 'notice')),
  -- An answer's title is the question it answers; a notice's is its headline.
  title text not null check (length(title) between 3 and 200),
  body text not null check (length(body) between 3 and 2000),
  -- The customer question from the knowledge gaps that prompted it, if any.
  source_question text null,
  expires_at timestamptz null,
  active boolean not null default true,
  -- The kb_chunks row this entry is searched as (kb_version 'team').
  chunk_id text not null unique
);

alter table support_agent.team_knowledge enable row level security;
revoke all on support_agent.team_knowledge from public, anon, authenticated;

-- Search leaves out a notice once it has expired. Otherwise unchanged from 0004.
create or replace function support_agent.search_kb(query_embedding public.vector(1536), query_text text, match_count integer)
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
    select * from support_agent.kb_chunks where active and (expires_at is null or expires_at > now())
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
   order by (s.rank = 1) desc nulls last, rrf_score desc, s.similarity desc nulls last
   limit greatest(match_count, 1)
$$;

revoke execute on function support_agent.search_kb(public.vector, text, integer) from public, anon, authenticated;
