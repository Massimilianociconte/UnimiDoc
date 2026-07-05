import type { DocumentItem } from '../data'

// ============================================================================
// UnimiDoc credit pricing model
// ----------------------------------------------------------------------------
// Goal: a clear, fair and sustainable way to price documents in credits so that
// the 30 welcome credits let a new user really try the platform (unlock ~1
// small/standard dispensa) WITHOUT being enough to grab premium / high-value
// content or to farm value that would hurt sellers and the economy.
//
// Model = HYBRID. The intrinsic value of a document is derived from:
//   • pages        — more material ⇒ more value (sub-linear, capped)
//   • quality      — completion / quality score (0–10), rewarded above baseline
//   • demand       — downloads as a popularity/demand proxy (capped)
//   • premium flag — curated / premium material carries a floor bonus
//   • trust        — verified + high uploader trust add a small premium
//   • subject      — per-subject scarcity/demand multiplier
//
// A seller MAY set an asking price; it is then clamped to a fair band around the
// intrinsic value ([fair·0.7, fair·1.5]) so nobody can under-price valuable
// material (devaluing the catalog) or wildly over-price it.
// ============================================================================

export const WELCOME_CREDITS = 30
export const MIN_DOCUMENT_PRICE = 8
// Cap alzato da 140 a 250 (= €25) così un venditore può realmente raggiungere
// prezzi da marketplace reale; l'anti-abuso resta la banda [fair·0.7, fair·1.5]
// attorno al valore intrinseco, non un tetto artificiale basso.
export const MAX_DOCUMENT_PRICE = 250

// ============================================================================
// EUR ↔ credits economy
// ----------------------------------------------------------------------------
// Anchor: 1 credito = €0.10 (10 crediti = €1). Scelta rispetto a 1:1 perché:
//   • i prezzi restano "interi tondi" e leggibili (una dispensa = 20–140 crediti,
//     cioè €2–€14) invece di micro-decimali;
//   • lascia granularità fine per bonus/ricompense senza frazioni di centesimo;
//   • separa il prezzo percepito (crediti) dal costo reale (€), così i pacchetti
//     ricarica possono avere un margine piattaforma senza confondere l'utente.
//
// Flusso vendita: il venditore fissa un prezzo in € → viene convertito in crediti
// e ancorato alla banda equa. L'acquirente paga quei crediti. Il venditore
// incassa un PAYOUT = valore € dei crediti spesi × (1 − commissione).
//
// Sostenibilità: la piattaforma trattiene PLATFORM_COMMISSION (copre fee di
// pagamento ~3–4% + infrastruttura + margine) e vende i crediti con un piccolo
// ricarico rispetto al valore di payout. I crediti di benvenuto e guadagnati
// NON sono convertibili in denaro (solo spendibili), così il bonus non è un
// costo cash per la piattaforma; solo i crediti ACQUISTATI generano ricavo.
// ============================================================================

/** Valore monetario di 1 credito, lato acquisto/spesa (€). */
export const CREDIT_EUR_VALUE = 0.1

/** Commissione piattaforma sul payout al venditore (fee pagamento + margine). */
export const PLATFORM_COMMISSION = 0.3

/** Soglia minima di payout accumulato per richiedere un prelievo (€). */
export const MIN_PAYOUT_EUR = 25

/** Acquisto minimo di crediti (€) per una ricarica. */
export const MIN_TOPUP_EUR = 5

export type CreditOrigin = 'welcome' | 'earned' | 'purchased'

/**
 * Pacchetti ricarica: più spendi più bonus ricevi (il valore effettivo per €
 * migliora con il taglio, incentivando acquisti maggiori senza svendere).
 * `credits` = crediti totali accreditati; `priceEur` = prezzo pagato.
 */
export const TOPUP_PACKS: Array<{ id: string; priceEur: number; credits: number; bonusPct: number }> = [
  { id: 'starter', priceEur: 5, credits: 50, bonusPct: 0 },
  { id: 'standard', priceEur: 10, credits: 105, bonusPct: 5 },
  { id: 'plus', priceEur: 20, credits: 220, bonusPct: 10 },
  { id: 'max', priceEur: 40, credits: 460, bonusPct: 15 },
]

/** Crediti → euro (valore nominale di spesa). */
export function creditsToEur(credits: number): number {
  return Math.round(credits * CREDIT_EUR_VALUE * 100) / 100
}

/** Euro → crediti, arrotondati al multiplo di 5 per prezzi puliti. */
export function eurToCredits(eur: number): number {
  const raw = eur / CREDIT_EUR_VALUE
  return Math.max(MIN_DOCUMENT_PRICE, Math.round(raw / 5) * 5)
}

/**
 * Payout netto al venditore (€) quando un documento viene sbloccato al prezzo
 * `priceCredits`. Solo i crediti spesi generano payout; la commissione resta
 * alla piattaforma.
 */
export function sellerPayoutEur(priceCredits: number): number {
  return Math.round(creditsToEur(priceCredits) * (1 - PLATFORM_COMMISSION) * 100) / 100
}

/** Ripartizione trasparente prezzo → payout venditore / trattenuta piattaforma. */
export function revenueSplit(priceCredits: number) {
  const grossEur = creditsToEur(priceCredits)
  const sellerEur = sellerPayoutEur(priceCredits)
  return {
    priceCredits,
    grossEur,
    sellerEur,
    platformEur: Math.round((grossEur - sellerEur) * 100) / 100,
    commissionPct: Math.round(PLATFORM_COMMISSION * 100),
  }
}

