import { supabase } from './supabaseClient'
import {
  LEGAL_CONSENT_DOCUMENT_TYPES,
  LEGAL_VERSION,
  type LegalConsentDocumentType,
} from '../legalContent'

export type LegalConsentRow = {
  id: string
  user_id: string
  document_type: string
  legal_version: string
  accepted_at: string
  locale: string
}

// L'accettazione espressa al signup viene parcheggiata qui finché non esiste
// una sessione autenticata (conferma email, redirect OAuth), poi registrata
// lato server in modo idempotente.
const PENDING_STORAGE_KEY = 'unimidoc:pending-legal-acceptance:v1'

type PendingAcceptance = {
  legalVersion: string
  locale: string
  documentTypes: LegalConsentDocumentType[]
}

function browserLocale(): string {
  if (typeof navigator === 'undefined') return 'it-IT'
  return (navigator.language || 'it-IT').slice(0, 20)
}

export function storePendingLegalAcceptance() {
  if (typeof window === 'undefined') return
  const pending: PendingAcceptance = {
    legalVersion: LEGAL_VERSION,
    locale: browserLocale(),
    documentTypes: [...LEGAL_CONSENT_DOCUMENT_TYPES],
  }
  try {
    window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Storage pieno o bloccato: l'utente vedrà il promemoria di accettazione.
  }
}

function readPendingLegalAcceptance(): PendingAcceptance | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingAcceptance
    if (!parsed?.legalVersion || !Array.isArray(parsed.documentTypes)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingLegalAcceptance() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // Ignora: al prossimo flush riproveremo.
  }
}

export async function recordLegalAcceptance(
  documentTypes: readonly LegalConsentDocumentType[] = LEGAL_CONSENT_DOCUMENT_TYPES,
  legalVersion: string = LEGAL_VERSION,
  locale: string = browserLocale(),
): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('record_legal_acceptance', {
    p_document_types: [...documentTypes],
    p_legal_version: legalVersion,
    p_locale: locale,
  })
  if (error) throw error
}

/**
 * Registra l'eventuale accettazione parcheggiata al signup. Va chiamata a
 * sessione attiva; è idempotente e in caso di errore lascia il pending in
 * storage per riprovare al login successivo.
 */
export async function flushPendingLegalAcceptance(): Promise<void> {
  const pending = readPendingLegalAcceptance()
  if (!pending || !supabase) return
  const documentTypes = pending.documentTypes.filter((type): type is LegalConsentDocumentType =>
    (LEGAL_CONSENT_DOCUMENT_TYPES as readonly string[]).includes(type),
  )
  if (documentTypes.length === 0) {
    clearPendingLegalAcceptance()
    return
  }
  await recordLegalAcceptance(documentTypes, pending.legalVersion, pending.locale)
  clearPendingLegalAcceptance()
}

/**
 * True se l'utente autenticato ha registrato l'accettazione della versione
 * corrente per tutti i documenti che la richiedono.
 */
export async function hasAcceptedCurrentLegalVersion(): Promise<boolean> {
  if (!supabase) return true
  const { data, error } = await supabase
    .from('legal_consents')
    .select('document_type')
    .eq('legal_version', LEGAL_VERSION)
    .in('document_type', [...LEGAL_CONSENT_DOCUMENT_TYPES])
  if (error) throw error
  const accepted = new Set((data ?? []).map((row) => row.document_type))
  return LEGAL_CONSENT_DOCUMENT_TYPES.every((type) => accepted.has(type))
}
