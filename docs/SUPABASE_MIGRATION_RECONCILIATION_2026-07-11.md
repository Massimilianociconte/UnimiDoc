# Supabase migration reconciliation — 11 July 2026

Project: `pmpzfkikwfylesehfezv` (UnimiDoc, PostgreSQL 17)

## Why reconciliation is required

The hosted project was originally migrated through generated cloud timestamps,
while the repository retained semantic/local timestamps. Several historical
local files were then hardened after their first remote application. A blind
`db push --include-all` would therefore replay historical SQL and is forbidden.

The CLI profile currently active on this workstation can read a different
Supabase organisation and receives HTTP 403 for UnimiDoc database/function
management. The authenticated Supabase project connector can inspect and deploy
UnimiDoc. Until CLI membership is corrected, forward migrations and functions
are deployed through that connector and every generated remote version is
mirrored back into this repository.

## Canonical hosted history before this release

| Hosted version | Hosted name | Local semantic source |
|---|---|---|
| `20260704141629` | `202607030001_pdf_flashcards` | `202607030001_pdf_flashcards.sql` |
| `20260704141744` | `202607030003_flashcard_premium_deepseek` | `202607030003_flashcard_premium_deepseek.sql` |
| `20260704141809` | `202607040002_ai_helpers_and_srs` | `202607040002_ai_helpers_and_srs.sql` |
| `20260704141829` | `202607040003_secure_preview_access` | `202607040003_secure_preview_access.sql` |
| `20260704141921` | `202607040004_user_area_and_occlusion` | `202607040004_user_area_and_occlusion.sql` |
| `20260704142009` | `202607040005_user_provisioning` | `202607040005_user_provisioning.sql` |
| `20260704142100` | `202607040006_security_hardening` | `202607040006_security_hardening.sql` |
| `20260704191209` | `202607040007_notification_preferences` | `202607040007_notification_preferences.sql` |
| `20260705141638` | `202607040008_secure_purchase_flow` | `202607040008_secure_purchase_flow.sql` |
| `20260705141819` | `202607040009_credit_origin_split` | `202607040009_credit_origin_split.sql` |
| `20260705141836` | `202607040010_document_metadata_fields` | `202607040010_document_metadata_fields.sql` |
| `20260705141933` | `202607040008b_harden_new_rpc_grants` | replacement `20260704000950_harden_purchase_rpc_grants.sql` |
| `20260705142131` | `202607040011_document_intelligence` | `202607040011_document_intelligence.sql` |
| `20260705142212` | `202607040012_harden_internal_rpc` | `202607040012_harden_internal_rpc.sql` |
| `20260705142238` | `202607040013_revoke_rls_auto_enable_public` | `202607040013_revoke_rls_auto_enable_public.sql` |
| `20260705153646` | `202607030002_l13_course_professors` | `202607030002_l13_course_professors.sql` |
| `20260705153745` | `202607040001_l13_course_metadata_and_word_upload` | `202607040001_l13_course_metadata_and_word_upload.sql` |
| `20260705202322` | `fk_indexes_and_purchase_hardening` | `202607050001_fk_indexes_and_purchase_hardening.sql` |
| `20260709083349` | `rag_pgvector` | `20260709083349_rag_pgvector.sql` |
| `20260709132205` | `rag_topic_chunks` | `20260709120000_rag_topic_chunks.sql` |

Only the first migration has byte-identical historical SQL. The mapping above
is therefore a version baseline, not a claim that later-edited local bytes were
the bytes originally executed.

## Data preflight

Read-only production queries returned:

- zero duplicate welcome-credit grants;
- zero ambiguous wallet origin splits;
- zero invalid `earned_convertible` balances;
- zero duplicate PDF jobs;
- zero duplicate or stale active RAG jobs.

The deployed schema already contains the flashcard mastery and outline-quality
objects, although those two changes are not represented in hosted migration
history. They are re-applied idempotently as forward migrations so schema and
history converge without rewriting the old rows.

## Forward-only release set deployed on 11 July 2026

The final hosted history contains the following eleven forward migrations. The
version and hosted name are mirrored exactly by the corresponding repository
filename; none of the 20 historical rows was repaired, reverted or replayed.

