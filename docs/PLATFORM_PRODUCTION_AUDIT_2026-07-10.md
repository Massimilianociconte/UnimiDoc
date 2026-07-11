> **Nota di superseding — 11 luglio 2026:** questo documento conserva il
> checkpoint tecnico del 10 luglio. Per lo stato conclusivo, gli interventi
> applicati e le verifiche remote fare riferimento a
> [`PLATFORM_PRODUCTION_COMPLETION_REPORT_2026-07-11.md`](./PLATFORM_PRODUCTION_COMPLETION_REPORT_2026-07-11.md).

# UnimiDoc — audit tecnico e piano di readiness per la produzione

Data del checkpoint: 10 luglio 2026
Repository analizzato: `/Users/massimilianociconte/Documents/UnimiDoc`
Stack osservato: React 19, TypeScript, Vite, Supabase Auth/Postgres/Storage/Edge Functions, pgvector, pipeline PDF/OCR e provider AI esterni.

## 1. Executive summary

### 1.1 Esito sintetico

UnimiDoc possiede già una base funzionale ampia e coerente con il prodotto: autenticazione Supabase, catalogo e materiali, area personale, upload, crediti, acquisti, pipeline documentale, flashcard, SRS e RAG condividono uno schema dati reale. L'intervento non ha riscritto la piattaforma: ha mantenuto le strutture esistenti, chiuso diversi percorsi che consentivano al browser di alterare dati autorevoli e consolidato i flussi più critici nel database o nelle Edge Function.

Il risultato locale è sensibilmente più stabile e riproducibile. Sono stati verificati build, lint, 30 test, typecheck frontend/pipeline/Edge Function, bootstrap completo delle migrazioni, lint del database, matrice ACL e flussi integrati contro Supabase locale. È stato inoltre eseguito QA browser sulle route principali a 1440, 390 e 320 px. Restano tuttavia blocchi P0 che impediscono di definire oggi il sistema pronto per monetizzazione reale: non esiste ancora un worker che consumi in produzione i job PDF accodati; non esiste un'integrazione pagamenti completa e contabilmente riconciliabile; mancano le pagine e i processi legali; la storia delle migrazioni del progetto remoto deve essere riconciliata prima di qualsiasi push; configurazioni Auth/SMTP/CAPTCHA e prove con provider e PDF reali richiedono validazione operativa.

Stato complessivo:

- **Applicato e verificato localmente:** hardening di upload, accesso documenti, crediti/acquisti, persistenza flashcard/SRS, chunking, versionamento embedding, retrieval RAG, ACL/RLS e riduzione dei dati dimostrativi nelle aree autenticabili.
- **Applicato nel repository ma non deployato:** nuove migrazioni, Edge Function, modifiche frontend e pipeline server. Nessuna modifica descritta in questo documento deve essere considerata attiva sul progetto Supabase remoto finché non viene eseguito un deploy controllato.
- **Non implementato o non chiuso:** worker PDF, pagamenti e payout, documentazione legale, osservabilità di produzione, riconciliazione migrazioni remote e QA end-to-end con provider reali.

### 1.2 Aree analizzate

L'audit ha coperto:

- architettura React/Vite, gestione route e confine tra dati demo e dati Supabase;
- landing page, Esplora, Premium, login/registrazione, dashboard, libreria, pagina materiale, viewer, upload, impostazioni, profili venditore, classifica, notifiche, crediti e storico acquisti;
- presenza o assenza di superfici legali e checkout reali;
- Supabase Auth, provisioning del profilo, persistenza preferenze, crediti iniziali e isolamento dei dati per utente;
- schema Postgres, migrazioni, RLS, grant SQL, indici, vincoli, funzioni `SECURITY DEFINER` e coerenza delle relazioni;
- bucket Storage, signed upload URL, accesso a originali/preview e ciclo di finalizzazione dell'upload;
- documenti, pagine, blocchi, asset, OCR, outline, chunk, job, flashcard, progressi, risposte, SRS e metriche di qualità;
- acquisti, ledger crediti, distinzione tra crediti gratuiti, acquistati, guadagnati e quota convertibile;
- parsing PDF, estrazione testo, OCR adapter, chunking, deduplicazione e stati asincroni;
- indicizzazione RAG, embedding, versionamento, pgvector, retrieval, limiti di contesto e citazioni;
- generazione flashcard, provenienza, persistenza, cronologia, filtri, preferiti, like/dislike, qualità e ripasso intelligente;
- TypeScript, responsabilità frontend/backend, gestione errori/fallback, duplicazioni e comportamento responsive rilevabile da codice/CSS.

### 1.3 Architettura risultante

Il flusso autorevole ora previsto è:

1. Auth crea/aggiorna profilo, entitlement e conto crediti; il bonus viene accreditato solo dopo conferma email e una sola volta.
2. `document-upload` crea una bozza privata e restituisce una signed URL; il browser non può creare o pubblicare documenti direttamente.
3. La finalizzazione scarica e verifica l'oggetto, controlla dimensione, hash, firma PDF e path, quindi porta il documento a `submitted` e accoda job idempotenti.
4. Il futuro worker elabora estrazione/layout/OCR/figure/outline/qualità e persiste pagine, blocchi, asset, outline e chunk.
5. `rag-index` genera o riusa embedding coerenti con modello, versione, dimensione e hash del contenuto; il retrieval applica i diritti di accesso dell'utente.
6. `generate-flashcards` seleziona chunk rappresentativi, valida la provenienza, salva carte idempotenti e collega documento, chunk, pagine, outline e argomento.
7. Il ripasso aggiorna SRS, progresso aggregato e risposta utente in una singola transazione SQL con controllo di concorrenza.
8. Gli acquisti passano dalla RPC atomica `purchase_document`; browser e componenti non aggiornano autonomamente saldo o ledger.

