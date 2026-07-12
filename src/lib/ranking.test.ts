import { describe, expect, it } from 'vitest'
import type { DocumentItem } from '../data'
import {
  academicYearFactor,
  bayesianAverage,
  buildAuthorScores,
  buildDocumentRankings,
  metadataCompleteness,
  scoreDocument,
  sortByRanking,
} from './ranking'

const NOW = new Date('2026-07-12T12:00:00Z')

function makeDoc(overrides: Partial<DocumentItem>): DocumentItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Dispensa di prova',
    subject: 'Genetica',
    professor: 'Maria Rossi',
    academicYear: '2025/2026',
    type: 'Appunti delle lezioni',
    examType: 'Scritto',
    pages: 40,
    sizeMb: 2,
    quality: 8,
    flashcardQualityPercent: 80,
    flashcardQualityVotes: 12,
    credits: 30,
    downloads: 25,
    description: 'Una descrizione sufficientemente lunga da superare la soglia di completezza dei metadati richiesta.',
    status: 'approved',
    verified: true,
    premium: false,
    uploader: 'Autore Demo',
    uploaderTrust: 80,
    fileHash: 'hash',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: '01/07/2026',
    language: 'Italiano',
    previewKind: 'notes',
    semester: '1 semestre',
    degreeCourse: 'Scienze Biologiche L-13',
    tags: ['genetica', 'esame', 'riassunto'],
    ...overrides,
  }
}

describe('bayesianAverage', () => {
  it('con zero campioni restituisce esattamente il prior', () => {
    expect(bayesianAverage(5, 0, 3.8, 5)).toBe(3.8)
  })

  it('pochi voti vengono attratti verso il prior, molti voti verso la media', () => {
    const few = bayesianAverage(5, 2, 3.8, 5)
    const many = bayesianAverage(5, 200, 3.8, 5)
    expect(few).toBeLessThan(many)
    expect(few).toBeGreaterThan(3.8)
    expect(many).toBeGreaterThan(4.9)
  })
})

describe('scoreDocument', () => {
  it('un documento nuovo con pochi dati non supera uno consolidato di pari qualità', () => {
    const established = makeDoc({ quality: 9, flashcardQualityVotes: 40, downloads: 60 })
    const newcomer = makeDoc({ quality: 10, flashcardQualityVotes: 1, downloads: 1 })
    expect(scoreDocument(established, NOW).overall).toBeGreaterThan(scoreDocument(newcomer, NOW).overall)
  })

  it('le segnalazioni erodono la soddisfazione', () => {
    const clean = makeDoc({})
    const reported = makeDoc({ reportCount: 3 })
    expect(scoreDocument(reported, NOW).satisfaction).toBeLessThan(scoreDocument(clean, NOW).satisfaction)
  })

  it('materiale vecchio pesa meno di materiale aggiornato', () => {
    const fresh = makeDoc({ academicYear: '2025/2026' })
    const stale = makeDoc({ academicYear: '2021/2022' })
    expect(scoreDocument(fresh, NOW).overall).toBeGreaterThan(scoreDocument(stale, NOW).overall)
  })

  it('il volume di vendite da solo non domina la qualità', () => {
    const qualitative = makeDoc({ quality: 9.5, flashcardQualityPercent: 92, flashcardQualityVotes: 30, downloads: 15 })
    const bestseller = makeDoc({ quality: 5, flashcardQualityPercent: 45, flashcardQualityVotes: 30, downloads: 400 })
    expect(scoreDocument(qualitative, NOW).overall).toBeGreaterThan(scoreDocument(bestseller, NOW).overall)
  })
})

describe('academicYearFactor', () => {
  it('decade in modo monotono con anni più vecchi, con pavimento', () => {
    const y2025 = academicYearFactor('2025/2026', NOW)
    const y2023 = academicYearFactor('2023/2024', NOW)
    const y2015 = academicYearFactor('2015/2016', NOW)
    expect(y2025).toBeGreaterThan(y2023)
    expect(y2023).toBeGreaterThan(y2015)
    expect(y2015).toBe(0.55)
  })
})

