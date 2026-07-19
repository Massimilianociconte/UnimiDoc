# Monitoraggio operativo e alert — 2026-07-15

## Componenti

| Componente | Cosa raccoglie | Dove |
| --- | --- | --- |
| `public.client_errors` | errori frontend (message, stack sanificato, release, correlation id, breadcrumb route) | insert-only da anon/authenticated, lettura solo service role, retention 30 giorni |
| `src/lib/monitoring.ts` | handler globali `error`/`unhandledrejection`, breadcrumb di navigazione, dedupe + max 10 errori/sessione | inizializzato in `main.tsx` |
| Edge Functions | log JSON con `requestId` (`_shared/log.ts`), propagato via header `x-request-id` | Dashboard > Logs (o `get_logs`) |
| Worker PDF | log JSON con `jobId`/`runId`/`documentId`, healthcheck `/healthz` | stdout container (json-file con rotazione) |
| `app_private.ops_metrics()` | backlog worker, lease bloccati, dead-letter, fallimenti job/OCR, errori client, spesa AI mensile, crescita DB/storage, cron falliti | funzione SQL, solo service role |
| `app_private.ops_alerts` + `evaluate_ops_alerts()` | alert su soglie, valutati ogni 15 minuti via pg_cron, max 1 alert aperto per metrica ogni 6h | tabella privata |

## Regole sui dati sensibili

Il client **non invia mai**: testo dei documenti, query di ricerca private,
email (mascherate), token/JWT (mascherati), querystring degli URL. I vincoli
di lunghezza sono anche lato DB (CHECK). Gli `usage_events` di prodotto
restano separati e minimizzati.

## Consultazione

```sql
-- Fotografia corrente
select jsonb_pretty(app_private.ops_metrics());

-- Alert aperti
select * from app_private.ops_alerts where acknowledged_at is null order by created_at desc;

-- Riconoscere un alert
update app_private.ops_alerts set acknowledged_at = now() where id = '<id>';

-- Errori frontend recenti raggruppati
select message, count(*), max(created_at)
from public.client_errors
where created_at > now() - interval '7 days'
group by message order by 2 desc limit 20;
```

## Soglie attive

| Metrica | Soglia | Severità |
| --- | --- | --- |
| worker_backlog | ≥ 25 job | warning |
| worker_oldest_queued_minutes | ≥ 30 min | critical |
| worker_stuck_leases | ≥ 1 | warning |
| jobs_dead_lettered_24h | ≥ 1 | critical |
| ocr_failures_24h | ≥ 5 | warning |
| client_errors_24h | ≥ 50 | warning |
| cron_failures_24h | ≥ 1 | critical |
| ai_cost_month_usd | ≥ 50 USD | warning |

Adeguare le soglie in `evaluate_ops_alerts()` quando il traffico reale darà
una baseline.

## Consegna degli alert (da attivare)

Oggi gli alert restano in tabella (pull). Per il push via email/webhook,
quando sarà disponibile un provider (stesso prerequisito dell'SMTP Auth):

1. salvare l'endpoint nel Vault: `select vault.create_secret('<url>', 'ops_webhook_url');`
2. aggiungere in coda a `evaluate_ops_alerts()` una chiamata
   `net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='ops_webhook_url'), body := to_jsonb(alert))`
   per ogni alert appena inserito.

## Release tracking

Impostare `VITE_APP_VERSION` (es. commit SHA) nella build Netlify:
`VITE_APP_VERSION=$COMMIT_REF` in `netlify.toml` o nelle build env, così gli
errori client sono correlabili alla release.
