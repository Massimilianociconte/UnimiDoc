-- RAG Hybrid Search + improved retrieval strategy
-- Adds optional keyword/hybrid scoring to match_rag_chunks using ts_rank
-- Introduces a new smarter selection path while keeping backward compatibility.

-- Make sure italian text search configuration is usable (usually present)
-- If not, 'simple' will be used as fallback inside the function.

-- The previous 6-parameter version must be dropped first: CREATE OR REPLACE
-- cannot change the return type (adds rank_score), and keeping both would
-- leave an ambiguous overload for PostgREST RPC calls.
drop function if exists public.match_rag_chunks(extensions.vector, text, text, int, uuid[], double precision);

create or replace function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  p_embedding_model text,
  p_embedding_version text,
  match_count int default 8,
  filter_document_ids uuid[] default null,
  min_similarity float default 0.0,
  -- NEW: optional query text for hybrid search
  query_text text default null,
  -- NEW: weight for keyword component (0 = pure vector, 1 = full keyword)
  hybrid_alpha float default 0.25
)
returns table (
  chunk_id uuid,
  document_id uuid,
  page_start int,
  page_end int,
  section_path text[],
  chunk_index int,
  content text,
  structure jsonb,
  similarity float,
  -- NEW: combined score for downstream re-ranking
  rank_score float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with vec as (
    select
      c.id as chunk_id,
      c.document_id,
      c.page_start,
      c.page_end,
      c.section_path,
      c.chunk_index,
      c.content,
      c.structure,
      (1 - (e.embedding <=> query_embedding)) as vec_sim
    from public.pdf_chunks c
    join public.rag_chunk_embeddings e on e.chunk_id = c.id
    where e.embedding_model = p_embedding_model
      and e.embedding_version = p_embedding_version
      and e.embedding_status = 'embedded'
      and c.is_active = true
      and c.processing_state = 'ready'
      -- Autorizzazione: solo documenti accessibili al chiamante (stessa regola
      -- della versione 6-parametri). Senza questo vincolo la funzione, essendo
      -- SECURITY DEFINER, esporrebbe i chunk di qualsiasi documento.
      and c.document_id in (
        select ad.document_id from public.rag_accessible_document_ids(auth.uid()) ad
      )
      and (filter_document_ids is null or c.document_id = any(filter_document_ids))
      and (1 - (e.embedding <=> query_embedding)) >= min_similarity
  ),
  kw as (
    select
      v.*,
      case
        when query_text is null or length(query_text) < 3 then 0.0
        else ts_rank(
          to_tsvector('simple', v.content),
          plainto_tsquery('simple', query_text)
        )
      end as kw_score
    from vec v
  ),
  scored as (
    select
      *,
      -- Hybrid score: blend vector similarity and keyword rank
      ( (1 - hybrid_alpha) * vec_sim + hybrid_alpha * kw_score ) as combined
    from kw
  )
  select
    chunk_id,
    document_id,
    page_start,
    page_end,
    section_path,
    chunk_index,
    content,
    structure,
    vec_sim as similarity,
    combined as rank_score
  from scored
  order by combined desc
  limit greatest(1, least(match_count, 50));  -- allow higher recall for re-ranking
$$;

-- Re-grant
revoke all on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float, text, float) from public, anon;
grant execute on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float, text, float)
  to authenticated, service_role;

comment on function public.match_rag_chunks is 
'Hybrid vector + keyword retrieval. Pass query_text to activate hybrid scoring. rank_score is the blended score suitable for re-ranking.';

-- Optional: ensure we have a GIN index for future full-text if we decide to persist tsvector
-- (commented to avoid heavy migration cost now)
-- create index if not exists pdf_chunks_content_tsv_idx on pdf_chunks using gin (to_tsvector('simple', content));