| Hosted version | Hosted name | Canonical repository file | Scope |
|---|---|---|---|
| `20260711011041` | `flashcard_mastery_quality_reconcile_20260711` | `20260711011041_flashcard_mastery_quality_reconcile_20260711.sql` | Flashcard mastery, dashboard filters and buyer-weighted quality rollups. |
| `20260711011052` | `document_outline_quality_reconcile_20260711` | `20260711011052_document_outline_quality_reconcile_20260711.sql` | Hierarchical outline provenance and quality metadata. |
| `20260711011059` | `production_integrity_hardening_20260711` | `20260711011059_production_integrity_hardening_20260711.sql` | ACL, RLS, wallet, purchase, flashcard, SRS, job and RAG invariants. |
| `20260711011109` | `billing_payments_and_payouts_20260711` | `20260711011109_billing_payments_and_payouts_20260711.sql` | Billing ledger, credit lots, refunds, subscriptions, seller earnings and payouts, disabled by default. |
| `20260711011123` | `pdf_worker_leases_pipeline_20260711` | `20260711011123_pdf_worker_leases_pipeline_20260711.sql` | Durable PDF runs, dependencies, leases, retries and versioned artifacts. |
| `20260711011130` | `privacy_request_workflow_20260711` | `20260711011130_privacy_request_workflow_20260711.sql` | Auditable privacy export and asynchronous erasure workflow. |
| `20260711012042` | `rag_topic_model_version_hardening_20260711` | `20260711012042_rag_topic_model_version_hardening_20260711.sql` | Topic selection pinned to embedding model, version and active content. |
| `20260711012049` | `billing_provider_and_rag_dispatch_hardening_20260711` | `20260711012049_billing_provider_and_rag_dispatch_hardening_20260711.sql` | Ambiguous provider outcomes, authorized subscription SKU and durable RAG dispatch. |
| `20260711012349` | `security_invoker_and_fk_indexes_20260711` | `20260711012349_security_invoker_and_fk_indexes_20260711.sql` | Caller-context public views and remaining hosted-advisor FK indexes. |
| `20260711012933` | `billing_subscription_lint_cleanup_20260711` | `20260711012933_billing_subscription_lint_cleanup_20260711.sql` | Immutable forward cleanup for the subscription-offer authorization assertion. |
| `20260711015747` | `pdf_worker_versioned_claim_hardening_20260711` | `20260711015747_pdf_worker_versioned_claim_hardening_20260711.sql` | Version-pinned worker claims; the legacy unversioned service-role claim is disabled. |

Every migration was tested from a clean local database before remote execution.
Remote DDL was applied transactionally through `apply_migration`; data-changing
preflight assertions abort the transaction instead of coercing ambiguous rows.

## Prohibited recovery shortcuts

- Do not use `db push --include-all`.
- Do not mark the 20 hosted migrations as reverted.
- Do not reset the hosted database.
- Do not delete economic records to make a constraint pass.
- Do not enable billing or payout merely because the schema is present.

## Post-deploy proof

The authenticated project connector verified the hosted state after the final
forward migration:

| Proof | Final result | Meaning |
|---|---:|---|
| Hosted migration history | `31` rows; `11/11` new forward versions present | The 20-row baseline was preserved and the release set is complete. |
| Security advisor severity `ERROR` | `0` | No blocking hosted security-advisor finding remains. |
| Wallet invariant violations | `0` | `balance = free + purchased + earned` and the convertible-earned bounds hold. |
| Accounts with duplicate welcome-credit grants | `0` | The initial grant remains exactly-once per account. |
| Active billing offers | `0` | Billing, subscription and payout products remain fail-closed after schema deployment. |
| Public-schema tables without RLS | `0` | Every exposed table is protected by row-level security. |
| Public/anonymous-executable privileged functions | `0` | No privileged RPC is exposed through broad `public` or `anon` grants; authenticated RPCs remain explicitly scoped and reviewed. |
| Ready documents without durable RAG dispatch | `0` | Completed eligible documents are not stranded without an indexing job. |
| `authenticated` can call payout-attempt RPC | `false` | Provider reconciliation remains service-role-only. |
| Active-chunk guard installed | `true` | Topic/retrieval helpers exclude inactive or stale chunk generations. |
| Durable RAG trigger installed | `true` | PDF quality completion dispatches post-processing durably. |
| Version-pinned PDF claim installed | `true` | A worker can claim only runs matching its configured pipeline version; the legacy service-role path is revoked. |

The remaining security-advisor warnings are understood and non-blocking for this
release: seven authenticated `SECURITY DEFINER` RPCs with intentional, scoped
execution semantics, plus leaked-password protection that must be enabled in the
Supabase Auth dashboard. Edge Function versions are deliberately not recorded
here because they were not independently verified as part of this database
history proof.

The workstation CLI should later be re-authenticated with an organisation
member. At that point `migration list --linked` must reproduce the same 31-row
history without `migration repair`.