Il punto 4 è ancora incompleto in produzione: la coda è reale, ma manca il processo operativo che la consumi.

### 1.4 Modifiche applicate

#### Database, migrazioni e permessi

- Corretto il nome non valido `202607040008b_harden_new_rpc_grants.sql`, sostituito con la migrazione numerica `20260704000950_harden_purchase_rpc_grants.sql`, così che Supabase CLI non la ignori.
- Resi riproducibili su database pulito gli hardening delle RPC interne nelle migrazioni `202607040012_harden_internal_rpc.sql` e `202607040013_revoke_rls_auto_enable_public.sql` anche se una funzione cloud-only non è ancora presente.
- Rafforzata `purchase_document` in `202607050001_fk_indexes_and_purchase_hardening.sql` e nella migrazione finale, mantenendo l'invariante tra saldo totale e origine dei crediti e trasferendo al venditore solo la quota effettivamente convertibile.
- Aggiunta `20260709222006_production_integrity_hardening.sql` con:
  - riconciliazione prudente del saldo legacy, preflight mirato per bonus welcome duplicati e arresto esplicito in caso di dati ambigui;
  - bonus di benvenuto exactly-once per email confermata;
  - vincoli `balance = free + purchased + earned` e `earned_convertible <= earned_credits`;
  - acquisto idempotente e transazionale;
  - chiave deterministica `generation_item_key` per evitare flashcard duplicate;
  - reservation atomica e serializzata delle flashcard revisionate, con limiti 300/documento e 160/ora;
  - RPC atomica `record_srs_review_atomic` con lock e controllo versione;
  - indici sulle foreign key indicati dagli advisor Supabase;
  - unicità dei job PDF per documento/tipo/hash e dei job RAG attivi per documento;
  - ACL più strette per voti, progressi e rollup qualità flashcard, inclusa una view pubblica senza `author_id`;
  - rimozione dei write path diretti dal browser per documenti, job PDF, Storage temporaneo e contenuto notifiche;
  - RPC limitata `mark_notification_read`;
  - profili venditore opt-in, scrub automatico delle identità materializzate e viste pubbliche a colonne esplicite `public_document_catalog`, `public_seller_profiles` e `public_document_flashcard_quality`;
  - isolamento RAG per modello/versione/hash, lease dei job e recupero degli indici bloccati;
  - grant espliciti a `service_role` e privilegi minimi per `anon`/`authenticated` derivati dalle policy RLS.
- Aggiunta `20260709120000_rag_topic_chunks.sql` per scegliere chunk rappresentativi del documento tramite centroide degli embedding senza creare una seconda tabella chunk.
- Aggiunta configurazione locale Supabase dedicata (`supabase/config.toml`) su porte separate, conferma email attiva e password minima di otto caratteri.

#### Upload, Storage e accesso documenti

- `document-upload` è stato trasformato in un protocollo a due fasi `create/finalize/cancel`.
- La finalizzazione verifica realmente i byte caricati e accoda i job soltanto dopo la validazione.
- Retry dello stesso hash e cancellazione della bozza sono idempotenti; un finalize con risposta persa viene riconciliato senza cancellare una bozza forse già inviata. Job falliti o annullati possono essere riaccodati sullo stesso hash.
- `document-access` convalida UUID, proprietà del path e coerenza tra documento, bucket e oggetto; un documento soltanto `submitted` non viene trattato come pubblico.
- Gli originali e le preview rimangono in bucket privati e l'accesso avviene tramite URL firmate emesse dal backend.

#### Elaborazione documentale

- La pipeline server non simula più il salvataggio del PDF e non considera riuscito un OCR senza adapter: Storage e OCR devono essere iniettati esplicitamente.
- Il chunking condiviso è ora consapevole di capitoli/sezioni, mantiene la corretta provenienza di pagina anche nell'overlap, non emette code composte soltanto da overlap, divide righe molto lunghe e usa target 700 token, massimo 900 e overlap 120.
- Il reindex RAG non elimina in modo distruttivo i chunk ancora referenziati: conserva gli ID stabili, archivia la coda obsoleta e rimuove i relativi embedding.
- I job hanno stati espliciti, deduplicazione per input e lease per recuperare elaborazioni RAG rimaste bloccate.

#### RAG, embedding e retrieval

- Modello, versione e dimensione degli embedding sono centralizzati; il default corrente è `gemini/gemini-embedding-001`, versione `1`, dimensione 768.
- Il provider rifiuta vettori di dimensione diversa o valori non finiti; cambiare dimensione richiede esplicitamente migrazione e reindicizzazione.
- La ricerca pgvector usa soltanto embedding con stesso modello/versione e `content_hash` uguale allo SHA del chunk corrente; esclude chunk falliti e associazioni embedding/chunk appartenenti a documenti diversi.
- L'accesso RAG è limitato a proprietario, acquirente, documento gratuito pubblicato o utente Premium valido per documenti con policy compatibile.
- Il retrieval applica soglia di similarità, limite ai risultati, rimozione dei quasi-duplicati lessicali e budget di contesto di circa 14.000 caratteri.
- Il prompt tratta i chunk come dati non affidabili, riduce il rischio di prompt injection e richiede risposte fondate sui risultati recuperati.
- Le citazioni mantengono documento, intervallo pagine e `section_path`; se non esiste supporto pertinente il flusso non deve inventare una risposta.
- È stata introdotta un'interfaccia provider condivisa, così da poter aggiungere provider futuri senza cambiare lo schema di retrieval, purché modello/versione/dimensione siano migrati correttamente.

