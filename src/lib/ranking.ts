import type { DocumentItem } from '../data'

// ---------------------------------------------------------------------------
// Ranking multi-segnale di documenti e autori — replica client delle formule
// autoritative in Postgres (migration document_reviews_and_ranking_20260712,
// viste public_document_rankings / public_author_rankings). Usata per il
// catalogo demo e come fallback quando i punteggi server non sono disponibili.
//
// Principi condivisi con il DB:
//  * nessun punteggio basato su un solo contatore (vendite/visualizzazioni);
//  * medie bayesiane con soglia minima di campioni: pochi voti vengono
//    attratti verso il prior e non scavalcano contenuti consolidati;
//  * correttivi temporali (decay su anno accademico, finestra recente);
//  * il volume entra solo come confidenza o con rendimento decrescente.
// ---------------------------------------------------------------------------

/** Soglie bayesiane: sotto questi campioni il prior domina. */
export const RATING_MIN_SAMPLES = 5
export const FLASHCARD_MIN_REVIEWERS = 3
export const AUTHOR_MIN_DOCS = 3

/** Prior neutri usati quando il catalogo non ha ancora abbastanza dati. */
const PRIOR_RATING = 3.8 // su scala 1..5
const PRIOR_FLASHCARD = 70 // percentuale voti positivi
const PRIOR_AUTHOR_SCORE = 55 // punteggio documento medio

export type DocumentScore = {
  documentId: string
  /** 0..1 — recensioni (bayes su rating 1-5). */
  rating: number
  /** 0..1 — qualità didattica percepita delle flashcard (bayes). */
  flashcard: number
  /** 0..1 — qualità del PDF stimata dalla pipeline (leggibilità/OCR). */
  aiQuality: number
  /** 0..1 — completezza e accuratezza dei metadati. */
  completeness: number
  /** 0..1 — acquisti attivi vs rimborsi e segnalazioni (Laplace). */
  satisfaction: number
  /** 0..1 — aggiornamento (decay su anno accademico). */
  freshness: number
  /** 0..100 — punteggio complessivo. */
  overall: number
  /** 0..100 — apprezzamento nel periodo recente (trend con gate qualità). */
  recent: number
  /** 0..100 — qualità didattica (flashcard + struttura). */
  didactic: number
  sampleSize: number
}

