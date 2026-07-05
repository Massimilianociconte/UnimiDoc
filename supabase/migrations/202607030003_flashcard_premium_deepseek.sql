create table if not exists public.user_entitlements (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'base', 'premium')),
  premium_until timestamptz,
  ai_flashcards_enabled boolean not null default false,
  monthly_page_limit integer not null default 0 check (monthly_page_limit >= 0),
  monthly_flashcard_limit integer not null default 0 check (monthly_flashcard_limit >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_monthly_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  pages_processed integer not null default 0 check (pages_processed >= 0),
  flashcards_generated integer not null default 0 check (flashcards_generated >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(10, 5) not null default 0 check (estimated_cost_usd >= 0),
  job_count integer not null default 0 check (job_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, period_start)
);

create table if not exists public.flashcard_generation_cache (
  id uuid primary key default gen_random_uuid(),
  document_hash text not null check (char_length(document_hash) = 64),
  owner_id uuid references auth.users(id) on delete cascade,
  visibility text not null check (visibility in ('private', 'submitted', 'published', 'rejected')),
  model_name text not null,
  prompt_version text not null,
  language text not null default 'it',
  generation_mode text not null check (generation_mode in ('free', 'base', 'premium')),
  detail_level text not null default 'standard',
  chunk_sha256 text not null check (char_length(chunk_sha256) = 64),
  cache_key text not null unique check (char_length(cache_key) = 64),
  card_payload jsonb not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(10, 5) not null default 0 check (estimated_cost_usd >= 0),
  hit_count integer not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    document_hash,
    owner_id,
    visibility,
    model_name,
    prompt_version,
    language,
    generation_mode,
    detail_level,
    chunk_sha256
  )
);

alter table public.documents
add column if not exists normalized_text_sha256 text check (
  normalized_text_sha256 is null or char_length(normalized_text_sha256) = 64
);

alter table public.pdf_processing_jobs
add column if not exists model_name text,
add column if not exists prompt_version text,
add column if not exists generation_mode text check (
  generation_mode is null or generation_mode in ('free', 'base', 'premium')
),
add column if not exists cache_key text check (cache_key is null or char_length(cache_key) = 64),
add column if not exists input_tokens integer not null default 0 check (input_tokens >= 0),
add column if not exists cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
add column if not exists output_tokens integer not null default 0 check (output_tokens >= 0);

alter table public.pdf_chunks
add column if not exists semantic_score numeric(5, 3) not null default 0 check (semantic_score >= 0),
add column if not exists excluded_reason text;

alter table public.flashcards
add column if not exists cache_key text check (cache_key is null or char_length(cache_key) = 64),
add column if not exists input_tokens integer not null default 0 check (input_tokens >= 0),
add column if not exists cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
add column if not exists output_tokens integer not null default 0 check (output_tokens >= 0),
add column if not exists estimated_cost_usd numeric(10, 5) not null default 0 check (estimated_cost_usd >= 0);

create index if not exists user_entitlements_plan_idx on public.user_entitlements (plan, premium_until);
create index if not exists ai_monthly_usage_owner_period_idx on public.ai_monthly_usage (owner_id, period_start desc);
create index if not exists flashcard_generation_cache_lookup_idx on public.flashcard_generation_cache (
  document_hash,
  owner_id,
  visibility,
  model_name,
  prompt_version,
  language,
  generation_mode,
  detail_level,
  chunk_sha256
);
create index if not exists documents_normalized_text_hash_idx on public.documents (normalized_text_sha256);
create index if not exists pdf_processing_jobs_cache_key_idx on public.pdf_processing_jobs (cache_key);
create index if not exists flashcards_cache_key_idx on public.flashcards (cache_key);

drop trigger if exists user_entitlements_set_updated_at on public.user_entitlements;
create trigger user_entitlements_set_updated_at
before update on public.user_entitlements
for each row execute function public.set_updated_at();

drop trigger if exists ai_monthly_usage_set_updated_at on public.ai_monthly_usage;
create trigger ai_monthly_usage_set_updated_at
before update on public.ai_monthly_usage
for each row execute function public.set_updated_at();

drop trigger if exists flashcard_generation_cache_set_updated_at on public.flashcard_generation_cache;
create trigger flashcard_generation_cache_set_updated_at
before update on public.flashcard_generation_cache
for each row execute function public.set_updated_at();

alter table public.user_entitlements enable row level security;
alter table public.ai_monthly_usage enable row level security;
alter table public.flashcard_generation_cache enable row level security;

drop policy if exists "Users can read own entitlement" on public.user_entitlements;
create policy "Users can read own entitlement"
on public.user_entitlements for select to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Users can read own AI monthly usage" on public.ai_monthly_usage;
create policy "Users can read own AI monthly usage"
on public.ai_monthly_usage for select to authenticated
using ((select auth.uid()) = owner_id);

-- No client policy for flashcard_generation_cache:
-- service role only. Generated cards are exposed through public.flashcards after
-- ownership, visibility and moderation checks.