#### Flashcard, qualità e SRS

- La generazione da documento usa chunk RAG rappresentativi invece dell'intero PDF e include provenienza per chunk, pagine, sezione, capitolo e argomento.
- La `source_quote` viene verificata rispetto al testo sorgente; le carte non ancorabili non vengono trattate come equivalenti a carte grounded.
- `generation_item_key` rende persistente e idempotente ogni elemento generato per utente.
- Il salvataggio di carte revisionate dall'utente non richiede una seconda generazione AI.
- La libreria studio recupera da Supabase sia le flashcard sia i progressi; non dipende soltanto dallo stato React della sessione corrente.
- Stato risposta, tentativi, corrette, errate, parziali, saltate, preferiti e `needs_review` sono persistenti in `user_flashcard_progress`.
- La RPC SRS aggiorna in modo atomico `srs_state`, `user_flashcard_progress` e `user_answers`, evitando lost update tra tab o dispositivi.
- Like/dislike passano dalla funzione controllata, sono consentiti soltanto ad acquirenti diversi dall'autore e aggiornano il rollup qualità senza doppio trigger.
- Il browser non può riscrivere contatori e snapshot di `user_flashcard_progress`; il solo preferito passa da `set_flashcard_favorite`, che materializza in sicurezza una card non ancora svolta.
- Il salvataggio delle flashcard revisionate usa una reservation RPC con lock per utente, idempotenza e quote concorrenti per ora/documento.
- Il fallback locale SRS è ora separato per utente e documento ed è destinato al solo funzionamento offline/demo, non a sostituire il database per utenti reali.

#### Frontend, dashboard e flussi utente

- Acquisti reali passano dalla RPC atomica; ID demo non vengono accettati come acquisti live e un errore di refresh non sottrae più il saldo nel client.
- La route upload è privata e il successo viene mostrato soltanto dopo upload firmato e finalizzazione verificata.
- Per utenti Supabase reali, dashboard, libreria, notifiche, acquisti, crediti, progressi e catalogo non ricadono più silenziosamente su fixture demo.
- Catalogo e profili usano le viste pubbliche minimali; l'identità del venditore viene esposta soltanto dopo opt-in.
- Profili venditore e classifica escludono identità non pubbliche; le impostazioni espongono opt-in/opt-out e pseudonimo, mentre le route pubbliche usano il `seller_id` stabile per evitare collisioni tra nomi uguali.
- Il prezzo mostrato da card, scheda e acquisto usa il valore autorevole `price_credits` persistito; l'upload salva la stessa stima nel documento, evitando divergenze con la RPC di acquisto.
- L'alias `/appunti` apre Esplora e il pannello laterale mobile è stato vincolato per eliminare l'overflow orizzontale rilevato a 390 px.
- Rimossi numeri promozionali non verificabili e ricompense simulate; le CTA Premium/checkout non operative sono disabilitate e descritte come non ancora attive.
- Migliorati stati vuoti, stati di upload/indicizzazione/deck, errori e fallback; aggiunto rendering rich text per l'assistente documentale.
- Aggiusti CSS riducono overflow e problemi del pulsante studio flashcard su viewport stretti.

### 1.5 File e componenti modificati

| Area | File principali | Responsabilità dell'intervento |
| --- | --- | --- |
| Shell, route e UI | `src/App.tsx`, `src/App.css`, `src/data.ts` | route guard, catalogo live, upload, acquisto, dashboard, seller privacy, stati e responsive |
| RAG UI | `src/components/rag/AskDocumentPanel.tsx`, `src/components/rag/RichMarkdown.tsx` | contesto/citazioni e rendering sicuro del contenuto strutturato |
| Client applicativo | `src/lib/aiClient.ts`, `src/lib/supabaseClient.ts`, `src/lib/flashcardProgress.ts`, `src/lib/creditPricing.ts`, `src/lib/contentModeration.ts`, `src/userDashboardData.ts` | API upload/SRS, query viste pubbliche, prezzo autorevole, idratazione progressi, fallback e dati dashboard |
| Pipeline PDF | `server/pdf-pipeline/pipeline.ts` | adapter reali per Storage/OCR, tipi e fallimenti espliciti |
| Edge condiviso | `supabase/functions/_shared/chunking.ts`, `_shared/embeddings.ts`, `_shared/env.ts`, `_shared/prompts.ts`, `_shared/rag.ts` | chunking, provider/versione embedding, limiti, prompt e retrieval condiviso |
| Edge Function | `ai-help`, `document-access`, `document-upload`, `generate-flashcards`, `rag-index`, `rag-query`, `srs-review` | autorizzazione, persistenza, idempotenza, RAG e transazioni SRS |
| Migrazioni | `20260704000950`, `202607040012`, `202607040013`, `202607050001`, `20260709120000`, `20260709222006` | bootstrap, grant, crediti, ACL, indici, catalogo pubblico, flashcard/SRS e RAG |
| Configurazione/test | `supabase/config.toml`, `supabase/.gitignore`, `supabase/.env.example`, `src/lib/chunking.test.ts` | ambiente locale isolato, variabili documentate e regressioni chunking |

Il file con suffisso non numerico `supabase/migrations/202607040008b_harden_new_rpc_grants.sql` è stato rimosso e sostituito dalla migrazione numerica equivalente. Non sono state eliminate tabelle esistenti: dove esiste sovrapposizione funzionale, la rimozione richiede prima una mappa d'uso e una migrazione dati verificata.

### 1.6 Tabelle e relazioni interessate

Le relazioni centrali confermate o rafforzate sono:

