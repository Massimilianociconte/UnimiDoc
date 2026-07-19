# Auth — configurazione per la produzione

Checklist della configurazione Supabase Auth necessaria al lancio. Le voci
marcate **[dashboard]** non sono replicabili da `supabase/config.toml` (che
vale solo per lo stack locale) e vanno impostate su
`https://supabase.com/dashboard/project/pmpzfkikwfylesehfezv` o via Management
API. Stato aggiornato al 2026-07-15.

## 1. URL e redirect **[dashboard]**

Auth > URL Configuration:

- **Site URL**: l'origin di produzione (oggi `https://unimidoc.netlify.app`;
  aggiornare quando arriverà il dominio definitivo — fuori scope ora).
- **Redirect URLs** (exact match, uno per ambiente attivo):
  - `https://unimidoc.netlify.app/login`
  - `https://unimidoc.netlify.app/dashboard`
  - `https://unimidoc.netlify.app/premium`
  - eventuali deploy preview usati per QA (aggiungerli solo se necessari,
    rimuoverli dopo).

Il frontend usa `window.location.origin` per costruire i redirect
(`requestPasswordReset` → `/login`, `signInWithGoogle` → route post-auth),
quindi ogni origin usato deve stare nell'allow-list.

## 2. Verifica email, recupero password, cambio email

Già coerenti nel codice; verificare che in hosted risultino:

- **Confirm email**: ON (Auth > Providers > Email > Confirm email). Il flusso
  UI gestisce già il caso `status: 'confirm'` dopo il signup.
- **Secure email change** (doppia conferma): ON.
- **Password minima**: 8+ caratteri (allineata a `minimum_password_length`).
- Recupero password: nessuna configurazione extra oltre a template e redirect.

## 3. Template email in italiano

Sorgenti versionati in `supabase/templates/`:

| Template       | File                | Oggetto                              |
| -------------- | ------------------- | ------------------------------------ |
| Confirm signup | `confirmation.html` | Conferma la tua email - UnimiDoc     |
| Reset password | `recovery.html`     | Reimposta la password - UnimiDoc     |
| Change email   | `email_change.html` | Conferma il cambio email - UnimiDoc  |

In locale sono già collegati da `config.toml`. **[dashboard]** In hosted vanno
incollati in Auth > Emails > Templates (subject + body HTML). Tenere i file del
repo come fonte di verità: ogni modifica passa da qui e viene ricopiata.

## 4. CAPTCHA alla registrazione **[dashboard]**

Auth > Attack Protection > CAPTCHA. Provider consigliato: Cloudflare
Turnstile (gratuito, GDPR-friendly).

1. Creare il sito su Turnstile, ottenere site key + secret.
2. Dashboard: abilitare CAPTCHA con il secret.
3. Frontend: quando viene attivato, `signUp`/`signInWithPassword` richiedono
   `options.captchaToken`. Il punto di integrazione è
   `src/lib/supabaseClient.ts` (`signUpWithEmail`, `signInWithEmail`):
   aggiungere il widget Turnstile alla `LoginPage` e passare il token.
   Finché il CAPTCHA non è abilitato lato server, il codice attuale funziona
   invariato — non attivare il flag server prima di deployare il widget.

Nota: il rate limiting su sign-in/sign-up (30 per 5 min per IP) è già attivo
di default e mitiga il grosso degli abusi anche senza CAPTCHA.

## 5. SMTP personalizzato (predisposto, non attivo)

Oggi le email escono dal servizio built-in di Supabase (limite 2/h utente:
adeguato solo a test). Quando ci saranno dominio e provider (es. Resend,
Postmark, SES):

1. **[dashboard]** Auth > SMTP Settings: host, porta, utente, password,
   sender (`no-reply@<dominio>` + nome "UnimiDoc").
2. Alzare `email_sent` nel rate limit (es. 100/h).
3. Nessuna modifica applicativa richiesta: i flussi (conferma, recovery,
   cambio email) passano tutti da Supabase Auth, che usa l'SMTP configurato in
   modo trasparente. I template restano quelli del punto 3.

## 6. Sessioni

- Rotazione refresh token: ON (default, confermata in `config.toml`).
- JWT expiry 3600s: OK.
- Timebox/inactivity timeout: non necessari per il lancio; valutare
  `inactivity_timeout` se richiesto da policy di sicurezza future.
- Logout: il client usa `supabase.auth.signOut()` (scope globale di default,
  revoca i refresh token).

## 7. Cancellazione account

Flusso già implementato via Edge Function `privacy-center` (richieste
auditabili, nessuna cancellazione diretta dal browser) — vedi
`docs/PRIVACY_REQUEST_RUNBOOK.md`. Verificare che l'operatore processi le
richieste entro i termini GDPR (30 giorni).

## 8. Provider OAuth (Google) **[dashboard]**

- Client ID/secret configurati su console Google con redirect
  `https://pmpzfkikwfylesehfezv.supabase.co/auth/v1/callback`.
- In Google Cloud: OAuth consent screen in produzione (non "testing", che
  scade dopo 7 giorni).
- Quando arriverà il dominio custom, aggiornare authorized origins.

## 9. Esclusioni esplicite

- **Leaked password protection** (Have I Been Pwned): richiede **Supabase Pro**.
  Non attivabile sul piano Free; accettato come residuale di rischio. Mitigazioni
  attuali: password min 8, rate limit auth, CAPTCHA (quando abilitato).
- **SMTP custom / CAPTCHA / OAuth Google production**: da completare in dashboard
  prima del traffico reale (vedi sezioni 4–5 e 8).
- **Dominio personalizzato**: fuori scope ora.
- **Stripe / identità legale**: fuori scope auth; bloccano solo moneta e testi
  legali (fail-closed billing già in codice).

## Verifica post-configurazione

1. Signup con email reale → arriva email italiana → conferma → login.
2. Reset password → email → nuova password → login.
3. Cambio email dalle impostazioni → doppia conferma.
4. Login Google → redirect corretto alla dashboard.
5. Signup con checkbox termini → riga in `public.legal_consents` con
   `legal_version` corrente.
