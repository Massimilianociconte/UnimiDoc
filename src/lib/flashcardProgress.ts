import type { DocumentItem } from '../data'
import type { AppAuthUser } from './supabaseClient'
import { supabase } from './supabaseClient'
import type { AnswerStatus, SrsState } from './studyEngine'
import type { Flashcard } from './pdfProcessing'

export type FlashcardStudyStatus = 'unanswered' | 'correct' | 'incorrect' | 'partial' | 'skipped'
export type FlashcardQualityVote = 1 | -1

export type FlashcardStudyRecord = {
  id: string
  flashcardId: string
  documentId: string | null
  documentTitle: string
  documentAuthor: string
  subject: string
  chapter: string
  section: string
  topic: string
  question: string
  answer: string
  latestStatus: FlashcardStudyStatus
  attempts: number
  correct: number
  incorrect: number
  partial: number
  skipped: number
  lastReviewedAt: string | null
  nextDueAt: string | null
  difficulty: 'easy' | 'medium' | 'hard'
  isFavorite: boolean
  needsReview: boolean
  page: number | null
  sourceQuote?: string | null
  tags: string[]
  qualityVote?: FlashcardQualityVote
}

export type FlashcardReviewGroup = {
  id: string
  subject: string
  documentTitle: string
  chapter: string
  topic: string
  count: number
  incorrect: number
  due: number
  accuracy: number
}

export type DocumentFlashcardQuality = {
  documentId: string
  documentTitle: string
  author: string
  reviewerCount: number
  totalVotes: number
  positiveVotes: number
  negativeVotes: number
  qualityPercent: number | null
  topPositiveTopic?: string | null
  mostProblematicTopic?: string | null
}

export type AuthorDidacticPerformance = {
  author: string
  documents: DocumentFlashcardQuality[]
  averageQuality: number | null
  bestTopic?: string
  weakTopic?: string
}

export type FlashcardDashboardFilters = {
  subject: string
  documentTitle: string
  author: string
  chapter: string
  section: string
  topic: string
  status: 'all' | FlashcardStudyStatus | 'needs_review' | 'favorite'
  difficulty: 'all' | 'easy' | 'medium' | 'hard'
}

export type FlashcardDashboardData = {
  records: FlashcardStudyRecord[]
  errorGroups: FlashcardReviewGroup[]
  documentQualities: DocumentFlashcardQuality[]
  authorPerformance: AuthorDidacticPerformance | null
  source: 'live' | 'local' | 'demo' | 'empty'
}

export const EMPTY_FLASHCARD_FILTERS: FlashcardDashboardFilters = {
  subject: 'all',
  documentTitle: 'all',
  author: 'all',
  chapter: 'all',
  section: 'all',
  topic: 'all',
  status: 'all',
  difficulty: 'all',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORAGE_PREFIX = 'unimidoc:flashcard-progress:v1:'

type LocalStore = {
  records: FlashcardStudyRecord[]
  documentQualities: DocumentFlashcardQuality[]
}

export type StudyContext = {
  documentId?: string | null
  documentTitle: string
  documentAuthor?: string
  subject?: string
}

type ProgressRow = {
  id: string
  flashcard_id: string
  document_id: string | null
  document_title: string | null
  document_author_name: string | null
  subject: string | null
  chapter_title: string | null
  section_title: string | null
  topic: string | null
  question: string
  answer: string
  latest_status: FlashcardStudyStatus
  attempts_count: number
  correct_count: number
  incorrect_count: number
  partial_count: number
  skipped_count: number
  last_reviewed_at: string | null
  next_due_at: string | null
  difficulty: 'easy' | 'medium' | 'hard' | null
  is_favorite: boolean
  needs_review: boolean
  source_page_start: number | null
  tags: string[] | null
}

type QualityVoteRow = {
  flashcard_id: string
  vote: FlashcardQualityVote
}

type QualityRollupRow = {
  document_id: string
  reviewer_count: number
  total_votes: number
  positive_votes: number
  negative_votes: number
  quality_percent: number | null
  top_positive_topic: string | null
  most_problematic_topic: string | null
}

type FlashcardRow = {
  id: string
  document_id: string
  front: string
  back: string
  tags: string[] | null
  difficulty: 'easy' | 'medium' | 'hard' | null
  source_page_start: number | null
  source_quote: string | null
  subject: string | null
  chapter_title: string | null
  section_title: string | null
  topic: string | null
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

function loadLocalStore(userId: string): LocalStore {
  if (typeof window === 'undefined') return { records: [], documentQualities: [] }
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return { records: [], documentQualities: [] }
    const parsed = JSON.parse(raw) as Partial<LocalStore>
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      documentQualities: Array.isArray(parsed.documentQualities) ? parsed.documentQualities : [],
    }
  } catch {
    return { records: [], documentQualities: [] }
  }
}

