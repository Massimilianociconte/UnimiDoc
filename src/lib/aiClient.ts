// Thin client for authenticated Supabase Edge Functions. No SDK dependency —
// plain fetch with the user's Supabase access token. Free/deterministic AI
// features must NOT go through here. When the backend or login isn't configured
// yet, calls resolve to a typed, non-throwing "not configured / login required"
// result so the UI stays functional in the current no-auth demo.

import type { SrsState } from './studyEngine'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
// Prefer calling Supabase Edge Functions directly (CSP connect-src already
// allows *.supabase.co) so the app never depends on a host-specific proxy
// (`/api/functions/*`), which 404s on deploys where the proxy isn't wired.
// An explicit VITE_SUPABASE_FUNCTIONS_URL still wins for custom setups.
const FUNCTIONS_BASE_URL =
  (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined) ??
  (SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1` : '/api/functions')

export function isBackendConfigured(): boolean {
  return Boolean(SUPABASE_URL)
}

// Access-token provider — wire to Supabase auth once login exists.
let accessTokenProvider: () => Promise<string | null> = async () => null
export function setAccessTokenProvider(provider: () => Promise<string | null>): void {
  accessTokenProvider = provider
}

export type AiClientError = {
  ok: false
  code: 'not_configured' | 'login_required' | 'premium_required' | 'rate_limited' | 'error'
  message: string
}
export type AiClientResult<T> = { ok: true; data: T } | AiClientError

async function callFunction<T>(
  name: string,
  payload: unknown,
  options: { requireAuth?: boolean } = {},
): Promise<AiClientResult<T>> {
  if (!SUPABASE_URL) {
    return { ok: false, code: 'not_configured', message: 'Backend AI non configurato (imposta VITE_SUPABASE_URL).' }
  }
  const requireAuth = options.requireAuth ?? true
  const token = await accessTokenProvider()
  if (requireAuth && !token) {
    return { ok: false, code: 'login_required', message: 'Accedi per usare le funzioni AI Premium.' }
  }
  try {
    const functionUrl = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/${name}`
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
      },
      body: JSON.stringify(payload),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T
    if (res.ok) return { ok: true, data: json as T }
    const code: AiClientError['code'] =
      res.status === 401 ? 'login_required' : res.status === 402 ? 'premium_required' : res.status === 429 ? 'rate_limited' : 'error'
    return { ok: false, code, message: json?.error?.message ?? `Errore ${res.status}` }
  } catch (error) {
    return { ok: false, code: 'error', message: error instanceof Error ? error.message : 'Errore di rete' }
  }
}

/** Shared authenticated backend transport for non-AI product services. */
export function callBackendFunction<T>(name: string, payload: unknown): Promise<AiClientResult<T>> {
  return callFunction<T>(name, payload)
}

/** Public, read-only backend transport (the server still validates origin/rate limits). */
export function callPublicBackendFunction<T>(name: string, payload: unknown): Promise<AiClientResult<T>> {
  return callFunction<T>(name, payload, { requireAuth: false })
}

export type AiHelpMode = 'explain' | 'followup' | 'example' | 'memo' | 'visualize'

export type PremiumGeneratedFlashcard = {
  type?: 'qa' | 'cloze' | 'definition' | 'comparison' | 'reasoning' | 'application'
  question?: string
  answer?: string
  cloze_text?: string | null
  difficulty?: 'easy' | 'medium' | 'hard'
  source_quote?: string
  page_start?: number | null
  page_end?: number | null
  tags?: string[]
}

export type PremiumOutlineCandidate = {
  title: string
  page: number
  level?: number
  score?: number
  source?: string
  evidence?: string
}

export type PremiumOutlineEntry = {
  title: string
  level: 1 | 2 | 3
  page_start: number
  page_end: number | null
  confidence: number
  source_candidate_titles?: string[]
}

export function requestAiHelp(payload: {
  mode: AiHelpMode
  question: string
  correctAnswer: string
  userAnswer?: string | null
  answerStatus?: string | null
  sourceText?: string | null
  followupQuestion?: string
  previousExplanation?: string
  flashcardId?: string
  documentId?: string
  language?: string
}): Promise<AiClientResult<{ content: string; cached: boolean; premium: boolean }>> {
  return callFunction('ai-help', payload)
}

export function generatePremiumFlashcards(payload: {
  chunkText: string
  language?: string
  maxCards?: number
  documentId?: string
  pageStart?: number
  pageEnd?: number
}): Promise<AiClientResult<{ flashcards: PremiumGeneratedFlashcard[]; cached: boolean; premium?: boolean }>> {
  return callFunction('generate-flashcards', payload)
}

/**
 * RAG mode: the SERVER selects the document's semantically most relevant
 * chunks (embedding centroid, or vector search on focusQuery) and generates
 * flashcards from those topics, persisting them with chunk/page provenance.
 * Requires the document to be indexed (rag-index).
 */