describe('metadataCompleteness', () => {
  it('metadati completi valgono 1, spogli molto meno', () => {
    expect(metadataCompleteness(makeDoc({}))).toBe(1)
    const bare = makeDoc({
      description: 'corta',
      tags: [],
      professor: 'Docente non indicato',
      academicYear: 'Non specificato',
      examType: 'Non specificato',
      semester: undefined,
      degreeCourse: undefined,
      pages: 0,
    })
    expect(metadataCompleteness(bare)).toBe(0)
  })
})

describe('buildDocumentRankings', () => {
  it('produce classifiche distinte per materia, docente e corso', () => {
    const docs = [
      makeDoc({ subject: 'Genetica', professor: 'Rossi' }),
      makeDoc({ subject: 'Fisiologia', professor: 'Bianchi', degreeCourse: 'Fisica L-30' }),
    ]
    const rankings = buildDocumentRankings(docs, 5, NOW)
    expect(rankings.bySubject.get('Genetica')).toHaveLength(1)
    expect(rankings.byProfessor.get('Bianchi')).toHaveLength(1)
    expect(rankings.byDegree.get('Fisica L-30')).toHaveLength(1)
    expect(rankings.overall.length).toBe(2)
  })
})

describe('buildAuthorScores', () => {
  it('pochi documenti eccellenti battono molti documenti mediocri', () => {
    const good = Array.from({ length: 3 }, (_, index) =>
      makeDoc({ uploader: 'Pochi Ottimi', id: `g${index}`, quality: 9.4, flashcardQualityPercent: 90, flashcardQualityVotes: 25 }),
    )
    const spam = Array.from({ length: 12 }, (_, index) =>
      makeDoc({ uploader: 'Tanti Scarsi', id: `s${index}`, quality: 4.5, flashcardQualityPercent: 40, flashcardQualityVotes: 8, description: 'corta', tags: [] }),
    )
    const scores = buildAuthorScores([...good, ...spam], NOW)
    const fewGreat = scores.find((author) => author.name === 'Pochi Ottimi')!
    const manyPoor = scores.find((author) => author.name === 'Tanti Scarsi')!
    expect(fewGreat.reliability).toBeGreaterThan(manyPoor.reliability)
  })

  it('la costanza penalizza chi alterna qualità alta e bassa', () => {
    const steady = [
      makeDoc({ uploader: 'Costante', id: 'c1', quality: 7.5 }),
      makeDoc({ uploader: 'Costante', id: 'c2', quality: 7.5 }),
      makeDoc({ uploader: 'Costante', id: 'c3', quality: 7.5 }),
    ]
    const erratic = [
      makeDoc({ uploader: 'Altalenante', id: 'e1', quality: 9.8, flashcardQualityPercent: 95 }),
      makeDoc({ uploader: 'Altalenante', id: 'e2', quality: 3, flashcardQualityPercent: 30, description: 'corta', tags: [] }),
      makeDoc({ uploader: 'Altalenante', id: 'e3', quality: 9.5, flashcardQualityPercent: 90 }),
    ]
    const scores = buildAuthorScores([...steady, ...erratic], NOW)
    const steadyScore = scores.find((author) => author.name === 'Costante')!
    const erraticScore = scores.find((author) => author.name === 'Altalenante')!
    expect(steadyScore.consistency).toBeGreaterThan(erraticScore.consistency)
  })
})

describe('sortByRanking', () => {
  it('ordina per punteggio complessivo decrescente', () => {
    const low = makeDoc({ id: 'low', quality: 3, flashcardQualityPercent: 35, description: 'corta', tags: [] })
    const high = makeDoc({ id: 'high', quality: 9.5, flashcardQualityPercent: 92 })
    expect(sortByRanking([low, high], NOW).map((doc) => doc.id)).toEqual(['high', 'low'])
  })
})
