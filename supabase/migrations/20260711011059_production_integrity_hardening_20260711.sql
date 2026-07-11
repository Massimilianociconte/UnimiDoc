-- ============================================================================
-- Production integrity hardening.
--
-- 1. Reconcile the credit-origin split and make welcome credits exactly-once.
-- 2. Lock down flashcard SECURITY DEFINER helpers and remove duplicate rollups.
-- 3. Add the FK indexes reported by the live Supabase advisor.
-- 4. Keep RAG retrieval inside one explicit embedding model/version and prevent
--    concurrent index jobs for the same document.
-- ============================================================================

select pg_advisory_xact_lock(hashtextextended('unimidoc:production-integrity-hardening', 0));

-- ---------------------------------------------------------------------------
-- Credits: repair legacy accounts created before the origin split.
-- ---------------------------------------------------------------------------

-- Reclassify the legacy welcome row so it becomes the idempotency marker used
-- by grant_welcome_credits(). DISTINCT ON protects projects that already contain
-- duplicate historical welcome rows.
with legacy_welcome as (
  select distinct on (t.owner_id) t.id
  from public.credit_transactions t
  where t.direction = 'earned'
    and t.reason ilike 'Bonus di benvenuto%'
    and not exists (
      select 1
      from public.credit_transactions existing
      where existing.owner_id = t.owner_id
        and existing.direction = 'welcome'
    )
  order by t.owner_id, t.created_at, t.id
)
update public.credit_transactions t
set direction = 'welcome'
from legacy_welcome legacy
where t.id = legacy.id;

