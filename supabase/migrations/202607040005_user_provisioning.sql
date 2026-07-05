-- ============================================================================
-- Auto-provision a full private area whenever a new auth user is created.
-- SECURITY DEFINER so it can write owner-scoped rows past RLS. Wrapped in an
-- exception guard so a provisioning hiccup can never block authentication.
-- Applied to the live project via the Supabase connector on 2026-07-04.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_avatar text;
  v_welcome integer := 30;
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

  insert into public.user_credit_accounts (owner_id, balance, lifetime_earned)
  values (new.id, v_welcome, v_welcome)
  on conflict (owner_id) do nothing;

  insert into public.credit_transactions (owner_id, direction, amount, reason)
  values (new.id, 'earned', v_welcome, 'Bonus di benvenuto UnimiDoc');

  insert into public.user_notifications (owner_id, title, body, notification_type)
  values (
    new.id,
    'Benvenuto su UnimiDoc',
    'La tua area riservata è pronta. Hai ricevuto ' || v_welcome || ' crediti di benvenuto.',
    'success'
  );

  return new;
exception
  when others then
    raise warning 'handle_new_user provisioning failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users that already exist (idempotent; none on a fresh project).
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(u.email, ''), '@', 1), 'Studente UnimiDoc')
from auth.users u
on conflict (id) do nothing;

insert into public.user_entitlements (owner_id, plan)
select u.id, 'free' from auth.users u
on conflict (owner_id) do nothing;

insert into public.user_credit_accounts (owner_id, balance, lifetime_earned)
select u.id, 30, 30 from auth.users u
on conflict (owner_id) do nothing;
