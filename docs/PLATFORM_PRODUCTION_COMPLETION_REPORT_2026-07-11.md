# UnimiDoc — report conclusivo di completamento e readiness produttiva

Data del checkpoint: **11 luglio 2026**

Repository: `/Users/massimilianociconte/Documents/UnimiDoc`

Supabase: progetto `pmpzfkikwfylesehfezv`, PostgreSQL 17

Frontend produzione: [https://unimidoc.netlify.app](https://unimidoc.netlify.app) — deploy `6a51a3a40ff85dc8923d8f9e`

Questo documento consolida l'audit del 10 luglio, le modifiche successive, la riconciliazione Supabase e le verifiche locali e remote dell'11 luglio. Le diciture usate sono intenzionalmente rigorose:

- **deployato e operativo**: codice o schema presente sul servizio remoto e verificato con una prova coerente con il suo stato;
- **deployato ma fail-closed**: componente remoto presente, ma non attivabile finché configurazione, compliance o infrastruttura non sono complete;
- **implementato, non operativo in produzione**: codice verificato nel repository, ma privo del runtime esterno necessario;
- **manuale/esterno**: attività che non può essere completata correttamente dal solo repository.

## 1. Aree analizzate

L'analisi e l'intervento hanno coperto l'intera catena applicativa, senza riscrivere i sottosistemi già corretti:

1. **Frontend e navigazione**: landing, Esplora, Premium, autenticazione, dashboard, libreria, scheda materiale, viewer, upload, profili pubblici, leaderboard, notifiche, impostazioni, privacy, termini, cookie, condizioni di vendita e copyright.
2. **Responsive e qualità percepita**: overflow, griglie, card, modali, stati vuoti, caricamenti, errori, CTA, microcopy, menu mobile, citazioni RAG e contenuti lunghi.
3. **Auth e dati utente**: registrazione, conferma email, provisioning profilo, bonus iniziale exactly-once, sessione, preferenze, isolamento dei dati personali e persistenza cross-device.
4. **Database Supabase**: migrazioni, history remota, tabelle, relazioni, foreign key, indici, vincoli, RLS, grant e RPC `SECURITY DEFINER`.
5. **Storage e upload**: bucket privati, signed URL, bozza, finalizzazione, cancellazione, verifica dell'oggetto e promozione verso un path canonico content-addressed.
6. **Pipeline documentale**: verifica PDF, compressione lossless, estrazione testo, classificazione pagina, OCR selettivo, layout, immagini, outline, qualità, chunk e attivazione atomica degli artefatti.
7. **Processi asincroni**: run, dipendenze, claim concorrente, lease token, heartbeat, retry con backoff, dead-letter, cleanup e riconciliazione dei job legacy.
8. **RAG**: chunking, deduplicazione, embedding, versionamento, pgvector, controllo accessi, retrieval, budget del contesto, grounding e citazioni.
9. **Flashcard e studio**: generazione, provenienza, persistenza, qualità, like/dislike, filtri, preferiti, risposte, SRS e concorrenza tra dispositivi.
10. **Crediti e acquisti**: wallet, origine dei crediti, acquisto atomico, snapshot economici, ledger e quota venditore.
11. **Billing e payout**: Stripe Checkout, webhook, abbonamenti, rimborsi, dispute, crediti cash-backed, earnings, hold, Connect e payout.
12. **Privacy e compliance**: pagine legali, versionamento delle accettazioni, export, richiesta di cancellazione, legal hold e runbook operativo.
13. **Deploy e operazioni**: build Vite, deploy Netlify, migrazioni forward-only, Edge Function, advisor Supabase, container worker e feature flag.

Le fonti principali sono il codice corrente, le migrazioni, i test, gli advisor live e i documenti [audit precedente](./PLATFORM_PRODUCTION_AUDIT_2026-07-10.md), [riconciliazione Supabase](./SUPABASE_MIGRATION_RECONCILIATION_2026-07-11.md), [runbook worker](./PDF_WORKER_RUNBOOK.md), [runbook privacy](./PRIVACY_REQUEST_RUNBOOK.md) e [ADR del worker](./adr/001-pdf-worker-runtime.md).

## 2. Problemi trovati

### 2.1 Problemi risolti o sostanzialmente mitigati

| Problema originario | Evidenza dell'intervento | Stato al checkpoint |
| --- | --- | --- |
| History locale e remota divergente, con rischio di replay distruttivo | I 20 record storici sono stati mappati; 11 migrazioni correttive forward-only sono state applicate. La history remota contiene ora **31 migrazioni**, ultima `20260711015747`. | **Risolto per questa release**; vietato comunque `db push --include-all`. |
| Browser troppo autorevole su documenti, job, saldo e progressi | Upload, acquisti, SRS, preferiti e operazioni sensibili passano da Edge Function o RPC con controlli server-side. | **Risolto nei percorsi modificati**. |
| Dati demo mischiati ai dati degli utenti reali | Le sessioni Supabase non ricadono silenziosamente sulle fixture; i fallback locali restano confinati alla modalità demo/offline. | **Mitigato**; da mantenere come regola architetturale. |
| Bonus iniziale e acquisto esposti a retry o doppia applicazione | Provisioning, welcome credit e `purchase_document` sono atomici e idempotenti; gli invarianti del wallet sono vincolati nel database. | **Risolto e testato localmente**. |
| Chunk e embedding non sufficientemente versionati | Chunk attivi, `artifact_version`, `chunking_version`, modello, versione embedding, dimensione e hash del contenuto sono collegati esplicitamente. | **Risolto nello schema e nelle Edge Function deployate**. |
| Retrieval e generazione potevano inviare troppo contenuto | Top-k limitato, soglie dinamiche, dedup lessicale e budget di 14.000 caratteri impediscono il reprocessing dell'intero documento. | **Risolto nel percorso RAG corrente**. |
| Flashcard e SRS fragili dopo refresh o concorrenza | Provenienza, progresso, preferiti, risposte e stato SRS sono persistiti; la review è atomica e controlla la versione attesa. | **Risolto a livello applicativo/database**. |
| Upload poteva avviare RAG troppo presto o cancellare una run già accodata | Il browser non avvia più `rag-index` prima di OCR/quality; il trigger DB crea il job durabile. La cancellazione è limitata alle bozze non in lavorazione e conserva la riga se il cleanup Storage fallisce. | **Risolto e verificato**. |
| Worker di versioni diverse potevano contendere gli stessi job | Il claim richiede ora `pipeline_version`; l'RPC legacy è revocata al service role e il worker invia la versione configurata. | **Risolto e testato transazionalmente**. |
| Assenza di una base contabile per monetizzazione | Sono presenti event store webhook, pagamenti, abbonamenti, refund/dispute, lotti crediti, earnings, hold e payout compensabili. | **Implementato e deployato, ma disabilitato**. |
| Assenza di workflow privacy | Sono presenti UI, Edge Function, tabelle e runbook per export e richiesta di cancellazione. | **Deployato**; esecuzione finale della cancellazione resta operativa/manuale. |

### 2.2 Problemi e blocchi ancora aperti

| Priorità | Problema | Evidenza | Stato |
| --- | --- | --- | --- |
| **P0** | Identità del titolare e testi legali non approvati | Le variabili `LEGAL_ENTITY_*` e le versioni legali sono obbligatorie; il billing remoto restituisce `legalReady: false`. | **Blocco esterno**: servono dati reali e revisione legale. |
| **P0** | Stripe non configurato | Le cinque offerte remote sono inattive, prive di Product/Price ID; `billing.settings.mode = 'disabled'`, tutte le feature economiche sono `false`. | **Fail-closed corretto**; nessun pagamento reale è possibile. |
| **P0** | Worker PDF senza runtime remoto | Codice, Dockerfile, coda, run e lease sono presenti; sul database remoto risultano zero run del nuovo worker al checkpoint. | **Implementato, non deployato come container**. |
| **P0** | Nuovo upload non va abilitato senza worker | `document-upload` è `ACTIVE` v7, `verify_jwt=true`, e lo smoke anonimo restituisce 401; il flusso resta governato da `PDF_WORKER_ENABLED` e `VITE_DOCUMENT_UPLOAD_ENABLED`. | **Deployato ma fail-closed**. |
| **P0** | Protezione password compromesse non attiva | L'advisor Supabase segnala `auth_leaked_password_protection` come unico warning Auth. | **Configurazione manuale nel dashboard Auth**. |
| **P1** | Configurazione Auth reale non completamente validata | SMTP, CAPTCHA, redirect, recovery, OAuth e template email non sono dimostrati dai test locali. | **Manuale/staging**. |
| **P1** | Osservabilità operativa incompleta | Esistono log strutturati e runbook, ma non dashboard/alert live per backlog, dead-letter, OCR, provider, webhook, crediti e payout. | **Da configurare sul runtime scelto**. |
| **P1** | Sette RPC `SECURITY DEFINER` esposte ad `authenticated` | L'advisor le segnala; sono percorsi intenzionali e scoped (`purchase_document`, SRS, preferiti, voti, notifiche e retrieval), ma restano un confine privilegiato. | **Accettazione motivata**, da mantenere sotto test di autorizzazione. |
| **P2** | Bundle frontend principale grande | La build passa, ma Vite segnala un chunk principale di **670,45 kB**. | **Debito performance**: route splitting e bundle budget. |
| **P2** | 89 indici ancora non usati | L'advisor performance riporta solo `INFO unused_index`, senza errori o missing foreign key. La release è recente e non ha traffico sufficiente. | **Non rimuovere ora**; rivalutare con statistiche reali. |
| **P2** | `App.tsx` rimane molto esteso | Routing, pagine e parte dell'orchestrazione convivono ancora nello stesso modulo. | **Refactor incrementale consigliato**, non riscrittura. |
| **P2** | QA reale di OCR/RAG e dispositivi incompleto | I test automatici sono verdi, ma non sostituiscono corpus autorizzati, provider reali e dispositivi fisici. | **Validazione manuale necessaria**. |

Gli advisor live non riportano errori di sicurezza: **0 ERROR**, 25 `INFO` relativi a tabelle private `billing` con RLS senza policy, 7 `WARN` sulle RPC privilegiate intenzionali e 1 `WARN` Auth. Le 25 tabelle/RLS segnalate dall'advisor sono service-only per design: lo schema `billing` non è concesso a `anon` o `authenticated`.

## 3. Priorità degli interventi

### P0 — condizioni necessarie prima di abilitare denaro o nuovi upload

1. Inserire identità legale, indirizzo, contatto, partita IVA se applicabile e versioni approvate di privacy, termini, vendita, rimborsi, copyright e condizioni venditore.
2. Configurare Stripe prima in test mode: secret, webhook secret, Product/Price ID versionati, portale cliente, eventi webhook, policy fiscale e valuta. Abilitare `automatic_tax` solo dopo revisione commerciale/fiscale.
3. Completare Stripe Connect: responsabilità della piattaforma, KYC, capability, condizioni venditore, hold, minimo payout e prova di trasferimento/rimborso/dispute.
4. Pubblicare il container worker in staging con service role isolata, callback secret, binari nativi, filesystem temporaneo, limiti CPU/RAM e alert. Solo dopo uno smoke riuscito abilitare i due flag upload.
5. Attivare leaked-password protection e validare SMTP, CAPTCHA, redirect allowlist, recovery, OAuth e revoca sessioni.
6. Eseguire un E2E staging completo: signup, upload, pipeline, RAG, flashcard, acquisto Stripe test, refund, abbonamento, portale, Connect e payout.

### P1 — stabilizzazione immediatamente successiva

1. Configurare monitoraggio e alert per worker, Storage temporaneo, OCR, costi AI, query RAG senza match, webhook falliti, debiti crediti e payout.
2. Eseguire backup/restore test e definire incident response, rotazione segreti e forward-fix database.
3. Validare export e cancellazione privacy con dataset paginati, legal hold e compensazione degli errori parziali.
4. Eseguire test responsive/accessibilità su dispositivi reali, tastiera, screen reader e font al 200%.
5. Ripristinare l'accesso CLI all'organizzazione Supabase e verificare che `migration list --linked` coincida con le 31 versioni remote.

### P2 — evoluzione controllata

1. Estrarre progressivamente router, auth, catalogo, upload, studio, RAG e billing da `App.tsx` in moduli di dominio.
2. Introdurre budget CI su bundle e lazy loading delle superfici pesanti.
3. Rivedere gli indici inutilizzati solo dopo una finestra di traffico rappresentativa e `EXPLAIN (ANALYZE, BUFFERS)`.
4. Valutare retrieval ibrido o reranking solo dopo avere costruito un benchmark con precision@k, recall@k e costo per risposta.

## 4. Modifiche applicate

### 4.1 Stato della release

| Livello | Stato remoto verificato | Stato funzionale |
| --- | --- | --- |
| Frontend Netlify | Deploy produzione `6a51a3a40ff85dc8923d8f9e`; root, `/upload` e `/sitemap.xml` rispondono 200. | **Deployato**. La risposta 200 della route upload prova il routing, non l'operatività del worker. |
| Database Supabase | 31 migrazioni remote; ultima `20260711015747`. | **Deployato**. RLS è attiva su tutte le tabelle base `public` verificate. |
| Edge Function | 20 funzioni `ACTIVE`. | **Deployate**; autenticazione e feature flag restano applicate per funzione. |
| `document-upload` | `ACTIVE` v7, `verify_jwt=true`; richiesta anonima 401. | **Fail-closed** finché worker e flag non sono abilitati. |
| Billing | Sette funzioni billing/Connect/payout `ACTIVE`; `billing-config` risponde 200. | **Fail-closed**: `enabled=false`, `legalReady=false`, `offers=[]`. |
| Worker PDF/OCR | Codice Node 22, Dockerfile, RPC e runbook presenti. | **Non operativo da remoto**: richiede un provider container separato. |
| Privacy | Migrazione e `privacy-center` v1 `ACTIVE`; UI impostazioni presente. | **Deployato**; le fasi distruttive restano supervisionate. |

### 4.2 Frontend e UX

- Aggiunte pagine legali versionate e route dedicate a privacy, termini, cookie, vendita e copyright.
- Aggiunti `BillingPlans` e `SellerPayoutPanel`, che leggono configurazione e stato server senza inventare disponibilità economica.
- Checkout, Connect e payout mostrano stati espliciti e restano disabilitati quando configurazione o consensi non sono completi.
- Aggiunto privacy center con stato richieste, export e avvio/annullamento della cancellazione.
- Rafforzati route guard, isolamento demo/live, catalogo pubblico, profilo venditore opt-in, persistenza dashboard e gestione degli errori.
- Aggiunto rendering rich Markdown sicuro per l'assistente e migliorati responsive, overflow, card, modali e stati vuoti.
- SEO tecnico aggiornato con metadata, canonical, JSON-LD, robots, sitemap, `llms.txt` e nuove immagini WebP.

### 4.3 Backend, Storage e pipeline

- `document-upload` usa bozza, signed upload e finalizzazione autenticata; il nuovo protocollo accoda una run versionata invece di svolgere lavoro pesante nell'Edge Runtime.
- Il primo job del worker verifica size, SHA-256, magic bytes e struttura PDF, applica compressione lossless e promuove l'oggetto in `private-documents` con path content-addressed.
- Il worker esegue estrazione nativa per pagina, classifica pagine digitali/scansionate/miste, applica OCRMyPDF quando necessario e produce layout, immagini, outline, qualità e chunk.
- Claim, heartbeat e completamento richiedono un lease token; retry, jitter, dead-letter e dipendenze impediscono doppi commit o artefatti parziali.
- Il claim è vincolato alla stessa `pipeline_version` del container; il service role non può più usare l'entrypoint legacy non versionato.
- Gli artefatti vengono scritti inattivi per `processing_run_id` e `artifact_version`; lo switch avviene soltanto dopo il quality gate.

### 4.4 Billing, crediti e payout

- Creato schema privato `billing`, senza accesso client diretto.
- Implementati catalogo offerte versionato, customer, checkout idempotente, pagamenti, webhook firmati e deduplicati, abbonamenti ed entitlement.
- Separati crediti pagati, promozionali, gratuiti e guadagnati; i lotti mantengono la provenienza e la copertura cash.
- Refund e dispute producono compensazioni e debiti interni quando crediti già spesi non possono essere sottratti integralmente.
- Earnings venditore restano in hold e diventano prelevabili soltanto se cash-backed; Connect e payout usano reservation, tentativo provider, completamento o rollback.
- Tutto il sistema rimane intenzionalmente disabilitato finché Price ID, legalità, tax e Connect non sono approvati.

### 4.5 Privacy e sicurezza

- Implementata la richiesta privacy con export on-demand, hash del manifest e nessun link pubblico persistente.
- Aggiunto workflow di cancellazione/legal hold e runbook che preserva gli obblighi contabili senza rompere il ledger.
- Rafforzate viste `security_invoker`, foreign key e indici mancanti; le RPC privilegiate hanno grant espliciti e controlli di ownership/identità.
- Segreti Stripe, provider AI, callback worker e service role restano server-side e non usano prefissi `VITE_`.

## 5. File e componenti modificati

| Area | File/componenti principali | Ruolo |
| --- | --- | --- |
| Shell e pagine | `src/App.tsx`, `src/App.css`, `src/data.ts`, `src/userDashboardData.ts` | routing, guard, dashboard, upload, impostazioni, responsive e stati applicativi |
| Billing UI | `src/components/BillingPlans.tsx`, `src/components/SellerPayoutPanel.tsx`, `src/lib/billingClient.ts` | configurazione server, checkout, portale, Connect, payout e polling stato |
| Legale/privacy | `src/components/LegalPage.tsx`, `src/legalContent.ts`, `src/lib/privacyClient.ts` | documenti versionati, identità operatore e privacy center |
| RAG UI | `src/components/rag/AskDocumentPanel.tsx`, `src/components/rag/RichMarkdown.tsx` | domande, citazioni, rendering strutturato e fallback |
| Client e persistenza | `src/lib/aiClient.ts`, `supabaseClient.ts`, `creditsWallet.ts`, `flashcardProgress.ts`, `creditPricing.ts`, `contentModeration.ts` | contratti backend, mapping dati, wallet, studio e validazione |
| Worker | `server/pdf-pipeline/worker.ts`, `queue.ts`, `stages.ts`, `persistence.ts`, `storage.ts`, `commands.ts`, `config.ts`, `errors.ts`, `types.ts`, `providers/` | runtime documentale, lease, stage, adapter e persistenza |
| Container e script | `Dockerfile.worker`, `.dockerignore`, `tsconfig.worker.json`, `scripts/reconcile-pdf-jobs.ts` | immagine nativa, typecheck e riconciliazione job legacy |
| Edge condiviso | `supabase/functions/_shared/chunking.ts`, `embeddings.ts`, `rag.ts`, `billing.ts`, `env.ts`, `prompts.ts`, `supabase.ts` | chunking, provider, retrieval, pagamenti, limiti e servizi condivisi |
| Edge Function | `document-upload`, `document-access`, `rag-index`, `rag-query`, `rag-status`, `rag-manifest`, `rag-pack`, `generate-flashcards`, `srs-review`, `billing-*`, `connect-onboarding`, `payout-request`, `privacy-center` | boundary HTTP autenticato e operazioni autorevoli |
| Configurazione backend | `supabase/config.toml`, `supabase/.env.example`, `supabase/README.md` | JWT, feature flag, segreti richiesti e procedure deploy |
| Test | `src/lib/chunking.test.ts`, `creditsWallet.test.ts`, `server/pdf-pipeline/worker.test.ts` e test studio/flashcard esistenti | regressioni su chunk, wallet, worker, SRS e generazione |
| Documentazione | `docs/PDF_WORKER_RUNBOOK.md`, `PRIVACY_REQUEST_RUNBOOK.md`, `SUPABASE_MIGRATION_RECONCILIATION_2026-07-11.md`, `docs/adr/001-pdf-worker-runtime.md` | rilascio, recovery, privacy e decisioni architetturali |

Non sono state rimosse tabelle esistenti soltanto perché potenzialmente sovrapposte: una rimozione richiede prova d'uso, migrazione dati e finestra di rollback. La sostituzione delle vecchie migrazioni locali con copie dai timestamp hosted è una riconciliazione di history, non una riscrittura dello schema remoto.

## 6. Migrazioni e tabelle aggiornate

### 6.1 History e release forward-only

La history remota è passata da 20 versioni storiche riconciliate a **31 versioni totali**. Le undici migrazioni forward della release sono:

| Versione | Migrazione | Contenuto principale |
| --- | --- | --- |
| `20260711011041` | `flashcard_mastery_quality_reconcile_20260711` | progresso, qualità, voti e rollup flashcard |
| `20260711011052` | `document_outline_quality_reconcile_20260711` | outline e qualità strutturale |
| `20260711011059` | `production_integrity_hardening_20260711` | invarianti crediti, ACL/RLS, catalogo, SRS, job e RAG |
| `20260711011109` | `billing_payments_and_payouts_20260711` | billing, lotti crediti, refund, dispute, earnings e payout |
| `20260711011123` | `pdf_worker_leases_pipeline_20260711` | run, lease, dipendenze, tentativi e versioni artefatto |
| `20260711011130` | `privacy_request_workflow_20260711` | richieste privacy, export manifest e legal hold |
| `20260711012042` | `rag_topic_model_version_hardening_20260711` | coerenza modello/versione/hash nella selezione topic |
| `20260711012049` | `billing_provider_and_rag_dispatch_hardening_20260711` | tentativi provider payout e dispatch RAG post-quality |
| `20260711012349` | `security_invoker_and_fk_indexes_20260711` | viste security-invoker e indici foreign key |
| `20260711012933` | `billing_subscription_lint_cleanup_20260711` | pulizia typing/lint della sincronizzazione subscription |
| `20260711015747` | `pdf_worker_versioned_claim_hardening_20260711` | claim worker vincolato alla versione e revoca del percorso legacy |

Tutte sono applicate sul progetto remoto. La strategia resta **forward-only**: niente reset remoto, replay storico, cancellazione di record economici o repair arbitrario della history.

### 6.2 Schema economico

Lo schema privato `billing` contiene 18 tabelle base: `settings`, `offers`, `legal_acceptances`, `customers`, `checkout_requests`, `payments`, `webhook_events`, `subscriptions`, `entitlement_grants`, `refunds`, `disputes`, `connected_accounts`, `seller_earnings`, `payout_requests`, `payout_items`, `payout_lot_allocations`, `payout_provider_attempts` e `credit_debts`.

Nel `public` sono stati aggiunti o rafforzati:

- `credit_lots` e `credit_lot_allocations` per provenienza e consumo dei crediti;
- colonne di snapshot e riferimenti economici su `credit_transactions` e `document_purchases`;
- vincoli di bilanciamento su `user_credit_accounts`;
- RPC idempotenti per acquisto, checkout, webhook, abbonamenti, refund/dispute, Connect e payout.

### 6.3 Pipeline, RAG, flashcard e privacy

- `pdf_processing_runs`, `pdf_processing_job_dependencies` e `pdf_processing_job_attempts` modellano l'esecuzione; `pdf_processing_jobs` include lease, disponibilità, progressi e run.
- Pagine, blocchi, asset, OCR, outline, report qualità e chunk sono collegati a `processing_run_id`, `artifact_version` e stato attivo.
- `rag_chunk_embeddings` e i job RAG vincolano modello, versione e `content_hash`; gli indici pgvector restano coerenti con 768 dimensioni.
- `flashcards` mantiene chunk, pagina, outline, sezione, argomento e chiave di generazione; progresso, SRS, risposte e qualità restano separati per utente.
- `privacy_requests` e `privacy_export_events` registrano stato e manifest senza archiviare il payload di export.

Il controllo remoto aggregato non rileva tabelle base `public` con RLS disabilitata. Le segnalazioni RLS senza policy riguardano lo schema privato `billing`, accessibile solo al service role per design.

## 7. Miglioramenti a chunking, embedding, retrieval e flashcard

### 7.1 Chunking e document intelligence

- Strategia section-aware con target **700 token**, massimo **900**, minimo **120** e overlap **120**.
- Un heading apre una nuova sezione senza trascinare overlap dalla precedente; `section_path` resta coerente con capitolo e sottosezione.
- Le righe molto lunghe vengono spezzate, le code composte solo da overlap non sono emesse e i frammenti piccoli vengono uniti soltanto nella stessa sezione.
- Ogni chunk mantiene `page_start`, `page_end`, indice, hash, versione artefatto e versione chunking.
- Il worker produce una versione completa inattiva e la rende attiva atomicamente; un crash non espone pagine, chunk e outline di release differenti.
- Gli embedding possono essere riutilizzati per lo stesso hash, modello e versione, evitando chiamate provider duplicate.

### 7.2 Embedding

- Contratto `EmbeddingProvider` separato dal resto del RAG, predisposto a provider alternativi.
- Configurazione corrente: `gemini/gemini-embedding-001`, versione `1`, output a **768 dimensioni**.
- Passage e query usano task type distinti; dimensione, cardinalità e valori non finiti sono validati prima del salvataggio.
- Un cambio di modello, versione o dimensione non riusa vettori incompatibili e richiede reindicizzazione controllata.

### 7.3 Retrieval e risposta grounded

- `match_rag_chunks` filtra per accesso utente, documento, modello, versione, hash corrente e embedding riuscito.
- La richiesta accetta al massimo 12 match, default 8; il retrieval iniziale usa soglia 0,18 e il prompt rifiuta il contesto se il miglior match è sotto 0,20.
- I risultati utili devono restare entro 0,20 dal miglior punteggio; chunk quasi duplicati nello stesso documento vengono esclusi con overlap lessicale almeno 0,86.
- Budget massimo del contesto: **14.000 caratteri**, con massimo 5.000 caratteri per chunk; il modello di risposta riceve soltanto i chunk selezionati e genera al massimo 900 token.
- Il prompt tratta il documento come dato non affidabile, ignora istruzioni contenute nei chunk e richiede una risposta di non disponibilità quando il supporto non è sufficiente.
- Le citazioni restituiscono marker, documento, corso, docente, pagine, `section_path`, chunk e similarity.
- Manifest e pack RAG, insieme al dispatch post-quality, separano preparazione degli artefatti, indicizzazione e risposta.

### 7.4 Flashcard e SRS

- La generazione documentale usa chunk rappresentativi e non l'intero PDF; i batch sono limitati e bilanciati per sezione.
- Domanda, risposta, difficoltà e `source_quote` sono validate; la provenienza collega documento, chunk, pagine, outline, capitolo e argomento.
- La chiave deterministica di generazione e le reservation impediscono duplicati su retry o scritture concorrenti.
- Le flashcard revisionate possono essere salvate subito con la pagina; al completamento RAG vengono collegate automaticamente al chunk e all'outline autorevoli, senza una chiamata browser prematura.
- Corrette, errate, parziali, saltate, non svolte, preferite e da ripassare sono persistite in proiezioni per utente.
- La review SRS aggiorna stato, progresso e risposta in una transazione con controllo concorrenza, rendendo coerenti refresh, logout/login e cambio dispositivo.
- Like/dislike e rollup qualità sono protetti da ownership/acquisto, unicità del voto e regole che impediscono l'autovalutazione dell'autore.

Resta da costruire un benchmark reale per misurare precisione/recall RAG, grounding delle citazioni, qualità OCR e qualità pedagogica delle flashcard. L'architettura è pronta a misurarlo, ma i risultati non devono essere inventati senza corpus e provider reali.

## 8. Test eseguiti e test consigliati

### 8.1 Verifiche eseguite

| Verifica | Esito |
| --- | --- |
| `npm test` | **42/42 test superati**, 5 file su 5: studio, chunking, wallet, worker PDF e flashcard. |
| `npm run lint` | Superato senza errori. |
| `npm run typecheck:worker` | Superato. |
| Deno check Edge Function | Superato sui file TypeScript in `supabase/functions`, incluso `document-upload`. |
| `npx supabase db reset --local --no-seed` | Superato applicando tutte le 31 migrazioni correnti da database pulito. |
| `npx supabase db lint --local --schema public,billing --level warning --fail-on none` | `No schema errors found`. |
| `npm run build` | Superato; warning non bloccante sul chunk principale da 670,45 kB. |
| `git diff --check` | Superato sull'insieme della release; il presente report viene verificato separatamente prima dell'handoff. |
| Migrazioni remote | 31 versioni presenti, ultima `20260711015747`. |
| Claim PDF versionato | Test SQL con job v1/v2 e priorità avversa: il worker v1 seleziona solo v1; RPC legacy non eseguibile dal service role. |
| Edge Function remote | 20 funzioni `ACTIVE`; ultime correzioni: `document-upload` v7, `rag-index` v6 e `generate-flashcards` v8, tutte con JWT verificato. |
| Smoke Auth upload | Richiesta anonima a `document-upload` respinta con 401. |
| Smoke live | Root, `/upload`, `/sitemap.xml` e `billing-config` rispondono 200. |
| Smoke billing | Risposta fail-closed: `enabled=false`, `legalReady=false`, `offers=[]`. |
| Advisor sicurezza | 0 ERROR; 25 INFO service-only, 7 WARN RPC intenzionali/scoped, 1 WARN leaked-password. |
| Advisor performance | 89 INFO `unused_index`; nessun errore e nessuna foreign key mancante segnalata. |

### 8.2 Test da eseguire prima del go-live completo

1. **Auth E2E**: signup, conferma email, login, refresh sessione, recovery, OAuth, logout globale, CAPTCHA e password compromessa.
2. **Upload/worker E2E**: PDF testuale, scansione, misto, ruotato, cifrato, corrotto, molto grande, con tabelle/formule/immagini; crash e recupero lease in ogni stage.
3. **Storage lifecycle**: signed URL scaduta, oggetto mancante, hash/size errati, doppio finalize, cancel, cleanup temporaneo e path traversal.
4. **RAG evaluation**: precision@k, recall@k, no-answer, citazione attesa, stale hash, modello misto, leakage tra documenti e prompt injection nel PDF.
5. **Flashcard grounding**: quote realmente presente, pagina/chunk corretti, dedup su retry, filtri server-side, quality vote e persistenza multi-device.
6. **Billing Stripe test**: firma webhook errata, evento duplicato/fuori ordine, pagamento asincrono, invoice failed, refund parziale/totale, dispute persa/vinta e retry del redirect.
7. **Ledger property/concurrency**: sequenze casuali di bonus, top-up, acquisto, refund, debt, earning e payout; saldo mai negativo e origine sempre riconciliata.
8. **Connect/payout**: onboarding incompleto, KYC, capability, hold, transfer fallito, idempotenza, rollback e minimo prelievo.
9. **Privacy drill**: export paginato, legal hold, cancellazione parziale, retry, rimozione Storage/derivati e conservazione economica pseudonimizzata.
10. **Responsive/accessibilità**: 320–1440 px, dispositivi reali, orientamento, tastiera virtuale, font 200%, focus trap, screen reader e contrasto.
11. **Performance/load**: bundle budget, LCP/INP/CLS, catalogo grande, dashboard, coda worker, OCR concorrente, pgvector e webhook burst.
12. **Operazioni**: backup/restore, rotazione segreti, rollback frontend, forward-fix database, dead-letter recovery e incident response.

## 9. Parti ancora da verificare o completare manualmente

### 9.1 Identità, legale e privacy

- Inserire denominazione reale del titolare, sede/indirizzo, contatto privacy e dati fiscali applicabili.
- Fare approvare da un professionista privacy, termini, cookie, vendita, recesso/rimborsi, licenza dei contenuti, copyright/takedown, venditori e payout.
- Definire retention per account, documenti, log, query RAG, studio, transazioni e backup.
- Assegnare responsabilità e SLA alle richieste privacy; testare un caso di export e cancellazione end-to-end.

### 9.2 Stripe, fiscalità e monetizzazione

- Creare Product e Price ID in test e poi live, mantenendo righe offerte distinte per `livemode` e versione.
- Configurare `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, URL applicazione, versioni legali e webhook diretto.
- Decidere prezzi inclusivi/esclusivi d'imposta, fatturazione, automatic tax e trattamento fiscale dei crediti e delle commissioni.
- Completare account piattaforma e Stripe Connect, KYC, responsabilità per fee/loss, capability, termini venditore e riconciliazione payout.
- Eseguire un ciclo test completo prima di modificare `billing.settings`; non attivare offerte o CTA come scorciatoia.

### 9.3 Runtime worker

- Scegliere provider container e registry, regione, CPU/RAM, autoscaling, rete, secret store e strategia di aggiornamento dei binari nativi.
- Configurare service role e callback secret esclusivamente nel runtime, root filesystem read-only dove compatibile e `/tmp` limitato.
- Eseguire dry-run della riconciliazione, corpus staging, smoke di ogni stage e alert su backlog, heartbeat, dead-letter, OCR e Storage temporaneo.
- Solo dopo prova riuscita impostare `PDF_WORKER_ENABLED=true` e `VITE_DOCUMENT_UPLOAD_ENABLED=true` in una release coordinata.

### 9.4 Supabase Auth e sicurezza operativa

- Attivare leaked-password protection nel dashboard Supabase.
- Verificare SMTP, template, redirect allowlist, recovery, OAuth, CAPTCHA/bot protection, durata JWT e revoca sessioni.
- Rieseguire periodicamente la matrice di test sulle sette RPC `SECURITY DEFINER` intenzionali.
- Ripristinare membership CLI corretta, controllare history linked e conservare evidenze degli advisor dopo ogni DDL.

### 9.5 Osservabilità, QA e performance

- Collegare metriche e alert per Edge Function, worker, database, pgvector, AI, Storage e Stripe.
- Validare tutte le route con utenti reali su browser e dispositivi fisici, inclusi casi limite di contenuto e accessibilità.
- Separare ulteriormente i chunk frontend per ridurre il bundle principale da 670,45 kB e fissare un budget CI.
- Attendere telemetria reale prima di eliminare uno degli 89 indici indicati come inutilizzati.
- Aggiungere in CI reset/lint database, Deno check, test RLS, build, diff-check, secret scanning e smoke staging.

### Valutazione conclusiva

La release dell'11 luglio porta UnimiDoc da base pre-production a piattaforma con **frontend, database e backend remoto riconciliati e deployati**, preservando l'architettura esistente. RAG, flashcard, persistenza, privacy, billing e pipeline asincrona hanno ora confini e invarianti adatti a una produzione controllata.

Non è però corretto dichiarare ancora attiva la monetizzazione o il nuovo ciclo upload: il billing è deliberatamente disabilitato e il worker richiede un runtime container esterno. La piattaforma è quindi pronta per **staging integrato e chiusura operativa dei P0**, non ancora per accettare denaro o carichi documentali reali senza supervisione. Il go-live completo è raccomandabile solo dopo identità/compliance, Stripe testato, worker osservabile, Auth hardening e QA reale documentati.