- `auth.users` → `profiles`, `user_entitlements`, `user_credit_accounts`, preferenze, notifiche e dati studio;
- `documents.owner_id` → autore; `document_purchases.buyer_id` → acquirente;
- `documents` → `pdf_pages`, `document_blocks`, `document_assets`, `ocr_runs`, `document_outline`, `pdf_chunks`, job PDF/RAG e report qualità;
- `pdf_chunks` → `rag_chunk_embeddings` e `flashcards.chunk_id`;
- `flashcards` → `user_flashcard_progress`, `srs_state`, `user_answers`, review e voti qualità;
- `document_purchases` → movimenti ledger e diritto di accesso;
- `document_flashcard_quality_rollups` → documento/autore lato servizio; `public_document_flashcard_quality` → proiezione sicura senza UUID autore;
- `reviewed_flashcard_write_reservations` → quota/idempotenza atomica delle flashcard revisionate.

Sono stati aggiunti indici mancanti su riferimenti usati nei join di progresso e qualità, oltre agli indici e vincoli univoci per deduplicazione job, flashcard e lease RAG. I dati denormalizzati in `user_flashcard_progress` (titolo documento, autore, materia, capitolo, domanda/risposta) sono stati mantenuti intenzionalmente come snapshot per filtri rapidi; richiedono una politica esplicita di aggiornamento o immutabilità se autore/titolo cambiano.

## 2. Problemi per severità

### P0 — bloccanti prima della produzione o della monetizzazione

| Problema | Impatto | Stato |
| --- | --- | --- |
| **Manca il worker dei job PDF** | `document-upload` accoda estrazione, layout, figure, outline, OCR/qualità, ma senza consumer i documenti rimangono in lavorazione e RAG/flashcard non hanno una base affidabile. | **Non implementato.** La libreria pipeline è stata resa più rigorosa, ma non è un worker deployato. |
| **Pagamenti incompleti** | Non esistono checkout reale, webhook firmati, top-up, idempotency key di pagamento, refund, chargeback, payout venditore e riconciliazione economica. I crediti interni da soli non costituiscono monetizzazione production-ready. | **Non implementato.** Le CTA non operative sono state disabilitate per evitare false promesse. |
| **Pagine e processi legali mancanti** | Termini, privacy, cookie/consenso, condizioni di vendita, diritto di recesso, rimborsi, contenuti caricati e copyright non sono sufficientemente definiti. | **Non implementato.** Richiede testi approvati da consulenza legale, non contenuto inventato dal codice. |
| **Migration history remota divergente** | Alcune migrazioni locali non risultano allineate alla cronologia del progetto remoto. Un `db push` cieco può saltare oggetti, ridefinire grant o fallire a metà. | **Blocco deploy.** Riconciliare prima con dump/schema diff e una procedura di repair tracciata. |
| **Patch non deployate sul progetto remoto** | Le correzioni locali non proteggono ancora utenti e dati reali. | **Atteso in questa fase.** Deploy solo dopo backup, dry-run, riconciliazione e piano rollback. |
| **Auth e deliverability non validati in produzione** | SMTP, redirect URL, conferma email, CAPTCHA/bot protection, leaked-password protection, OAuth, recovery e delete-account possono bloccare registrazione o esporre abuso. | **Configurazione/manuale.** La configurazione locale non prova quella del dashboard remoto. |
| **QA con provider e documenti reali incompleto** | OCR, parsing, embedding e generazione possono divergere su scansioni, PDF grandi, tabelle, formule, immagini e limiti/timeout del provider. | **Da eseguire.** Servono chiavi di staging, corpus reale e budget controllato. |

### P1 — alta priorità dopo i P0

- **Ciclo Storage incompleto:** l'upload verificato usa l'area temporanea, ma promozione atomica all'oggetto canonico, garbage collection delle bozze, TTL, retry del move e pulizia degli orfani devono diventare un workflow operativo.
- **Osservabilità insufficiente:** mancano dashboard/alert per job in coda, durata OCR, errori provider, costi AI, retrieval senza match, webhook pagamento, drift di saldo e tasso di upload fallito.
- **Dashboard studio parzialmente aggregata:** flashcard e progressi sono persistenti, ma `study_sessions`, attività storiche e KPI cross-device devono essere letti e aggregati in modo uniforme invece di dipendere da viste/client state differenti.
- **Catalogo non ancora completo:** la vista pubblica espone soltanto campi sicuri; tipo materiale, statistiche download/vendita, rating e snapshot di prezzo/versione richiedono colonne autorevoli e politiche anti-manomissione.
- **Conservazione degli acquisti:** deve essere definito cosa vede un acquirente se il venditore ritira, sostituisce o aggiorna un documento e quale versione rimane accessibile.
- **Contenuti e ranking:** leaderboard e profili ora rispettano l'opt-in, ma ranking, reputazione e conteggi devono derivare da query/server aggregate antifrode, non da una lista client.
- **Bundle frontend elevato:** la build segnala un chunk principale di circa 661 kB; alcune immagini sono nell'ordine di 1,3–1,9 MB e i chunk PDF/Word sono circa 449–500 kB. Servono code splitting e asset optimization.
- **`App.tsx` monolitico:** route, dati, dashboard, upload, studio e pagine pubbliche convivono in un file molto grande; questo aumenta coupling e rischio di regressione.
- **Recovery asincrono PDF:** lease, backoff, dead-letter, concorrenza massima e idempotenza esistono solo in parte; devono essere uniformi per tutti i job, non soltanto per RAG.
- **Moderazione e pubblicazione:** il passaggio `submitted` → `published/rejected`, i ruoli di moderazione, audit trail e motivazioni devono vivere nel backend con una UI amministrativa controllata.