-- Do not let the partial unique index fail opaquely, and never guess whether
-- duplicate bonus credits have already been spent. This preflight identifies
-- both explicit duplicates and the legacy-earned + welcome race shape with a
-- remediation-specific error before any account balance is rewritten.
do $$
begin
  if exists (
    select transaction.owner_id
    from public.credit_transactions transaction
    where transaction.direction = 'welcome'
       or (
         transaction.direction = 'earned'
         and transaction.reason ilike 'Bonus di benvenuto%'
       )
    group by transaction.owner_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate welcome-credit ledger rows detected. Reconcile affected balances and ledger rows before applying production hardening.';
  end if;
end;
$$;

-- Repair only the deterministic legacy welcome-only shape. Never guess the
-- origin of purchased or seller-earned credits: an ambiguous row aborts below
-- and must be reconciled from its ledger before this migration is retried.
update public.user_credit_accounts account
set
  free_credits = account.balance,
  updated_at = now()
where account.balance between 0 and 30
  and account.free_credits = 0
  and account.purchased_credits = 0
  and account.earned_credits = 0
  and exists (
    select 1
    from public.credit_transactions marker
    where marker.owner_id = account.owner_id
      and marker.direction = 'welcome'
      and marker.amount = account.balance
  );

do $$
begin
  if exists (
    select 1
    from public.user_credit_accounts
    where balance <> free_credits + purchased_credits + earned_credits
  ) then
    raise exception using
      errcode = '23514',
      message = 'Ambiguous credit-origin split: reconcile the ledger before applying production hardening.';
  end if;
end;
$$;

create unique index if not exists credit_transactions_one_welcome_per_user_idx
  on public.credit_transactions (owner_id)
  where direction = 'welcome';

alter table public.user_credit_accounts
  drop constraint if exists user_credit_accounts_balance_origin_check;
alter table public.user_credit_accounts
  add constraint user_credit_accounts_balance_origin_check
  check (balance = free_credits + purchased_credits + earned_credits) not valid;
alter table public.user_credit_accounts
  validate constraint user_credit_accounts_balance_origin_check;

alter table public.user_credit_accounts
  drop constraint if exists user_credit_accounts_convertible_within_earned_check;
alter table public.user_credit_accounts
  add constraint user_credit_accounts_convertible_within_earned_check
  check (earned_convertible <= earned_credits) not valid;
alter table public.user_credit_accounts
  validate constraint user_credit_accounts_convertible_within_earned_check;

-- Keep the total/convertible invariant valid when a buyer spends seller-earned
-- credits. Non-convertible earnings are consumed first; only the actually used
-- convertible portion is decremented and propagated as convertible payout.
create or replace function public.purchase_document(p_document_id uuid)
returns public.document_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_buyer uuid := auth.uid();
  v_doc public.documents;
  v_price integer;
  v_free integer; v_purchased integer; v_earned integer; v_earned_convertible integer;
  v_free_avail integer; v_use_free integer; v_use_purchased integer; v_use_earned integer;
  v_earned_nonconvertible integer; v_use_earned_convertible integer;
  v_seller_convertible integer; v_seller_nonconv integer;
  v_purchase public.document_purchases;
begin
  if v_buyer is null then raise exception 'auth_required' using errcode = '28000'; end if;

  select * into v_doc from public.documents where id = p_document_id;
  if not found then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if v_doc.owner_id = v_buyer then raise exception 'own_document' using errcode = 'P0001'; end if;
  if v_doc.visibility <> 'published' then raise exception 'not_purchasable' using errcode = 'P0001'; end if;

  select * into v_purchase from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then return v_purchase; end if;

  v_price := coalesce(v_doc.price_credits, 0);
  if v_price <= 0 then raise exception 'price_unavailable' using errcode = 'P0001'; end if;

  select free_credits, purchased_credits, earned_credits, earned_convertible
    into v_free, v_purchased, v_earned, v_earned_convertible
  from public.user_credit_accounts where owner_id = v_buyer for update;
  if not found then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  select * into v_purchase from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then return v_purchase; end if;

  v_free_avail := case when v_price <= 30 then v_free else 0 end;
  if v_free_avail + v_purchased + v_earned < v_price then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  v_use_free := least(v_free_avail, v_price);
  v_use_purchased := least(v_purchased, v_price - v_use_free);
  v_use_earned := v_price - v_use_free - v_use_purchased;
  v_earned_nonconvertible := v_earned - v_earned_convertible;
  v_use_earned_convertible := greatest(0, v_use_earned - v_earned_nonconvertible);

  update public.user_credit_accounts
  set free_credits = free_credits - v_use_free,
      purchased_credits = purchased_credits - v_use_purchased,
      earned_credits = earned_credits - v_use_earned,
      earned_convertible = earned_convertible - v_use_earned_convertible,
      balance = balance - v_price,
      lifetime_spent = lifetime_spent + v_price,
      updated_at = now()
  where owner_id = v_buyer;

  insert into public.document_purchases (document_id, buyer_id, credits_spent)
  values (p_document_id, v_buyer, v_price)
  returning * into v_purchase;

  insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason, metadata)
  values (
    v_buyer,
    p_document_id,
    v_purchase.id,
    'spent',
    v_price,
    'Acquisto documento',
    jsonb_build_object(
      'free_credits', v_use_free,
      'purchased_credits', v_use_purchased,
      'earned_credits', v_use_earned,
      'earned_convertible', v_use_earned_convertible
    )
  );

  v_seller_convertible := floor((v_use_purchased + v_use_earned_convertible) * 0.7);
  v_seller_nonconv := floor((v_use_free + v_use_earned - v_use_earned_convertible) * 0.7);
  if v_seller_convertible + v_seller_nonconv > 0 then
    insert into public.user_credit_accounts (owner_id, balance, free_credits, purchased_credits, earned_credits)
    values (v_doc.owner_id, 0, 0, 0, 0)
    on conflict (owner_id) do nothing;

    update public.user_credit_accounts
    set earned_credits = earned_credits + v_seller_convertible + v_seller_nonconv,
        earned_convertible = earned_convertible + v_seller_convertible,
        balance = balance + v_seller_convertible + v_seller_nonconv,
        lifetime_earned = lifetime_earned + v_seller_convertible + v_seller_nonconv,
        updated_at = now()
    where owner_id = v_doc.owner_id;

    if found then
      insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason, metadata)
      values (
        v_doc.owner_id,
        p_document_id,
        v_purchase.id,
        'earned',
        v_seller_convertible + v_seller_nonconv,
        'Vendita documento',
        jsonb_build_object('convertible', v_seller_convertible, 'non_convertible', v_seller_nonconv)
      );
    end if;
  end if;

  return v_purchase;
end;
$function$;

revoke all on function public.purchase_document(uuid) from public, anon;
grant execute on function public.purchase_document(uuid) to authenticated, service_role;

