-- Keep the local migration history aligned with the live hardening applied in
-- Supabase: rls_auto_enable is an internal trigger/helper and must never be
-- callable through public REST RPC grants.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
