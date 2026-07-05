# UnimiDoc: PDF lossless, flashcard AI e anteprime protette

Data: 2026-07-03

## 1. Architettura esistente

Il progetto attuale è una SPA React/Vite in `src/App.tsx`, con dati demo in `src/data.ts` e catalogo corsi in `src/courseCatalog.ts`. Non ci sono ancora backend, Supabase client, autenticazione reale, code, storage o API server: login, crediti, download, documenti e toast sono stato locale React.

Questo rende l'integrazione chiara: il frontend va esteso senza riscriverlo, mentre il backend va aggiunto come livello separato con Supabase Auth, Postgres, Storage privato e un worker server/container per PDF processing.

## 2. Punti di integrazione flashcard

- Upload: `UploadPage` deve creare un record `documents`, caricare il PDF in `processing-temp`, creare job `compress`, `extract` e, se richiesto, `flashcards`.
- Documento: ogni `DocumentCard` deve mostrare stato flashcard: `queued`, `running`, `ready`, `needs_review`.
- Libreria utente: aggiungere tab "Flashcard" collegate a `document_id`, approvabili/modificabili/cancellabili.
- Premium: sbloccare cloze, immagini, formule, domande d'esame, multimodale e rigenerazione intelligente.
- Backend: usare `server/pdf-pipeline/pipeline.ts` come base del worker e salvare output in `pdf_pages`, `pdf_chunks`, `flashcards`.

## 3. Punti di integrazione compressione PDF lossless

- Prima del salvataggio definitivo in `private-documents`, il PDF passa da `processing-temp`.
- Il worker valida magic bytes, MIME, dimensione e `qpdf --check`.
- Il worker prova compressione lossless con qpdf/pikepdf/mutool.
- Se il PDF compresso non supera i controlli, si conserva l'originale.
- Dopo verifica, il file finale va in `private-documents/{user_id}/documents/{document_id}/document.pdf`.

## 4. Pipeline completa

1. Client richiede upload firmato temporaneo.
2. Backend crea `documents` con `owner_id = auth.uid()`.
3. Client carica in `processing-temp/{user_id}/incoming/{document_id}.pdf`.
4. Backend accoda job `compress`.
5. Worker scarica il file con service role in ambiente isolato.
6. Validazione: estensione, MIME, magic bytes, peso, qpdf check, limiti pagina.
7. Compressione lossless.
8. Verifica post-compressione: pagine, testo estratto, hash testo normalizzato, immagini inventariate, dimensione.
9. Upload finale in bucket privato.
10. Cancellazione temp.
11. Estrazione testo nativo.
12. OCR solo sulle pagine con testo assente o degradato.
13. Rilevamento pagine con tabelle, figure, formule o schemi.
14. Analisi multimodale solo premium e solo sulle pagine utili.
15. Chunking strutturale.
16. Cache lookup per `content_sha256 + settings_hash`.
17. Generazione flashcard euristica e AI economica/premium.
18. Quality gate, deduplica, salvataggio.
19. UI mostra flashcard in bozza.
20. Utente modifica, approva, rigenera o elimina.

## 5. Schema database

La migration è in `supabase/migrations/202607030001_pdf_flashcards.sql`.

Tabelle principali:

- `documents`: ownership, storage path, hash, status compressione/flashcard.
- `pdf_processing_jobs`: coda logica, stato, tentativi, costo stimato/reale.
- `pdf_pages`: testo pagina, qualità estrazione, OCR status, figure/tabelle/formule.
- `pdf_chunks`: blocchi processabili con hash e struttura.
- `flashcards`: card atomicamente collegate a documento, chunk e pagine.
- `flashcard_reviews`: approvazione, editing, rigenerazione, cancellazione.
- `ai_cost_ledger`: tracciamento costi.
- `processed_chunk_cache`: cache backend-only per non riprocessare chunk già visti.

## 6. Schema Supabase Storage

- `processing-temp`: privato, transitorio, TTL consigliato 24 ore.
- `private-documents`: privato, contiene solo PDF finali validati/compressi.
- `derived-previews`: privato, contiene anteprime oscurate, thumbnail e pagine renderizzate con watermark.

Percorso standard:

```text
{user_id}/documents/{document_id}/document.pdf
{user_id}/documents/{document_id}/preview/page-001.png
{user_id}/incoming/{document_id}.pdf
```