create or replace function public.grant_welcome_credits(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_marker uuid;
  v_welcome constant integer := 30;
begin
  if p_user is null or not exists (
    select 1
    from auth.users u
    where u.id = p_user
      and u.email_confirmed_at is not null
  ) then
    return;
  end if;

  insert into public.user_credit_accounts (
    owner_id,
    balance,
    free_credits,
    purchased_credits,
    earned_credits,
    lifetime_earned
  ) values (p_user, 0, 0, 0, 0, 0)
  on conflict (owner_id) do nothing;

  -- Insert the marker first. The partial unique index makes concurrent auth
  -- events safe: only the transaction that creates the marker grants credits.
  insert into public.credit_transactions (owner_id, direction, amount, reason)
  values (p_user, 'welcome', v_welcome, 'Bonus di benvenuto UnimiDoc')
  on conflict do nothing
  returning id into v_marker;

  if v_marker is null then
    return;
  end if;

  update public.user_credit_accounts
  set
    free_credits = free_credits + v_welcome,
    balance = balance + v_welcome,
    lifetime_earned = lifetime_earned + v_welcome,
    updated_at = now()
  where owner_id = p_user;
end;
$$;

revoke all on function public.grant_welcome_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_welcome_credits(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_avatar text;
  v_had_welcome boolean;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Studente UnimiDoc'
  );
  v_avatar := nullif(new.raw_user_meta_data->>'avatar_url', '');

  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, v_name, v_avatar)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  insert into public.user_entitlements (owner_id, plan)
  values (new.id, 'free')
  on conflict (owner_id) do nothing;

  insert into public.user_credit_accounts (
    owner_id,
    balance,
    free_credits,
    purchased_credits,
    earned_credits,
    lifetime_earned
  ) values (new.id, 0, 0, 0, 0, 0)
  on conflict (owner_id) do nothing;

  select exists (
    select 1
    from public.credit_transactions
    where owner_id = new.id and direction = 'welcome'
  ) into v_had_welcome;

  perform public.grant_welcome_credits(new.id);

  if not v_had_welcome and exists (
    select 1
    from public.credit_transactions
    where owner_id = new.id and direction = 'welcome'
  ) then
    insert into public.user_notifications (owner_id, title, body, notification_type)
    values (
      new.id,
      'Benvenuto su UnimiDoc',
      'La tua area riservata e pronta. Hai ricevuto 30 crediti di benvenuto.',
      'success'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_new_user();

-- Idempotently repair already-confirmed accounts that never received a marker.
select public.grant_welcome_credits(u.id)
from auth.users u
where u.email_confirmed_at is not null;

-- ---------------------------------------------------------------------------
-- Flashcard persistence, ACL and advisor indexes.
-- ---------------------------------------------------------------------------

alter table public.flashcards
  add column if not exists generation_item_key text
  check (generation_item_key is null or char_length(generation_item_key) = 64);

create unique index if not exists flashcards_owner_generation_item_idx
  on public.flashcards (owner_id, generation_item_key);

create table if not exists public.reviewed_flashcard_write_reservations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  request_key text not null check (char_length(request_key) = 64),
  card_count integer not null check (card_count between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'committed')),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  primary key (owner_id, request_key)
);

alter table public.reviewed_flashcard_write_reservations enable row level security;
create index if not exists reviewed_flashcard_reservations_document_idx
  on public.reviewed_flashcard_write_reservations (owner_id, document_id, status, created_at desc);

create or replace function public.reserve_reviewed_flashcard_write(
  p_owner uuid,
  p_document uuid,
  p_request_key text,
  p_card_count integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.reviewed_flashcard_write_reservations;
  v_document_count integer;
  v_pending_count integer;
  v_recent_count integer;
begin
  if p_owner is null or p_document is null or char_length(p_request_key) <> 64
     or p_card_count < 1 or p_card_count > 80 then
    raise exception 'invalid_reviewed_flashcard_reservation' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.documents document
    where document.id = p_document and document.owner_id = p_owner
  ) then
    raise exception 'reviewed_flashcard_owner_required' using errcode = '42501';
  end if;

  -- Owner-level lock serializes both the per-document and cross-document
  -- hourly quotas. One stable lock order also avoids multi-lock deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('reviewed-flashcards:' || p_owner::text, 0));
  select * into v_existing
  from public.reviewed_flashcard_write_reservations
  where owner_id = p_owner and request_key = p_request_key
  for update;

  if found and (v_existing.status = 'committed' or v_existing.created_at >= now() - interval '1 hour') then
    return true;
  elsif found then
    delete from public.reviewed_flashcard_write_reservations
    where owner_id = p_owner and request_key = p_request_key;
  end if;

  select count(*)::integer into v_document_count
  from public.flashcards flashcard
  where flashcard.owner_id = p_owner
    and flashcard.document_id = p_document
    and flashcard.generation_method = 'manual'
    and flashcard.status <> 'deleted';

  select coalesce(sum(reservation.card_count), 0)::integer into v_pending_count
  from public.reviewed_flashcard_write_reservations reservation
  where reservation.owner_id = p_owner
    and reservation.document_id = p_document
    and reservation.status = 'pending'
    and reservation.created_at >= now() - interval '1 hour';

  if v_document_count + v_pending_count + p_card_count > 300 then
    raise exception 'reviewed_flashcard_document_quota' using errcode = 'P0001';
  end if;

  select coalesce(sum(reservation.card_count), 0)::integer into v_recent_count
  from public.reviewed_flashcard_write_reservations reservation
  where reservation.owner_id = p_owner
    and reservation.created_at >= now() - interval '1 hour';

  if v_recent_count + p_card_count > 160 then
    raise exception 'reviewed_flashcard_hourly_quota' using errcode = 'P0001';
  end if;

  insert into public.reviewed_flashcard_write_reservations (
    owner_id, document_id, request_key, card_count
  ) values (
    p_owner, p_document, p_request_key, p_card_count
  );
  return true;
end;
$$;