### P2 — debito tecnico e coerenza da pianificare

- Esiste sovrapposizione semantica tra `flashcard_reviews`, `flashcard_quality_votes`, `user_answers`, `quiz_attempts` e `user_flashcard_progress`; non è stata rimossa perché ogni tabella può rappresentare un evento differente, ma va definito il source of truth di ogni metrica.
- `processed_chunk_cache` e `flashcard_generation_cache` coprono cache vicine ma con granularità diversa: documentare ownership, TTL, invalidazione e cost allocation prima di consolidarle.
- `user_library_items` e `document_purchases` devono rimanere distinti tra preferenza/libreria e diritto economico; query e naming devono rendere questa differenza esplicita.
- Alcuni snapshot denormalizzati possono divergere dai dati correnti; aggiungere regole di aggiornamento o versionamento.
- Il commento nella migrazione pgvector cita ancora un modello embedding precedente mentre il provider corrente usa `gemini-embedding-001`: correggere la documentazione inline per evitare migrazioni errate.
- Centralizzare ulteriormente mapping tra righe Supabase e tipi UI, error code delle RPC, stati documento/job e microcopy di fallback.
- Separare configurazione demo, staging e produzione con flag espliciti; nessun controllo dovrebbe inferire l'ambiente dalla sola assenza di dati.

### P3 — miglioramenti di qualità percepita

- Completare la verifica responsive visuale per ogni route e per dati estremi: titoli lunghi, badge multipli, prezzi/contatori grandi, tabelle e citazioni molto estese.
- Uniformare skeleton, toast, empty state, retry CTA e messaggi accessibili con `aria-live`.
- Migliorare tastiera/focus nelle modali, nel viewer, nelle flashcard e nei menu mobile.
- Aggiungere formati di data/numero centralizzati e microcopy coerente tra dashboard, materiale, upload e Premium.

## 3. Quick wins

### 3.1 Già applicati

- Rimozione delle fixture dalle sessioni Supabase reali e mantenimento dei dati demo soltanto in ambiente demo/non configurato.
- Disabilitazione di checkout e claim Premium non esistenti.
- Route guard su upload, dashboard, libreria e impostazioni.
- Signed upload con finalizzazione verificata e cancellazione/retry idempotenti.
- Catalogo e profili pubblici tramite viste minimali con seller opt-in.
- Acquisto e saldo aggiornati dal database, non da optimistic mutation client.
- Bonus di benvenuto exactly-once dopo conferma email.
- SRS atomico e persistenza cross-device di flashcard/progressi.
- Versionamento embedding e controllo hash nei match.
- Test di regressione sul chunking per heading, pagine nell'overlap e indici non duplicati.
- Correzione dei grant RPC e degli indici segnalati dagli advisor.

### 3.2 Da chiudere subito, a basso costo relativo

1. Correggere il commento obsoleto sul modello embedding e generare una breve ADR su modello/versione/dimensione.
2. Estrarre `routePaths`, mapping Supabase e stati condivisi da `App.tsx` in moduli tipizzati, senza cambiare UI.
3. Aggiungere lazy import per viewer PDF/Word, editor rich text e pagine private.
4. Comprimere le PNG pesanti e produrre varianti WebP/AVIF con dimensioni dichiarate.
5. Aggiungere a CI `npm run lint`, test, build, typecheck pipeline, `supabase db reset`, `supabase db lint` e `git diff --check`.
6. Versionare script di smoke test per bonus, acquisto, upload, SRS e grant: oggi le prove integrate sono state eseguite localmente ma non sono ancora una suite ripetibile nel repository.
7. Aggiungere una vista/RPC read-only per KPI dashboard e una per notifiche non lette, riducendo round trip e aggregazioni client.
8. Definire cleanup schedulato delle bozze upload scadute, inizialmente con log dry-run e metriche.

## 4. Rischi sistemici

### 4.1 Doppio source of truth tra frontend e backend

La base storica mescola fixture, local storage, stato React e Supabase. Le correzioni rimuovono i fallback più pericolosi per utenti reali, ma il rischio riappare se nuove feature implementano prima una simulazione client e poi una persistenza parziale. Regola raccomandata: saldo, acquisto, entitlement, stato documento, pubblicazione, job, SRS e accesso sono sempre backend-authoritative; il client può solo mostrare cache con invalidazione esplicita.

### 4.2 Migrazioni come codice operativo

La presenza di una migrazione ignorata per naming e la divergenza tra locale e remoto dimostrano che la sola correttezza SQL non basta. Ogni release database deve includere snapshot precedente, history check, dry-run su clone, verifica grant/RLS, query di invarianti e rollback/forward-fix. La migrazione finale abortisce volutamente su saldi ambigui: è una protezione, non un errore da aggirare.

### 4.3 Workflow asincroni senza orchestratore unico

Upload, pipeline PDF, OCR, indicizzazione e generazione flashcard costituiscono una saga distribuita. Senza worker, retry policy e compensazioni comuni, gli stati possono divergere. Serve una macchina a stati unica, con idempotency key, heartbeat, tentativi, `next_attempt_at`, dead-letter, errore pubblico sanitizzato ed errore tecnico riservato.

### 4.4 Monetizzazione e contabilità

Il ledger interno è ora più coerente, ma non sostituisce un ledger di pagamento esterno. Prezzo, acquisto, rimborso e quota venditore devono essere immutabili o versionati, collegati agli event ID del provider e riconciliati. La conversione dei crediti guadagnati richiede regole fiscali/contrattuali, KYC dove applicabile e una chiara distinzione tra saldo promozionale e valore riscattabile.

