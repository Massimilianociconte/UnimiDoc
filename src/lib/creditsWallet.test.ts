import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialDocuments } from '../data'
import {
  addPurchasedCredits,
  ensureWallet,
  loadWalletState,
  purchaseWithWallet,
  sellerPayoutFor,
  type WalletState,
} from './creditsWallet'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()

describe('credit wallet economic buckets', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('window', { localStorage: storage })
  })

  it('keeps top-up bonuses outside the cash-backed purchased bucket', () => {
    ensureWallet('buyer')
    const toppedUp = addPurchasedCredits('buyer', 100, 10, 5)

    expect(toppedUp.wallet).toMatchObject({ free: 30, promotional: 5, purchased: 100 })
    expect(toppedUp.ledger[0]).toMatchObject({ amount: 105, eurValue: 10 })
  })

  it('spends promotional units before purchased units on a non-free document', () => {
    ensureWallet('buyer')
    addPurchasedCredits('buyer', 100, 10, 5)

    const result = purchaseWithWallet('buyer', initialDocuments[0], 35)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.wallet).toMatchObject({ free: 30, promotional: 0, purchased: 70 })
    expect(result.entry.breakdown).toMatchObject({ promotional: 5, purchased: 30 })
  })

  it('uses non-convertible earnings before reducing the withdrawable balance', () => {
    const state: WalletState = {
      wallet: { free: 0, promotional: 0, purchased: 0, earned: 40, earnedConvertible: 15 },
      ledger: [],
      purchases: [],
      initialized: true,
    }
    storage.setItem('unimidoc:wallet:v1:seller', JSON.stringify(state))

    const result = purchaseWithWallet('seller', initialDocuments[0], 30)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.wallet).toMatchObject({ earned: 10, earnedConvertible: 10 })
    expect(result.entry.breakdown).toMatchObject({ earnedNonConvertible: 25, earnedConvertible: 5 })
    expect(sellerPayoutFor(result.entry.breakdown!)).toMatchObject({
      convertibleCredits: 3,
      nonConvertibleCredits: 17,
    })
  })

  it('loads legacy wallets with a zero promotional bucket', () => {
    storage.setItem('unimidoc:wallet:v1:legacy', JSON.stringify({
      wallet: { free: 3, purchased: 7, earned: 2, earnedConvertible: 1 },
      ledger: [],
      purchases: [],
      initialized: true,
    }))

    expect(loadWalletState('legacy').wallet.promotional).toBe(0)
  })
})
