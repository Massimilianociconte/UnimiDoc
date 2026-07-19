# Refactor incrementale di App.tsx — piano e stato

Obiettivo: scomporre `src/App.tsx` (~9.500 righe) in route reali, pagine,
hook e servizi, senza riscrittura big-bang. URL e comportamenti invariati a
ogni passo; ogni passo lascia typecheck, unit test ed E2E verdi.

## Fatto (2026-07-15)

- **Passo 0 — modulo routing**: `src/routing.ts` estrae `Route`, `AuthMode`,
  `routePaths`, `routeSeo`, `routeFromPathname`, `isLegalRoute`,
  `authModeFromRoute`, `nextRouteAfterAuth` (con test `src/routing.test.ts`).
  È la mappa che la migrazione a react-router riuserà tale e quale.
- `LegalPage` è già una pagina separata lazy (`src/components/LegalPage.tsx`).

## Prossimi passi (in ordine, uno per PR)

1. **Estrazione pagine foglia** (meccanica, nessun cambio di stato):
   `LoginPage`, `SiteFooter`, `PremiumPage`, `DegreeProgramPage` →
   `src/pages/`. Ogni estrazione: spostare il componente + i soli helper che
   usa, importare da App.tsx, `npm test && npm run e2e`.
2. **Hook di dominio**: spostare gli useEffect di caricamento in hook dedicati
   (`useCatalog`, `useCredits`, `useAuthSession`, `useLegalConsent`) in
   `src/hooks/`, con le funzioni fetch già isolate in `src/lib/*Client.ts`.
3. **Data layer**: introdurre `@tanstack/react-query` con un
   `QueryClientProvider` in `main.tsx` e migrare in quest'ordine: catalogo
   pubblico → saldo crediti → documenti propri → notifiche → flashcard.
   Regole: `staleTime` breve per i saldi, invalidazione su mutazione
   (`purchase_document` ⇒ invalidate `['credits']` e `['library']`).
   Non migrare la modalità demo (stato locale intenzionale).
4. **react-router**: creare `createBrowserRouter` con una route per ogni voce
   di `routePaths` + le tre route con slug (`/appunti/:slug`, `/autore/:slug`,
   `/corsi/:slug`), `lazy:` per pagina. Sostituire `navigateRoute` con un
   adapter che chiama `useNavigate` mantenendo la stessa firma, così i ~50
   call site non cambiano nello stesso PR. Gli alias legacy (`/esplora`,
   `/carica`, `/pricing`, …) diventano `<Navigate replace>`.
5. **Pulizia finale**: rimuovere lo state `route` manuale, il listener
   `popstate` e l'effetto SEO manuale (sostituito da loader/handle di route).

## Vincoli

- Il prerender (`scripts/prerender.mjs`) inietta contenuto statico dentro
  `#root`: la migrazione al router deve mantenere l'hydration-safe mount
  attuale (`createRoot().render` sostituisce tutto — va bene finché resta così).
- Gli E2E Playwright coprono i flussi marketplace/auth-upload in modalità
  demo: eseguirli a ogni passo.
- Budget bundle in CI (`npm run check:bundle`): react-router (+~12 kB gz) e
  react-query (+~13 kB gz) rientrano nel budget attuale (entry 212/240 kB),
  ma vanno verificati nel PR che li introduce.