create or replace function public.commit_reviewed_flashcard_write(
  p_owner uuid,
  p_document uuid,
  p_request_key text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.reviewed_flashcard_write_reservations
  set status = 'committed', committed_at = coalesce(committed_at, now())
  where owner_id = p_owner
    and document_id = p_document
    and request_key = p_request_key;
  if not found then
    raise exception 'reviewed_flashcard_reservation_not_found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_reviewed_flashcard_write(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.commit_reviewed_flashcard_write(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_reviewed_flashcard_write(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.commit_reviewed_flashcard_write(uuid, uuid, text)
  to service_role;

create or replace function public.record_srs_review_atomic(
  p_flashcard_id uuid,
  p_expected_review_count integer,
  p_answer_status text,
  p_due_at timestamptz,
  p_last_reviewed_at timestamptz,
  p_review_count integer,
  p_lapse_count integer,
  p_ease_factor real,
  p_interval_minutes integer,
  p_last_rating text,
  p_stage text,
  p_record_progress boolean default true,
  p_record_answer boolean default true,
  p_quiz_session_id uuid default null,
  p_question_type text default 'qa',
  p_user_answer text default null,
  p_correct_answer text default null,
  p_time_spent_ms integer default null,
  p_attempt_number integer default 1
)
returns public.srs_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_current_count integer;
  v_state public.srs_state;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if p_answer_status not in ('correct', 'incorrect', 'partial', 'unknown', 'skipped') then
    raise exception 'invalid_answer_status' using errcode = '22023';
  end if;
  if p_last_rating not in ('impossible', 'hard', 'ok', 'easy') then
    raise exception 'invalid_srs_rating' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_flashcard_id::text, 0));
  select review_count into v_current_count
  from public.srs_state
  where owner_id = v_user and flashcard_id = p_flashcard_id
  for update;
  v_current_count := coalesce(v_current_count, 0);
  if v_current_count <> greatest(coalesce(p_expected_review_count, 0), 0) then
    raise exception 'srs_state_conflict' using errcode = '40001';
  end if;

  if p_record_progress then
    perform public.record_flashcard_study_event(
      p_flashcard_id,
      p_answer_status,
      p_due_at,
      p_last_reviewed_at
    );
  else
    update public.user_flashcard_progress
    set
      next_due_at = p_due_at,
      last_reviewed_at = p_last_reviewed_at,
      needs_review = p_answer_status in ('incorrect', 'partial', 'unknown', 'skipped') or p_due_at <= now()
    where owner_id = v_user and flashcard_id = p_flashcard_id;
    if not found then
      perform public.record_flashcard_study_event(
        p_flashcard_id,
        p_answer_status,
        p_due_at,
        p_last_reviewed_at
      );
    end if;
  end if;

  insert into public.srs_state (
    owner_id,
    flashcard_id,
    due_at,
    last_reviewed_at,
    review_count,
    lapse_count,
    ease_factor,
    interval_minutes,
    last_rating,
    stage
  ) values (
    v_user,
    p_flashcard_id,
    p_due_at,
    p_last_reviewed_at,
    greatest(p_review_count, 0),
    greatest(p_lapse_count, 0),
    greatest(1.3, least(3.0, p_ease_factor)),
    greatest(p_interval_minutes, 0),
    p_last_rating,
    p_stage
  )
  on conflict (owner_id, flashcard_id) do update set
    due_at = excluded.due_at,
    last_reviewed_at = excluded.last_reviewed_at,
    review_count = excluded.review_count,
    lapse_count = excluded.lapse_count,
    ease_factor = excluded.ease_factor,
    interval_minutes = excluded.interval_minutes,
    last_rating = excluded.last_rating,
    stage = excluded.stage
  returning * into v_state;

  if p_record_answer then
    insert into public.user_answers (
      owner_id,
      quiz_session_id,
      flashcard_id,
      question_type,
      user_answer,
      correct_answer,
      answer_status,
      time_spent_ms,
      attempt_number
    ) values (
      v_user,
      p_quiz_session_id,
      p_flashcard_id,
      left(coalesce(nullif(p_question_type, ''), 'qa'), 80),
      left(p_user_answer, 2000),
      left(p_correct_answer, 2000),
      p_answer_status,
      case when p_time_spent_ms is null then null else greatest(0, least(p_time_spent_ms, 3600000)) end,
      greatest(1, least(coalesce(p_attempt_number, 1), 1000))
    );
  end if;

  return v_state;
end;
$$;

revoke all on function public.record_srs_review_atomic(
  uuid, integer, text, timestamptz, timestamptz, integer, integer, real,
  integer, text, text, boolean, boolean, uuid, text, text, text, integer, integer
) from public, anon;
grant execute on function public.record_srs_review_atomic(
  uuid, integer, text, timestamptz, timestamptz, integer, integer, real,
  integer, text, text, boolean, boolean, uuid, text, text, text, integer, integer
) to authenticated, service_role;

