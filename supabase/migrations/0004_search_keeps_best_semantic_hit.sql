-- The threshold is applied to the top hit's cosine similarity (DESIGN §8), so
-- that hit must be among the chunks the agent sees. Plain reciprocal-rank
-- fusion let longer chunks with more keyword matches push it out: for "Can
-- RelayPay guarantee a payout arrival time?" the FAQ "Can RelayPay Guarantee
-- Payment Timelines?" was missing from the top four (eval run, 2026-09-29).
-- The best semantic hit now comes first; the rest follow by fused rank.

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
   order by (s.rank = 1) desc nulls last, rrf_score desc, s.similarity desc nulls last
   limit greatest(match_count, 1)
$$;

revoke execute on function support_agent.search_kb(public.vector, text, integer) from public, anon, authenticated;
