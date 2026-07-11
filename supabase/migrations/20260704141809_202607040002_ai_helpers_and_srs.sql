-- ============================================================================
-- Bridge tables used by the Edge Functions that the core PDF/flashcard schema
-- does not already provide:
--   * ai_helps      — Explain / Follow-up / Example / Memo / Visualize history
--   * ai_cache      — generic content-hash cache for non-flashcard AI responses
--                     and image-occlusion candidates (service-role only)
--   * srs_state     — authoritative per-user, per-card spaced-repetition state
--   * user_answers  — quiz answer telemetry
-- Conventions match the rest of the schema (owner_id + RLS via auth.uid()).
-- Depends on public.flashcards and public.set_updated_at() from 202607030001.
-- ============================================================================

create table if not exists public.ai_helps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid references public.flashcards(id) on delete set null,
  mode text not null check (mode in ('explain', 'followup', 'example', 'memo', 'visualize')),
  input text,
  output text,
  provider text not null,
  model_name text not null,
  prompt_version text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(10, 5) not null default 0 check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_helps_owner_idx on public.ai_helps (owner_id, created_at desc);

-- Generic AI response cache (Explain/Memo/etc + occlusion candidates).
-- No RLS policy => reachable only via the service role.
create table if not exists public.ai_cache (
  cache_key text primary key check (char_length(cache_key) = 64),
  provider text not null,
  model_name text not null,
  prompt_version text not null,
  feature text not null,
  language text,
  output jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.srs_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  review_count integer not null default 0 check (review_count >= 0),
  lapse_count integer not null default 0 check (lapse_count >= 0),
  ease_factor real not null default 2.5 check (ease_factor >= 1.3 and ease_factor <= 3.0),
  interval_minutes integer not null default 0 check (interval_minutes >= 0),
  last_rating text check (last_rating in ('impossible', 'hard', 'ok', 'easy')),
  stage text not null default 'learning' check (stage in ('learning', 'review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, flashcard_id)
);
create index if not exists srs_state_due_idx on public.srs_state (owner_id, due_at);
drop trigger if exists srs_state_set_updated_at on public.srs_state;
create trigger srs_state_set_updated_at before update on public.srs_state
  for each row execute function public.set_updated_at();

create table if not exists public.user_answers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  quiz_session_id uuid,
  question_type text not null,
  user_answer text,
  correct_answer text,
  answer_status text not null check (answer_status in ('correct', 'incorrect', 'partial', 'unknown', 'skipped')),
  time_spent_ms integer,
  attempt_number integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists user_answers_owner_idx on public.user_answers (owner_id, created_at desc);

-- Atomic monthly usage rollup (avoids read-modify-write races).
create or replace function public.record_ai_monthly_usage(
  p_owner uuid,
  p_input integer,
  p_cached integer,
  p_output integer,
  p_cost numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', now())::date;
begin
  insert into public.ai_monthly_usage (
    owner_id, period_start, input_tokens, cached_input_tokens, output_tokens, estimated_cost_usd, job_count
  ) values (p_owner, v_period, greatest(p_input, 0), greatest(p_cached, 0), greatest(p_output, 0), greatest(p_cost, 0), 1)
  on conflict (owner_id, period_start) do update set
    input_tokens = ai_monthly_usage.input_tokens + excluded.input_tokens,
    cached_input_tokens = ai_monthly_usage.cached_input_tokens + excluded.cached_input_tokens,
    output_tokens = ai_monthly_usage.output_tokens + excluded.output_tokens,
    estimated_cost_usd = ai_monthly_usage.estimated_cost_usd + excluded.estimated_cost_usd,
    job_count = ai_monthly_usage.job_count + 1,
    updated_at = now();
end;
$$;

alter table public.ai_helps enable row level security;
alter table public.ai_cache enable row level security; -- no policies => service-role only
alter table public.srs_state enable row level security;
alter table public.user_answers enable row level security;

drop policy if exists "Users read own ai helps" on public.ai_helps;
create policy "Users read own ai helps" on public.ai_helps for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own srs" on public.srs_state;
create policy "Users manage own srs" on public.srs_state for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own answers" on public.user_answers;
create policy "Users manage own answers" on public.user_answers for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