-- Progress counters/status are projections written by the study RPC, not
-- arbitrary client state. Expose the one user-editable preference separately.
drop policy if exists "Users manage own flashcard progress" on public.user_flashcard_progress;
drop policy if exists "Users read own flashcard progress" on public.user_flashcard_progress;
create policy "Users read own flashcard progress"
  on public.user_flashcard_progress for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.set_flashcard_favorite(
  p_flashcard_id uuid,
  p_is_favorite boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.user_flashcard_progress progress
    where progress.owner_id = v_user and progress.flashcard_id = p_flashcard_id
  ) then
    perform public.record_flashcard_study_event(
      p_flashcard_id,
      'unanswered',
      null,
      now()
    );
  end if;

  update public.user_flashcard_progress
  set is_favorite = p_is_favorite
  where owner_id = v_user
    and flashcard_id = p_flashcard_id;
  if not found then
    raise exception 'flashcard_progress_not_found' using errcode = 'P0002';
  end if;
  return p_is_favorite;
end;
$$;

revoke all on function public.set_flashcard_favorite(uuid, boolean) from public, anon;
grant execute on function public.set_flashcard_favorite(uuid, boolean) to authenticated, service_role;

create index if not exists user_flashcard_progress_flashcard_idx
  on public.user_flashcard_progress (flashcard_id);
create index if not exists user_flashcard_progress_document_idx
  on public.user_flashcard_progress (document_id)
  where document_id is not null;
create index if not exists user_flashcard_progress_document_author_idx
  on public.user_flashcard_progress (document_author_id)
  where document_author_id is not null;
create index if not exists flashcard_quality_votes_flashcard_idx
  on public.flashcard_quality_votes (flashcard_id);
create index if not exists flashcard_quality_votes_outline_idx
  on public.flashcard_quality_votes (outline_id)
  where outline_id is not null;

with duplicate_jobs as (
  select
    id,
    row_number() over (
      partition by document_id, job_type, input_hash
      order by created_at, id
    ) as duplicate_rank
  from public.pdf_processing_jobs
  where input_hash is not null
)
delete from public.pdf_processing_jobs job
using duplicate_jobs duplicate
where job.id = duplicate.id
  and duplicate.duplicate_rank > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pdf_processing_jobs_document_type_input_key'
      and conrelid = 'public.pdf_processing_jobs'::regclass
  ) then
    alter table public.pdf_processing_jobs
      add constraint pdf_processing_jobs_document_type_input_key
      unique (document_id, job_type, input_hash);
  end if;
end;
$$;

-- Flashcard provenance is immutable from the browser. Cards are created and
-- edited only by reviewed server workflows; otherwise an owner could move a
-- card to another document and manipulate that document's quality rollup.
drop policy if exists "Users can update own flashcards" on public.flashcards;
revoke update on public.flashcards from anon, authenticated;
revoke insert, update, delete on public.user_flashcard_progress from anon, authenticated;

-- Votes are written through set_flashcard_quality_vote(), which validates
-- access and refreshes the aggregate once. Direct client writes previously
-- caused the trigger and the RPC to recompute the same rollup twice.
drop trigger if exists flashcard_quality_votes_refresh_rollup on public.flashcard_quality_votes;
drop function if exists public.refresh_document_flashcard_quality_trigger();

drop policy if exists "Users manage own flashcard quality votes" on public.flashcard_quality_votes;
drop policy if exists "Users read own flashcard quality votes" on public.flashcard_quality_votes;
create policy "Users read own flashcard quality votes"
  on public.flashcard_quality_votes for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Anyone can read document flashcard quality" on public.document_flashcard_quality_rollups;
drop policy if exists "Public read published flashcard quality" on public.document_flashcard_quality_rollups;
drop policy if exists "Users read accessible flashcard quality" on public.document_flashcard_quality_rollups;
revoke all on public.document_flashcard_quality_rollups from anon, authenticated;

revoke all on function public.user_can_access_flashcard(uuid) from public, anon, authenticated;
revoke all on function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.set_flashcard_quality_vote(uuid, smallint) from public, anon, authenticated;
revoke all on function public.refresh_document_flashcard_quality(uuid) from public, anon, authenticated;
grant execute on function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.set_flashcard_quality_vote(uuid, smallint) to authenticated, service_role;
grant execute on function public.user_can_access_flashcard(uuid) to service_role;
grant execute on function public.refresh_document_flashcard_quality(uuid) to service_role;

-- Document creation and lifecycle transitions are backend workflows. The
-- original owner-wide INSERT/UPDATE policies let a browser set visibility to
-- "published" or rewrite storage/hash/status fields without verification.
drop policy if exists "Users can create own documents" on public.documents;
drop policy if exists "Users can update own documents" on public.documents;
drop policy if exists "Users can delete own documents" on public.documents;
drop policy if exists "Users can create own jobs" on public.pdf_processing_jobs;

-- Upload bytes must use a short-lived signed URL minted by document-upload.
-- Direct processing-temp writes/deletes bypass rate limits and finalization.
drop policy if exists "Users can upload own private PDF objects" on storage.objects;
drop policy if exists "Users can delete own temp objects" on storage.objects;