## 7. Policy RLS consigliate

Principi:

- Ogni tabella utente ha `owner_id`.
- Le policy usano `(select auth.uid()) = owner_id` per evitare chiamate per riga.
- Tutte le colonne usate in RLS sono indicizzate.
- Cache globali e contenuti derivati sensibili restano service-role only.
- Storage consente accesso solo se la prima cartella del path coincide con `auth.uid()`.

Esempio:

```sql
create policy "Users can read own documents"
on public.documents for select to authenticated
using ((select auth.uid()) = owner_id);
```

## 8. Algoritmo compressione PDF lossless

Metodo consigliato:

1. Eseguire `qpdf --check`.
2. Calcolare metriche prima: SHA-256 file, peso, pagine, hash testo normalizzato, inventory immagini.
3. Provare `qpdf`:

```bash
qpdf \
  --object-streams=generate \
  --stream-data=compress \
  --recompress-flate \
  --compression-level=9 \
  --remove-unreferenced-resources=auto \
  input.pdf output.pdf
```

4. Per casi speciali provare pikepdf/mutool, sempre senza downsampling, rasterizzazione o conversione immagini.
5. Validare dopo: stesso numero pagine, testo invariato, immagini non degradate, nessuna perdita OCR layer utile.
6. Salvare il compresso solo se è più piccolo e valido.
7. In caso contrario, salvare l'originale validato.

Ghostscript va usato solo se si impone un profilo realmente lossless e verificato; molte ricette Ghostscript comuni sono lossy e non vanno usate qui.

## 9. Pipeline economica free/base

- Max pagine free: 15, base: 40.
- Solo testo nativo dove possibile.
- OCR selettivo solo su poche pagine critiche.
- Nessuna analisi immagini salvo thumbnail/metadata.
- Heuristics per definizioni, sequenze, confronti, causa-effetto.
- AI economica solo per trasformare concetti già estratti in JSON flashcard.
- Max card: free 20, base 80.
- Quality gate più severo: se la card non è ancorabile al chunk, viene scartata.

## 10. Pipeline premium

- Max pagine più alto, gestito per piano.
- OCR avanzato sulle pagine scannerizzate.
- Analisi multimodale solo su pagine con figure/tabelle/formule rilevanti.
- Flashcard cloze, da immagine, grafico, formula, tabella.
- Domande in stile esame.
- Spiegazioni aggiuntive.
- Rigenerazione card su singolo chunk.
- Collegamento preciso a pagina, sezione e quote di origine.
- Quality review AI separata sui casi ambigui.

## 11. Strategia contenimento costi

- Hash file per evitare duplicati utente.
- Hash chunk per cache cross-job service-only.
- Chunking prima dell'AI.
- Batch di chunk piccoli e omogenei.
- Prompt versionati e JSON schema rigido.
- OCR solo quando il testo nativo è scarso.
- Multimodale solo premium e solo per pagine classificate come utili.
- Limiti per piano: pagine, card, rigenerazioni, immagini analizzate.
- Ledger costi per bloccare job oltre budget.
- Background queue con retry e `SKIP LOCKED` se si usa Postgres come coda.

## 12. Modelli AI economici consigliati

Configurare via env, senza fissare il modello nel codice:

```text
BASE_FLASHCARD_MODEL=gpt-4.1-mini
BASE_REVIEW_MODEL=gpt-4.1-mini
```

Se l'account ha accesso a modelli GPT-5 mini/nano con prezzo migliore, usare:

```text
BASE_FLASHCARD_MODEL=gpt-5-nano
BASE_REVIEW_MODEL=gpt-5-mini
```

Il modello base riceve solo chunk testuali già puliti e deve produrre JSON validato.

## 13. Modelli AI premium consigliati

```text
PREMIUM_FLASHCARD_MODEL=gpt-5-mini
PREMIUM_REVIEW_MODEL=gpt-5-mini
PREMIUM_MULTIMODAL_MODEL=gpt-5
```

Fallback pragmatico:

```text
PREMIUM_FLASHCARD_MODEL=gpt-4.1
PREMIUM_MULTIMODAL_MODEL=gpt-4.1
```

Il modello premium va usato solo quando la pipeline deterministica segnala contenuto ad alto valore: figure scientifiche, formule, tabelle dense o chunk con bassa qualità euristica.

