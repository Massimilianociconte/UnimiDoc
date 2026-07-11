-- Keep the already-deployed subscription hardening immutable while making its
-- selected offer row an explicit part of the authorization assertion. The
-- previous definition intentionally selected the row but only inspected FOUND,
-- which is correct at runtime yet reported as an unread-variable warning.

do $migration$
declare
  definition text;
  before_guard text := E'    if not found then\n      raise exception ''billing_subscription_sku_not_authorized'' using errcode = ''23514'';';
  after_guard text := E'    if not found or v_offer.id is null then\n      raise exception ''billing_subscription_sku_not_authorized'' using errcode = ''23514'';';
begin
  select pg_get_functiondef(
    'public.billing_sync_subscription(text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz,timestamptz)'::regprocedure
  ) into definition;

  if definition is null or position(before_guard in definition) = 0 then
    raise exception 'billing_subscription_definition_unexpected' using errcode = 'P0001';
  end if;

  execute replace(definition, before_guard, after_guard);
end;
$migration$;

revoke all on function public.billing_sync_subscription(
  text, boolean, text, text, text, text, timestamptz, timestamptz,
  timestamptz, boolean, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(
  text, boolean, text, text, text, text, timestamptz, timestamptz,
  timestamptz, boolean, timestamptz, timestamptz
) to service_role;