-- A generic UPDATE policy lets the browser rewrite notification content. Keep
-- the table read-only and expose the one intended transition as a narrow RPC.
drop policy if exists "Users mark own notifications read" on public.user_notifications;

create or replace function public.mark_notification_read(p_notification uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_read_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification
    and owner_id = auth.uid()
  returning read_at into v_read_at;

  if v_read_at is null then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;
  return v_read_at;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;

-- Safe catalog surfaces. The base documents/profiles tables retain private
-- storage hashes, paths, email and metadata; public consumers only see these
-- explicit columns and only published/opted-in rows.
alter table public.profiles
  add column if not exists public_display_name text
    check (public_display_name is null or char_length(public_display_name) between 2 and 80),
  add column if not exists seller_profile_enabled boolean not null default false;

-- Preserve the original study/vote implementations behind server-only names,
-- then expose privacy-aware wrappers. Buyers must never learn a seller's auth
-- UUID or private full name when that seller has not enabled a public profile.
alter function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz)
  rename to record_flashcard_study_event_internal;

revoke all on function public.record_flashcard_study_event_internal(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_flashcard_study_event_internal(uuid, text, timestamptz, timestamptz)
  to service_role;

create function public.record_flashcard_study_event(
  p_flashcard_id uuid,
  p_answer_status text,
  p_next_due_at timestamptz default null,
  p_last_reviewed_at timestamptz default now()
) returns public.user_flashcard_progress
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_flashcard_progress;
  v_author uuid;
  v_author_name text;
  v_public_name text;
  v_public_enabled boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  v_row := public.record_flashcard_study_event_internal(
    p_flashcard_id,
    p_answer_status,
    p_next_due_at,
    p_last_reviewed_at
  );

  select
    document.owner_id,
    profile.full_name,
    profile.public_display_name,
    profile.seller_profile_enabled
  into v_author, v_author_name, v_public_name, v_public_enabled
  from public.documents document
  left join public.profiles profile on profile.id = document.owner_id
  where document.id = v_row.document_id;

  update public.user_flashcard_progress
  set
    document_author_id = case
      when v_author = v_user then v_author
      when v_public_enabled and v_public_name is not null then v_author
      else null
    end,
    document_author_name = case
      when v_author = v_user then coalesce(v_author_name, v_public_name, 'Tu')
      when v_public_enabled and v_public_name is not null then v_public_name
      else 'Profilo venditore privato'
    end
  where owner_id = v_user
    and flashcard_id = p_flashcard_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.record_flashcard_study_event(uuid, text, timestamptz, timestamptz)
  to authenticated, service_role;

alter function public.set_flashcard_quality_vote(uuid, smallint)
  rename to set_flashcard_quality_vote_internal;

revoke all on function public.set_flashcard_quality_vote_internal(uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.set_flashcard_quality_vote_internal(uuid, smallint)
  to service_role;

create function public.set_flashcard_quality_vote(
  p_flashcard_id uuid,
  p_vote smallint
) returns public.flashcard_quality_votes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_document uuid;
  v_author uuid;
  v_public_enabled boolean;
  v_public_name text;
  v_vote public.flashcard_quality_votes;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select
    flashcard.document_id,
    document.owner_id,
    profile.seller_profile_enabled,
    profile.public_display_name
  into v_document, v_author, v_public_enabled, v_public_name
  from public.flashcards flashcard
  join public.documents document on document.id = flashcard.document_id
  left join public.profiles profile on profile.id = document.owner_id
  where flashcard.id = p_flashcard_id
    and flashcard.status <> 'deleted';

  if not found then
    raise exception 'flashcard_not_accessible' using errcode = 'P0001';
  end if;
  if v_author = v_user then
    raise exception 'author_cannot_vote' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_purchases purchase
    where purchase.document_id = v_document
      and purchase.buyer_id = v_user
  ) then
    raise exception 'purchase_required_for_quality_vote' using errcode = '42501';
  end if;

  v_vote := public.set_flashcard_quality_vote_internal(p_flashcard_id, p_vote);
  if not (v_public_enabled and v_public_name is not null) then
    update public.flashcard_quality_votes
    set document_author_id = null
    where id = v_vote.id
      and owner_id = v_user
    returning * into v_vote;
  end if;
  return v_vote;
end;
$$;

revoke all on function public.set_flashcard_quality_vote(uuid, smallint)
  from public, anon;
grant execute on function public.set_flashcard_quality_vote(uuid, smallint)
  to authenticated, service_role;

-- Scrub identities already materialized before the opt-in rule existed.
update public.user_flashcard_progress progress
set document_author_id = null,
    document_author_name = 'Profilo venditore privato'
from public.documents document
left join public.profiles profile on profile.id = document.owner_id
where progress.document_id = document.id
  and progress.owner_id <> document.owner_id
  and not (coalesce(profile.seller_profile_enabled, false) and profile.public_display_name is not null);

update public.flashcard_quality_votes vote
set document_author_id = null
from public.documents document
left join public.profiles profile on profile.id = document.owner_id
where vote.document_id = document.id
  and vote.owner_id <> document.owner_id
  and not (coalesce(profile.seller_profile_enabled, false) and profile.public_display_name is not null);

create or replace function public.sync_materialized_seller_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.seller_profile_enabled and new.public_display_name is not null then
    update public.user_flashcard_progress progress
    set document_author_id = new.id,
        document_author_name = new.public_display_name
    from public.documents document
    where document.owner_id = new.id
      and progress.document_id = document.id
      and progress.owner_id <> new.id;

    update public.flashcard_quality_votes vote
    set document_author_id = new.id
    from public.documents document
    where document.owner_id = new.id
      and vote.document_id = document.id
      and vote.owner_id <> new.id;
  else
    update public.user_flashcard_progress progress
    set document_author_id = null,
        document_author_name = 'Profilo venditore privato'
    from public.documents document
    where document.owner_id = new.id
      and progress.document_id = document.id
      and progress.owner_id <> new.id;

    update public.flashcard_quality_votes vote
    set document_author_id = null
    from public.documents document
    where document.owner_id = new.id
      and vote.document_id = document.id
      and vote.owner_id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_materialized_seller_privacy on public.profiles;
create trigger profiles_sync_materialized_seller_privacy
after update of seller_profile_enabled, public_display_name on public.profiles
for each row
when (
  old.seller_profile_enabled is distinct from new.seller_profile_enabled
  or old.public_display_name is distinct from new.public_display_name
)
execute function public.sync_materialized_seller_privacy();

revoke all on function public.sync_materialized_seller_privacy() from public, anon, authenticated;
grant execute on function public.sync_materialized_seller_privacy() to service_role;

-- Public/authenticated consumers use a projection without author_id. The base
-- rollup remains service-only for payout/author analytics.
create or replace view public.public_document_flashcard_quality
with (security_barrier = true)
as
select
  quality.document_id,
  quality.reviewer_count,
  quality.total_votes,
  quality.positive_votes,
  quality.negative_votes,
  quality.quality_percent,
  quality.top_positive_topic,
  quality.most_problematic_topic,
  quality.computed_at
from public.document_flashcard_quality_rollups quality
join public.documents document on document.id = quality.document_id
where document.visibility = 'published'
  or document.owner_id = auth.uid()
  or exists (
    select 1 from public.document_purchases purchase
    where purchase.document_id = document.id
      and purchase.buyer_id = auth.uid()
  );

create or replace view public.public_document_catalog
with (security_barrier = true)
as
select
  document.id,
  case
    when profile.seller_profile_enabled and profile.public_display_name is not null
      then document.owner_id
    else null
  end as seller_id,
  document.title,
  document.course_name,
  document.professor,
  document.academic_year,
  document.page_count,
  document.language,
  document.preview_policy,
  document.description,
  document.exam_type,
  document.semester,
  document.degree_course,
  document.university,
  document.tags,
  document.compatible_exams,
  document.insights,
  document.price_credits,
  quality.quality_percent as flashcard_quality_percent,
  quality.reviewer_count as flashcard_reviewer_count,
  document.created_at,
  document.updated_at
from public.documents document
join public.profiles profile on profile.id = document.owner_id
left join public.document_flashcard_quality_rollups quality
  on quality.document_id = document.id
where document.visibility = 'published';

create or replace view public.public_seller_profiles
with (security_barrier = true)
as
select
  profile.id,
  profile.public_display_name,
  profile.avatar_url,
  profile.university,
  profile.degree_course,
  count(distinct document.id)::integer as published_documents,
  round(avg(quality.quality_percent), 1) as average_flashcard_quality
from public.profiles profile
join public.documents document
  on document.owner_id = profile.id
  and document.visibility = 'published'
left join public.document_flashcard_quality_rollups quality
  on quality.document_id = document.id
where profile.seller_profile_enabled = true
  and profile.public_display_name is not null
group by profile.id, profile.public_display_name, profile.avatar_url, profile.university, profile.degree_course;

revoke all on public.public_document_catalog from public;
revoke all on public.public_seller_profiles from public;
revoke all on public.public_document_flashcard_quality from public;
grant select on public.public_document_catalog to anon, authenticated;
grant select on public.public_seller_profiles to anon, authenticated;
grant select on public.public_document_flashcard_quality to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RAG: model/version isolation and single active indexer lease per document.
-- ---------------------------------------------------------------------------

create index if not exists rag_chunk_embeddings_model_document_idx
  on public.rag_chunk_embeddings (
    embedding_model,
    embedding_version,
    document_id,
    embedding_status
  );

-- Close abandoned jobs and deterministically retain only the newest active job
-- before adding the concurrency guard. This keeps upgrades from failing on
-- historical duplicates while preserving the most recent attempt.
update public.rag_embedding_jobs
set
  status = 'failed',
  error_message = coalesce(error_message, 'Job scaduto durante hardening deployment'),
  finished_at = coalesce(finished_at, now())
where status in ('pending', 'processing')
  and coalesce(started_at, created_at) < now() - interval '30 minutes';

with ranked_active as (
  select
    id,
    row_number() over (
      partition by document_id
      order by coalesce(started_at, created_at) desc, created_at desc, id desc
    ) as active_rank
  from public.rag_embedding_jobs
  where status in ('pending', 'processing')
)
update public.rag_embedding_jobs job
set
  status = 'failed',
  error_message = coalesce(job.error_message, 'Job duplicato chiuso durante hardening deployment'),
  finished_at = coalesce(job.finished_at, now())
from ranked_active ranked
where job.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists rag_embedding_jobs_one_active_per_document_idx
  on public.rag_embedding_jobs (document_id)
  where status in ('pending', 'processing');

create or replace function public.claim_rag_embedding_job(
  p_document uuid,
  p_user uuid,
  p_embedding_model text,
  p_embedding_version text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
begin
  if not exists (
    select 1 from public.documents
    where id = p_document and owner_id = p_user
  ) then
    raise exception 'document_owner_mismatch' using errcode = '42501';
  end if;

  -- Batch progress updates touch updated_at and act as a heartbeat. A hard
  -- Edge timeout can therefore be reclaimed after 30 minutes without waiting
  -- for another deployment.
  update public.rag_embedding_jobs
  set
    status = 'failed',
    error_message = coalesce(error_message, 'Lease scaduta: job recuperato da un nuovo tentativo'),
    finished_at = coalesce(finished_at, now())
  where document_id = p_document
    and status in ('pending', 'processing')
    and updated_at < now() - interval '30 minutes';

  insert into public.rag_embedding_jobs (
    document_id,
    user_id,
    status,
    embedding_model,
    embedding_version,
    started_at
  ) values (
    p_document,
    p_user,
    'processing',
    p_embedding_model,
    p_embedding_version,
    now()
  )
  returning id into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_rag_embedding_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_rag_embedding_job(uuid, uuid, text, text) to service_role;

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
        select 1
        from public.document_purchases purchase
        where purchase.document_id = d.id
          and purchase.buyer_id = p_user
      )
      or (
        d.visibility = 'published'
        and d.price_credits = 0
      )
      or (
        d.visibility = 'published'
        and d.preview_policy = 'premium_full'
        and exists (
          select 1
          from public.user_entitlements entitlement
          where entitlement.owner_id = p_user
            and entitlement.plan = 'premium'
            and (entitlement.premium_until is null or entitlement.premium_until > now())
        )
      )
    )
