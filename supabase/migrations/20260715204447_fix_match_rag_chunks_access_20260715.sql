-- SECURITY FIX: la versione ibrida di match_rag_chunks (20260714000001) aveva
-- perso il filtro sugli accessi presente nella versione originale. Essendo
-- SECURITY DEFINER ed eseguibile da authenticated, permetteva a qualsiasi
-- utente autenticato di leggere i chunk (contenuto testuale) di QUALSIASI
-- documento, inclusi quelli a pagamento non acquistati. Ripristina il vincolo
-- rag_accessible_document_ids(auth.uid()) mantenendo lo scoring ibrido.

create or replace function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  p_embedding_model text,
  p_embedding_version text,
  match_count int default 8,
  filter_document_ids uuid[] default null,
  min_similarity float default 0.0,
  query_text text default null,
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
      -- Autorizzazione: solo documenti accessibili al chiamante. Con
      -- auth.uid() null (service role) non torna nulla: i caller server-side
      -- passano sempre il JWT dell'utente.
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
  limit greatest(1, least(match_count, 50));
$$;
