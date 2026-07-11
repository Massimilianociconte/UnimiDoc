# ADR 001 — Runtime del worker documentale PDF/OCR

- Stato: accepted
- Data: 2026-07-11
- Ambito: upload, parsing PDF, OCR, chunk, outline, qualità e Storage

## Decisione

L’elaborazione documentale nativa viene eseguita da un container Node 22 separato. Supabase Edge Functions restano il boundary HTTP per autenticazione e accodamento; Postgres è la coda autorevole; Supabase Storage conserva input e artefatti.

Non vengono eseguiti `qpdf`, Poppler, OCRmyPDF o Tesseract nelle Edge Function. `EdgeRuntime.waitUntil()` non cambia i limiti CPU, RAM e wall-clock del runtime hosted e non fornisce i binari nativi necessari.

## Flusso

```text
signed upload → processing-temp
             → document-upload/finalize
             → enqueue_pdf_processing_run()
             → compress [verify + promote]
             → extract
             → ocr
             → layout
             → figures + outline
             → quality_review
             → attivazione atomica artifact_version
             → RAG queued
```

`document-upload` non scarica il PDF durante finalize. Verifica soltanto path, presenza e dimensione dichiarata. Il primo job calcola SHA-256 in streaming, controlla magic bytes e `qpdf`, comprime senza perdita e promuove il file in un path immutabile content-addressed.

## Semantica della coda

- `FOR UPDATE SKIP LOCKED` impedisce claim concorrenti dello stesso job.
- Ogni claim genera un `lease_token` necessario per heartbeat, complete e fail.
- Un worker che perde la lease non può committare risultati.
- `available_at` implementa backoff esponenziale con jitter.
- Il quinto fallimento retryable passa in `dead_lettered`.
- Le dipendenze sono righe esplicite in `pdf_processing_job_dependencies`.
- La idempotency key è stabile per run e fase.
- Le righe legacy senza `run_id` non vengono reclamate automaticamente.

## Consistenza degli artefatti

Pagine, chunk, blocchi, asset e outline sono scritti con `processing_run_id`, `artifact_version` e `is_active=false`. Soltanto `complete_pdf_processing_job()` per `quality_review`:

1. disattiva la versione corrente;
2. attiva tutte le tabelle della nuova versione;
3. aggiorna report qualità e documento;
4. imposta RAG in coda quando esistono chunk attivi.

Un crash intermedio non espone mai una combinazione di versioni diverse. Le versioni storiche rimangono disponibili al backend per provenienza e foreign key di flashcard preesistenti.

## RAG

`rag-index` ignora il testo inviato dal browser. Legge esclusivamente `resolved_text` e `pdf_chunks` attivi prodotti dal worker. Durante estrazione/OCR restituisce HTTP 202 con stato `queued`. I documenti legacy possono ancora generare chunk da pagine attive già persistite, senza accettare nuovi contenuti dal client.

## Alternative respinte

- Edge Function con `waitUntil`: non adatta a CPU, memoria, durata e binari nativi.
- Netlify Function: non adatta a processi OCR lunghi e filesystem/toolchain nativa.
- Seconda coda `pgmq`: duplicazione non necessaria mentre `pdf_processing_jobs` è già il source of truth applicativo.
- Eliminazione degli artefatti precedenti prima del parsing: espone stati parziali e rompe provenienza.

## Conseguenze operative

Serve un runtime container persistente o un job container schedulato. Il deploy del frontend e delle Edge Function non avvia il worker. Il container deve essere monitorato separatamente e ricostruito regolarmente per aggiornare qpdf, Poppler, Ghostscript, OCRmyPDF e Tesseract.