// Fraction of the fair price a seller is allowed to move within.
const SELLER_FLOOR_RATIO = 0.7
const SELLER_CEIL_RATIO = 1.5

// Per-subject scarcity / demand multiplier. Harder or rarer subjects hold value
// slightly better; broad, abundant ones sit a touch lower. Unknown ⇒ 1.0.
const SUBJECT_MULTIPLIER: Record<string, number> = {
  Genetica: 1.05,
  'Chimica biologica': 1.08,
  'Biochimica': 1.08,
  Microbiologia: 1.05,
  'Biologia molecolare': 1.06,
  'Anatomia comparata': 1.1,
  'Citologia e istologia': 1.04,
  'Fisica e metodologie fisiche': 1.12,
  'Matematica e statistica': 1.1,
  Botanica: 0.98,
  Zoologia: 0.98,
  'Ecologia': 0.97,
}

function subjectMultiplier(subject: string): number {
  return SUBJECT_MULTIPLIER[subject] ?? 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

type PricingInput = Pick<DocumentItem, 'pages' | 'quality' | 'downloads' | 'premium' | 'verified' | 'uploaderTrust' | 'subject'>

/** Intrinsic (pre-clamp) fair value of a document in credits. */
function intrinsicFairValue(doc: PricingInput): number {
  const pages = Number.isFinite(doc.pages) ? Math.max(0, doc.pages) : 0
  const quality = Number.isFinite(doc.quality) ? doc.quality : 6
  const downloads = Number.isFinite(doc.downloads) ? Math.max(0, doc.downloads) : 0

  const base = 6
  const pageValue = Math.min(pages, 220) * 0.22 // sub-linear, capped ~48
  const qualityBonus = Math.max(0, quality - 6) * 3.5 // baseline 6/10, up to ~14
  const demandBonus = Math.min(downloads / 60, 12) // capped at 12
  const premiumBonus = doc.premium ? 10 : 0
  const trustBonus = (doc.verified ? 2 : 0) + ((doc.uploaderTrust ?? 0) >= 90 ? 2 : 0)

  return (base + pageValue + qualityBonus + demandBonus + premiumBonus + trustBonus) * subjectMultiplier(doc.subject)
}

/**
 * Final price of a document in credits.
 * @param sellerAsk optional seller-set price; clamped to a fair band around the
 *                  intrinsic value so valuable material can't be under-priced.
 */
export function documentCreditPrice(doc: PricingInput, sellerAsk?: number): number {
  const fair = intrinsicFairValue(doc)

  const priced =
    typeof sellerAsk === 'number' && sellerAsk > 0
      ? clamp(sellerAsk, fair * SELLER_FLOOR_RATIO, fair * SELLER_CEIL_RATIO)
      : fair

  return Math.round(clamp(priced, MIN_DOCUMENT_PRICE, MAX_DOCUMENT_PRICE))
}

/**
 * Prezzo finale in crediti a partire da un prezzo € desiderato dal venditore.
 * Converte €→crediti e poi applica la stessa banda equa di documentCreditPrice,
 * così un "vendi a €25" diventa un prezzo-crediti coerente e mostrabile insieme
 * al payout atteso. Ritorna prezzo, € equivalenti e payout venditore.
 */
export function priceFromSellerEur(doc: PricingInput, askEur: number) {
  const askCredits = eurToCredits(askEur)
  const priceCredits = documentCreditPrice(doc, askCredits)
  return {
    priceCredits,
    buyerEur: creditsToEur(priceCredits),
    sellerPayoutEur: sellerPayoutEur(priceCredits),
    clamped: priceCredits !== askCredits,
  }
}

export type CreditTier = 'base' | 'standard' | 'avanzato' | 'premium'

export function creditTier(price: number): CreditTier {
  if (price <= 20) return 'base'
  if (price <= 40) return 'standard'
  if (price <= 70) return 'avanzato'
  return 'premium'
}

const TIER_LABEL: Record<CreditTier, string> = {
  base: 'Base',
  standard: 'Standard',
  avanzato: 'Avanzato',
  premium: 'Premium',
}

export function tierLabel(tier: CreditTier): string {
  return TIER_LABEL[tier]
}

/** Can this balance unlock the document right now? */
export function canUnlockWithBalance(doc: PricingInput, balance: number, sellerAsk?: number): boolean {
  return balance >= documentCreditPrice(doc, sellerAsk)
}

/**
 * Is the document within reach of the welcome-credits budget? Used to keep the
 * free trial focused on base/standard material (never premium/high-value docs).
 */
export function isWithinWelcomeBudget(doc: PricingInput, sellerAsk?: number): boolean {
  return documentCreditPrice(doc, sellerAsk) <= WELCOME_CREDITS
}

/** Transparent per-component breakdown for a "why this price?" UI. */
export function priceBreakdown(doc: PricingInput, sellerAsk?: number) {
  const price = documentCreditPrice(doc, sellerAsk)
  const tier = creditTier(price)
  return {
    price,
    tier,
    tierLabel: tierLabel(tier),
    components: [
      { label: 'Base', value: 6 },
      { label: 'Pagine', value: Math.round(Math.min(Math.max(doc.pages, 0), 220) * 0.22) },
      { label: 'Qualità', value: Math.round(Math.max(0, doc.quality - 6) * 3.5) },
      { label: 'Richiesta', value: Math.round(Math.min(Math.max(doc.downloads, 0) / 60, 12)) },
      { label: 'Premium', value: doc.premium ? 10 : 0 },
    ].filter((component) => component.value > 0),
  }
}
