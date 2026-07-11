-- Lock down internal SECURITY DEFINER functions that must NOT be callable as
-- REST RPC by clients. handle_new_user / rls_auto_enable are trigger functions;
-- record_ai_monthly_usage is called by Edge Functions via the service role
-- (which bypasses these grants), so revoking client roles is safe.
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
do $$
begin
  -- Supabase Cloud may install this event-trigger helper, while a fresh local
  -- stack may not. Keep bootstrap reproducible in both environments.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end;
$$;
revoke execute on function public.record_ai_monthly_usage(uuid, integer, integer, integer, numeric) from anon;
revoke execute on function public.record_ai_monthly_usage(uuid, integer, integer, integer, numeric) from authenticated;
