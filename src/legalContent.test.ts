import { describe, expect, it } from 'vitest'
import {
  LEGAL_CONSENT_DOCUMENT_TYPES,
  LEGAL_VERSION,
  legalDocumentForRoute,
  legalDocuments,
  type LegalRoute,
} from './legalContent'

const EXPECTED_ROUTES: LegalRoute[] = [
  'privacy',
  'terms',
  'cookies',
  'sales',
  'refunds',
  'authors',
  'content',
  'ai',
  'copyright',
]

describe('legalContent', () => {
  it('espone tutti i documenti richiesti', () => {
    expect(Object.keys(legalDocuments).sort()).toEqual([...EXPECTED_ROUTES].sort())
  })

  it('ogni documento è coerente e non vuoto', () => {
    for (const route of EXPECTED_ROUTES) {
      const doc = legalDocumentForRoute(route)
      expect(doc.route).toBe(route)
      expect(doc.title.length).toBeGreaterThan(3)
      expect(doc.description.length).toBeGreaterThan(10)
      expect(doc.sections.length).toBeGreaterThan(0)
      for (const section of doc.sections) {
        expect(section.title.length).toBeGreaterThan(2)
        const paragraphs = section.paragraphs ?? []
        const items = section.items ?? []
        expect(paragraphs.length + items.length).toBeGreaterThan(0)
        for (const text of [...paragraphs, ...items]) {
          expect(text.trim().length).toBeGreaterThan(10)
        }
      }
    }
  })

  it('la versione legale è una data ISO usata dal log dei consensi', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('i documenti che richiedono consenso esplicito esistono', () => {
    for (const type of LEGAL_CONSENT_DOCUMENT_TYPES) {
      expect(EXPECTED_ROUTES).toContain(type)
    }
    // Termini e privacy sono il minimo per la registrazione.
    expect(LEGAL_CONSENT_DOCUMENT_TYPES).toContain('terms')
    expect(LEGAL_CONSENT_DOCUMENT_TYPES).toContain('privacy')
  })
})
