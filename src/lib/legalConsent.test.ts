import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// I test unitari non devono raggiungere il backend reale: qui interessa solo
// la logica di parcheggio locale dell'accettazione.
vi.mock('./supabaseClient', () => ({ supabase: null, isSupabaseConfigured: false }))

import {
  clearPendingLegalAcceptance,
  flushPendingLegalAcceptance,
  storePendingLegalAcceptance,
} from './legalConsent'
import { LEGAL_VERSION } from '../legalContent'

function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    _dump: () => Object.fromEntries(store),
  }
}

describe('legalConsent pending storage', () => {
  let localStorageStub: ReturnType<typeof makeLocalStorage>

  beforeEach(() => {
    localStorageStub = makeLocalStorage()
    vi.stubGlobal('window', { localStorage: localStorageStub })
    vi.stubGlobal('navigator', { language: 'it-IT' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parcheggia versione, lingua e documenti richiesti', () => {
    storePendingLegalAcceptance()
    const raw = localStorageStub.getItem('unimidoc:pending-legal-acceptance:v1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(String(raw))
    expect(parsed.legalVersion).toBe(LEGAL_VERSION)
    expect(parsed.locale).toBe('it-IT')
    expect(parsed.documentTypes).toContain('terms')
    expect(parsed.documentTypes).toContain('privacy')
  })

  it('clear rimuove il pending', () => {
    storePendingLegalAcceptance()
    clearPendingLegalAcceptance()
    expect(localStorageStub.getItem('unimidoc:pending-legal-acceptance:v1')).toBeNull()
  })

  it('flush senza Supabase configurato non tocca il pending', async () => {
    // In ambiente di test supabase è null: il flush deve restare inerte e
    // conservare il pending per una sessione reale.
    storePendingLegalAcceptance()
    await flushPendingLegalAcceptance()
    expect(localStorageStub.getItem('unimidoc:pending-legal-acceptance:v1')).toBeTruthy()
  })
})
