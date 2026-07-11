// Authenticated GDPR/privacy workflow: portable JSON export plus auditable
// erasure requests. No browser endpoint directly deletes an account or any
// financial record; a verified worker applies retention/pseudonymisation rules.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { adminClient, requireUser, sha256Hex } from '../_shared/supabase.ts'

const MAX_ROWS_PER_DATASET = 10_000

// deno-lint-ignore no-explicit-any
async function readOwned(admin: any, table: string, ownerColumn: string, userId: string, columns = '*') {
  const { data, error, count } = await admin
    .from(table)
    .select(columns, { count: 'exact' })
    .eq(ownerColumn, userId)
    .range(0, MAX_ROWS_PER_DATASET - 1)
  if (error) return { rows: [], count: 0, unavailable: true }
  return {
    rows: data ?? [],
    count: count ?? data?.length ?? 0,
    truncated: (count ?? 0) > MAX_ROWS_PER_DATASET,
  }
}

// deno-lint-ignore no-explicit-any
async function readBillingExport(admin: any, userId: string) {
  const { data, error } = await admin.rpc('billing_privacy_export', { p_owner: userId })
  if (error) return { rows: {}, count: 0, unavailable: true }
  return { rows: data ?? {}, count: 1, truncated: false }
}

// deno-lint-ignore no-explicit-any
async function readAuthProfile(admin: any, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user) return { rows: [], count: 0, unavailable: true }
  const user = data.user
  return {
    rows: [{
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      userMetadata: user.user_metadata ?? {},
      identities: (user.identities ?? []).map((identity: Record<string, unknown>) => ({
        id: String(identity.id ?? ''),
        provider: String(identity.provider ?? ''),
        createdAt: identity.created_at ?? null,
        updatedAt: identity.updated_at ?? null,
      })),
    }],
    count: 1,
    truncated: false,
  }
}

// deno-lint-ignore no-explicit-any
async function buildExport(admin: any, userId: string) {
  const datasets = await Promise.all([
    readAuthProfile(admin, userId),
    readOwned(admin, 'profiles', 'id', userId, 'id, full_name, email, avatar_url, public_display_name, seller_profile_enabled, created_at, updated_at'),
    readOwned(admin, 'user_entitlements', 'owner_id', userId),
    readOwned(admin, 'user_credit_accounts', 'owner_id', userId),
    readOwned(admin, 'credit_lots', 'owner_id', userId),
    readOwned(admin, 'credit_lot_allocations', 'owner_id', userId),
    readOwned(admin, 'credit_transactions', 'owner_id', userId),
    readOwned(admin, 'document_purchases', 'buyer_id', userId),
    readOwned(admin, 'documents', 'owner_id', userId, 'id, title, course_name, professor, academic_year, page_count, language, visibility, preview_policy, description, exam_type, semester, degree_course, university, tags, compatible_exams, price_credits, metadata, created_at, updated_at'),
    readOwned(admin, 'flashcards', 'owner_id', userId),
    readOwned(admin, 'pdf_processing_runs', 'owner_id', userId),
    readOwned(admin, 'pdf_processing_jobs', 'owner_id', userId),
    readOwned(admin, 'pdf_pages', 'owner_id', userId),
    readOwned(admin, 'pdf_chunks', 'owner_id', userId),
    readOwned(admin, 'document_blocks', 'owner_id', userId),
    readOwned(admin, 'document_assets', 'owner_id', userId),
    readOwned(admin, 'document_outline', 'owner_id', userId),
    readOwned(admin, 'document_quality_reports', 'owner_id', userId),
    readOwned(admin, 'ocr_runs', 'owner_id', userId),
    readOwned(admin, 'user_library_items', 'owner_id', userId),
    readOwned(admin, 'notification_preferences', 'owner_id', userId),
    readOwned(admin, 'user_flashcard_progress', 'owner_id', userId),
    readOwned(admin, 'user_answers', 'owner_id', userId),
    readOwned(admin, 'flashcard_quality_votes', 'owner_id', userId),
    readOwned(admin, 'quiz_attempts', 'owner_id', userId),
    readOwned(admin, 'study_sessions', 'owner_id', userId),
    readOwned(admin, 'user_notifications', 'owner_id', userId),
    readOwned(admin, 'image_occlusion_masks', 'owner_id', userId),
    readOwned(admin, 'image_occlusion_sets', 'owner_id', userId),
    readOwned(admin, 'ai_helps', 'owner_id', userId),
    readOwned(admin, 'ai_monthly_usage', 'owner_id', userId),
    readOwned(admin, 'srs_state', 'owner_id', userId),
    readOwned(admin, 'flashcard_reviews', 'owner_id', userId),
    readOwned(admin, 'document_study_progress', 'owner_id', userId),
    readOwned(admin, 'subject_study_progress', 'owner_id', userId),
    readOwned(admin, 'review_tasks', 'owner_id', userId),
    readOwned(admin, 'rag_query_logs', 'user_id', userId),
    readOwned(admin, 'privacy_export_events', 'owner_id', userId),
    readOwned(admin, 'privacy_requests', 'requester_id', userId, 'id, request_type, status, public_message, legal_hold, requested_at, acknowledged_at, completed_at, cancelled_at, updated_at'),
    readBillingExport(admin, userId),
  ])
  const names = [
    'authProfile',
    'profile',
    'entitlements',
    'creditAccounts',
    'creditLots',
    'creditLotAllocations',
    'creditTransactions',
    'purchases',
    'documents',
    'authoredFlashcards',
    'pdfProcessingRuns',
    'pdfProcessingJobs',
    'pdfPages',
    'pdfChunks',
    'documentBlocks',
    'documentAssets',
    'documentOutline',
    'documentQualityReports',
    'ocrRuns',
    'library',
    'notificationPreferences',
    'flashcardProgress',
    'flashcardAnswers',
    'flashcardVotes',
    'quizAttempts',
    'studySessions',
    'notifications',
    'imageOcclusionMasks',
    'imageOcclusionSets',
    'aiHelps',
    'aiMonthlyUsage',
    'srsState',
    'flashcardReviews',
    'documentStudyProgress',
    'subjectStudyProgress',
    'reviewTasks',
    'ragQueryLogs',
    'privacyExportEvents',
    'privacyRequests',
    'billing',
  ]
  const data = Object.fromEntries(names.map((name, index) => [name, datasets[index].rows]))
  const manifest = Object.fromEntries(names.map((name, index) => [name, {
    count: datasets[index].count,
    truncated: datasets[index].truncated === true,
    unavailable: datasets[index].unavailable === true,
  }]))
  return {
    format: 'unimidoc-portability-json-v1',
    generatedAt: new Date().toISOString(),
    subjectId: userId,
    manifest,
    data,
  }
}

