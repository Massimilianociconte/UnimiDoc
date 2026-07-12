-- ============================================================================
-- Ripasso intelligente delle flashcard per capitolo/argomento (pgvector).
--
-- match_review_flashcards(): dato un insieme di flashcard "seme" (tipicamente
-- gli errori di un capitolo), calcola il centroide degli embedding dei loro
-- chunk sorgente e restituisce le ALTRE flashcard dell'utente più vicine in
-- spazio vettoriale — così un ripasso "per capitolo" richiama anche le card
-- semanticamente adiacenti, anche se etichettate sotto sezioni o documenti
-- diversi.
--
-- SECURITY: security definer ma interamente vincolato a auth.uid() = owner_id
-- su flashcards ed embeddings: un utente può recuperare solo le PROPRIE card.
-- Lo spazio vettoriale (embedding_model, embedding_version) viene dedotto dai
-- semi, così client e funzione restano allineati senza parametri di modello.
-- ============================================================================

create or replace function public.match_review_flashcards(
  p_seed_flashcards uuid[],
  p_limit int default 20
)
returns table (
  flashcard_id uuid,
  document_id uuid,
  chunk_id uuid,
  subject text,
  chapter_title text,
  topic text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with me as (select auth.uid() as uid),
  seed_emb as (
    select e.embedding, e.embedding_model, e.embedding_version
    from public.flashcards f
    join public.rag_chunk_embeddings e on e.chunk_id = f.chunk_id
    where f.id = any(p_seed_flashcards)
      and f.owner_id = (select uid from me)
      and e.owner_id = (select uid from me)
      and e.embedding_status = 'embedded'
      and e.embedding is not null
  ),
  space as (
    select embedding_model, embedding_version
    from seed_emb
    group by embedding_model, embedding_version
    order by count(*) desc
    limit 1
  ),
  centroid as (
    select avg(s.embedding) as center
    from seed_emb s, space
    where s.embedding_model = space.embedding_model
      and s.embedding_version = space.embedding_version
  )
  select
    f.id,
    f.document_id,
    f.chunk_id,
    f.subject,
    f.chapter_title,
    f.topic,
    1 - (e.embedding <=> (select center from centroid)) as similarity
  from public.flashcards f
  join public.rag_chunk_embeddings e on e.chunk_id = f.chunk_id
  cross join space
  where f.owner_id = (select uid from me)
    and f.status <> 'deleted'
    and e.owner_id = (select uid from me)
    and e.embedding_status = 'embedded'
    and e.embedding_model = space.embedding_model
    and e.embedding_version = space.embedding_version
    and e.embedding is not null
    and (select center from centroid) is not null
    and f.id <> all(p_seed_flashcards)
  order by e.embedding <=> (select center from centroid)
  limit greatest(1, least(coalesce(p_limit, 20), 60))
$$;

revoke all on function public.match_review_flashcards(uuid[], int) from public, anon;
grant execute on function public.match_review_flashcards(uuid[], int) to authenticated, service_role;