## 14. Sistema caching

Chiavi:

- `original_file_sha256`: deduplica upload.
- `compressed_file_sha256`: verifica storage finale.
- `content_sha256`: chunk normalizzato.
- `settings_hash`: piano, lingua, prompt version, tipo card richieste, modello.

La cache `processed_chunk_cache` non deve essere leggibile dal client, perché contiene contenuto derivato dai PDF di altri utenti.

## 15. Sistema deduplicazione

- Deduplica file per `owner_id + original_file_sha256`.
- Deduplica chunk per `content_sha256`.
- Deduplica flashcard per fingerprint semantico: front normalizzato + back normalizzato + source page.
- Premium: opzionale embedding locale/economico solo sulle card candidate per rimuovere parafrasi duplicate.
- In caso di duplicati: mantenere card con qualità più alta e fonte più precisa.

## 16. Controllo qualità flashcard

Score 0-1 per:

- Accuratezza rispetto al chunk.
- Chiarezza.
- Utilità didattica.
- Specificità.
- Atomicità.
- Duplicazione.
- Difficoltà.
- Rischio allucinazione.
- Coerenza con pagina/sezione.

Regole minime:

- Una card = un concetto.
- Front sotto 280 caratteri salvo cloze/formule.
- Back sotto 900 caratteri salvo spiegazione premium.
- Deve citare o derivare da un chunk sorgente.
- Se `hallucination_risk > 0.25`, scarta o rigenera.
- Se `quality_score < 0.65`, scarta in base, rigenera in premium.

## 17. Codice/pseudocodice principale

Il worker di riferimento è in `server/pdf-pipeline/pipeline.ts`.

Flusso sintetico:

```ts
await validatePdf(path)
const before = await inspectPdf(path)
const compression = await compressLosslessPdf(path, output, before)
const pages = await extractNativeText(compression.outputPath)
const ocrPages = await runSelectiveOcr(compression.outputPath, weakPages, tier)
const chunks = chunkStructuredPdf(mergeNativeAndOcr(pages, ocrPages))
const cards = await generateFlashcardsCostFirst(chunks, tier)
await saveFlashcards(cards)
```

## 18. Gestione errori

- `INVALID_PDF_MAGIC_BYTES`: rifiuto upload.
- `PDF_TOO_LARGE`: mostra limite piano.
- `QPDF_CHECK_FAILED`: quarantena, non processare.
- `LOSSLESS_VERIFY_FAILED`: salva originale validato o rifiuta se corrotto.
- `OCR_FAILED`: continua con testo nativo e segnala qualità parziale.
- `AI_BUDGET_EXCEEDED`: salva chunk e rimanda generazione.
- `FLASHCARD_QA_FAILED`: card in `needs_review` o scartata.
- Errori client sempre generici; log server senza contenuto PDF.

## 19. Limiti tecnici

- Il browser non può impedire screenshot o foto allo schermo. Può solo oscurare, watermarkare, ridurre qualità e impedire accesso al PDF originale.
- Supabase Edge Functions standard non sono ideali per qpdf/OCR: serve worker containerizzato o server con binari installati.
- La compressione lossless non sempre riduce peso. PDF già ottimizzati resteranno invariati.
- OCR e multimodale sono i cost driver: devono essere limitati e tracciati.
- Le flashcard AI non sono fonte di verità: devono restare ancorate al chunk.

## 20. Miglioramenti futuri

- Spaced repetition con FSRS.
- Deck per esame e appello.
- Ricerca semantica interna sui chunk.
- Editor flashcard collaborativo.
- Moderazione copyright più avanzata.
- Watermark per utente/sessione in ogni anteprima renderizzata.
- Export Anki.
- Fine-tuning o distillazione su flashcard approvate dagli utenti, solo con consenso esplicito.

## Fonti operative

- Flashka.ai come riferimento UX, senza copiare logiche proprietarie: https://www.flashka.ai
- Piano didattico Scienze Biologiche L-13 Statale: https://scienzebiologiche.cdl.unimi.it/it/insegnamenti/piano-didattico
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- qpdf CLI: https://qpdf.readthedocs.io/en/stable/cli.html
- OpenAI models: https://platform.openai.com/docs/models
- OpenAI pricing: https://openai.com/api/pricing