function saveLocalStore(userId: string, store: LocalStore): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(store))
  } catch {
    /* Keep the active study session usable even in privacy/quota failures. */
  }
}

function stableCardId(card: Flashcard, context: StudyContext): string {
  if (UUID_RE.test(card.id)) return card.id
  const documentScope = context.documentId?.trim()
    || context.documentTitle.trim().toLocaleLowerCase('it').replace(/\s+/g, '-')
    || 'documento-locale'
  return `${documentScope}:${card.id}`
}

export function flashcardProgressId(card: Flashcard, context: StudyContext): string {
  return stableCardId(card, context)
}

export function isPersistedFlashcardId(id: string): boolean {
  return UUID_RE.test(id)
}

function normalizeStatus(status: AnswerStatus | FlashcardStudyStatus): FlashcardStudyStatus {
  if (status === 'unknown') return 'incorrect'
  if (status === 'correct' || status === 'incorrect' || status === 'partial' || status === 'skipped' || status === 'unanswered') return status
  return 'skipped'
}

function topicFromCard(card: Flashcard): string {
  if (card.ref?.section) return card.ref.section
  const match = card.front.match(/\b([A-ZÀ-Ú][\p{L}\d-]{3,}(?:\s+[A-ZÀ-Ú]?\p{L}{3,}){0,4})/u)
  return match?.[1]?.replace(/[?:.]+$/, '') ?? 'Concetto generale'
}

function recordFromCard(card: Flashcard, context: StudyContext): FlashcardStudyRecord {
  const chapter = card.ref?.section ?? 'Senza capitolo'
  const topic = topicFromCard(card)
  return {
    id: stableCardId(card, context),
    flashcardId: stableCardId(card, context),
    documentId: context.documentId ?? null,
    documentTitle: context.documentTitle || 'Documento senza titolo',
    documentAuthor: context.documentAuthor || 'Autore non indicato',
    subject: context.subject || card.ref?.section || 'Materia non classificata',
    chapter,
    section: card.ref?.section ?? 'Senza sezione',
    topic,
    question: card.front,
    answer: card.back,
    latestStatus: 'unanswered',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    partial: 0,
    skipped: 0,
    lastReviewedAt: null,
    nextDueAt: null,
    difficulty: card.score >= 0.93 ? 'hard' : card.score <= 0.86 ? 'easy' : 'medium',
    isFavorite: false,
    needsReview: false,
    page: card.ref?.page ?? null,
    tags: [card.source, topic].filter(Boolean),
  }
}

function applyOutcome(record: FlashcardStudyRecord, status: FlashcardStudyStatus, srs?: SrsState | null): FlashcardStudyRecord {
  const next = { ...record }
  next.latestStatus = status
  if (status !== 'unanswered') next.attempts += 1
  if (status === 'correct') next.correct += 1
  if (status === 'incorrect') next.incorrect += 1
  if (status === 'partial') next.partial += 1
  if (status === 'skipped') next.skipped += 1
  next.lastReviewedAt = status === 'unanswered' ? next.lastReviewedAt : new Date().toISOString()
  next.nextDueAt = srs?.dueAt ?? next.nextDueAt
  next.needsReview = status === 'incorrect' || status === 'partial' || status === 'skipped' || Boolean(srs && new Date(srs.dueAt).getTime() <= Date.now())
  return next
}

export function recordLocalFlashcardOutcome(
  userId: string,
  card: Flashcard,
  context: StudyContext,
  status: AnswerStatus | FlashcardStudyStatus,
  srs?: SrsState | null,
): FlashcardStudyRecord {
  const store = loadLocalStore(userId)
  const normalized = normalizeStatus(status)
  const flashcardId = stableCardId(card, context)
  const existing = store.records.find((record) => record.flashcardId === flashcardId)
  const base = existing ?? recordFromCard(card, context)
  const updated = applyOutcome(base, normalized, srs)
  const records = [updated, ...store.records.filter((record) => record.flashcardId !== flashcardId)]
  saveLocalStore(userId, { ...store, records })
  return updated
}