### 4.5 AI, costi e dipendenza da provider

Le interfacce e il versionamento riducono il lock-in, ma cambiare modello senza reindicizzazione rompe la comparabilità vettoriale. OCR e LLM devono avere budget per documento/utente, circuit breaker, timeout, fallback espliciti e metriche qualità/costo. L'assenza di un match RAG pertinente non deve attivare automaticamente analisi whole-document costose.

### 4.6 Privacy e contenuti accademici

Documenti, appunti, profili venditore e cronologia studio sono dati personali o contenuti potenzialmente protetti. Le viste minimali e l'opt-in migliorano la superficie, ma servono retention, export/delete account, gestione segnalazioni/takedown, log accessi amministrativi e classificazione dei dati. I bucket privati non bastano se un backend firma il path sbagliato: per questo la verifica documento-path deve rimanere obbligatoria.

### 4.7 Manutenibilità frontend

La concentrazione di pagine e business flow in `App.tsx` rende semplice prototipare ma difficile isolare regressioni, caricare route in modo differito e testare stati. Il refactor deve essere incrementale e preservare comportamento e design, spostando prima adapter e state machine, poi le pagine.

## 5. Refactor raccomandati

### 5.1 Frontend per dominio

Estrarre progressivamente:

- `app/router`: definizioni route, guard, canonical URL e SEO;
- `features/auth`: sessione, registrazione, provisioning status e recovery;
- `features/catalog`: query viste pubbliche, card materiale, filtri e pagina autore;
- `features/library`: diritti, acquisti e documenti posseduti;
- `features/upload`: state machine create/upload/finalize/cancel e progress UI;
- `features/study`: flashcard, SRS, filtri, sessioni e dashboard;
- `features/rag`: viewer assistant, citazioni e stato indice;
- `features/billing`: saldo, ledger e, in futuro, payment provider.

Le query Supabase devono passare da servizi tipizzati; i componenti non dovrebbero conoscere nomi colonna, RPC o codici errore grezzi.

### 5.2 Modello dati e responsabilità

- Documentare una matrice tabella → owner → writer → reader → retention.
- Definire `document_version` o snapshot immutabile per gli acquisti.
- Separare eventi append-only (`user_answers`, review, ledger) da proiezioni mutabili (`user_flashcard_progress`, rollup qualità, saldo).
- Consolidare soltanto dopo analisi d'uso le tabelle di review/cache apparentemente sovrapposte.
- Aggiungere una tabella/event log per transizioni di moderazione e stato documento.
- Rendere gli stati dei job un enum condiviso o generare tipi TypeScript dallo schema.
- Tenere i campi pubblici in viste stabili; non allargare `SELECT *` sulle tabelle base.

### 5.3 Worker documentale

Implementare un worker deployabile che:

1. reclami un job con `FOR UPDATE SKIP LOCKED` o RPC equivalente;
2. scarichi l'oggetto verificato;
3. esegua parsing nativo per pagina;
4. valuti qualità del testo e applichi OCR solo dove necessario;
5. persista blocchi, asset, outline e chunk in transazioni idempotenti;
6. aggiorni heartbeat/progresso e cost ledger;
7. accodi RAG/flashcard soltanto dopo prerequisiti riusciti;
8. gestisca retry esponenziale, timeout, dead-letter e cleanup;
9. promuova l'oggetto canonico e cancelli temporanei soltanto dopo commit verificato.

### 5.4 RAG modulare

- Mantenere `EmbeddingProvider` e introdurre analoghe interfacce `TextExtractionProvider`, `OcrProvider`, `ChatProvider` e `Reranker`.
- Inserire una tabella/configurazione di `index_profile` con modello, versione, dimensione, chunking version e data attivazione.
- Considerare hybrid retrieval lessicale+vettoriale e reranking solo dopo aver raccolto un set di valutazione; non aumentare costi senza misurare recall/precision.
- Salvare `chunking_version` e rendere la reindicizzazione una nuova versione controllata, con switch atomico.
- Mantenere il budget di contesto e le citazioni strutturate come contratto dell'API, non solo del prompt.

### 5.5 Flashcard e studio

- Trattare la flashcard generata come contenuto versionato: sorgente, modello, prompt, chunk e quote non devono cambiare retroattivamente.
- Separare deck condiviso/documentale da materializzazione utente e progresso personale.
- Rendere i filtri materia/documento/capitolo/argomento/difficoltà una query server paginata per volumi elevati.
- Calcolare qualità con soglia minima di reviewer e protezioni antifrode; mostrare intervalli/confidenza quando il campione è piccolo.
- Aggiungere un endpoint per sessione studio che selezioni carte dovute e registri in modo append-only inizio/fine/session metrics.

### 5.6 Pagamenti

- Introdurre un adapter provider e una tabella eventi webhook append-only con unique provider event ID.
- Creare saldo/crediti solo in risposta a webhook verificato, non al redirect checkout.
- Collegare acquisto documento a snapshot prezzo, valuta/crediti, buyer, seller e payment/refund IDs.
- Gestire refund e chargeback con movimenti compensativi, mai riscrittura del ledger storico.
- Calcolare payout venditore da movimenti riconciliati e approvati, con stato e audit trail.

## 6. Test da aggiungere

### 6.1 Verifiche già eseguite localmente

