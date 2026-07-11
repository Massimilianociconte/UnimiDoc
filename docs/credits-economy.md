# Modello economico UnimiDoc — crediti, euro, payout

Fonte di verità del codice: [`src/lib/creditPricing.ts`](../src/lib/creditPricing.ts).
Questo documento spiega le scelte; i numeri vivono nel codice come costanti.

## 1. Ancoraggio: 1 credito = €0,10

Valutata la conversione 1:1 (1 credito = €1) ma **scartata** a favore di
**10 crediti = €1**:

- i prezzi restano interi e leggibili (una dispensa costa 20–250 crediti, cioè
  €2–€25) invece di micro-decimali;
- granularità fine per bonus/ricompense senza frazioni di centesimo;
- **separa il prezzo percepito (crediti) dal costo reale (€)**: i pacchetti
  ricarica possono avere un margine piattaforma senza esporre all'utente un
  cambio confuso.

`CREDIT_EUR_VALUE = 0.10`.

## 2. Flusso di una vendita

1. Il venditore fissa un prezzo desiderato **in €** (o accetta il prezzo equo
   suggerito).
2. `priceFromSellerEur(doc, askEur)` converte €→crediti (`eurToCredits`,
   arrotondato al multiplo di 5) e **ancora il risultato alla banda equa**
   `[fair·0.7, fair·1.5]` attorno al valore intrinseco del documento.
3. L'acquirente paga quei **crediti**.
4. Il venditore incassa un **payout** = valore € dei crediti spesi ×
   `(1 − PLATFORM_COMMISSION)`.

### Esempio del prompt (vendere a €25)

- €25 → `eurToCredits` = 250 crediti.
- Se il documento ha valore intrinseco alto abbastanza, il prezzo regge fino al
  cap `MAX_DOCUMENT_PRICE = 250` (= €25). L'acquirente paga **250 crediti**, il
  venditore incassa **€17,50** (250 × €0,10 × 0,70).
- Se invece il valore equo del documento è più basso (es. intrinseco ~105
  crediti = €10,50), l'ask €25 viene **clampato** a 1,5× ≈ 158 crediti ≈ €15,80:
  è la protezione anti-overpricing, non un bug. Il payout scala di conseguenza.

Il cap è stato alzato da 140 a **250 crediti** proprio per rendere l'esempio €25
realmente raggiungibile da un documento di valore; l'anti-abuso resta la banda
attorno al valore equo, non un tetto artificiale basso.

## 3. Commissione e sostenibilità

`PLATFORM_COMMISSION = 0.30` sul payout venditore. Copre:

- fee dei sistemi di pagamento (~3–4% su acquisto crediti),
- infrastruttura (storage, Edge Functions, AI),
- margine della piattaforma.

Allineato alle marketplace di appunti (StuDocu/Docsity trattengono il 40–60% o
più; 30% è competitivo per attrarre autori di qualità).

`revenueSplit(priceCredits)` espone la ripartizione trasparente
prezzo → payout venditore / trattenuta piattaforma per una UI "come viene
diviso questo prezzo".

## 4. Tipi di credito e convertibilità

`CreditOrigin = 'welcome' | 'promotional' | 'earned' | 'purchased'`.

| Tipo | Come si ottiene | Spendibile | Convertibile in € |
|------|-----------------|-----------|-------------------|
| `welcome` | 30 crediti al signup (€3 di valore di spesa) | Sì | **No** |
| `promotional` | bonus associato a una ricarica | Sì | **No** |
| `earned` | payout da vendite proprie o ricompense | Sì | Solo quota `earned_convertible` (≥ `MIN_PAYOUT_EUR`) |
| `purchased` | pacchetti ricarica | Sì | No |

Regola chiave di sostenibilità: `welcome`, `promotional` e `purchased` non sono
prelevabili. `promotional` resta inoltre separato da `purchased`, perché non è
cash-backed e non può generare un incasso reale al venditore. Dei crediti
`earned`, soltanto la quota `earned_convertible` finanziata da valore cash è
prelevabile, sopra la soglia `MIN_PAYOUT_EUR = €25`.

`WELCOME_CREDITS = 30` = ~1 dispensa base/standard, mai un documento premium
(che prezza ben oltre 30): il free trial fa provare la piattaforma senza
regalare contenuto di valore.

## 5. Pacchetti ricarica (`TOPUP_PACKS`)

Più spendi, più bonus (valore effettivo per € che migliora col taglio):

| Pack | Prezzo | Pagati | Promozionali | Totale | cr/€ | Valore di spesa |
|------|--------|--------|---------------|--------|------|-----------------|
| starter | €5 | 50 | 0 | 50 | 10,0 | €5,00 |
| standard | €10 | 100 | 5 | 105 | 10,5 | €10,50 |
| plus | €20 | 200 | 20 | 220 | 11,0 | €22,00 |
| max | €40 | 400 | 60 | 460 | 11,5 | €46,00 |

Acquisto minimo `MIN_TOPUP_EUR = €5`. Il bonus è "valore di spesa" (crediti in
più), non cash: incentiva ricariche maggiori senza erodere il margine reale.

## 6. Arrotondamenti e soglie (riassunto)

- Prezzi documento: crediti interi, ask €→crediti arrotondato al multiplo di 5.
- `creditsToEur` a 2 decimali; `MIN_DOCUMENT_PRICE = 8` crediti.
- Prelievo venditore: soglia `MIN_PAYOUT_EUR = €25`.

## 6b. Split per origine, ordine di consumo e anti-abuso (definitivo)

Il wallet (`src/lib/creditsWallet.ts` in demo; colonne DB in
`202607040009_credit_origin_split.sql` in live) tiene il saldo **diviso per
origine**: `free`, `promotional`, `purchased`, `earned` (con
`earned_convertible` = quota prelevabile).
`balance = free + promotional + purchased + earned`.

**Regola crediti gratuiti (sostenibilità del bonus):** i 30 crediti `free`
sbloccano SOLO documenti a basso costo (≤ 30 crediti = `FREE_CREDIT_MAX_DOC_PRICE`).
Su documenti più cari i crediti gratuiti non sono spendibili: servono
purchased/earned. Così il bonus fa provare la piattaforma senza regalare
contenuto premium.

**Ordine di consumo:** `free → promotional → purchased → earned non-convertible
→ earned convertible`. I bucket non cash-backed vengono consumati per primi.

**Coerenza payout venditore per tipo di credito:** la quota che l'acquirente
paga con crediti `free` NON è coperta da denaro reale → il venditore riceve per
quella quota un payout **non convertibile** (spendibile ma non prelevabile). La
quota pagata con `purchased`/`earned` genera payout **convertibile**. Questo
evita che il bonus di benvenuto faccia uscire cassa reale.

**Anti-abuso (GDPR / minimizzazione dati):** il bonus è concesso **una sola
volta per email verificata** (`grant_welcome_credits` controlla
`email_confirmed_at` + idempotenza sulla riga ledger `welcome`). Nessun dato
extra raccolto (niente telefono/fingerprint): email verificata +
un-account-per-email è un controllo standard e proporzionato. Le regole vanno
esplicitate in Termini, Privacy e Cookie Policy.

## 7. TODO backend (non ancora implementato)

- Tabella `seller_earnings`/`payouts` con saldo `earned` separato dallo
  spendibile e provider di pagamento (Stripe Connect o simile) per i prelievi.
- Split del pagamento a `document_purchases` che accredita il payout al
  venditore applicando `sellerPayoutEur`.
- Acquisto pacchetti crediti (`TOPUP_PACKS`) via checkout.
