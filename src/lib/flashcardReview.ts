import type { DocSentence, Flashcard } from './pdfProcessing'
import { supabase } from './supabaseClient'
import { isPersistedFlashcardId, type FlashcardStudyRecord } from './flashcardProgress'

// Motore di ripasso mirato: raggruppa le flashcard "da chiudere" per materia →
// capitolo → argomento, seleziona il mazzo di ripasso ordinato per urgenza e,
// quando esistono embedding (pgvector), espande il capitolo con le card
// semanticamente vicine tramite la RPC match_review_flashcards. Tutto lato
// client lavora sui FlashcardStudyRecord già caricati; il pgvector aggiunge
// solo recall extra ed è completamente opzionale.

export type ReviewScopeKind = 'all' | 'subject' | 'document' | 'chapter' | 'topic'

export type ReviewScope = {
  kind: ReviewScopeKind
  label: string
  subject?: string
  documentTitle?: string
  documentId?: string | null
  chapter?: string
  topic?: string
}

export type ChapterReviewGroup = {
  id: string
  subject: string
  documentTitle: string
  documentId: string | null
  chapter: string
  /** Argomenti distinti dentro il capitolo, dal più problematico. */
  topics: string[]
  total: number
  incorrect: number
  due: number
  unanswered: number
  accuracy: number | null
  /** Priorità di ripasso: errori pesano più dei semplici "in scadenza". */
  urgency: number
}

export type SubjectReviewSummary = {
  subject: string
  total: number
  incorrect: number
  due: number
  chapters: number
  accuracy: number | null
}

/** Una card è "da chiudere" se sbagliata, parziale, saltata o in scadenza SRS. */
export function isReviewable(record: FlashcardStudyRecord): boolean {
  return (
    record.needsReview ||
    record.latestStatus === 'incorrect' ||
    record.latestStatus === 'partial' ||
    record.latestStatus === 'skipped'
  )
}

function accuracyOf(records: FlashcardStudyRecord[]): number | null {
  const correct = records.reduce((sum, record) => sum + record.correct, 0)
  const graded = records.reduce((sum, record) => sum + record.correct + record.incorrect + record.partial, 0)
  return graded ? Math.round((correct / graded) * 100) : null
}

/** Raggruppa gli errori per materia → documento → capitolo (più ricco del
 *  vecchio errorGroups piatto: elenca gli argomenti e calcola un'urgenza). */
export function buildChapterReviewGroups(records: FlashcardStudyRecord[]): ChapterReviewGroup[] {
  const buckets = new Map<string, FlashcardStudyRecord[]>()
  for (const record of records) {
    if (!isReviewable(record)) continue
    const key = `${record.subject}|||${record.documentTitle}|||${record.chapter}`
    buckets.set(key, [...(buckets.get(key) ?? []), record])
  }
  return [...buckets.entries()]
    .map(([id, rows]) => {
      const incorrect = rows.filter((row) => row.latestStatus === 'incorrect').length
      const due = rows.filter((row) => row.needsReview).length
      const unanswered = rows.filter((row) => row.latestStatus === 'unanswered').length
      const topicCounts = new Map<string, number>()
      for (const row of rows) {
        const problematic = row.latestStatus === 'incorrect' || row.needsReview ? 2 : 1
        topicCounts.set(row.topic, (topicCounts.get(row.topic) ?? 0) + problematic)
      }
      const topics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topic)
      return {
        id,
        subject: rows[0].subject,
        documentTitle: rows[0].documentTitle,
        documentId: rows[0].documentId,
        chapter: rows[0].chapter,
        topics,
        total: rows.length,
        incorrect,
        due,
        unanswered,
        accuracy: accuracyOf(rows),
        urgency: incorrect * 3 + due * 2 + unanswered,
      }
    })
    .sort((a, b) => b.urgency - a.urgency)
}

/** Riepilogo per materia, per la testata del centro ripasso. */
export function buildSubjectReviewSummaries(records: FlashcardStudyRecord[]): SubjectReviewSummary[] {
  const bySubject = new Map<string, FlashcardStudyRecord[]>()
  for (const record of records) {
    if (!isReviewable(record)) continue
    bySubject.set(record.subject, [...(bySubject.get(record.subject) ?? []), record])
  }
  return [...bySubject.entries()]
    .map(([subject, rows]) => ({
      subject,
      total: rows.length,
      incorrect: rows.filter((row) => row.latestStatus === 'incorrect').length,
      due: rows.filter((row) => row.needsReview).length,
      chapters: new Set(rows.map((row) => row.chapter)).size,
      accuracy: accuracyOf(rows),
    }))
    .sort((a, b) => b.incorrect + b.due - (a.incorrect + a.due))
}

function matchesScope(record: FlashcardStudyRecord, scope: ReviewScope): boolean {
  if (scope.subject && record.subject !== scope.subject) return false
  if (scope.documentId && record.documentId !== scope.documentId) return false
  if (scope.documentTitle && record.documentTitle !== scope.documentTitle) return false
  if (scope.chapter && record.chapter !== scope.chapter) return false
  if (scope.topic && record.topic !== scope.topic) return false
  return true
}

