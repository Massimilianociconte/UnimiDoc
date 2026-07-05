import { CREDIT_EUR_VALUE, PLATFORM_COMMISSION, WELCOME_CREDITS } from './creditPricing'
import type { DocumentItem } from '../data'

// ============================================================================
// Credit wallet — persistent, split by origin, with a transaction ledger.
// ----------------------------------------------------------------------------
// Source of truth for the DEMO experience (localStorage, per user id, survives
// login/logout/refresh). The live path mirrors this in Postgres:
// `user_credit_accounts` gains free_credits / purchased_credits columns and the
// SECURITY DEFINER `purchase_document` RPC applies the same rules server-side.
//
// Credit origins:
//   • free      — 30 welcome credits, non-refundable, LIMITED to low-cost docs.
//   • purchased — bought with real money (top-up packs). Fully spendable.
//   • earned    — seller payouts. Spendable; the convertible-to-cash part is
//                 tracked separately (see below).
//
// Consumption order when spending: free → purchased → earned. Free credits are
// burned first so the promotional bonus gets used and paid credits are retained.
//
// Economic-balance rule (the important one): free credits are NOT backed by real
// money, so a sale funded by free credits must NOT pay the seller real cash. The
// portion a buyer pays with free credits produces a NON-convertible payout for
// the seller; only the portion paid with purchased/earned credits produces a
// convertible (withdrawable) payout. This keeps the welcome bonus sustainable.
// ============================================================================

export type CreditOrigin = 'free' | 'purchased' | 'earned'

export type Wallet = {
  free: number
  purchased: number
  earned: number
  /** Portion of `earned` that is convertible to cash (funded by real money). */
  earnedConvertible: number
}

export type LedgerDirection = 'welcome' | 'purchased' | 'spent' | 'earned'

export type LedgerEntry = {
  id: string
  ts: number
  direction: LedgerDirection
  amount: number
  balanceBefore: number
  balanceAfter: number
  reason: string
  documentId?: string
  documentTitle?: string
  eurValue: number
  /** For a spend: how much came from each origin. */
  breakdown?: { free: number; purchased: number; earned: number }
}

export type PurchasedItem = {
  transactionId: string
  documentId: string
  title: string
  subject: string
  type: string
  university: string
  course: string
  professor: string
  academicYear: string
  uploader: string
  purchasedAt: number
  creditsSpent: number
  balanceBefore: number
  balanceAfter: number
  eurValue: number
  pages: number
}

export type WalletState = {
  wallet: Wallet
  ledger: LedgerEntry[]
  purchases: PurchasedItem[]
  initialized: boolean
}

/** A document priced at or below this (credits) is unlockable with free credits. */
export const FREE_CREDIT_MAX_DOC_PRICE = WELCOME_CREDITS // 30

const STORAGE_PREFIX = 'unimidoc:wallet:v1:'
const UNIVERSITY = 'Università degli Studi di Milano'

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

function emptyState(): WalletState {
  return {
    wallet: { free: 0, purchased: 0, earned: 0, earnedConvertible: 0 },
    ledger: [],
    purchases: [],
    initialized: false,
  }
}

export function balanceOf(wallet: Wallet): number {
  return wallet.free + wallet.purchased + wallet.earned
}

export function loadWalletState(userId: string): WalletState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as WalletState
    // Defensive defaults for forward-compat.
    return {
      wallet: {
        free: parsed.wallet?.free ?? 0,
        purchased: parsed.wallet?.purchased ?? 0,
        earned: parsed.wallet?.earned ?? 0,
        earnedConvertible: parsed.wallet?.earnedConvertible ?? 0,
      },
      ledger: parsed.ledger ?? [],
      purchases: parsed.purchases ?? [],
      initialized: parsed.initialized ?? true,
    }
  } catch {
    return emptyState()
  }
}

