import { supabase } from './supabaseClient'

// Recensioni, segnalazioni, moderazione e telemetria minima.
// Il gate è nel DB (RLS/RPC): qui solo chiamate tipizzate e messaggi chiari.

export type DocumentReview = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  mine: boolean
}

export async function loadDocumentReviews(documentId: string): Promise<DocumentReview[]> {
  if (!supabase) return []
  const [{ data: session }, { data, error }] = await Promise.all([
    supabase.auth.getSession(),
    supabase
      .from('document_reviews')
      .select('id, rating, comment, created_at, reviewer_id')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  if (error) throw error
  const uid = session.session?.user?.id
  return ((data ?? []) as Array<{ id: string; rating: number; comment: string | null; created_at: string; reviewer_id: string }>).map(
    (row) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
      mine: Boolean(uid && row.reviewer_id === uid),
    }),
  )
}

export async function submitDocumentReview(documentId: string, rating: number, comment: string): Promise<void> {
  if (!supabase) throw new Error('Recensioni disponibili solo sui materiali pubblicati.')
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) throw new Error('Accedi per lasciare una recensione.')
  const { error } = await supabase
    .from('document_reviews')
    .upsert(
      {
        document_id: documentId,
        reviewer_id: uid,
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        comment: comment.trim().slice(0, 1200) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'document_id,reviewer_id' },
    )
  if (error) {
    if (error.code === '42501') {
      throw new Error('Puoi recensire solo i materiali che hai acquistato (o quelli gratuiti), e mai i tuoi.')
    }
    throw new Error('Recensione non salvata. Riprova.')
  }
}

export const REPORT_REASONS = [
  { value: 'contenuto_errato', label: 'Contenuto errato o fuorviante' },
  { value: 'metadati_ingannevoli', label: 'Metadati ingannevoli (materia/docente sbagliati)' },
  { value: 'copyright', label: 'Violazione di copyright' },
  { value: 'spam', label: 'Spam o contenuto di bassissima qualità' },
  { value: 'altro', label: 'Altro' },
] as const

export async function reportDocument(documentId: string, reason: string, details: string): Promise<void> {
  if (!supabase) throw new Error('Segnalazioni disponibili solo sui materiali pubblicati.')
  const { error } = await supabase.from('document_reports').insert({
    document_id: documentId,
    reason,
    details: details.trim().slice(0, 2000) || null,
  })
  if (error) {
    if (error.code === '23505') throw new Error('Hai già segnalato questo materiale: la moderazione lo sta valutando.')
    if (error.code === '42501') throw new Error('Accedi per segnalare un materiale.')
    throw new Error('Segnalazione non inviata. Riprova.')
  }
}

// ---------------------------------------------------------------------------
// Moderazione (RPC SECURITY DEFINER, gate app_private.is_moderator nel DB)
// ---------------------------------------------------------------------------

export type ModerationQueueItem = {
  documentId: string
  title: string
  courseName: string
  professor: string | null
  degreeSlug: string | null
  academicYear: string | null
  pageCount: number | null
  priceCredits: number | null
  ownerEmail: string
  submittedAt: string
  aiQuality: number | null
  openReports: number
}

export async function checkIsModerator(): Promise<boolean> {
  if (!supabase) return false
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return false
  const { data, error } = await supabase.rpc('moderation_is_moderator')
  return !error && data === true
}

export async function loadModerationQueue(): Promise<ModerationQueueItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('moderation_queue')
  if (error) throw new Error('Coda di moderazione non disponibile.')
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((row) => ({
    documentId: row.document_id,
    title: row.title,
    courseName: row.course_name,
    professor: row.professor,
    degreeSlug: row.degree_slug,
    academicYear: row.academic_year,
    pageCount: row.page_count,
    priceCredits: row.price_credits,
    ownerEmail: row.owner_email,
    submittedAt: row.submitted_at,
    aiQuality: row.ai_quality == null ? null : Number(row.ai_quality),
    openReports: row.open_reports ?? 0,
  }))
}

export async function moderateDocument(documentId: string, action: 'publish' | 'reject', note?: string): Promise<void> {
  if (!supabase) throw new Error('Moderazione non disponibile in demo.')
  const { error } = await supabase.rpc('moderate_document', {
    p_document: documentId,
    p_action: action,
    p_note: note ?? null,
  })
  if (error) throw new Error(`Azione non applicata: ${error.message}`)
}

export type ModerationReport = {
  reportId: string
  documentId: string
  documentTitle: string
  reason: string
  details: string | null
  status: string
  createdAt: string
}

export async function loadModerationReports(): Promise<ModerationReport[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('moderation_reports')
  if (error) throw new Error('Segnalazioni non disponibili.')
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((row) => ({
    reportId: row.report_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  }))
}

export async function resolveModerationReport(reportId: string, status: 'reviewing' | 'dismissed' | 'upheld'): Promise<void> {
  if (!supabase) throw new Error('Moderazione non disponibile in demo.')
  const { error } = await supabase.rpc('resolve_document_report', { p_report: reportId, p_status: status })
  if (error) throw new Error(`Segnalazione non aggiornata: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Telemetria minima (fire-and-forget, mai bloccante, nessun PII)
// ---------------------------------------------------------------------------

export type UsageEvent =
  | 'document_preview'
  | 'document_download'
  | 'document_open'
  | 'search'
  | 'search_no_results'
  | 'degree_page_view'
  | 'signup_completed'
  | 'upload_completed'
  | 'document_purchased'
  | 'flashcards_generated'
  | 'study_session_completed'
  | 'premium_conversion'
  | 'ocr_used'
  | 'rag_query_used'
  | 'image_occlusion_used'

export function trackEvent(
  event: UsageEvent,
  payload: { documentId?: string; degreeSlug?: string; query?: string } = {},
): void {
  if (!supabase) return
  void supabase
    .from('usage_events')
    .insert({
      event,
      document_id: payload.documentId ?? null,
      degree_slug: payload.degreeSlug ?? null,
      query: payload.query?.slice(0, 120) ?? null,
    })
    .then(({ error }) => {
      if (error) console.debug('trackEvent skipped:', error.code)
    })
}