| Verifica | Esito osservato |
| --- | --- |
| `npm run build` | Superata; resta warning sulla dimensione del bundle principale. |
| `npm test -- --run` | 30 test superati su 30. |
| `npm run lint` | Superato senza errori. |
| Typecheck isolato `server/pdf-pipeline/*.ts` | Superato. |
| `npx supabase db reset` | Bootstrap completo delle migrazioni superato durante l'audit. |
| `npx supabase db lint --local --level warning` | Nessun errore di schema rilevato nel checkpoint verificato. |
| `npx --yes deno check …` | Typecheck superato sulle Edge Function modificate e sui moduli condivisi. |
| QA browser responsive | Landing, Esplora, Premium, login, dashboard, upload, impostazioni, scheda materiale e profilo autore senza overflow a 1440/390/320 px; console finale senza errori. |
| Auth/provisioning locale | Utente non confermato: profilo e saldo zero; dopo conferma: 30 crediti una sola volta, anche dopo update ripetuto. |
| Acquisto locale | Buyer 70→20 su prezzo 50; seller riceve payout coerente; retry restituisce lo stesso acquisto e gli invarianti saldo restano validi. |
| Upload locale | Write Storage diretto negato; create→signed upload→finalize produce documento verificato e sei job distinti; finalize ripetuto è idempotente. |
| Retry/cancel upload | Stessa bozza riutilizzata per stesso hash; cancel rimuove documento/oggetto temporaneo. |
| SRS locale | Review consecutive aggiornano stato, progresso e risposte; il fallback crea il progresso mancante senza duplicare il conteggio. |
| Lease RAG | Claim concorrente rifiutato; job simulato come scaduto viene chiuso e recuperato senza più job attivi duplicati. |
| RLS/grant | Browser autenticato non inserisce documenti/job e non riscrive notifiche; RPC sensibili non sono eseguibili da `anon`; `service_role` mantiene accesso operativo. |
| Privacy seller | `seller_id` assente prima/dopo opt-out, presente solo dopo consenso; pseudonimo aggiornabile, route UUID stabile e nessuna CTA profilo per venditore privato. |
| Prezzo catalogo | `price_credits=10` viene mostrato e usato come 10 crediti, senza ricalcolo client divergente. |
| Progressi flashcard | Direct PATCH rifiutata con 403; `set_flashcard_favorite` crea una proiezione `unanswered` con zero tentativi e persiste il preferito. |
| Edge auth smoke test | Chiamate anonime rifiutate con 401; richieste autenticate ma prive di payload valido arrivano alla validazione e restituiscono 400. |

Queste prove dimostrano il comportamento locale, non la corretta configurazione o il deploy del progetto remoto.

### 6.2 Test automatizzati prioritari

1. **Migration contract test:** bootstrap da zero, upgrade da snapshot remoto anonimizzato e verifica invarianti/grant con query versionate.
2. **RLS matrix:** per `anon`, autore, acquirente, altro utente, Premium e `service_role` su documenti, Storage, chunk, flashcard, qualità, profili, notifiche e RAG.
3. **Upload E2E:** file non PDF, MIME falso, hash errato, upload parziale, dimensione limite, doppio finalize, cancel durante upload, signed URL scaduta e oggetto mancante.
4. **Worker PDF:** PDF testuale, scansione, misto, ruotato, cifrato, corrotto, 1/100/1000 pagine, tabelle, formule, immagini e timeout OCR.
5. **Chunking property test:** ogni carattere sorgente coperto almeno una volta, nessun chunk oltre limite, overlap limitato, page range valido, heading path stabile e dedup hash.
6. **RAG evaluation:** set di domande con chunk atteso, precision@k, recall@k, no-answer, cross-document leakage, modello/versione misti, stale hash e prompt injection nei documenti.
7. **Flashcard grounding:** quote presente, provenienza pagina/chunk corretta, dedup tra retry, salvataggio revisioni, filtri e persistenza dopo logout/login/cambio dispositivo.
8. **SRS concurrency:** due tab/dispositivi, retry su `40001`, idempotenza evento, orologio/fuso, carta eliminata e account cancellato.
9. **Crediti property test:** sequenze casuali di bonus, top-up futuro, acquisto, payout e refund; saldo mai negativo e origine sempre riconciliata.
10. **Payment webhook:** firma errata, evento duplicato/fuori ordine, timeout, refund parziale, chargeback e riconciliazione giornaliera.
11. **Frontend route test:** refresh diretto di ogni URL, guard auth, back/forward, deep link documento/autore e session restoration.
12. **Responsive visual regression:** 320, 360, 390, 768, 1024 e 1440 px con contenuti molto lunghi e font scaling al 200%.
13. **Accessibility:** tastiera, focus trap, label, contrasto, screen reader e annunci live per caricamento/errori.
14. **Performance:** bundle budget, LCP/INP/CLS, lista documenti grande, query plan pgvector e dashboard con dataset realistico.

### 6.3 Verifiche manuali ancora necessarie

- eseguire il ciclo completo signup→conferma email→login→recovery→logout su dominio e SMTP di staging;
- provare OAuth e redirect URL consentiti, CAPTCHA, leaked-password protection e rate limiting Auth;
- caricare un corpus autorizzato di PDF reali, inclusi scansioni italiane, appunti fotografati, tabelle, formule e documenti grandi;
- verificare qualità OCR/parsing, outline, chunk, citazioni, flashcard e costi con provider reali;
- controllare tutte le route su desktop e dispositivi mobili reali, inclusi overflow, modali, toast, viewer, tastiera virtuale e orientamento;
- validare catalogo, materiale acquistato, seller opt-in e persistenza tra browser/dispositivi;
- verificare la retention dell'acquisto quando un materiale viene ritirato o sostituito;
- eseguire penetration test mirato su signed URL, IDOR, RPC `SECURITY DEFINER`, RLS e prompt injection;
- approvare legalmente termini, privacy, cookie, vendita, rimborsi, copyright/takedown e payout;
- riconciliare la migration history remota, provare deploy e rollback su clone/staging, poi monitorare query e job;
- configurare alert e runbook per job bloccati, errori OCR/AI, costo anomalo, saldo incoerente, webhook mancanti e storage orphan.

