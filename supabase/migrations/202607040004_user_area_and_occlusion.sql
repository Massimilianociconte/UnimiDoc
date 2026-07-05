-- ============================================================================
-- User private area, credit ledger, study progress and editable image occlusion.
-- This migration is intentionally owner-scoped: clients can read/manage only
-- their own study artifacts, while balances, purchases and notifications are
-- written through trusted backend functions/service role.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default 'Studente UnimiDoc',
  avatar_url text,
  university text not null default 'Università degli Studi di Milano',
  degree_course text not null default 'Scienze Biologiche L-13',
  onboarding_done boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_credit_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
  lifetime_spent integer not null default 0 check (lifetime_spent >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  purchase_id uuid references public.document_purchases(id) on delete set null,
  direction text not null check (direction in ('earned', 'spent', 'reserved', 'released', 'adjusted')),
  amount integer not null check (amount > 0),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  relation text not null check (relation in ('saved', 'wishlist', 'study_later', 'purchased')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, document_id, relation)
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  subject text,
  session_type text not null check (session_type in ('reader', 'flashcards', 'quiz', 'occlusion', 'mixed')),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  cards_reviewed integer not null default 0 check (cards_reviewed >= 0),
  quiz_questions integer not null default 0 check (quiz_questions >= 0),
  correct_answers integer not null default 0 check (correct_answers >= 0),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.document_study_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  progress_percent numeric(5, 2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  last_page integer check (last_page is null or last_page > 0),
  flashcards_total integer not null default 0 check (flashcards_total >= 0),
  flashcards_mastered integer not null default 0 check (flashcards_mastered >= 0),
  quiz_accuracy numeric(5, 2) check (quiz_accuracy is null or (quiz_accuracy >= 0 and quiz_accuracy <= 100)),
  last_studied_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, document_id)
);

create table if not exists public.subject_study_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  progress_percent numeric(5, 2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  documents_count integer not null default 0 check (documents_count >= 0),
  due_reviews integer not null default 0 check (due_reviews >= 0),
  average_accuracy numeric(5, 2) check (average_accuracy is null or (average_accuracy >= 0 and average_accuracy <= 100)),
  updated_at timestamptz not null default now(),
  unique (owner_id, subject)
);