function saveWalletState(userId: string, state: WalletState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/**
 * Ensure the user has a wallet; grants the welcome bonus exactly once. Idempotent
 * across refresh (persisted `initialized` flag). Returns the current state.
 */
export function ensureWallet(userId: string, opts?: { grantWelcome?: boolean }): WalletState {
  const state = loadWalletState(userId)
  if (state.initialized) return state

  const grant = opts?.grantWelcome ?? true
  const next: WalletState = emptyState()
  next.initialized = true
  if (grant) {
    next.wallet.free = WELCOME_CREDITS
    next.ledger = [
      {
        id: makeId(),
        ts: nowMs(),
        direction: 'welcome',
        amount: WELCOME_CREDITS,
        balanceBefore: 0,
        balanceAfter: WELCOME_CREDITS,
        reason: 'Bonus di benvenuto',
        eurValue: 0, // free credits carry no cash value
      },
    ]
  }
  saveWalletState(userId, next)
  return next
}

export type SpendResult =
  | { ok: true; state: WalletState; entry: LedgerEntry; item: PurchasedItem }
  | { ok: false; reason: 'insufficient' | 'free_only_low_cost' | 'already_owned' }

/** Is this document unlockable using (partly) free credits? */
export function isFreeEligible(priceCredits: number): boolean {
  return priceCredits <= FREE_CREDIT_MAX_DOC_PRICE
}

/**
 * Spend credits to unlock a document. Applies the free-credit eligibility rule,
 * the free→purchased→earned consumption order, records a ledger entry and a
 * library purchase item, and persists everything. Pure w.r.t. inputs; the only
 * side effect is localStorage.
 */
export function purchaseWithWallet(userId: string, document: DocumentItem, priceCredits: number): SpendResult {
  const state = loadWalletState(userId)

  if (state.purchases.some((purchase) => purchase.documentId === document.id)) {
    return { ok: false, reason: 'already_owned' }
  }

  const { free, purchased, earned } = state.wallet
  const freeEligible = isFreeEligible(priceCredits)
  const spendableFree = freeEligible ? free : 0
  const available = spendableFree + purchased + earned

  if (available < priceCredits) {
    // Distinguish "you have free credits but this doc is too expensive for them".
    if (!freeEligible && free + purchased + earned >= priceCredits) {
      return { ok: false, reason: 'free_only_low_cost' }
    }
    return { ok: false, reason: 'insufficient' }
  }

  const balanceBefore = balanceOf(state.wallet)

  // Deduct free → purchased → earned.
  let remaining = priceCredits
  const useFree = Math.min(spendableFree, remaining)
  remaining -= useFree
  const usePurchased = Math.min(purchased, remaining)
  remaining -= usePurchased
  const useEarned = Math.min(earned, remaining)
  remaining -= useEarned

  const nextWallet: Wallet = {
    ...state.wallet,
    free: free - useFree,
    purchased: purchased - usePurchased,
    earned: earned - useEarned,
  }
  const balanceAfter = balanceOf(nextWallet)
  const transactionId = makeId()
  const eurValue = Math.round(priceCredits * CREDIT_EUR_VALUE * 100) / 100

  const entry: LedgerEntry = {
    id: transactionId,
    ts: nowMs(),
    direction: 'spent',
    amount: priceCredits,
    balanceBefore,
    balanceAfter,
    reason: 'Acquisto documento',
    documentId: document.id,
    documentTitle: document.title,
    eurValue,
    breakdown: { free: useFree, purchased: usePurchased, earned: useEarned },
  }

  const item: PurchasedItem = {
    transactionId,
    documentId: document.id,
    title: document.title,
    subject: document.subject,
    type: document.type,
    university: UNIVERSITY,
    course: 'Scienze Biologiche L-13',
    professor: document.professor,
    academicYear: document.academicYear,
    uploader: document.uploader,
    purchasedAt: nowMs(),
    creditsSpent: priceCredits,
    balanceBefore,
    balanceAfter,
    eurValue,
    pages: document.pages,
  }

  const nextState: WalletState = {
    wallet: nextWallet,
    ledger: [entry, ...state.ledger],
    purchases: [item, ...state.purchases],
    initialized: true,
  }
  saveWalletState(userId, nextState)
  return { ok: true, state: nextState, entry, item }
}

/** Credit a top-up purchase (real money) into the purchased bucket. */
export function addPurchasedCredits(userId: string, credits: number, priceEur: number): WalletState {
  const state = loadWalletState(userId)
  const balanceBefore = balanceOf(state.wallet)
  const nextWallet: Wallet = { ...state.wallet, purchased: state.wallet.purchased + credits }
  const entry: LedgerEntry = {
    id: makeId(),
    ts: nowMs(),
    direction: 'purchased',
    amount: credits,
    balanceBefore,
    balanceAfter: balanceOf(nextWallet),
    reason: `Ricarica crediti (€${priceEur.toFixed(2)})`,
    eurValue: priceEur,
  }
  const nextState: WalletState = { ...state, wallet: nextWallet, ledger: [entry, ...state.ledger] }
  saveWalletState(userId, nextState)
  return nextState
}

/** Credit earned (non-convertible) credits, e.g. an upload/review reward. */
export function addEarnedCredits(userId: string, credits: number, reason: string): WalletState {
  const state = loadWalletState(userId)
  const balanceBefore = balanceOf(state.wallet)
  const nextWallet: Wallet = { ...state.wallet, earned: state.wallet.earned + credits }
  const entry: LedgerEntry = {
    id: makeId(),
    ts: nowMs(),
    direction: 'earned',
    amount: credits,
    balanceBefore,
    balanceAfter: balanceOf(nextWallet),
    reason,
    eurValue: 0,
  }
  const nextState: WalletState = { ...state, wallet: nextWallet, ledger: [entry, ...state.ledger] }
  saveWalletState(userId, nextState)
  return nextState
}

/**
 * Seller payout split for a spend breakdown: the free-funded part becomes a
 * non-convertible earned payout, the paid part a convertible one. Used by the
 * live purchase RPC; kept here so the rule lives in one place.
 */
export function sellerPayoutFor(breakdown: { free: number; purchased: number; earned: number }) {
  const paidCredits = breakdown.purchased + breakdown.earned
  const freeCredits = breakdown.free
  const convertibleCredits = Math.floor(paidCredits * (1 - PLATFORM_COMMISSION))
  const nonConvertibleCredits = Math.floor(freeCredits * (1 - PLATFORM_COMMISSION))
  return {
    convertibleCredits,
    nonConvertibleCredits,
    convertibleEur: Math.round(convertibleCredits * CREDIT_EUR_VALUE * 100) / 100,
  }
}

function nowMs(): number {
  return new Date().getTime()
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tx-${crypto.randomUUID()}`
  }
  // Fallback for very old browsers: time + counter, collision-resistant enough
  // for a per-user local ledger.
  noiseCounter = (noiseCounter + 97) % 100000
  return `tx-${nowMs().toString(36)}-${noiseCounter.toString(36)}`
}

let noiseCounter = 0

export function formatTransactionRef(id: string): string {
  return `UD-${id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`
}

export function formatTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString()
  }
}