export function bayesianAverage(average: number, count: number, prior: number, minSamples: number): number {
  return (average * count + prior * minSamples) / (count + minSamples)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Anno di inizio dell'anno accademico corrente (settembre → agosto). */
function currentAcademicStartYear(now = new Date()): number {
  return now.getFullYear() - (now.getMonth() + 1 >= 9 ? 0 : 1)
}

/** Fattore 0.55..1 dall'anno accademico dichiarato ('2025/2026', '2023/24'…). */
export function academicYearFactor(academicYear: string | undefined, now = new Date()): number {
  const match = /^(\d{4})/.exec(academicYear ?? '')
  // anno mancante: penalità media, come un materiale di ~2 anni fa
  const startYear = match ? Number(match[1]) : currentAcademicStartYear(now) - 2
  const age = Math.max(0, currentAcademicStartYear(now) - startYear)
  return Math.max(0.55, 1 - 0.15 * age)
}

/** Checklist deterministica di completezza dei metadati (0..1). */
export function metadataCompleteness(doc: DocumentItem): number {
  let score = 0
  if ((doc.description ?? '').length >= 80) score += 0.2
  if ((doc.tags?.length ?? 0) >= 3) score += 0.15
  if (doc.professor && doc.professor !== 'Docente non indicato') score += 0.15
  if (/^\d{4}/.test(doc.academicYear ?? '')) score += 0.1
  if (doc.examType && doc.examType !== 'Non specificato') score += 0.1
  if (doc.semester) score += 0.1
  if (doc.degreeCourse) score += 0.1
  if ((doc.pages ?? 0) > 0) score += 0.1
  return Math.round(score * 1000) / 1000
}

type DemoSignals = {
  ratingAvg: number
  ratingCount: number
  fqPercent: number | null
  fqReviewers: number
  purchasesActive: number
  purchasesRefunded: number
  recentSignals: number
  reportsNegative: number
  aiQuality: number | null
}

// Il catalogo demo non ha recensioni/acquisti reali: deriva segnali dichiarati
// dai campi disponibili. Il path live usa i valori veri dal DB
// (public_document_rankings) e ignora questi proxy.
function demoSignals(doc: DocumentItem): DemoSignals {
  const ratingCount = doc.flashcardQualityVotes ?? Math.round(doc.downloads * 0.12)
  return {
    ratingAvg: clamp01(doc.quality / 10) * 4 + 1, // 0..10 → 1..5
    ratingCount,
    fqPercent: doc.flashcardQualityPercent ?? null,
    fqReviewers: doc.flashcardQualityVotes ?? 0,
    purchasesActive: doc.downloads,
    purchasesRefunded: 0,
    recentSignals: Math.min(doc.downloads, 8),
    reportsNegative: doc.reportCount,
    aiQuality: doc.insights ? 0.72 : null,
  }
}

export function scoreDocument(doc: DocumentItem, now = new Date()): DocumentScore {
  const s = demoSignals(doc)

  const rating = clamp01(
    (bayesianAverage(s.ratingAvg, s.ratingCount, PRIOR_RATING, RATING_MIN_SAMPLES) - 1) / 4,
  )
  const flashcard = clamp01(
    bayesianAverage(s.fqPercent ?? PRIOR_FLASHCARD, s.fqReviewers, PRIOR_FLASHCARD, FLASHCARD_MIN_REVIEWERS) / 100,
  )
  const aiQuality = s.aiQuality ?? 0.55
  const completeness = metadataCompleteness(doc)
  const satisfaction = clamp01(
    (s.purchasesActive + 4) / (s.purchasesActive + s.purchasesRefunded + 2 * s.reportsNegative + 5),
  )
  const freshness = clamp01(academicYearFactor(doc.academicYear, now))

  const overall =
    100 *
    (0.26 * rating +
      0.2 * flashcard +
      0.14 * aiQuality +
      0.14 * completeness +
      0.12 * satisfaction +
      0.14 * freshness)

  // trend: log-saturazione dei segnali recenti, mai lineare; gate sulla qualità
  const recentSignal = Math.min(1, Math.log(1 + s.recentSignals) / Math.log(21))
  const recent = 0.62 * overall + 0.38 * 100 * recentSignal * (0.5 + 0.5 * rating)

  const didactic = 100 * (0.6 * flashcard + 0.25 * aiQuality + 0.15 * (doc.insights ? 1 : 0))

  return {
    documentId: doc.id,
    rating,
    flashcard,
    aiQuality,
    completeness,
    satisfaction,
    freshness,
    // I punteggi calcolati dal DB (segnali reali: recensioni, acquisti,
    // rimborsi, segnalazioni) sono autoritativi e sostituiscono i proxy demo.
    overall: doc.serverRanking?.overall ?? Math.round(overall * 100) / 100,
    recent: doc.serverRanking?.recent ?? Math.round(recent * 100) / 100,
    didactic: doc.serverRanking?.didactic ?? Math.round(didactic * 100) / 100,
    sampleSize: s.ratingCount + s.fqReviewers + s.purchasesActive,
  }
}

export type RankedDocument = { document: DocumentItem; score: DocumentScore }

function ranked(documents: DocumentItem[], now = new Date()): RankedDocument[] {
  return documents.map((document) => ({ document, score: scoreDocument(document, now) }))
}

function topBy(items: RankedDocument[], key: 'overall' | 'recent' | 'didactic', limit: number): RankedDocument[] {
  return [...items].sort((a, b) => b.score[key] - a.score[key]).slice(0, limit)
}

function groupTop(
  items: RankedDocument[],
  keyOf: (doc: DocumentItem) => string | undefined,
  limit: number,
): Map<string, RankedDocument[]> {
  const groups = new Map<string, RankedDocument[]>()
  for (const item of items) {
    const key = keyOf(item.document)?.trim()
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  for (const [key, list] of groups) {
    groups.set(key, topBy(list, 'overall', limit))
  }
  return groups
}

export type DocumentRankings = {
  /** Migliori materiali complessivi. */
  overall: RankedDocument[]
  /** Materiali più apprezzati nel periodo recente. */
  recent: RankedDocument[]
  /** Migliore qualità didattica. */
  didactic: RankedDocument[]
  /** Migliori dispense per materia. */
  bySubject: Map<string, RankedDocument[]>
  /** Migliori materiali per docente. */
  byProfessor: Map<string, RankedDocument[]>
  /** Migliori contenuti per corso di laurea. */
  byDegree: Map<string, RankedDocument[]>
}

export function buildDocumentRankings(documents: DocumentItem[], limit = 10, now = new Date()): DocumentRankings {
  const items = ranked(documents, now)
  return {
    overall: topBy(items, 'overall', limit),
    recent: topBy(items, 'recent', limit),
    didactic: topBy(items, 'didactic', limit),
    bySubject: groupTop(items, (doc) => doc.subject, limit),
    byProfessor: groupTop(items, (doc) => doc.professor, limit),
    byDegree: groupTop(items, (doc) => doc.degreeCourse, limit),
  }
}

/** Ordina i documenti visibili per punteggio complessivo (listing/esplora). */
export function sortByRanking(documents: DocumentItem[], now = new Date()): DocumentItem[] {
  return ranked(documents, now)
    .sort((a, b) => b.score.overall - a.score.overall)
    .map((item) => item.document)
}

export type AuthorScore = {
  id: string
  name: string
  sellerId?: string
  documents: number
  avgDocScore: number
  /** Punteggio bayesiano: pochi documenti → attratto verso il prior. */
  authorBayes: number
  /** 0..1 — costanza qualitativa (deviazione standard penalizzata). */
  consistency: number
  /** 0..1 — quota (smussata) di acquirenti che ricomprano dall'autore. */
  repeatRate: number
  /** 0..1 — rimborsi e segnalazioni erodono la fiducia. */
  trustRate: number
  /** 0..1 — qualità didattica media delle flashcard. */
  flashcard: number
  /** 0..100 — affidabilità complessiva. */
  reliability: number
  /** 0..100 — punteggio "emergente" (novità che decade in ~90 giorni). */
  emerging: number
  isEmerging: boolean
  totalDownloads: number
  avgRating: number
}

export function buildAuthorScores(documents: DocumentItem[], now = new Date()): AuthorScore[] {
  const byAuthor = new Map<string, { name: string; sellerId?: string; docs: RankedDocument[] }>()
  for (const item of ranked(documents.filter((doc) => doc.sellerPublic !== false), now)) {
    const id = item.document.sellerId ?? `name:${item.document.uploader}`
    const group = byAuthor.get(id) ?? { name: item.document.uploader, sellerId: item.document.sellerId, docs: [] }
    group.docs.push(item)
    byAuthor.set(id, group)
  }

  const allScores = [...byAuthor.values()].map(
    (group) => group.docs.reduce((total, item) => total + item.score.overall, 0) / group.docs.length,
  )
  const priorAuthor = allScores.length
    ? allScores.reduce((total, value) => total + value, 0) / allScores.length
    : PRIOR_AUTHOR_SCORE

  return [...byAuthor.entries()]
    .map(([id, group]) => {
      const docs = group.docs
      const scores = docs.map((item) => item.score.overall)
      const avgDocScore = scores.reduce((total, value) => total + value, 0) / scores.length
      const variance = scores.reduce((total, value) => total + (value - avgDocScore) ** 2, 0) / scores.length
      const stddev = Math.sqrt(variance)
      // rapporto quantità/qualità: la media bayesiana premia la qualità media,
      // non il numero di upload (K = AUTHOR_MIN_DOCS documenti di soglia)
      const authorBayes = bayesianAverage(avgDocScore, docs.length, priorAuthor, AUTHOR_MIN_DOCS)
      const consistency = Math.max(0, 1 - stddev / 25)

      const purchases = docs.reduce((total, item) => total + item.document.downloads, 0)
      const reports = docs.reduce((total, item) => total + item.document.reportCount, 0)
      // demo: nessun dato reale su acquirenti ricorrenti → prior neutro di
      // Laplace (1/5); il path live usa repeat_rate da public_author_rankings
      const repeatRate = 1 / 5
      const trustRate = 1 - Math.min(1, (reports * 2) / Math.max(purchases, 5))
      const flashcard = docs.reduce((total, item) => total + item.score.flashcard, 0) / docs.length

      const reliability =
        0.45 * authorBayes + 100 * (0.15 * consistency + 0.15 * repeatRate + 0.15 * trustRate + 0.1 * flashcard)

      // demo: senza data di prima pubblicazione, "emergente" = pochi materiali
      // ma segnali di qualità sopra il prior
      const isEmerging = docs.length <= 2 && avgDocScore >= priorAuthor
      const emerging = reliability * (isEmerging ? 1 : 0.55)

      const avgRating = docs.reduce((total, item) => total + item.score.rating, 0) / docs.length

      return {
        id,
        name: group.name,
        sellerId: group.sellerId,
        documents: docs.length,
        avgDocScore: Math.round(avgDocScore * 100) / 100,
        authorBayes: Math.round(authorBayes * 100) / 100,
        consistency: Math.round(consistency * 1000) / 1000,
        repeatRate,
        trustRate: Math.round(trustRate * 1000) / 1000,
        flashcard: Math.round(flashcard * 1000) / 1000,
        reliability: Math.round(reliability * 100) / 100,
        emerging: Math.round(emerging * 100) / 100,
        isEmerging,
        totalDownloads: purchases,
        avgRating: Math.round((1 + avgRating * 4) * 10) / 10,
      }
    })
    .sort((a, b) => b.reliability - a.reliability)
}

export function emergingAuthors(documents: DocumentItem[], limit = 5, now = new Date()): AuthorScore[] {
  return buildAuthorScores(documents, now)
    .filter((author) => author.isEmerging)
    .sort((a, b) => b.emerging - a.emerging)
    .slice(0, limit)
}