create table if not exists public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  flashcard_id uuid references public.flashcards(id) on delete cascade,
  subject text,
  title text not null,
  due_at timestamptz not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'done', 'snoozed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null default 'info' check (notification_type in ('info', 'success', 'warning', 'purchase', 'review', 'credits')),
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  subject text,
  total_questions integer not null check (total_questions > 0),
  correct_answers integer not null check (correct_answers >= 0),
  score_percent numeric(5, 2) not null check (score_percent >= 0 and score_percent <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.image_occlusion_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  title text not null default 'Image occlusion',
  source_width integer check (source_width is null or source_width > 0),
  source_height integer check (source_height is null or source_height > 0),
  source_storage_bucket text,
  source_storage_path text,
  status text not null default 'draft' check (status in ('draft', 'saved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.image_occlusion_masks (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.image_occlusion_sets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  label text not null default '',
  answer text not null check (char_length(answer) between 1 and 500),
  hint text,
  x numeric(7, 6) not null check (x >= 0 and x <= 1),
  y numeric(7, 6) not null check (y >= 0 and y <= 1),
  width numeric(7, 6) not null check (width > 0 and width <= 1),
  height numeric(7, 6) not null check (height > 0 and height <= 1),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_transactions_owner_created_idx on public.credit_transactions (owner_id, created_at desc);
create index if not exists user_library_items_owner_relation_idx on public.user_library_items (owner_id, relation, updated_at desc);
create index if not exists study_sessions_owner_started_idx on public.study_sessions (owner_id, started_at desc);
create index if not exists document_study_progress_owner_updated_idx on public.document_study_progress (owner_id, updated_at desc);
create index if not exists subject_study_progress_owner_updated_idx on public.subject_study_progress (owner_id, updated_at desc);
create index if not exists review_tasks_owner_due_idx on public.review_tasks (owner_id, status, due_at asc);
create index if not exists user_notifications_owner_created_idx on public.user_notifications (owner_id, read_at, created_at desc);
create index if not exists quiz_attempts_owner_created_idx on public.quiz_attempts (owner_id, created_at desc);
create index if not exists image_occlusion_sets_owner_document_idx on public.image_occlusion_sets (owner_id, document_id, page_number);
create index if not exists image_occlusion_masks_set_order_idx on public.image_occlusion_masks (set_id, sort_order);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_library_items_set_updated_at on public.user_library_items;
create trigger user_library_items_set_updated_at before update on public.user_library_items
  for each row execute function public.set_updated_at();

drop trigger if exists document_study_progress_set_updated_at on public.document_study_progress;
create trigger document_study_progress_set_updated_at before update on public.document_study_progress
  for each row execute function public.set_updated_at();

drop trigger if exists subject_study_progress_set_updated_at on public.subject_study_progress;
create trigger subject_study_progress_set_updated_at before update on public.subject_study_progress
  for each row execute function public.set_updated_at();

drop trigger if exists review_tasks_set_updated_at on public.review_tasks;
create trigger review_tasks_set_updated_at before update on public.review_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists image_occlusion_sets_set_updated_at on public.image_occlusion_sets;
create trigger image_occlusion_sets_set_updated_at before update on public.image_occlusion_sets
  for each row execute function public.set_updated_at();

drop trigger if exists image_occlusion_masks_set_updated_at on public.image_occlusion_masks;
create trigger image_occlusion_masks_set_updated_at before update on public.image_occlusion_masks
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.user_library_items enable row level security;
alter table public.study_sessions enable row level security;
alter table public.document_study_progress enable row level security;
alter table public.subject_study_progress enable row level security;
alter table public.review_tasks enable row level security;
alter table public.user_notifications enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.image_occlusion_sets enable row level security;
alter table public.image_occlusion_masks enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users read own credit account" on public.user_credit_accounts;
create policy "Users read own credit account" on public.user_credit_accounts for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users read own credit transactions" on public.credit_transactions;
create policy "Users read own credit transactions" on public.credit_transactions for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users read own library items" on public.user_library_items;
create policy "Users read own library items" on public.user_library_items for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users create own non-purchase library items" on public.user_library_items;
create policy "Users create own non-purchase library items" on public.user_library_items for insert to authenticated
  with check ((select auth.uid()) = owner_id and relation in ('saved', 'wishlist', 'study_later'));

drop policy if exists "Users update own non-purchase library items" on public.user_library_items;
create policy "Users update own non-purchase library items" on public.user_library_items for update to authenticated
  using ((select auth.uid()) = owner_id and relation in ('saved', 'wishlist', 'study_later'))
  with check ((select auth.uid()) = owner_id and relation in ('saved', 'wishlist', 'study_later'));

drop policy if exists "Users delete own non-purchase library items" on public.user_library_items;
create policy "Users delete own non-purchase library items" on public.user_library_items for delete to authenticated
  using ((select auth.uid()) = owner_id and relation in ('saved', 'wishlist', 'study_later'));

drop policy if exists "Users manage own study sessions" on public.study_sessions;
create policy "Users manage own study sessions" on public.study_sessions for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own document progress" on public.document_study_progress;
create policy "Users manage own document progress" on public.document_study_progress for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own subject progress" on public.subject_study_progress;
create policy "Users manage own subject progress" on public.subject_study_progress for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own review tasks" on public.review_tasks;
create policy "Users manage own review tasks" on public.review_tasks for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications" on public.user_notifications for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users mark own notifications read" on public.user_notifications;
create policy "Users mark own notifications read" on public.user_notifications for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own quiz attempts" on public.quiz_attempts;
create policy "Users manage own quiz attempts" on public.quiz_attempts for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own occlusion sets" on public.image_occlusion_sets;
create policy "Users manage own occlusion sets" on public.image_occlusion_sets for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage own occlusion masks" on public.image_occlusion_masks;
create policy "Users manage own occlusion masks" on public.image_occlusion_masks for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
