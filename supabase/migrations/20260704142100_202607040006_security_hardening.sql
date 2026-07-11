-- ============================================================================
-- Security hardening flagged by the Supabase advisor after the user-area DDL.
--   * Pin search_path on the shared trigger function (lint 0011).
--   * Stop the signup trigger and the usage-rollup RPC from being callable as
--     public PostgREST RPCs (lints 0028 / 0029); the rollup stays reachable by
--     the service role used by the Edge Functions.
-- Applied to the live project via the Supabase connector on 2026-07-04.
--
-- Note: public.rls_auto_enable() is a platform event-trigger function that
-- auto-enables RLS on new public tables; it is intentionally left in place.
-- ============================================================================

alter function public.set_updated_at() set search_path = public, pg_temp;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.record_ai_monthly_usage(uuid, integer, integer, integer, numeric) from public;
grant execute on function public.record_ai_monthly_usage(uuid, integer, integer, integer, numeric) to service_role;