$$;

revoke all on function public.rag_accessible_document_ids(uuid) from public, anon, authenticated;
grant execute on function public.rag_accessible_document_ids(uuid) to service_role;

drop function if exists public.match_rag_chunks(extensions.vector, int, uuid[], float);

create function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  p_embedding_model text,
  p_embedding_version text,
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
    and e.content_hash = c.content_sha256
    and e.document_id = c.document_id
    and e.embedding_model = p_embedding_model
    and e.embedding_version = p_embedding_version
    and c.processing_state <> 'failed'
    and c.document_id in (
      select ad.document_id
      from public.rag_accessible_document_ids((select auth.uid())) ad
    )
    and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    and (1 - (e.embedding <=> query_embedding)) >= min_similarity
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 24));
$$;

revoke all on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float)
  from public, anon;
grant execute on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float)
  to authenticated, service_role;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Future
-- functions created by this migration role must be opted in explicitly.
alter default privileges in schema public revoke execute on functions from public;

-- Edge Functions use the service-role JWT: BYPASSRLS does not replace SQL
-- object privileges on projects using the new non-auto-exposed default.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant usage, select, update on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- New Supabase projects no longer auto-expose freshly created tables. Derive
-- the minimum table privileges from the RLS policies themselves so a clean
-- bootstrap works while legacy projects lose broad INSERT/UPDATE/DELETE grants.
revoke all privileges on all tables in schema public from anon, authenticated;

do $$
declare
  policy_grant record;
  privilege_list text;
begin
  for policy_grant in
    select distinct
      policy.schemaname,
      policy.tablename,
      policy.cmd,
      role_name::text as role_name
    from pg_policies policy,
      lateral unnest(policy.roles) role_name
    where policy.schemaname = 'public'
      and role_name::text in ('anon', 'authenticated')
  loop
    privilege_list := case policy_grant.cmd
      when 'ALL' then 'select, insert, update, delete'
      else lower(policy_grant.cmd)
    end;
    execute format(
      'grant %s on table %I.%I to %I',
      privilege_list,
      policy_grant.schemaname,
      policy_grant.tablename,
      policy_grant.role_name
    );
  end loop;
end;
$$;

grant select on public.public_document_catalog to anon, authenticated;
grant select on public.public_seller_profiles to anon, authenticated;
grant select on public.public_document_flashcard_quality to anon, authenticated;
