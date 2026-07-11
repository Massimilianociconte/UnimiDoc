-- Keep the local migration history aligned with the live hardening applied in
-- Supabase: rls_auto_enable is an internal trigger/helper and must never be
-- callable through public REST RPC grants.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end;
$$;
