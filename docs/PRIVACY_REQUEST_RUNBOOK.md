# Privacy request runbook

This runbook governs rows in `public.privacy_requests`. It is an operational
process, not a substitute for legal review.

## Intake

1. The authenticated user creates a request through `privacy-center`.
2. Store only the SHA-256 of the normalized account email in the request row.
3. Acknowledge the request and set `acknowledged_at` before starting work.
4. Never ask for identity documents by ordinary email. Use reauthentication or
   a dedicated secure channel only when the account session is insufficient.

## Export

`privacy-center` builds JSON on demand, returns it directly to the authenticated
session and stores only an export manifest hash. It does not persist the export
payload or signed public links.

If a dataset is marked `truncated`, an operator must produce the remaining rows
through a server-side paginated export before treating an access request as
complete.

## Erasure decision

Before deletion, check:

- active subscription, refund, dispute or payout;
- accounting and tax retention requirements;
- unresolved copyright, fraud, security or moderation case;
- documents purchased by other users and the minimum metadata needed to keep
  their transaction intelligible;
- storage objects, derived previews, embeddings, chunks, flashcards and caches.

If retention is required, set `legal_hold=true`, record a concise internal
reason, expose a non-sensitive `public_message`, and pseudonymize everything not
needed for that purpose. Never use a legal hold as a generic reason to delay.

## Execution order

1. Disable new sessions and economic operations for the account.
2. Cancel pending worker/RAG jobs and invalidate active leases.
3. Remove or anonymize public seller/profile data.
4. Delete private storage and derived objects not under hold.
5. Delete or pseudonymize study activity and user-generated metadata.
6. Pseudonymize retained economic records; do not break ledger invariants.
7. Remove the Auth user only after database/storage compensation succeeds.
8. Mark the request `completed` or `partially_completed`, with timestamps and a
   user-safe explanation.

## Failure and audit

Every destructive step must be idempotent and retryable. A partial failure keeps
the request `in_progress`; it must not be reported as completed. Operator logs
must not contain raw tokens, document text, payment secrets or local file paths.
