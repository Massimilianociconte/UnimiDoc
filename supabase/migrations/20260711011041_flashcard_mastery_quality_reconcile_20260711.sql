-- ============================================================================
-- Flashcard mastery, dashboard filters and perceived didactic quality.
--
-- This layer does not replace srs_state/user_answers. It adds a fast, user-
-- scoped summary for dashboard filters and a fair quality metric for documents:
-- first compute each buyer's positive ratio, then average those ratios so a
-- single heavy reviewer cannot dominate a document's score.
-- ============================================================================

alter table public.flashcards
  add column if not exists outline_id uuid references public.document_outline(id) on delete set null,
  add column if not exists subject text,
  add column if not exists chapter_title text,
  add column if not exists section_title text,
  add column if not exists topic text,
  add column if not exists topic_confidence numeric(5,4) check (topic_confidence is null or (topic_confidence >= 0 and topic_confidence <= 1)),
  add column if not exists source_block_ids uuid[] not null default '{}',
  add column if not exists source_outline_path text[] not null default '{}',
  add column if not exists educational_quality_score numeric(4,3) check (educational_quality_score is null or (educational_quality_score >= 0 and educational_quality_score <= 1)),
  add column if not exists perceived_quality_percent numeric(5,2) check (perceived_quality_percent is null or (perceived_quality_percent >= 0 and perceived_quality_percent <= 100));

create index if not exists flashcards_document_topic_idx on public.flashcards (document_id, subject, chapter_title, topic);
create index if not exists flashcards_outline_idx on public.flashcards (outline_id) where outline_id is not null;
create index if not exists flashcards_source_blocks_gin_idx on public.flashcards using gin (source_block_ids);

create table if not exists public.user_flashcard_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  document_title text,
  document_author_id uuid references auth.users(id) on delete set null,
  document_author_name text,
  subject text,
  chapter_title text,
  section_title text,
  topic text,
  question text not null,
  answer text not null,
  latest_status text not null default 'unanswered' check (latest_status in ('unanswered', 'correct', 'incorrect', 'partial', 'skipped')),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  partial_count integer not null default 0 check (partial_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  last_reviewed_at timestamptz,
  next_due_at timestamptz,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  is_favorite boolean not null default false,
  needs_review boolean not null default false,
  source_page_start integer,
  source_page_end integer,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, flashcard_id)
);

create index if not exists user_flashcard_progress_owner_status_idx on public.user_flashcard_progress (owner_id, latest_status, updated_at desc);
create index if not exists user_flashcard_progress_owner_due_idx on public.user_flashcard_progress (owner_id, needs_review, next_due_at asc);
create index if not exists user_flashcard_progress_owner_filters_idx on public.user_flashcard_progress (owner_id, subject, document_id, chapter_title, topic);
create index if not exists user_flashcard_progress_owner_favorite_idx on public.user_flashcard_progress (owner_id, is_favorite, updated_at desc) where is_favorite;

create table if not exists public.flashcard_quality_votes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_author_id uuid references auth.users(id) on delete set null,
  outline_id uuid references public.document_outline(id) on delete set null,
  chapter_title text,
  section_title text,
  topic text,
  generation_method text,
  model_name text,
  prompt_version text,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, flashcard_id)
);

create index if not exists flashcard_quality_votes_doc_idx on public.flashcard_quality_votes (document_id, updated_at desc);
create index if not exists flashcard_quality_votes_owner_idx on public.flashcard_quality_votes (owner_id, updated_at desc);
create index if not exists flashcard_quality_votes_author_idx on public.flashcard_quality_votes (document_author_id, document_id);