export function updateLocalFlashcardSchedule(userId: string, flashcardId: string, srs: SrsState): void {
  const store = loadLocalStore(userId)
  const now = new Date().toISOString()
  const records = store.records.map((record) => {
    if (record.flashcardId !== flashcardId) return record
    const dueAt = new Date(srs.dueAt).getTime()
    return {
      ...record,
      lastReviewedAt: srs.lastReviewedAt ?? now,
      nextDueAt: srs.dueAt,
      needsReview: record.needsReview || Number.isFinite(dueAt) && dueAt <= Date.now(),
    }
  })
  saveLocalStore(userId, { ...store, records })
}

export function setLocalFlashcardFavorite(userId: string, flashcardId: string, isFavorite: boolean): void {
  const store = loadLocalStore(userId)
  saveLocalStore(userId, {
    ...store,
    records: store.records.map((record) => (record.flashcardId === flashcardId ? { ...record, isFavorite } : record)),
  })
}

export function setLocalFlashcardQualityVote(
  userId: string,
  card: Flashcard,
  context: StudyContext,
  vote: FlashcardQualityVote,
): FlashcardStudyRecord {
  const store = loadLocalStore(userId)
  const flashcardId = stableCardId(card, context)
  const existing = store.records.find((record) => record.flashcardId === flashcardId)
  const updated = { ...(existing ?? recordFromCard(card, context)), qualityVote: vote }
  const records = [updated, ...store.records.filter((record) => record.flashcardId !== flashcardId)]
  saveLocalStore(userId, { ...store, records })
  return updated
}

export async function saveRemoteFlashcardQualityVote(flashcardId: string, vote: FlashcardQualityVote): Promise<boolean> {
  if (!supabase || !isPersistedFlashcardId(flashcardId)) return false
  try {
    const { error } = await supabase.rpc('set_flashcard_quality_vote', {
      p_flashcard_id: flashcardId,
      p_vote: vote,
    })
    return !error
  } catch {
    return false
  }
}

export async function recordRemoteFlashcardOutcome(
  flashcardId: string,
  status: AnswerStatus | FlashcardStudyStatus,
): Promise<boolean> {
  if (!supabase || !isPersistedFlashcardId(flashcardId)) return false
  try {
    const { error } = await supabase.rpc('record_flashcard_study_event', {
      p_flashcard_id: flashcardId,
      p_answer_status: normalizeStatus(status),
      p_next_due_at: null,
      p_last_reviewed_at: new Date().toISOString(),
    })
    return !error
  } catch {
    return false
  }
}

export async function loadRemoteFlashcardSrs(flashcardIds: string[]): Promise<Record<string, SrsState>> {
  if (!supabase) return {}
  const ids = [...new Set(flashcardIds.filter(isPersistedFlashcardId))]
  if (ids.length === 0) return {}
  try {
    const { data, error } = await supabase
      .from('srs_state')
      .select('flashcard_id, due_at, last_reviewed_at, review_count, lapse_count, ease_factor, interval_minutes, last_rating, stage')
      .in('flashcard_id', ids)
    if (error) return {}
    return Object.fromEntries((data ?? []).map((row) => [row.flashcard_id, {
      dueAt: row.due_at,
      lastReviewedAt: row.last_reviewed_at,
      reviewCount: row.review_count,
      lapseCount: row.lapse_count,
      easeFactor: row.ease_factor,
      intervalMinutes: row.interval_minutes,
      lastRating: row.last_rating,
      stage: row.stage,
    } satisfies SrsState]))
  } catch {
    return {}
  }
}

export async function setRemoteFlashcardFavorite(flashcardId: string, isFavorite: boolean): Promise<boolean> {
  if (!supabase || !isPersistedFlashcardId(flashcardId)) return false
  try {
    const { error } = await supabase.rpc('set_flashcard_favorite', {
      p_flashcard_id: flashcardId,
      p_is_favorite: isFavorite,
    })
    return !error
  } catch {
    return false
  }
}

function groupErrors(records: FlashcardStudyRecord[]): FlashcardReviewGroup[] {
  const groups = new Map<string, FlashcardReviewGroup & { correct: number; total: number }>()
  for (const record of records) {
    if (record.latestStatus !== 'incorrect' && !record.needsReview) continue
    const key = `${record.subject}|||${record.documentTitle}|||${record.chapter}|||${record.topic}`
    const current = groups.get(key) ?? {
      id: key,
      subject: record.subject,
      documentTitle: record.documentTitle,
      chapter: record.chapter,
      topic: record.topic,
      count: 0,
      incorrect: 0,
      due: 0,
      accuracy: 0,
      correct: 0,
      total: 0,
    }
    current.count += 1
    current.incorrect += record.latestStatus === 'incorrect' ? 1 : 0
    current.due += record.needsReview ? 1 : 0
    current.correct += record.correct
    current.total += record.correct + record.incorrect + record.partial
    current.accuracy = current.total ? Math.round((current.correct / current.total) * 100) : 0
    groups.set(key, current)
  }
  return [...groups.values()]
    .map(({ correct: _correct, total: _total, ...group }) => group)
    .sort((a, b) => b.incorrect + b.due - (a.incorrect + a.due))
}