## 7. Security: remediation roadmap

### Fase 0 — prima di qualsiasi deploy

1. Effettuare backup verificato di database e Storage metadata.
2. Esportare schema/history remoti e confrontarli con tutte le migrazioni locali.
3. Risolvere esplicitamente migrazioni mancanti/divergenti; non usare `db push` finché il piano non è deterministico.
4. Eseguire la migrazione su un clone con query di invarianti per crediti, duplicati, job attivi, grant e policy.
5. Verificare che nessun saldo legacy ambiguo venga forzato: riconciliare dal ledger e ripetere.
6. Ruotare o verificare segreti server; confermare che chiavi service-role/provider non siano mai in variabili `VITE_*` o bundle frontend.

### Fase 1 — identity e superficie dati

1. Configurare SMTP, email template, redirect allowlist, recovery, MFA opzionale, CAPTCHA/bot protection e leaked-password protection.
2. Applicare e verificare la matrice RLS/grant su staging con token reali per tutti i ruoli.
3. Testare signed URL e mapping documento-path; mantenere bucket privati.
4. Implementare export/delete account e retention per profili, cronologia studio, query log e documenti.
5. Aggiungere audit log per ruoli amministrativi, moderazione e operazioni economiche.

### Fase 2 — pipeline e AI

1. Deployare il worker con identità service-role isolata, limiti risorse e rete minima necessaria.
2. Aggiungere content type/magic-byte scanning, limite pagine, timeout e quarantena file sospetti.
3. Sanitizzare errori pubblici e mantenere dettagli tecnici soltanto nei log protetti.
4. Applicare rate limit/costo per utente e documento a OCR, embedding, RAG e generazione.
5. Misurare prompt injection, data exfiltration e leakage tra documenti con test automatici.

### Fase 3 — pagamenti e monetizzazione

1. Implementare webhook verificati, event store idempotente e riconciliazione.
2. Separare legalmente e tecnicamente crediti promozionali, acquistati e convertibili.
3. Aggiungere refund/chargeback/payout come movimenti compensativi tracciati.
4. Applicare antifrode, velocity limit, audit e alert sui movimenti.
5. Abilitare CTA soltanto dopo test end-to-end e approvazione legale/commerciale.

### Fase 4 — continuous assurance

1. Integrare migration/RLS/security test in CI.
2. Eseguire dependency scanning, secret scanning e aggiornamenti controllati.
3. Monitorare query lente, pgvector, job backlog, costi AI, errori per provider e accessi anomali.
4. Definire incident response, rollback, restore test e rotazione segreti.
5. Rieseguire audit periodici dopo modifiche a pagamenti, permessi, storage o provider AI.

## 8. Valutazione finale codebase

### 8.1 Cosa è ora solido

- Il modello dati principale riusa correttamente `pdf_chunks` come fonte comune per flashcard e RAG, evitando una duplicazione strutturale `rag_chunks`.
- Le relazioni documento→pagina/chunk→embedding/flashcard→progresso sono adatte a una crescita reale e hanno metadati di provenienza utili.
- Acquisto, bonus e SRS sono stati spostati verso transazioni backend autorevoli e idempotenti.
- Upload e accesso ai file non si affidano più alla buona condotta del browser.
- Embedding e retrieval hanno un contratto esplicito di modello/versione/hash e limiti di contesto.
- Flashcard, preferenze e progressi possono sopravvivere a refresh, logout/login e cambio dispositivo quando Supabase è disponibile.
- Le viste pubbliche riducono esposizione di path, hash, email e metadati privati.
- Il progetto può essere bootstrapato localmente e le regressioni principali passano build, lint e test.

### 8.2 Cosa impedisce ancora la dichiarazione “production-ready”

UnimiDoc non è ancora pronto a gestire denaro e documenti reali senza supervisione. Il motivo non è la qualità del frontend, ma l'assenza degli ultimi elementi operativi: worker PDF, pagamenti riconciliati, legale, deploy/migration governance, Auth di produzione, osservabilità e prove reali dei provider. Questi elementi non vanno mascherati con fallback o contenuti statici.

### 8.3 Priorità conclusiva

Ordine raccomandato:

1. riconciliare migrazioni remote e creare staging riproducibile;
2. implementare e stressare il worker PDF/Storage lifecycle;
3. chiudere Auth, privacy, legale e gestione account;
4. eseguire QA provider/documenti reali e tarare costi/qualità;
5. implementare checkout, webhook, refund e payout con riconciliazione;
6. aggiungere osservabilità e runbook;
7. completare responsive/accessibility/performance e refactor incrementale del frontend;
8. solo allora abilitare monetizzazione e traffico reale.

### 8.4 Giudizio finale

La codebase è passata da prototipo ricco ma con confini client/server fragili a una base **pre-production tecnicamente credibile**. Gli interventi locali risolvono vulnerabilità e incoerenze concrete senza demolire l'architettura esistente. Il nucleo dati, RAG e studio è ora abbastanza ordinato da essere evoluto; il prossimo lavoro deve concentrarsi su operazioni, deploy, compliance e integrazioni reali, non su una riscrittura.

Il go-live può essere raccomandato soltanto dopo la chiusura documentata di tutti i P0, il deploy controllato su staging, i test manuali elencati e una verifica finale su ambiente remoto. Fino a quel momento, le funzioni Premium/monetizzazione devono restare disabilitate e lo stato del sistema deve essere comunicato come staging o beta controllata.
