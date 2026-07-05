create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('private-documents', 'private-documents', false, 52428800, array['application/pdf']),
  ('derived-previews', 'derived-previews', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']),
  ('processing-temp', 'processing-temp', false, 52428800, array['application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 180),
  course_name text not null,
  professor text,
  academic_year text,
  original_file_sha256 text not null check (char_length(original_file_sha256) = 64),
  compressed_file_sha256 text check (compressed_file_sha256 is null or char_length(compressed_file_sha256) = 64),
  storage_bucket text not null default 'private-documents',
  storage_path text not null,
  original_size_bytes bigint not null check (original_size_bytes > 0),
  compressed_size_bytes bigint check (compressed_size_bytes is null or compressed_size_bytes > 0),
  mime_type text not null default 'application/pdf',
  page_count integer check (page_count is null or page_count > 0),
  language text,
  compression_status text not null default 'pending' check (compression_status in ('pending', 'running', 'compressed', 'kept_original', 'failed')),
  flashcard_status text not null default 'not_requested' check (flashcard_status in ('not_requested', 'queued', 'running', 'ready', 'needs_review', 'failed')),
  visibility text not null default 'private' check (visibility in ('private', 'submitted', 'published', 'rejected')),
  preview_policy text not null default 'protected' check (preview_policy in ('protected', 'premium_full', 'owner_full')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, original_file_sha256)
);

create table public.pdf_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null check (job_type in ('compress', 'extract', 'ocr', 'flashcards', 'quality_review')),
  requested_tier text not null default 'base' check (requested_tier in ('free', 'base', 'premium')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  input_hash text,
  settings_hash text,
  estimated_input_tokens integer not null default 0,
  estimated_output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 5) not null default 0,
  actual_cost_usd numeric(10, 5),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pdf_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  native_text text,
  native_text_chars integer not null default 0 check (native_text_chars >= 0),
  text_quality_score numeric(4, 3) not null default 0 check (text_quality_score >= 0 and text_quality_score <= 1),
  ocr_status text not null default 'not_needed' check (ocr_status in ('not_needed', 'queued', 'running', 'done', 'failed', 'skipped')),
  has_images boolean not null default false,
  has_tables boolean not null default false,
  has_formulas boolean not null default false,
  has_scientific_figures boolean not null default false,
  image_inventory jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, page_number)
);

create table public.pdf_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_start integer not null check (page_start > 0),
  page_end integer not null check (page_end >= page_start),
  section_path text[] not null default '{}',
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_sha256 text not null check (char_length(content_sha256) = 64),
  token_estimate integer not null default 0 check (token_estimate >= 0),
  structure jsonb not null default '{}'::jsonb,
  processing_state text not null default 'ready' check (processing_state in ('ready', 'cached', 'needs_ai', 'processed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id uuid references public.pdf_chunks(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_type text not null check (card_type in ('definition', 'function', 'process', 'sequence', 'cause_effect', 'comparison', 'classification', 'qa', 'cloze', 'table', 'image', 'chart', 'formula', 'exam_question')),
  front text not null check (char_length(front) between 3 and 1200),
  back text not null check (char_length(back) between 1 and 2400),
  cloze_text text,
  explanation text,
  tags text[] not null default '{}',
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  source_page_start integer check (source_page_start is null or source_page_start > 0),
  source_page_end integer check (source_page_end is null or source_page_end >= source_page_start),
  source_quote text,
  generation_method text not null default 'heuristic' check (generation_method in ('heuristic', 'cheap_ai', 'premium_ai', 'multimodal_ai', 'manual')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'needs_edit', 'rejected', 'deleted')),
  quality_score numeric(4, 3) not null default 0 check (quality_score >= 0 and quality_score <= 1),
  hallucination_risk numeric(4, 3) not null default 0 check (hallucination_risk >= 0 and hallucination_risk <= 1),
  duplicate_group_id uuid,
  model_name text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  rating integer check (rating between 1 and 5),
  action text not null check (action in ('approved', 'edited', 'regenerated', 'deleted', 'reported')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.ai_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  job_id uuid references public.pdf_processing_jobs(id) on delete set null,
  provider text not null,
  model_name text not null,
  operation text not null,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 5) not null,
  created_at timestamptz not null default now()
);

