// Thin client for authenticated Supabase Edge Functions. No SDK dependency —
// plain fetch with the user's Supabase access token. Free/deterministic AI
// features must NOT go through here. When the backend or login isn't configured
// yet, calls resolve to a typed, non-throwing "not configured / login required"
// result so the UI stays functional in the current no-auth demo.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const FUNCTIONS_BASE_URL = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined) ?? '/api/functions'

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

async function callFunction<T>(name: string, payload: unknown): Promise<AiClientResult<T>> {
  if (!SUPABASE_URL) {
    return { ok: false, code: 'not_configured', message: 'Backend AI non configurato (imposta VITE_SUPABASE_URL).' }
  }
  const token = await accessTokenProvider()
  if (!token) {
    return { ok: false, code: 'login_required', message: 'Accedi per usare le funzioni AI Premium.' }
  }
  try {
    const functionUrl = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/${name}`
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
}): Promise<AiClientResult<{ srs: unknown }>> {
  return callFunction('srs-review', payload)
}

export function createDocumentUpload(payload: {
  title: string
  courseName: string
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
