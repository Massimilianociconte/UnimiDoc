import { describe, it, expect, vi } from 'vitest'

// pdfjs-dist touches DOMMatrix (canvas) at import time, which isn't present in
// the Node test runtime. The flashcard generator is pure text logic and never
// calls pdf.js, so stub the heavy imports to keep the engine unit-testable.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve({}) }) }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { generateFlashcards, scoreFigureAreas, refreshAnalysisDerivedFields, type DocSentence, type PdfAnalysis } from './pdfProcessing'

function analysisFrom(lines: string[], language: 'it' | 'en' = 'en'): PdfAnalysis {
  const sentences: DocSentence[] = lines.map((text, index) => ({ index, page: 1, text, section: null, kind: 'sentence' }))
  const text = lines.join(' ')
  return {
    pageCount: 1,
    pages: [{ page: 1, chars: text.length, needsOcr: false }],
    ocrPages: [],
    text,
    textChars: text.replace(/\s+/g, '').length,
    sentences,
    language,
  }
}

const LINES = [
  'The diaphragm separates the abdominal cavity from the thoracic cavity.',
  'Arteries are the vessels which transport the blood from the heart to the body.',
  'Mitosis: the process of cell division producing two identical daughter cells.',
  'The heart is localized in the inner cavity of the thorax in a region called mediastinum.',
  'Copyright 2024 University of Milan, all rights reserved.',
  'Page 12 of 87',
]

describe('generateFlashcards (deterministic engine)', () => {
  it('produces non-trivial, deduplicated cards each anchored to a source', () => {
    const cards = generateFlashcards(analysisFrom(LINES), { max: 10, premium: false })
    expect(cards.length).toBeGreaterThan(0)

    for (const card of cards) {
      expect(card.front.length).toBeGreaterThan(6)
      expect(card.back.length).toBeGreaterThan(2)
      expect(card.ref?.page).toBe(1)
      // front and back must not be identical (banal card)
      expect(card.front.toLowerCase().replace(/[?.!]/g, '')).not.toBe(card.back.toLowerCase().replace(/[?.!]/g, ''))
    }

    const fronts = cards.map((card) => card.front.toLowerCase())
    expect(new Set(fronts).size).toBe(fronts.length) // no duplicate questions
  })

  it('excludes copyright / footer noise', () => {
    const cards = generateFlashcards(analysisFrom(LINES), { max: 10, premium: false })
    expect(cards.some((card) => /copyright|page 12|all rights reserved/i.test(`${card.front} ${card.back}`))).toBe(false)
  })

  it('builds a passive→active "What separates …?" card from the diaphragm sentence', () => {
    const cards = generateFlashcards(analysisFrom(LINES), { max: 10, premium: false })
    expect(cards.some((card) => /what separates/i.test(card.front))).toBe(true)
  })

  it('premium mode can yield at least as many cards as free', () => {
    const free = generateFlashcards(analysisFrom(LINES), { max: 10, premium: false })
    const premium = generateFlashcards(analysisFrom(LINES), { max: 24, premium: true })
    expect(premium.length).toBeGreaterThanOrEqual(free.length)
  })
})

describe('PDF visual scoring', () => {
  it('does not treat tiny decorative images as study figures', () => {
    const score = scoreFigureAreas([0.003, 0.012, -0.02], { textChars: 1500 })
    expect(score.imageCount).toBe(3)
    expect(score.figureCount).toBe(0)
    expect(score.figureScore).toBe(0)
  })

  it('detects large raster figures and vector-only diagrams', () => {
    const raster = scoreFigureAreas([0.18], { textChars: 250 })
    expect(raster.figureCount).toBe(1)
    expect(raster.figureScore).toBeGreaterThan(0.4)

    const vector = scoreFigureAreas([], { vectorOpCount: 80, textChars: 300 })
    expect(vector.figureCount).toBe(1)
    expect(vector.figureScore).toBeGreaterThan(0.5)
  })

  it('rebuilds outline and review when OCR text is merged into an analysis', () => {
    const analysis = analysisFrom([
      'Genetica molecolare',
      'Il DNA codifica informazioni ereditarie e contiene sequenze regolative che controllano trascrizione, replicazione e risposta cellulare.',
      'La duplicazione del DNA avviene in modo semiconservativo e richiede enzimi specifici, primer, nucleotidi e controllo della fedelta.',
      'Le mutazioni possono modificare la sequenza nucleotidica e produrre effetti diversi sulla proteina o sulla regolazione genica.',
    ], 'it')
    const refreshed = refreshAnalysisDerivedFields({
      ...analysis,
      pages: [{ page: 1, chars: analysis.text.length, needsOcr: false }],
      outline: [],
      review: undefined,
    })
    expect(refreshed.outline?.length).toBeGreaterThan(0)
    expect(refreshed.review?.textQuality).not.toBe('poor')
    expect(refreshed.ocrPages).toEqual([])
  })
})
