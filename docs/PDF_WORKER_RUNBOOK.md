# UnimiDoc PDF worker — runbook produzione

## Prerequisiti

1. applicare la migrazione `pdf_worker_leases_and_pipeline_runs`;
2. deployare `document-upload` e `rag-index` aggiornate;
3. configurare nel runtime worker soltanto secret backend;
4. avviare almeno una replica container;
5. riconciliare i job legacy prima in dry-run.
6. solo dopo uno smoke test riuscito, impostare `PDF_WORKER_ENABLED=true`
   nelle Edge Function e `VITE_DOCUMENT_UPLOAD_ENABLED=true` nel frontend.

Il worker non viene deployato da Netlify o da `supabase functions deploy`.

## Variabili

Obbligatorie:

```ini
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PDF_WORKER_CALLBACK_SECRET=... # almeno 32 caratteri, uguale nel worker e nelle Edge Function
```

Raccomandate:

```ini
PDF_PIPELINE_VERSION=pdf-worker-v1
PDF_CHUNKING_VERSION=section-aware-v2
PDF_WORKER_ID=production-eu-1
PDF_WORKER_CONCURRENCY=1
PDF_WORKER_POLL_MS=1500
PDF_JOB_LEASE_SECONDS=180
PDF_WORKER_HEARTBEAT_MS=30000
PDF_OCR_LANGUAGES=ita+eng
PDF_OCR_MAX_PAGES_FREE=0
PDF_OCR_MAX_PAGES_BASE=24
PDF_OCR_MAX_PAGES_PREMIUM=160
PDF_MAX_UPLOAD_BYTES=52428800
PDF_MAX_PAGES=2000
PDF_RAG_INDEX_TIMEOUT_MS=900000
```

`PDF_PIPELINE_VERSION` deve coincidere nelle Edge Function e nel container. Il
worker usa il claim versionato e non può consumare run di una release diversa;
prima di cambiare versione drenare o riconciliare esplicitamente il backlog
precedente.

Non usare mai prefissi `VITE_` per questi valori. Il service-role key non deve essere presente nel frontend, nei log o nell'immagine Docker.

## Verifica locale

```bash
npm run typecheck:worker
npx vitest run server/pdf-pipeline/worker.test.ts src/lib/chunking.test.ts
npx oxlint server/pdf-pipeline scripts/reconcile-pdf-jobs.ts
npx supabase db reset
npx supabase db lint --local --level warning
```

## Observability & Metrics (production)

Il worker emette log JSON strutturati con:
- `pdf_job_started` / `pdf_job_completed` / `pdf_job_failed`
- `pdf_job_stage` (per ogni fase)
- `pdf_job_metric` (duration_ms, etc.)
- `pdf_job_lease_contention` (importante per tuning)

**Correlation**: Tutti i log includono `jobId`, `runId`, `documentId`. Edge Functions passano `requestId` (usa `x-request-id` header se presente).

**Lease contention monitoring**: Cerca `lease_contention` o `lost_lease`. Se frequente:
- Aumenta `PDF_JOB_LEASE_SECONDS`
- Riduci `PDF_WORKER_CONCURRENCY`
- Aumenta heartbeat

**Costi e qualità**: I costi AI sono registrati in `ai_cost_ledger` e `ai_monthly_usage`. Monitora `estimated_cost_usd` per job.

Prima di attivare `PDF_WORKER_ENABLED=true`:
1. Verifica che i log del worker siano collezionati (es. in Loki/CloudWatch).
2. Fai un dry-run di riconciliazione.
3. Fai smoke con `--once` su un documento reale.
4. Verifica che le Edge Function usino la stessa `PDF_PIPELINE_VERSION`.

Feature flag raccomandati:
- `PDF_WORKER_ENABLED` nelle Edge Functions (blocca nuovi upload se false)
- `VITE_DOCUMENT_UPLOAD_ENABLED` nel frontend

**Runbook operativo**: Prima di cambiare versione del pipeline, drenare i job in corso o usare lo script di riconciliazione.

Build container:

```bash
docker build -f Dockerfile.worker -t unimidoc-pdf-worker:local .
```

Smoke test senza claim infinito:

```bash
docker run --rm \
  --env-file .env.worker.local \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --memory=2g \
  --cpus=2 \
  --pids-limit=256 \
  unimidoc-pdf-worker:local \
  npm run worker:pdf:once
```

In produzione evitare `noexec` sul tmpfs se la distribuzione OCR usa helper temporanei eseguibili; verificare l’immagine specifica. Non montare il Docker socket e mantenere il root filesystem read-only.

## Riconciliazione job legacy

Dry-run obbligatorio:

```bash
npm run worker:pdf:reconcile
```

Controllare `legacyJobs`, `eligibleDocuments` e `skippedDocuments`. Solo dopo:

```bash
npm run worker:pdf:reconcile -- --apply
```

Lo script crea run versionate soltanto per documenti `verified_submitted` o già in `verification_queued`, poi marca come sostituiti i job legacy senza `run_id`. Non elabora bozze mai finalizzate.

## Query operative

Backlog e job più vecchio:

```sql
select
  status,
  job_type,
  count(*) as jobs,
  min(created_at) as oldest_created_at
from public.pdf_processing_jobs
where run_id is not null
group by status, job_type
order by status, job_type;
```

Lease scadute:

```sql
select id, run_id, document_id, job_type, worker_id, attempts, lease_expires_at
from public.pdf_processing_jobs
where status = 'running' and lease_expires_at < now();
```

Dead letter:

```sql
select id, run_id, document_id, job_type, attempts, error_code, finished_at
from public.pdf_processing_jobs
where status = 'dead_lettered'
order by finished_at desc;
```

Durate e errori tecnici sono in `pdf_processing_job_attempts`, leggibile soltanto con service role/amministrazione.

## Soglie di allerta iniziali

- job queued più vecchio di 5 minuti;
- almeno un `dead_lettered` negli ultimi 15 minuti;
- lease scadute non recuperate entro due cicli di poll;
- failure OCR superiore al 10% su 30 minuti;
- p95 OCR oltre 20 minuti;
- crescita continua di oggetti `processing-temp` oltre 24 ore;
- nessuna heartbeat da tutte le repliche per 3 minuti.

## Recovery

- Crash worker: non intervenire subito; la lease scade e il job passa a `retry_wait`.
- Worker zombie: il token scaduto non può completare il job.
- Errore permanente file: il run passa `failed`; l’utente deve correggere/ricaricare il PDF.
- Configurazione binari mancante: il preflight del container fallisce prima del polling.
- Rilascio difettoso: fermare le repliche nuove; non fare rollback distruttivo dello schema. Correggere con forward-fix e riavviare.
- Retry manuale: una nuova finalize sullo stesso documento riapre soltanto fasi terminali/cancellate della stessa run.

## Limite di deploy ancora esterno al repository

Il repository produce un’immagine completa, ma la scelta del provider container, il registry, CPU/RAM, autoscaling, rete e secret store sono configurazioni infrastrutturali esterne. Prima del go-live servono un deploy staging e un corpus autorizzato con PDF testuali, scansioni, misti, ruotati, cifrati e documenti vicini ai limiti.
