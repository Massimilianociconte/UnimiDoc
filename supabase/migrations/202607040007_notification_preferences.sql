-- ============================================================================
-- Per-user, granular notification preferences (in-app / email / push per
-- event category). Stored as a JSONB map so categories can evolve without
-- schema churn. Owner-scoped RLS. Applied to the live project on 2026-07-04.
-- ============================================================================

create table if not exists public.notification_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop policy if exists "Users read own notification prefs" on public.notification_preferences;
create policy "Users read own notification prefs" on public.notification_preferences for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users insert own notification prefs" on public.notification_preferences;
create policy "Users insert own notification prefs" on public.notification_preferences for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users update own notification prefs" on public.notification_preferences;
create policy "Users update own notification prefs" on public.notification_preferences for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