function documentQualityFromLocal(records: FlashcardStudyRecord[]): DocumentFlashcardQuality[] {
  const byDocument = new Map<string, FlashcardStudyRecord[]>()
  for (const record of records) {
    if (!record.qualityVote) continue
    const key = record.documentId ?? record.documentTitle
    byDocument.set(key, [...(byDocument.get(key) ?? []), record])
  }
  return [...byDocument.entries()].map(([documentId, rows]) => {
    const positiveVotes = rows.filter((row) => row.qualityVote === 1).length
    const negativeVotes = rows.filter((row) => row.qualityVote === -1).length
    const totalVotes = positiveVotes + negativeVotes
    return {
      documentId,
      documentTitle: rows[0]?.documentTitle ?? 'Documento',
      author: rows[0]?.documentAuthor ?? 'Autore',
      reviewerCount: 1,
      totalVotes,
      positiveVotes,
      negativeVotes,
      qualityPercent: totalVotes ? Math.round((positiveVotes / totalVotes) * 100) : null,
      topPositiveTopic: rows.find((row) => row.qualityVote === 1)?.topic,
      mostProblematicTopic: rows.find((row) => row.qualityVote === -1)?.topic,
    }
  })
}

function authorPerformance(user: AppAuthUser, qualities: DocumentFlashcardQuality[]): AuthorDidacticPerformance | null {
  const own = qualities.filter((quality) => quality.author === user.name || quality.author === 'Tu')
  if (!own.length) return null
  const scored = own.filter((quality) => typeof quality.qualityPercent === 'number')
  const averageQuality = scored.length
    ? Math.round(scored.reduce((sum, quality) => sum + (quality.qualityPercent ?? 0), 0) / scored.length)
    : null
  return {
    author: user.name,
    documents: own,
    averageQuality,
    bestTopic: own.find((quality) => quality.topPositiveTopic)?.topPositiveTopic ?? undefined,
    weakTopic: own.find((quality) => quality.mostProblematicTopic)?.mostProblematicTopic ?? undefined,
  }
}

function mapProgressRow(row: ProgressRow, votes: Map<string, FlashcardQualityVote>): FlashcardStudyRecord {
  return {
    id: row.id,
    flashcardId: row.flashcard_id,
    documentId: row.document_id,
    documentTitle: row.document_title ?? 'Documento',
    documentAuthor: row.document_author_name ?? 'Autore non indicato',
    subject: row.subject ?? 'Materia non classificata',
    chapter: row.chapter_title ?? 'Senza capitolo',
    section: row.section_title ?? row.chapter_title ?? 'Senza sezione',
    topic: row.topic ?? row.section_title ?? row.chapter_title ?? 'Concetto generale',
    question: row.question,
    answer: row.answer,
    latestStatus: row.latest_status,
    attempts: row.attempts_count,
    correct: row.correct_count,
    incorrect: row.incorrect_count,
    partial: row.partial_count,
    skipped: row.skipped_count,
    lastReviewedAt: row.last_reviewed_at,
    nextDueAt: row.next_due_at,
    difficulty: row.difficulty ?? 'medium',
    isFavorite: row.is_favorite,
    needsReview: row.needs_review,
    page: row.source_page_start,
    tags: row.tags ?? [],
    qualityVote: votes.get(row.flashcard_id),
  }
}

