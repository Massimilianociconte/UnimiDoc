# Censimento funzioni SECURITY DEFINER — 2026-07-15

Fotografia delle funzioni `SECURITY DEFINER` nello schema `public` del progetto
`pmpzfkikwfylesehfezv`, con verifica di: `search_path` esplicito, controllo del
chiamante, validazione parametri, privilegi minimi. Fonte: `pg_proc` +
`pg_get_functiondef` (query in fondo). I test automatici di isolamento sono in
`supabase/tests/` (vedi CI).

## Esito sintetico

- **Tutte** le funzioni SECURITY DEFINER hanno `search_path` esplicito.
- **Nessuna** funzione è eseguibile da `anon`.
- Le funzioni worker/billing/trigger sono eseguibili solo da `service_role`.
- **1 vulnerabilità trovata e corretta** (2026-07-15): `match_rag_chunks`
  versione ibrida aveva perso il filtro `rag_accessible_document_ids` — un
  utente autenticato poteva leggere i chunk di qualunque documento. Fix in
  migrazione `20260715204447_fix_match_rag_chunks_access_20260715.sql` (+ patch
  del file `20260714000001` per i reset locali).

## Funzioni eseguibili da `authenticated` (superficie API)

| Funzione | Controllo chiamante | Note |
| --- | --- | --- |
| `delete_document(uuid)` | `auth.uid()` = owner | Soft/hard delete deciso dal server; buyer attivi ⇒ soft. |
| `mark_notification_read(uuid)` | `auth.uid()` = owner notifica | Output boolean. |
| `match_rag_chunks(...)` | `rag_accessible_document_ids(auth.uid())` | **Corretta 2026-07-15**; limit clampato ≤ 50. |
| `match_review_flashcards(uuid[], int)` | `auth.uid()` su accesso flashcard | Usa embeddings; limit clampato. |
| `moderate_document(uuid, text, text)` | `app_private.is_moderator()` | Ruolo moderatore da tabella privata. |
| `moderation_is_moderator()` | implicito (ritorna solo il flag del chiamante) | Nessun dato di terzi. |
| `moderation_queue()` | `app_private.is_moderator()` con raise | Espone email degli autori ai soli moderatori. |
| `moderation_reports()` | `app_private.is_moderator()` con raise | Idem. |
| `purchase_document(uuid)` | `auth.uid()` = buyer | Acquisto atomico, idempotente, wallet server-side. |
| `record_flashcard_study_event(...)` | `auth.uid()` + `user_can_access_flashcard` | Progressi solo propri. |
| `record_legal_acceptance(text[], text, text)` | `auth.uid()` obbligatorio | Insert idempotente, tipi/versione validati (whitelist + regex). |
| `record_srs_review_atomic(...)` | `auth.uid()` + optimistic check su review_count | Parametri clampati nel corpo. |
| `resolve_document_report(uuid, text, text)` | `app_private.is_moderator()` | Stati ammessi whitelisted. |
| `set_flashcard_favorite(uuid, boolean)` | `auth.uid()` + accesso flashcard | |
| `set_flashcard_quality_vote(uuid, smallint)` | `auth.uid()` + acquisto attivo | Voto unico per utente (unique). |

## Funzioni solo `service_role` (non raggiungibili dai client)

`billing_*` (21 funzioni, search_path `billing, public, pg_temp`),
`claim_pdf_processing_job[_versioned]`, `heartbeat/complete/fail_pdf_processing_job`,
`enqueue_pdf_processing_run`, `cancel/refresh_pdf_processing_run`,
`claim_rag_embedding_job`, `rag_document_topic_chunks`,
`rag_accessible_document_ids`, `reserve/commit_reviewed_flashcard_write`,
`grant_welcome_credits`, `record_ai_monthly_usage`,
`refresh_document_flashcard_quality`, `billing_privacy_export`.

Trigger-only (nessun EXECUTE per ruoli API): `handle_new_user`,
`enqueue_document_storage_cleanup`, `enqueue_rag_index_after_quality`,
`finalize_run_after_rag_index`, `sync_materialized_seller_privacy`,
`rls_auto_enable`.

`app_private.*` (ranking fn, `is_moderator`, `refresh_ranking_caches`): schema
non esposto all'API REST; `document_rankings_public_fn`/`author_rankings_public_fn`
hanno EXECUTE per anon/authenticated ma sono raggiungibili solo tramite le view
`public_*_rankings` (proiezione limitata, sola lettura).

## Regole per nuove funzioni

1. `set search_path = <schemi>, pg_temp` sempre.
2. `revoke all ... from public, anon` subito dopo il `create`.
3. Se il chiamante è un utente: primo statement = risoluzione `auth.uid()` con
   `raise` se null; ogni riga letta/scritta filtrata su quell'id.
4. Parametri: whitelist per gli enum testuali, clamp per i numerici.
5. Aggiungere un caso alla suite di isolamento in `supabase/tests/`.

## Query di censimento

```sql
select p.oid::regprocedure::text as signature,
       coalesce(array_to_string(p.proconfig, '|'), 'NO_SEARCH_PATH') as config,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_can_exec,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;
```
