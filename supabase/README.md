# UnimiDoc — Backend (Supabase)

Backend for the learning engine: database, spaced-repetition persistence, and
the premium AI layer (DeepSeek text + Gemini vision). **All AI keys stay
server-side; free users never trigger an AI call.**

## Architecture

```
Browser (free)                 Browser (premium)
  deterministic engine           deterministic engine
  + local SRS (localStorage)     + AI Helps / premium gen / occlusion
        │                                 │  (Authorization: Bearer <jwt>)
        ▼                                 ▼
  (no network AI)            Supabase Edge Functions (Deno)  ── secrets ──▶ DeepSeek / Gemini
                              ├─ document-upload    (—)          signed upload + queued jobs
                              ├─ document-access    (—)          signed previews, no raw PDF leak
                              ├─ ai-help            (DeepSeek)   auth + premium + rate limit
                              ├─ generate-flashcards(DeepSeek)   cache + cost tracking
                              ├─ image-occlusion    (Gemini)     bbox validation
                              └─ srs-review          (—)         authoritative SRS + telemetry
                                        │
                                        ▼
                                Postgres (RLS): documents, pdf_pages,
                                pdf_chunks, flashcards, flashcard_reviews,
                                user_entitlements, ai_monthly_usage,
                                ai_cost_ledger, flashcard_generation_cache,
                                processed_chunk_cache + bridge tables
                                (ai_helps, ai_cache, srs_state, user_answers)
```

**AI router (`_shared/ai.ts › resolveAiProvider`)**: `image_occlusion` /
`image_label_detection` / `diagram_understanding` → **Gemini**; everything else
→ **DeepSeek**. DeepSeek is never called for vision; Gemini never for ordinary
text.

## Deploy

```bash
supabase link --project-ref <ref>
supabase db push                      # applies all supabase/migrations/*.sql in order
supabase secrets set --env-file supabase/.env   # DeepSeek/Gemini keys + limits
supabase functions deploy document-upload document-access ai-help generate-flashcards image-occlusion srs-review
```

Production secrets must include a strict CORS allowlist rather than `*`:

```ini
CORS_ALLOW_ORIGIN=https://unimidoc.it
CORS_ALLOW_ORIGINS=https://unimidoc.it,https://www.unimidoc.it,https://unimidoc.netlify.app,http://127.0.0.1:5173,http://localhost:5173
DEEPSEEK_MODEL=deepseek-v4-flash
GEMINI_VISION_MODEL=gemini-3-flash-preview
MAX_IMAGE_BASE64_CHARS=12000000
```

If provider keys were ever pasted into a chat, ticket, log, or screenshot, rotate
them in the provider dashboards and immediately overwrite the Supabase secrets.

Frontend: copy `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` into the project
root `.env.local`, and wire the access token once auth exists:

```ts
import { setAccessTokenProvider } from './lib/aiClient'
setAccessTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null)
```

## Guarantees

- **Premium gating** — every AI function calls `requirePremium()` (reads
  `user_entitlements.plan` / `ai_flashcards_enabled` / `premium_until`
  server-side). A tampered client flag cannot unlock paid generations. Free
  users get a `402` paywall.
- **Protected previews** — `document-access` returns only short-lived signed
  URLs for allowed preview images unless the caller is owner/buyer/premium
  according to the document policy.
- **Safe upload entry** — `document-upload` writes a private draft, returns a
  signed upload URL under the authenticated user's storage folder, and queues
  processing jobs. Publication remains worker-confirmed only.
- **Rate limit / anti-abuse** — `enforceRateLimit()` caps per-minute and
  per-feature-per-month by counting the `ai_cost_ledger` (`429` when exceeded).
- **Cost tracking** — one row per call in `ai_cost_ledger` (input / cached-input
  / output tokens, per provider) plus an atomic monthly rollup in
  `ai_monthly_usage` via the `record_ai_monthly_usage` RPC.
- **Caching** — flashcards reuse `flashcard_generation_cache`; other AI
  responses use the generic `ai_cache`, keyed by SHA-256 of
  provider+model+prompt_version+language+content (identical requests cost 0).
- **Security** — keys only in Deno env; RLS on every user table; `ai_cache` has
  RLS with no policies (service-role only); no PII sent to providers (only an
  anonymised technical `user` id).
- **Errors** — provider failures/timeouts retry with backoff, then surface a
  safe `502`; nothing leaks stack traces or keys.

## Tests

`npm test` (vitest) covers the pure engine used on both sides:
`src/lib/studyEngine.test.ts` (SRS scheduling + answer evaluation) and
`src/lib/flashcardEngine.test.ts` (dedup, noise exclusion, question templating).
The Edge Functions mirror `studyEngine` in `_shared/srs.ts`.