create table public.processed_chunk_cache (
  id uuid primary key default gen_random_uuid(),
  content_sha256 text not null check (char_length(content_sha256) = 64),
  settings_hash text not null check (char_length(settings_hash) = 64),
  source_language text,
  card_payload jsonb not null,
  quality_payload jsonb not null default '{}'::jsonb,
  model_name text,
  prompt_version text,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_sha256, settings_hash)
);

create index documents_owner_created_idx on public.documents (owner_id, created_at desc);
create index documents_owner_visibility_idx on public.documents (owner_id, visibility, created_at desc);
create index documents_storage_path_idx on public.documents (storage_bucket, storage_path);
create index documents_original_hash_idx on public.documents (original_file_sha256);

create index pdf_processing_jobs_owner_status_idx on public.pdf_processing_jobs (owner_id, status, created_at desc);
create index pdf_processing_jobs_document_type_idx on public.pdf_processing_jobs (document_id, job_type, status);

create index pdf_pages_document_page_idx on public.pdf_pages (document_id, page_number);
create index pdf_pages_owner_document_idx on public.pdf_pages (owner_id, document_id);

create index pdf_chunks_document_idx on public.pdf_chunks (document_id, chunk_index);
create index pdf_chunks_owner_document_idx on public.pdf_chunks (owner_id, document_id);
create index pdf_chunks_hash_idx on public.pdf_chunks (content_sha256);
create index pdf_chunks_structure_gin_idx on public.pdf_chunks using gin (structure jsonb_path_ops);

create index flashcards_owner_status_idx on public.flashcards (owner_id, status, created_at desc);
create index flashcards_document_status_idx on public.flashcards (document_id, status, card_type);
create index flashcards_chunk_idx on public.flashcards (chunk_id);
create index flashcards_tags_gin_idx on public.flashcards using gin (tags);

create index flashcard_reviews_owner_idx on public.flashcard_reviews (owner_id, created_at desc);
create index flashcard_reviews_card_idx on public.flashcard_reviews (flashcard_id);

create index ai_cost_ledger_owner_created_idx on public.ai_cost_ledger (owner_id, created_at desc);
create index ai_cost_ledger_job_idx on public.ai_cost_ledger (job_id);

create index processed_chunk_cache_lookup_idx on public.processed_chunk_cache (content_sha256, settings_hash);

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger pdf_processing_jobs_set_updated_at
before update on public.pdf_processing_jobs
for each row execute function public.set_updated_at();

create trigger pdf_pages_set_updated_at
before update on public.pdf_pages
for each row execute function public.set_updated_at();

create trigger pdf_chunks_set_updated_at
before update on public.pdf_chunks
for each row execute function public.set_updated_at();

create trigger flashcards_set_updated_at
before update on public.flashcards
for each row execute function public.set_updated_at();

create trigger processed_chunk_cache_set_updated_at
before update on public.processed_chunk_cache
for each row execute function public.set_updated_at();

alter table public.documents enable row level security;
alter table public.pdf_processing_jobs enable row level security;
alter table public.pdf_pages enable row level security;
alter table public.pdf_chunks enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_reviews enable row level security;
alter table public.ai_cost_ledger enable row level security;
alter table public.processed_chunk_cache enable row level security;

create policy "Users can read own documents"
on public.documents for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create own documents"
on public.documents for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can update own documents"
on public.documents for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can delete own documents"
on public.documents for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can read own jobs"
on public.pdf_processing_jobs for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create own jobs"
on public.pdf_processing_jobs for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can read own pages"
on public.pdf_pages for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can read own chunks"
on public.pdf_chunks for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can read own flashcards"
on public.flashcards for select to authenticated
using ((select auth.uid()) = owner_id and status <> 'deleted');

create policy "Users can update own flashcards"
on public.flashcards for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can create own flashcard reviews"
on public.flashcard_reviews for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can read own flashcard reviews"
on public.flashcard_reviews for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can read own cost ledger"
on public.ai_cost_ledger for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can upload own private PDF objects"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('private-documents', 'processing-temp') and
  (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can read own private objects"
on storage.objects for select to authenticated
using (
  bucket_id in ('private-documents', 'derived-previews', 'processing-temp') and
  (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete own temp objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'processing-temp' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);