export function generateFlashcardsFromDocument(payload: {
  documentId: string
  maxCards?: number
  language?: string
  /** Optional topic: cards are generated from the chunks most similar to it. */
  focusQuery?: string
}): Promise<AiClientResult<{
  flashcards: PremiumGeneratedFlashcard[]
  savedIds?: string[]
  cached: boolean
  premium?: boolean
  source?: string
  chunksUsed?: number
}>> {
  return callFunction('generate-flashcards', { ...payload, fromDocument: true })
}

export function saveReviewedFlashcards(payload: {
  documentId: string
  cards: PremiumGeneratedFlashcard[]
}): Promise<AiClientResult<{
  savedIds: string[]
  savedCount: number
  premium: true
  source: 'human_reviewed'
}>> {
  return callFunction('generate-flashcards', { ...payload, saveReviewed: true })
}

export function generatePremiumOutline(payload: {
  candidates: PremiumOutlineCandidate[]
  pageCount: number
  language?: string
  documentId?: string
}): Promise<AiClientResult<{ outline: PremiumOutlineEntry[]; notes?: string[]; cached: boolean; premium?: boolean }>> {
  return callFunction('generate-outline', payload)
}

export function autoDetectOcclusion(payload: {
  imageBase64: string
  mimeType?: string
  pageNumber?: number
  language?: string
  documentId?: string
}): Promise<AiClientResult<{ occlusion_candidates: unknown[]; cached: boolean }>> {
  return callFunction('image-occlusion', payload)
}

export function submitSrsReview(payload: {
  flashcardId: string
  rating: string
  answerStatus: string
  questionType?: string
  userAnswer?: string
  correctAnswer?: string
  timeSpentMs?: number
  quizSessionId?: string
  recordAnswer?: boolean
  recordProgress?: boolean
}): Promise<AiClientResult<{ srs: SrsState }>> {
  return callFunction('srs-review', payload)
}

export function createDocumentUpload(payload: {
  title: string
  courseName: string
  degreeSlug?: string
  degreeCourse?: string
  originalFileSha256: string
  originalSizeBytes: number
  mimeType?: string
  fileName?: string
  professor?: string
  academicYear?: string
  description?: string
  examType?: string
  semester?: string
  tags?: string[]
  compatibleExams?: string[]
  priceCredits?: number | null
}): Promise<AiClientResult<{
  documentId: string
  storageBucket: string
  storagePath: string
  signedUploadUrl: string
  token?: string
  path?: string
  maxUploadBytes: number
  queuedJobs: string[]
}>> {
  return callFunction('document-upload', payload)
}

export function finalizeDocumentUpload(payload: {
  documentId: string
  pageCount?: number
  language?: string
}): Promise<AiClientResult<{
  documentId: string
  status: 'verification_queued' | 'submitted'
  verified: boolean
  verificationQueued: boolean
  processingRunId: string
  queuedJobs: string[]
  postProcessingStages?: string[]
}>> {
  return callFunction('document-upload', { action: 'finalize', ...payload })
}

export function cancelDocumentUpload(documentId: string): Promise<AiClientResult<{
  documentId: string
  status: 'cancelled'
}>> {
  return callFunction('document-upload', { action: 'cancel', documentId })
}

// --------------------------------------------------------------------------
// RAG (Retrieval-Augmented Generation) — pgvector-backed. The UI should call
// these through src/lib/rag/provider.ts, not directly, so retrieval stays
// swappable (see the RagRetrievalProvider abstraction).
// --------------------------------------------------------------------------
export type RagFunctionResult<T> = AiClientResult<T>

/** Generic RAG edge-function call (re-exported callFunction for the rag lib). */
export function callRagFunction<T>(name: string, payload: unknown): Promise<AiClientResult<T>> {
  return callFunction<T>(name, payload)
}

export function ragIndexDocument(payload: {
  documentId: string
  force?: boolean
  /** Per-page text extracted in the uploader's browser (owner only, validated server-side). */
  pages?: Array<{ pageNumber: number; text: string }>
}): Promise<
  AiClientResult<{ documentId: string; status: string; chunksTotal?: number; chunksEmbedded?: number; chunkCap?: number; embeddingModel?: string; dimensions?: number }>
> {
  return callFunction('rag-index', payload)
}

export function fetchRagStatus(payload: { documentIds: string[] }): Promise<
  AiClientResult<{
    statuses: Array<{
      documentId: string
      status: 'not_indexed' | 'queued' | 'processing' | 'indexed' | 'partial' | 'failed'
      chunkCount: number
      indexVersion: number
      indexedAt: string | null
      job: { status: string; chunksTotal: number; chunksEmbedded: number; error: string | null } | null
    }>
  }>
> {
  return callFunction('rag-status', payload)
}

export function requestDocumentAccess(payload: { documentId: string }): Promise<AiClientResult<{
  documentId: string
  fullAccess: boolean
  canDownloadOriginal: boolean
  lockedPages: number
  expiresInSeconds: number
  previews: Array<{ page: number; url: string; free: boolean }>
  originalUrl: string | null
}>> {
  return callFunction('document-access', payload)
}
