-- Serverless Storage GC: schedule the storage-gc Edge Function every 10 minutes.
-- The Edge Function authenticates by requiring the service-role key as a Bearer
-- token; the cron reads that key from Vault (secret name 'service_role_key').
-- Until that Vault secret is created the call simply gets 401 (harmless no-op).
--
-- One-time operator step to activate it:
--   select vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'service_role_key');
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('storage-gc-drain');
exception when others then
  null;
end
$$;

select cron.schedule(
  'storage-gc-drain',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://pmpzfkikwfylesehfezv.supabase.co/functions/v1/storage-gc',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);