function mapUnansweredCard(
  row: FlashcardRow,
  document: { title: string; author: string } | undefined,
  votes: Map<string, FlashcardQualityVote>,
): FlashcardStudyRecord {
  return {
    id: `unanswered-${row.id}`,
    flashcardId: row.id,
    documentId: row.document_id,
    documentTitle: document?.title ?? 'Documento',
    documentAuthor: document?.author ?? 'Autore non indicato',
    subject: row.subject ?? 'Materia non classificata',
    chapter: row.chapter_title ?? 'Senza capitolo',
    section: row.section_title ?? row.chapter_title ?? 'Senza sezione',
    topic: row.topic ?? row.section_title ?? row.chapter_title ?? 'Concetto generale',
    question: row.front,
    answer: row.back,
    latestStatus: 'unanswered',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    partial: 0,
    skipped: 0,
    lastReviewedAt: null,
    nextDueAt: null,
    difficulty: row.difficulty ?? 'medium',
    isFavorite: false,
    needsReview: false,
    page: row.source_page_start,
    sourceQuote: row.source_quote,
    tags: row.tags ?? [],
    qualityVote: votes.get(row.id),
  }
}

async function loadRemoteDashboard(user: AppAuthUser, documents: DocumentItem[]): Promise<FlashcardDashboardData | null> {
  if (!supabase || user.isDemo) return null
  try {
    const [progress, cards, votes, rollups, ownedDocuments] = await Promise.all([
      supabase
        .from('user_flashcard_progress')
        .select('*')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(500),
      // SECURITY DEFINER RPC: owner cards + cards on documents with active purchase.
      supabase.rpc('list_accessible_flashcards', { p_limit: 500 }),
      supabase
        .from('flashcard_quality_votes')
        .select('flashcard_id, vote')
        .eq('owner_id', user.id),
      supabase
        .from('public_document_flashcard_quality')
        .select('*')
        .order('quality_percent', { ascending: false, nullsFirst: false })
        .limit(80),
      supabase
        .from('documents')
        .select('id, title, professor')
        .eq('owner_id', user.id),
    ])
    const firstError = progress.error || cards.error || votes.error || rollups.error || ownedDocuments.error
    if (firstError) throw new Error(firstError.message || 'flashcard_dashboard_load_failed')

    const voteMap = new Map(((votes.data as QualityVoteRow[] | null) ?? []).map((row) => [row.flashcard_id, row.vote]))
    const cardRows = (cards.data as FlashcardRow[] | null) ?? []
    const cardById = new Map(cardRows.map((card) => [card.id, card]))
    const progressRecords = ((progress.data as ProgressRow[] | null) ?? []).map((row) => ({
      ...mapProgressRow(row, voteMap),
      sourceQuote: cardById.get(row.flashcard_id)?.source_quote ?? null,
    }))
    const progressedIds = new Set(progressRecords.map((record) => record.flashcardId))
    const documentMeta = new Map<string, { title: string; author: string }>(
      documents.map((document) => [document.id, { title: document.title, author: document.uploader }]),
    )
    for (const document of (ownedDocuments.data ?? []) as Array<{ id: string; title: string; professor: string | null }>) {
      documentMeta.set(document.id, { title: document.title, author: user.name || document.professor || 'Tu' })
    }
    const unansweredRecords = cardRows
      .filter((card) => !progressedIds.has(card.id))
      .map((card) => mapUnansweredCard(card, documentMeta.get(card.document_id), voteMap))
    const records = [...progressRecords, ...unansweredRecords]
    const docById = new Map(documents.map((document) => [document.id, document]))
    const documentQualities: DocumentFlashcardQuality[] = ((rollups.data as QualityRollupRow[] | null) ?? []).map((row) => {
      const document = docById.get(row.document_id)
      return {
        documentId: row.document_id,
        documentTitle: document?.title ?? row.document_id,
        author: document?.uploader ?? 'Autore',
        reviewerCount: row.reviewer_count,
        totalVotes: row.total_votes,
        positiveVotes: row.positive_votes,
        negativeVotes: row.negative_votes,
        qualityPercent: row.quality_percent,
        topPositiveTopic: row.top_positive_topic,
        mostProblematicTopic: row.most_problematic_topic,
      }
    })

    return {
      records,
      errorGroups: groupErrors(records),
      documentQualities,
      authorPerformance: authorPerformance(user, documentQualities),
      source: 'live',
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('flashcard_dashboard_load_failed')
  }
}

export async function loadFlashcardDashboardData(user: AppAuthUser, documents: DocumentItem[]): Promise<FlashcardDashboardData> {
  const remote = await loadRemoteDashboard(user, documents)
  // For real accounts an empty remote result is authoritative. Falling back to
  // localStorage after a refresh/login would reintroduce stale device-specific
  // progress and hide backend failures.
  if (remote) return remote

  const local = loadLocalStore(user.id)
  const localQualities = local.documentQualities.length ? local.documentQualities : documentQualityFromLocal(local.records)
  if (local.records.length || localQualities.length) {
    return {
      records: local.records,
      errorGroups: groupErrors(local.records),
      documentQualities: localQualities,
      authorPerformance: authorPerformance(user, localQualities),
      source: 'local',
    }
  }

  if (!user.isDemo) {
    return {
      records: [],
      errorGroups: [],
      documentQualities: [],
      authorPerformance: null,
      source: 'empty',
    }
  }

  const demoRecords = buildDemoFlashcardRecords(documents)
  const demoQualities = buildDemoQuality(documents)
  return {
    records: demoRecords,
    errorGroups: groupErrors(demoRecords),
    documentQualities: demoQualities,
    authorPerformance: authorPerformance({ ...user, name: 'Tu' }, demoQualities),
    source: 'demo',
  }
}

export function filterFlashcardRecords(records: FlashcardStudyRecord[], filters: FlashcardDashboardFilters): FlashcardStudyRecord[] {
  return records.filter((record) => {
    if (filters.subject !== 'all' && record.subject !== filters.subject) return false
    if (filters.documentTitle !== 'all' && record.documentTitle !== filters.documentTitle) return false
    if (filters.author !== 'all' && record.documentAuthor !== filters.author) return false
    if (filters.chapter !== 'all' && record.chapter !== filters.chapter) return false
    if (filters.section !== 'all' && record.section !== filters.section) return false
    if (filters.topic !== 'all' && record.topic !== filters.topic) return false
    if (filters.difficulty !== 'all' && record.difficulty !== filters.difficulty) return false
    if (filters.status === 'needs_review' && !record.needsReview) return false
    if (filters.status === 'favorite' && !record.isFavorite) return false
    if (filters.status !== 'all' && filters.status !== 'needs_review' && filters.status !== 'favorite' && record.latestStatus !== filters.status) return false
    return true
  })
}

function buildDemoFlashcardRecords(documents: DocumentItem[]): FlashcardStudyRecord[] {
  const sourceDocs = documents.slice(0, 4)
  const topics = ['Ciclo lisogeno', 'Lamelle secondarie', 'SAM e RAM', 'Trasduzione specializzata', 'Nefrone']
  return sourceDocs.flatMap((document, documentIndex) =>
    topics.slice(0, 3).map((topic, index) => {
      const status: FlashcardStudyStatus = index === 0 ? 'incorrect' : index === 1 ? 'correct' : 'unanswered'
      return {
        id: `demo-${document.id}-${index}`,
        flashcardId: `demo-${document.id}-${index}`,
        documentId: document.id,
        documentTitle: document.title.replace(' - Appunti completi', ''),
        documentAuthor: document.uploader,
        subject: document.subject,
        chapter: index === 0 ? 'Capitolo critico' : `Capitolo ${index + 1}`,
        section: index === 0 ? topic : `Sezione ${index + 1}`,
        topic,
        question: index === 0 ? `Che cosa devi ripassare su ${topic}?` : `Definisci ${topic}`,
        answer: `Risposta sintetica e verificabile su ${topic}.`,
        latestStatus: status,
        attempts: status === 'unanswered' ? 0 : 2 + index,
        correct: status === 'correct' ? 2 : 0,
        incorrect: status === 'incorrect' ? 2 : 0,
        partial: 0,
        skipped: status === 'unanswered' ? 0 : 1,
        lastReviewedAt: status === 'unanswered' ? null : new Date(Date.now() - (documentIndex + index + 1) * 86400000).toISOString(),
        nextDueAt: index === 0 ? new Date(Date.now() + 3600000).toISOString() : null,
        difficulty: index === 0 ? 'hard' : 'medium',
        isFavorite: index === 1,
        needsReview: index === 0,
        page: 8 + documentIndex * 6 + index,
        tags: [document.subject, topic],
        qualityVote: index === 2 ? -1 : 1,
      }
    }),
  )
}

function buildDemoQuality(documents: DocumentItem[]): DocumentFlashcardQuality[] {
  return documents.slice(0, 5).map((document, index) => ({
    documentId: document.id,
    documentTitle: document.title.replace(' - Appunti completi', ''),
    author: document.uploader,
    reviewerCount: 4 + index,
    totalVotes: 22 + index * 8,
    positiveVotes: 18 + index * 6,
    negativeVotes: 4 + index,
    qualityPercent: Math.max(62, 88 - index * 6),
    topPositiveTopic: document.insights?.topics?.[0] ?? 'Definizioni chiave',
    mostProblematicTopic: document.insights?.topics?.[2] ?? 'Segmentazione argomenti',
  }))
}
