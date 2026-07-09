-- ============================================================================
-- Lightweight RAG on Supabase Postgres + pgvector.
--
-- Design note (no duplication): the chunk schema ALREADY exists as
-- public.pdf_chunks (document_id, owner_id, page_start/page_end, section_path,
-- chunk_index, content, content_sha256, token_estimate, structure). The
-- flashcard pipeline (server/pdf-pipeline/pipeline.ts -> chunkStructuredPdf)
-- produces exactly these chunks. So RAG does NOT re-create a rag_chunks table.
-- Instead it adds a MODEL-VERSIONED companion table `rag_chunk_embeddings`
-- keyed by chunk_id, so multiple embedding models/versions can coexist without
-- ever mixing them, and re-indexing never rewrites the chunk content.
--
-- The original PDF stays in Storage (bucket 'private-documents'); only chunks
-- (already in pdf_chunks) + embeddings + light metadata live in Postgres.
-- ============================================================================

-- pgvector lives in the dedicated `extensions` schema (Supabase convention).
create extension if not exists vector with schema extensions;

-- --------------------------------------------------------------------------
-- Per-document indexing status, surfaced in the dashboard/viewer.
-- --------------------------------------------------------------------------
alter table public.documents
  add column if not exists rag_status text not null default 'not_indexed'
    check (rag_status in ('not_indexed', 'queued', 'processing', 'indexed', 'failed', 'partial')),
  add column if not exists rag_chunk_count integer not null default 0 check (rag_chunk_count >= 0),
  add column if not exists rag_index_version integer not null default 0 check (rag_index_version >= 0),
  add column if not exists rag_indexed_at timestamptz;

-- --------------------------------------------------------------------------
-- Embeddings companion table. 768 dims = Gemini text-embedding-004 (see
-- supabase/functions/_shared/embeddings.ts). Change BOTH the column dimension
-- and embedding_model/embedding_version together if the model ever changes.
-- --------------------------------------------------------------------------
create table if not exists public.rag_chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.pdf_chunks(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  embedding extensions.vector(768),
  embedding_model text not null,
  embedding_version text not null default '1',
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'embedded', 'failed')),
  -- Copied from pdf_chunks.content_sha256 so identical text (across docs or
  -- re-indexing) can skip re-embedding.
  content_hash text not null check (char_length(content_hash) = 64),
  token_count integer not null default 0 check (token_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chunk_id, embedding_model, embedding_version)
);

create index if not exists rag_chunk_embeddings_document_idx
  on public.rag_chunk_embeddings (document_id, embedding_status);
create index if not exists rag_chunk_embeddings_owner_idx
  on public.rag_chunk_embeddings (owner_id);
create index if not exists rag_chunk_embeddings_hash_idx
  on public.rag_chunk_embeddings (content_hash, embedding_model, embedding_version);

-- Approximate-nearest-neighbour index (cosine). HNSW needs no training step and
-- gives better recall than ivfflat for our volumes. Only embedded rows.
create index if not exists rag_chunk_embeddings_hnsw_idx
  on public.rag_chunk_embeddings using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

drop trigger if exists rag_chunk_embeddings_set_updated_at on public.rag_chunk_embeddings;
create trigger rag_chunk_embeddings_set_updated_at
  before update on public.rag_chunk_embeddings
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Async embedding jobs (one per document per index run).
-- --------------------------------------------------------------------------
create table if not exists public.rag_embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'partial')),
  chunks_total integer not null default 0 check (chunks_total >= 0),
  chunks_embedded integer not null default 0 check (chunks_embedded >= 0),
  embedding_model text,
  embedding_version text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rag_embedding_jobs_document_idx
  on public.rag_embedding_jobs (document_id, created_at desc);
create index if not exists rag_embedding_jobs_user_status_idx
  on public.rag_embedding_jobs (user_id, status, created_at desc);

drop trigger if exists rag_embedding_jobs_set_updated_at on public.rag_embedding_jobs;
create trigger rag_embedding_jobs_set_updated_at
  before update on public.rag_embedding_jobs
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Lightweight query logs (monitoring only — no heavy payloads).
-- --------------------------------------------------------------------------
create table if not exists public.rag_query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  query text not null check (char_length(query) <= 2000),
  document_ids uuid[] not null default '{}',
  matched_chunk_ids uuid[] not null default '{}',
  match_count integer not null default 0,
  top_similarity numeric(5, 4),
  model_used text,
  created_at timestamptz not null default now()
);

create index if not exists rag_query_logs_user_idx
  on public.rag_query_logs (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- RLS. Retrieval never reads these tables directly from the client — it goes
-- through the SECURITY DEFINER match_rag_chunks() below, which enforces the
-- authoritative access rule. So the table policies stay strict owner-only.
-- --------------------------------------------------------------------------
alter table public.rag_chunk_embeddings enable row level security;
alter table public.rag_embedding_jobs enable row level security;
alter table public.rag_query_logs enable row level security;

create policy "Users can read own embeddings"
  on public.rag_chunk_embeddings for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can read own embedding jobs"
  on public.rag_embedding_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read own query logs"
  on public.rag_query_logs for select to authenticated
  using ((select auth.uid()) = user_id);

-- --------------------------------------------------------------------------
-- Authoritative access rule: which documents may a user query?
--   * documents they own (uploaded),
--   * documents they purchased,
--   * published free documents,
--   * published premium-full documents when the caller has active premium.
-- Reused by match_rag_chunks and the manifest/pack endpoints.
-- --------------------------------------------------------------------------
create or replace function public.rag_accessible_document_ids(p_user uuid)
returns table (document_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id
  from public.documents d
  where p_user is not null
    and (
      d.owner_id = p_user
      or exists (
        select 1 from public.document_purchases p
        where p.document_id = d.id and p.buyer_id = p_user
      )
      or (
        d.visibility = 'published'
        and coalesce(d.price_credits, 0) = 0
      )
      or (
        d.visibility = 'published'
        and d.preview_policy = 'premium_full'
        and exists (
          select 1
          from public.user_entitlements e
          where e.owner_id = p_user
            and (e.premium_until is null or e.premium_until > now())
            and (e.plan = 'premium' or e.ai_flashcards_enabled = true)
        )
      )
    )
$$;

-- --------------------------------------------------------------------------
-- Vector search. Returns ONLY chunks from documents the caller may access.
-- match_count is clamped to [1, 24]. Cosine similarity = 1 - distance.
-- --------------------------------------------------------------------------
create or replace function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  match_count int default 8,
  filter_document_ids uuid[] default null,
  min_similarity float default 0.0
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
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    c.id,
    c.document_id,
    c.page_start,
    c.page_end,
    c.section_path,
    c.chunk_index,
    c.content,
    c.structure,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.rag_chunk_embeddings e
  join public.pdf_chunks c on c.id = e.chunk_id
  where e.embedding is not null
    and e.embedding_status = 'embedded'
    and c.document_id in (
      select ad.document_id from public.rag_accessible_document_ids(auth.uid()) ad
    )
    and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    and (1 - (e.embedding <=> query_embedding)) >= min_similarity
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 24))
$$;

-- Callable by authenticated users only; the functions enforce access internally.
revoke all on function public.rag_accessible_document_ids(uuid) from public, anon;
revoke all on function public.match_rag_chunks(extensions.vector, int, uuid[], float) from public, anon;
revoke all on function public.rag_accessible_document_ids(uuid) from authenticated;
grant execute on function public.rag_accessible_document_ids(uuid) to service_role;
grant execute on function public.match_rag_chunks(extensions.vector, int, uuid[], float) to authenticated, service_role;