// deno-lint-ignore no-explicit-any
async function emailHashFor(admin: any, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user?.email) throw errors.badRequest('Email verificata non disponibile per questa richiesta.')
  return sha256Hex(data.user.email.trim().toLowerCase())
}

// deno-lint-ignore no-explicit-any
async function requestErasure(admin: any, userId: string, req: Request) {
  const { data: existing } = await admin
    .from('privacy_requests')
    .select('id, request_type, status, public_message, legal_hold, requested_at, updated_at')
    .eq('requester_id', userId)
    .eq('request_type', 'erasure')
    .in('status', ['queued', 'identity_check', 'in_progress'])
    .maybeSingle()
  if (existing) return jsonResponse({ request: existing, idempotent: true }, 200, req)

  const requesterEmailHash = await emailHashFor(admin, userId)
  const { data, error } = await admin
    .from('privacy_requests')
    .insert({
      requester_id: userId,
      requester_email_hash: requesterEmailHash,
      request_type: 'erasure',
      status: 'queued',
      public_message: 'Richiesta ricevuta. Verificheremo eventuali obblighi di conservazione prima di cancellare o pseudonimizzare i dati.',
      internal_payload: { source: 'privacy-center', requested_ip_stored: false },
    })
    .select('id, request_type, status, public_message, legal_hold, requested_at, updated_at')
    .single()
  if (error) throw errors.badRequest(`Richiesta non registrata: ${error.message}`)
  return jsonResponse({ request: data, idempotent: false }, 201, req)
}

// deno-lint-ignore no-explicit-any
async function cancelErasure(admin: any, userId: string, requestId: string, req: Request) {
  const { data, error } = await admin
    .from('privacy_requests')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      public_message: 'Richiesta annullata dall’utente prima dell’elaborazione.',
    })
    .eq('id', requestId)
    .eq('requester_id', userId)
    .eq('request_type', 'erasure')
    .in('status', ['queued', 'identity_check'])
    .select('id, request_type, status, public_message, legal_hold, requested_at, cancelled_at, updated_at')
    .maybeSingle()
  if (error || !data) throw errors.badRequest('La richiesta non è annullabile o non appartiene al tuo account.')
  return jsonResponse({ request: data }, 200, req)
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    const body = await req.json().catch(() => ({})) as { action?: string; requestId?: string }
    const action = String(body.action ?? 'status')

    if (action === 'export') {
      const payload = await buildExport(admin, userId)
      const manifestSha256 = await sha256Hex(JSON.stringify(payload))
      const datasets = Object.keys(payload.data)
      await admin.from('privacy_export_events').insert({
        owner_id: userId,
        manifest_sha256: manifestSha256,
        datasets,
      })
      return jsonResponse({ export: payload, manifestSha256 }, 200, req)
    }
    if (action === 'request_erasure') return await requestErasure(admin, userId, req)
    if (action === 'cancel_erasure') {
      const requestId = String(body.requestId ?? '')
      if (!requestId) throw errors.badRequest('requestId mancante.')
      return await cancelErasure(admin, userId, requestId, req)
    }
    if (action === 'status') {
      const { data, error } = await admin
        .from('privacy_requests')
        .select('id, request_type, status, public_message, legal_hold, requested_at, acknowledged_at, completed_at, cancelled_at, updated_at')
        .eq('requester_id', userId)
        .order('requested_at', { ascending: false })
        .limit(20)
      if (error) throw errors.badRequest(`Stato privacy non disponibile: ${error.message}`)
      return jsonResponse({ requests: data ?? [] }, 200, req)
    }
    throw errors.badRequest('Azione privacy non supportata.')
  } catch (error) {
    return errorResponse(error, req)
  }
})
