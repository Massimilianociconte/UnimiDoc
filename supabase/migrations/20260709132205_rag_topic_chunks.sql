-- ============================================================================
-- RAG topic selection for flashcard generation.
--
-- rag_document_topic_chunks(): returns the chunks of a document ranked by
-- cosine similarity to the document's embedding centroid — i.e. the chunks
-- most representative of the document's core topics. Used by the
-- generate-flashcards edge function ("fromDocument" mode) to feed the LLM the
-- semantically most relevant material instead of raw sequential text.
--
-- SECURITY: service_role only. The edge function is responsible for the
-- caller's access check (rag_accessible_document_ids) BEFORE calling this.
-- ============================================================================

create or replace function public.rag_document_topic_chunks(
  p_document uuid,
  p_model text,
  p_version text,
  p_limit int default 48
)
returns table (
  chunk_id uuid,
  chunk_index int,
  page_start int,
  page_end int,
  section_path text[],
  content text,
  token_estimate int,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with centroid as (
    select avg(e.embedding) as center
    from public.rag_chunk_embeddings e
    join public.pdf_chunks current_chunk on current_chunk.id = e.chunk_id
    where e.document_id = p_document
      and e.embedding_status = 'embedded'
      and e.embedding_model = p_model
      and e.embedding_version = p_version
      and e.content_hash = current_chunk.content_sha256
      and current_chunk.document_id = p_document
      and current_chunk.processing_state <> 'failed'
      and e.embedding is not null
  )
  select
    pc.id,
    pc.chunk_index,
    pc.page_start,
    pc.page_end,
    pc.section_path,
    pc.content,
    pc.token_estimate,
    1 - (e.embedding <=> (select center from centroid)) as similarity
  from public.rag_chunk_embeddings e
  join public.pdf_chunks pc on pc.id = e.chunk_id
  where e.document_id = p_document
    and e.embedding_status = 'embedded'
    and e.embedding_model = p_model
    and e.embedding_version = p_version
    and e.content_hash = pc.content_sha256
    and pc.document_id = p_document
    and pc.processing_state <> 'failed'
    and e.embedding is not null
    and (select center from centroid) is not null
  order by e.embedding <=> (select center from centroid)
  limit greatest(1, least(p_limit, 120))
$$;

revoke all on function public.rag_document_topic_chunks(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.rag_document_topic_chunks(uuid, text, text, int) to service_role;
