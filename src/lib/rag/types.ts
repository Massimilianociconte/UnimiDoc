// Retrieval-provider abstraction. The UI depends ONLY on RagRetrievalProvider,
// never on pgvector / Supabase directly. Today the single implementation is
// SupabasePgvectorProvider (calls the rag-query Edge Function). In the future a
// native Flutter app can add ZvecMobileLocalProvider (on-device ZVec) or a
// ZvecServerProvider (a separate microservice) WITHOUT changing any UI code.

export type RagSource = {
  marker: string
  chunk_id: string
  document_id: string
  title: string | null
  course_name: string | null
  professor: string | null
  page_start: number
  page_end: number
  section_path: string[]
  similarity: number
}

export type RagSearchParams = {
  query: string
  documentIds?: string[] | null
  matchCount?: number
}

export type RagAnswer = {
  answer: string
  sources: RagSource[]
  matched: number
}

export type RagResult =
  | { ok: true; data: RagAnswer }
  | { ok: false; code: 'not_configured' | 'login_required' | 'not_indexed' | 'rate_limited' | 'error'; message: string }

export type RagIndexStatus = {
  documentId: string
  status: 'not_indexed' | 'queued' | 'processing' | 'indexed' | 'partial' | 'failed'
  chunkCount: number
  indexVersion: number
  indexedAt: string | null
  job: { status: string; chunksTotal: number; chunksEmbedded: number; error: string | null } | null
}

export interface RagRetrievalProvider {
  readonly id: string
  /** Whether this provider can serve requests in the current environment. */
  isAvailable(): Promise<boolean>
  /** Answer a question grounded in accessible, indexed chunks. */
  search(params: RagSearchParams): Promise<RagResult>
}