create table if not exists public.document_flashcard_quality_rollups (
  document_id uuid primary key references public.documents(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  reviewer_count integer not null default 0 check (reviewer_count >= 0),
  total_votes integer not null default 0 check (total_votes >= 0),
  positive_votes integer not null default 0 check (positive_votes >= 0),
  negative_votes integer not null default 0 check (negative_votes >= 0),
  quality_percent numeric(5,2) check (quality_percent is null or (quality_percent >= 0 and quality_percent <= 100)),
  top_positive_topic text,
  most_problematic_topic text,
  computed_at timestamptz not null default now()
);

create index if not exists document_flashcard_quality_author_idx on public.document_flashcard_quality_rollups (author_id, quality_percent desc nulls last);

drop trigger if exists user_flashcard_progress_set_updated_at on public.user_flashcard_progress;
create trigger user_flashcard_progress_set_updated_at before update on public.user_flashcard_progress
  for each row execute function public.set_updated_at();

drop trigger if exists flashcard_quality_votes_set_updated_at on public.flashcard_quality_votes;
create trigger flashcard_quality_votes_set_updated_at before update on public.flashcard_quality_votes
  for each row execute function public.set_updated_at();

alter table public.user_flashcard_progress enable row level security;
alter table public.flashcard_quality_votes enable row level security;
alter table public.document_flashcard_quality_rollups enable row level security;

drop policy if exists "Users manage own flashcard progress" on public.user_flashcard_progress;
create policy "Users manage own flashcard progress" on public.user_flashcard_progress for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own flashcard quality votes" on public.flashcard_quality_votes;
create policy "Users manage own flashcard quality votes" on public.flashcard_quality_votes for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Anyone can read document flashcard quality" on public.document_flashcard_quality_rollups;
create policy "Anyone can read document flashcard quality" on public.document_flashcard_quality_rollups for select to anon, authenticated
  using (true);

create or replace function public.user_can_access_flashcard(p_flashcard_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.flashcards f
    join public.documents d on d.id = f.document_id
    where f.id = p_flashcard_id
      and f.status <> 'deleted'
      and (
        f.owner_id = (select auth.uid())
        or d.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.document_purchases p
          where p.document_id = f.document_id
            and p.buyer_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.record_flashcard_study_event(
  p_flashcard_id uuid,
  p_answer_status text,
  p_next_due_at timestamptz default null,
  p_last_reviewed_at timestamptz default now()
) returns public.user_flashcard_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_card record;
  v_row public.user_flashcard_progress;
  v_status text := coalesce(p_answer_status, 'skipped');
  v_needs_review boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if v_status not in ('correct', 'incorrect', 'partial', 'unknown', 'skipped', 'unanswered') then
    raise exception 'invalid_answer_status' using errcode = '22023';
  end if;

  select
    f.id,
    f.document_id,
    f.owner_id,
    f.front,
    f.back,
    f.difficulty,
    f.source_page_start,
    f.source_page_end,
    f.tags,
    f.subject,
    f.chapter_title,
    f.section_title,
    f.topic,
    d.title as document_title,
    d.owner_id as document_author_id,
    coalesce(p.full_name, d.owner_id::text) as document_author_name,
    d.course_name as document_subject
  into v_card
  from public.flashcards f
  join public.documents d on d.id = f.document_id
  left join public.profiles p on p.id = d.owner_id
  where f.id = p_flashcard_id
    and f.status <> 'deleted';

  if not found or not public.user_can_access_flashcard(p_flashcard_id) then
    raise exception 'flashcard_not_accessible' using errcode = 'P0001';
  end if;

  v_status := case when v_status = 'unknown' then 'incorrect' else v_status end;
  v_needs_review := v_status in ('incorrect', 'partial', 'skipped') or (p_next_due_at is not null and p_next_due_at <= now());

  insert into public.user_flashcard_progress (
    owner_id,
    flashcard_id,
    document_id,
    document_title,
    document_author_id,
    document_author_name,
    subject,
    chapter_title,
    section_title,
    topic,
    question,
    answer,
    latest_status,
    attempts_count,
    correct_count,
    incorrect_count,
    partial_count,
    skipped_count,
    last_reviewed_at,
    next_due_at,
    difficulty,
    needs_review,
    source_page_start,
    source_page_end,
    tags
  ) values (
    v_user,
    v_card.id,
    v_card.document_id,
    v_card.document_title,
    v_card.document_author_id,
    v_card.document_author_name,
    coalesce(v_card.subject, v_card.document_subject),
    v_card.chapter_title,
    v_card.section_title,
    v_card.topic,
    v_card.front,
    v_card.back,
    v_status,
    case when v_status = 'unanswered' then 0 else 1 end,
    case when v_status = 'correct' then 1 else 0 end,
    case when v_status = 'incorrect' then 1 else 0 end,
    case when v_status = 'partial' then 1 else 0 end,
    case when v_status = 'skipped' then 1 else 0 end,
    case when v_status = 'unanswered' then null else p_last_reviewed_at end,
    p_next_due_at,
    coalesce(v_card.difficulty, 'medium'),
    v_needs_review,
    v_card.source_page_start,
    v_card.source_page_end,
    coalesce(v_card.tags, '{}')
  )
  on conflict (owner_id, flashcard_id) do update set
    document_id = excluded.document_id,
    document_title = excluded.document_title,
    document_author_id = excluded.document_author_id,
    document_author_name = excluded.document_author_name,
    subject = excluded.subject,
    chapter_title = excluded.chapter_title,
    section_title = excluded.section_title,
    topic = excluded.topic,
    question = excluded.question,
    answer = excluded.answer,
    latest_status = excluded.latest_status,
    attempts_count = user_flashcard_progress.attempts_count + excluded.attempts_count,
    correct_count = user_flashcard_progress.correct_count + excluded.correct_count,
    incorrect_count = user_flashcard_progress.incorrect_count + excluded.incorrect_count,
    partial_count = user_flashcard_progress.partial_count + excluded.partial_count,
    skipped_count = user_flashcard_progress.skipped_count + excluded.skipped_count,
    last_reviewed_at = coalesce(excluded.last_reviewed_at, user_flashcard_progress.last_reviewed_at),
    next_due_at = excluded.next_due_at,
    difficulty = excluded.difficulty,
    needs_review = excluded.needs_review,
    source_page_start = excluded.source_page_start,
    source_page_end = excluded.source_page_end,
    tags = excluded.tags
  returning * into v_row;

  insert into public.document_study_progress (
    owner_id,
    document_id,
    flashcards_total,
    flashcards_mastered,
    quiz_accuracy,
    last_studied_at
  )
  select
    v_user,
    v_card.document_id,
    count(*),
    count(*) filter (where latest_status = 'correct'),
    case when count(*) filter (where latest_status in ('correct','incorrect','partial')) = 0 then null
      else round((count(*) filter (where latest_status = 'correct'))::numeric * 100 / (count(*) filter (where latest_status in ('correct','incorrect','partial'))), 2)
    end,
    now()
  from public.user_flashcard_progress
  where owner_id = v_user and document_id = v_card.document_id
  on conflict (owner_id, document_id) do update set
    flashcards_total = excluded.flashcards_total,
    flashcards_mastered = excluded.flashcards_mastered,
    quiz_accuracy = excluded.quiz_accuracy,
    last_studied_at = excluded.last_studied_at;

  insert into public.subject_study_progress (
    owner_id,
    subject,
    documents_count,
    due_reviews,
    average_accuracy
  )
  select
    v_user,
    coalesce(v_row.subject, 'Senza materia'),
    count(distinct document_id),
    count(*) filter (where needs_review),
    case when count(*) filter (where latest_status in ('correct','incorrect','partial')) = 0 then null
      else round((count(*) filter (where latest_status = 'correct'))::numeric * 100 / (count(*) filter (where latest_status in ('correct','incorrect','partial'))), 2)
    end
  from public.user_flashcard_progress
  where owner_id = v_user and subject = coalesce(v_row.subject, 'Senza materia')
  on conflict (owner_id, subject) do update set
    documents_count = excluded.documents_count,
    due_reviews = excluded.due_reviews,
    average_accuracy = excluded.average_accuracy;

  return v_row;
end;
$$;

create or replace function public.set_flashcard_quality_vote(
  p_flashcard_id uuid,
  p_vote smallint
) returns public.flashcard_quality_votes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_card record;
  v_vote public.flashcard_quality_votes;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_vote not in (-1, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;

  select
    f.id,
    f.document_id,
    f.outline_id,
    f.chapter_title,
    f.section_title,
    f.topic,
    f.generation_method,
    f.model_name,
    f.prompt_version,
    d.owner_id as document_author_id
  into v_card
  from public.flashcards f
  join public.documents d on d.id = f.document_id
  where f.id = p_flashcard_id
    and f.status <> 'deleted';

  if not found or not public.user_can_access_flashcard(p_flashcard_id) then
    raise exception 'flashcard_not_accessible' using errcode = 'P0001';
  end if;

  insert into public.flashcard_quality_votes (
    owner_id,
    flashcard_id,
    document_id,
    document_author_id,
    outline_id,
    chapter_title,
    section_title,
    topic,
    generation_method,
    model_name,
    prompt_version,
    vote
  ) values (
    v_user,
    v_card.id,
    v_card.document_id,
    v_card.document_author_id,
    v_card.outline_id,
    v_card.chapter_title,
    v_card.section_title,
    v_card.topic,
    v_card.generation_method,
    v_card.model_name,
    v_card.prompt_version,
    p_vote
  )
  on conflict (owner_id, flashcard_id) do update set
    vote = excluded.vote,
    document_id = excluded.document_id,
    document_author_id = excluded.document_author_id,
    outline_id = excluded.outline_id,
    chapter_title = excluded.chapter_title,
    section_title = excluded.section_title,
    topic = excluded.topic,
    generation_method = excluded.generation_method,
    model_name = excluded.model_name,
    prompt_version = excluded.prompt_version
  returning * into v_vote;

  perform public.refresh_document_flashcard_quality(v_card.document_id);
  return v_vote;
end;
$$;

create or replace function public.refresh_document_flashcard_quality(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_reviewer_count integer;
  v_total integer;
  v_positive integer;
  v_negative integer;
  v_quality numeric(5,2);
  v_top_positive text;
  v_problem_topic text;
begin
  select owner_id into v_author from public.documents where id = p_document_id;

  with per_user as (
    select
      owner_id,
      count(*) as total_votes,
      count(*) filter (where vote = 1) as positive_votes
    from public.flashcard_quality_votes
    where document_id = p_document_id
    group by owner_id
  )
  select
    count(*),
    coalesce(round(avg(positive_votes::numeric * 100 / nullif(total_votes, 0)), 2), null)
  into v_reviewer_count, v_quality
  from per_user;

  select
    count(*),
    count(*) filter (where vote = 1),
    count(*) filter (where vote = -1)
  into v_total, v_positive, v_negative
  from public.flashcard_quality_votes
  where document_id = p_document_id;

  select coalesce(topic, section_title, chapter_title)
  into v_top_positive
  from public.flashcard_quality_votes
  where document_id = p_document_id and vote = 1
  group by coalesce(topic, section_title, chapter_title)
  order by count(*) desc nulls last
  limit 1;

  select coalesce(topic, section_title, chapter_title)
  into v_problem_topic
  from public.flashcard_quality_votes
  where document_id = p_document_id and vote = -1
  group by coalesce(topic, section_title, chapter_title)
  order by count(*) desc nulls last
  limit 1;

  insert into public.document_flashcard_quality_rollups (
    document_id,
    author_id,
    reviewer_count,
    total_votes,
    positive_votes,
    negative_votes,
    quality_percent,
    top_positive_topic,
    most_problematic_topic,
    computed_at
  ) values (
    p_document_id,
    v_author,
    coalesce(v_reviewer_count, 0),
    coalesce(v_total, 0),
    coalesce(v_positive, 0),
    coalesce(v_negative, 0),
    v_quality,
    v_top_positive,
    v_problem_topic,
    now()
  )
  on conflict (document_id) do update set
    author_id = excluded.author_id,
    reviewer_count = excluded.reviewer_count,
    total_votes = excluded.total_votes,
    positive_votes = excluded.positive_votes,
    negative_votes = excluded.negative_votes,
    quality_percent = excluded.quality_percent,
    top_positive_topic = excluded.top_positive_topic,
    most_problematic_topic = excluded.most_problematic_topic,
    computed_at = excluded.computed_at;

  update public.flashcards f
  set perceived_quality_percent = v_quality
  where f.document_id = p_document_id;
end;
$$;

create or replace function public.refresh_document_flashcard_quality_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_document_flashcard_quality(coalesce(new.document_id, old.document_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists flashcard_quality_votes_refresh_rollup on public.flashcard_quality_votes;
create trigger flashcard_quality_votes_refresh_rollup
after insert or update or delete on public.flashcard_quality_votes
for each row execute function public.refresh_document_flashcard_quality_trigger();

grant execute on function public.user_can_access_flashcard(uuid) to authenticated;
grant execute on function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_flashcard_quality_vote(uuid, smallint) to authenticated;
grant execute on function public.refresh_document_flashcard_quality(uuid) to service_role;