// Ordine di ripasso: prima gli errori, poi le card in scadenza (per data SRS),
// poi parziali/saltate, infine le non ancora affrontate.
function reviewPriority(record: FlashcardStudyRecord): number {
  if (record.latestStatus === 'incorrect') return 0
  if (record.needsReview) return 1
  if (record.latestStatus === 'partial' || record.latestStatus === 'skipped') return 2
  if (record.latestStatus === 'unanswered') return 4
  return 3
}

export function selectReviewRecords(
  records: FlashcardStudyRecord[],
  scope: ReviewScope,
  limit = 40,
): FlashcardStudyRecord[] {
  const inScope = records.filter((record) => matchesScope(record, scope) && isReviewable(record))
  const pool = inScope.length ? inScope : records.filter((record) => matchesScope(record, scope))
  return [...pool]
    .sort((a, b) => {
      const priority = reviewPriority(a) - reviewPriority(b)
      if (priority !== 0) return priority
      const aDue = a.nextDueAt ? Date.parse(a.nextDueAt) : Number.POSITIVE_INFINITY
      const bDue = b.nextDueAt ? Date.parse(b.nextDueAt) : Number.POSITIVE_INFINITY
      if (aDue !== bDue) return aDue - bDue
      return (b.incorrect - b.correct) - (a.incorrect - a.correct)
    })
    .slice(0, limit)
}

export type StudyDeck = {
  title: string
  subject: string
  documentId: string | null
  author: string
  cards: Flashcard[]
  sentences: DocSentence[]
}

/** Converte un elenco di record nel mazzo atteso da FlashcardStudyModal,
 *  ricostruendo le citazioni sorgente per l'evidenziazione in-testo. */
export function recordsToStudyDeck(records: FlashcardStudyRecord[], meta?: Partial<StudyDeck>): StudyDeck {
  const withSource = records.filter((record) => record.page && record.sourceQuote)
  const sentences: DocSentence[] = withSource.map((record, index) => ({
    index,
    page: record.page!,
    text: record.sourceQuote!,
    section: record.section,
    kind: 'sentence',
  }))
  const sentenceIndexByCard = new Map(withSource.map((record, index) => [record.flashcardId, index]))
  const first = records[0]
  return {
    title: meta?.title ?? first?.documentTitle ?? 'Ripasso mirato',
    subject: meta?.subject ?? first?.subject ?? 'Ripasso',
    documentId: meta?.documentId ?? first?.documentId ?? null,
    author: meta?.author ?? first?.documentAuthor ?? 'Autore non indicato',
    cards: records.map((record) => ({
      id: record.flashcardId,
      front: record.question,
      back: record.answer,
      source: 'concetto',
      score: record.difficulty === 'hard' ? 0.95 : record.difficulty === 'easy' ? 0.8 : 0.9,
      ref: record.page && record.sourceQuote
        ? {
            page: record.page,
            sentenceIndex: sentenceIndexByCard.get(record.flashcardId) ?? 0,
            text: record.sourceQuote,
            section: record.section,
          }
        : null,
    })),
    sentences,
  }
}

export type SemanticNeighbor = { flashcardId: string; similarity: number }

/**
 * Espande un ripasso di capitolo con le card semanticamente vicine (pgvector).
 * I semi sono gli errori del capitolo; la RPC restituisce le altre card
 * dell'utente più prossime al centroide degli embedding. Ritorna [] quando non
 * c'è backend o nessun seme persistito (modalità demo/locale): in quel caso il
 * ripasso resta puramente strutturale, senza errori.
 */
export async function fetchSemanticReviewNeighbors(seedRecords: FlashcardStudyRecord[], limit = 20): Promise<SemanticNeighbor[]> {
  if (!supabase) return []
  const seedIds = [...new Set(seedRecords.map((record) => record.flashcardId).filter(isPersistedFlashcardId))]
  if (!seedIds.length) return []
  try {
    const { data, error } = await supabase.rpc('match_review_flashcards', {
      p_seed_flashcards: seedIds,
      p_limit: limit,
    })
    if (error || !Array.isArray(data)) return []
    return (data as Array<{ flashcard_id: string; similarity: number | null }>).map((row) => ({
      flashcardId: row.flashcard_id,
      similarity: typeof row.similarity === 'number' ? row.similarity : 0,
    }))
  } catch {
    return []
  }
}

/** Unisce il mazzo strutturale del capitolo con i vicini semantici, senza
 *  duplicati, mantenendo in testa le card di ripasso "vere". */
export async function buildSmartChapterDeck(
  allRecords: FlashcardStudyRecord[],
  scope: ReviewScope,
  limit = 40,
): Promise<{ records: FlashcardStudyRecord[]; semanticCount: number }> {
  const base = selectReviewRecords(allRecords, scope, limit)
  const neighbors = await fetchSemanticReviewNeighbors(base, Math.max(8, Math.floor(limit / 2)))
  if (!neighbors.length) return { records: base, semanticCount: 0 }

  const recordById = new Map(allRecords.map((record) => [record.flashcardId, record]))
  const present = new Set(base.map((record) => record.flashcardId))
  const extras: FlashcardStudyRecord[] = []
  for (const neighbor of neighbors) {
    if (present.has(neighbor.flashcardId)) continue
    const record = recordById.get(neighbor.flashcardId)
    if (!record) continue
    present.add(neighbor.flashcardId)
    extras.push(record)
  }
  const merged = [...base, ...extras].slice(0, limit)
  const semanticCount = merged.filter((record) => !base.includes(record)).length
  return { records: merged, semanticCount }
}
