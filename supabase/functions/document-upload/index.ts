// POST /functions/v1/document-upload
//
// Two-phase upload:
//   action=create   -> private draft + short-lived signed upload URL
//   action=finalize -> verifies object presence/path/declared size and atomically
//                      enqueues a container-worker run. The worker performs the
//                      expensive SHA-256, magic-byte and qpdf verification.
// Publication and credit rewards remain separate moderation operations.

import { preflight, jsonResponse, errorResponse, errors, AppError, parseJsonBody, requireMethod, dbFailure} from '../_shared/http.ts'
import { adminClient, requireUser, type AdminClient } from '../_shared/supabase.ts'
import { UUID_RE, HASH_RE, DEGREE_SLUG_RE, DEFAULT_DEGREE_SLUG, MAX_UPLOADS_PER_HOUR, INITIAL_PIPELINE_STAGES, POST_PROCESSING_STAGES, safeName, parseTags } from '../_shared/constants.ts'
import { createRequestLogger } from '../_shared/log.ts'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const PDF_PIPELINE_VERSION = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno?.env?.get('PDF_PIPELINE_VERSION')?.trim() || 'pdf-worker-v1'
// Fail-closed: uploads require an explicit opt-in after the PDF worker is
// deployed and smoke-tested. See docs/PDF_WORKER_RUNBOOK.md.
// Set PDF_WORKER_ENABLED=true only when a live container drains the queue.
// Keep PDF_PIPELINE_VERSION in sync between Edge and worker.
const PDF_WORKER_ENABLED = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno?.env?.get('PDF_WORKER_ENABLED') === 'true'

const clean = (value: unknown, fallback = '') => String(value ?? fallback).trim()

/** Server-side public-field scan: block contact/off-platform leaks even if the client skips moderation. */
function assertPublicTextClean(label: string, value: string) {
  if (!value.trim()) return
  const scan = value
    .toLowerCase()
    .replace(/\s*[([{]\s*(?:at|chiocciola)\s*[)\]}]\s*/g, '@')
    .replace(/\s+(?:at|chiocciola)\s+/g, '@')
    .replace(/\s*[([{]\s*(?:dot|punto)\s*[)\]}]\s*/g, '.')
    .replace(/\s+(?:dot|punto)\s+/g, '.')
  if (
    /[a-z0-9][a-z0-9.+]*@[a-z0-9][a-z0-9.]*\.[a-z]{2,}/i.test(scan)
    || /\b(?:https?:\/\/|www\.)\S+/i.test(scan)
    || /\b(?:whats\s?app|telegram|insta(?:gram)?|face\s?book|tik\s?tok|discord)\b/i.test(scan)
    || /\b(?:scrivimi|contattami|chiamami|contact\s+me|dm\s+me)\b/i.test(scan)
  ) {
    throw errors.badRequest(
      `${label}: rimuovi contatti esterni (email, link, social). La comunicazione resta su UnimiDoc.`,
    )
  }
}

// Storage list is intentionally lightweight. Full-byte integrity verification
// belongs to the native worker, not to the 256 MB / CPU-bounded Edge runtime.
async function assertUploadedObjectPresent(admin: AdminClient, bucket: string, objectPath: string, expectedSize: number) {
  const slash = objectPath.lastIndexOf('/')
  const folder = objectPath.slice(0, slash)
  const fileName = objectPath.slice(slash + 1)
  const { data, error } = await admin.storage.from(bucket).list(folder, {
    limit: 10,
    search: fileName,
  })
  if (error) throw dbFailure('db_error', error, 'Verifica presenza upload non riuscita')
  const object = (data ?? []).find((entry: { name?: string }) => entry.name === fileName)
  if (!object) throw errors.badRequest('Upload non ancora disponibile nello Storage.')
  const storedSize = Number((object as { metadata?: { size?: number } }).metadata?.size)
  if (Number.isFinite(storedSize) && storedSize > 0 && storedSize !== expectedSize) {
    throw errors.badRequest('La dimensione del file caricato non corrisponde alla bozza.')
  }
}

async function finalizeUpload(admin: AdminClient, userId: string, body: Record<string, unknown>, req: Request): Promise<Response> {
  const documentId = clean(body.documentId)
  if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')

  const { data: doc, error: docError } = await admin
    .from('documents')
    .select('id, owner_id, storage_bucket, storage_path, original_file_sha256, original_size_bytes, visibility, metadata')
    .eq('id', documentId)
    .maybeSingle()
  if (docError || !doc) throw errors.badRequest('Documento non trovato.')
  if (doc.owner_id !== userId) throw errors.badRequest('Non puoi finalizzare questo documento.')

  const uploadState = String(doc.metadata?.upload_state ?? '')
  const alreadyVerified = doc.visibility === 'submitted' && uploadState === 'verified_submitted'
  if (!alreadyVerified && (doc.visibility !== 'private' || !['awaiting_client_upload', 'verification_failed', 'verification_queued'].includes(uploadState))) {
    throw errors.badRequest('Il documento non è in uno stato finalizzabile.')
  }

  const bucket = String(doc.storage_bucket)
  const path = String(doc.storage_path)
  const expectedPrefix = `${userId}/incoming/${documentId}/`
  if (!alreadyVerified && (bucket !== 'processing-temp' || !path.startsWith(expectedPrefix) || path.includes('/../'))) {
    throw errors.badRequest('Riferimento Storage del documento non valido.')
  }
  const expectedHash = String(doc.original_file_sha256).toLowerCase()
  const expectedSize = Number(doc.original_size_bytes)
  if (!alreadyVerified) await assertUploadedObjectPresent(admin, bucket, path, expectedSize)

  const pageCount = Number(body.pageCount)
  const { data: queued, error: queueError } = await admin.rpc('enqueue_pdf_processing_run', {
    p_document: documentId,
    p_owner: userId,
    p_input_hash: expectedHash,
    p_pipeline_version: PDF_PIPELINE_VERSION,
    p_requested_tier: 'base',
    p_page_count: Number.isInteger(pageCount) && pageCount > 0 && pageCount <= 2000 ? pageCount : null,
    p_language: clean(body.language).slice(0, 12) || null,
  })
  if (queueError) throw dbFailure('db_error', queueError, 'Accodamento analisi non riuscito')
  const queueResult = Array.isArray(queued) ? queued[0] : queued
  const runId = String(queueResult?.run_id ?? '')
  if (!UUID_RE.test(runId)) throw errors.badRequest('Run di elaborazione non creato.')

  return jsonResponse({
    documentId,
    status: alreadyVerified ? 'submitted' : 'verification_queued',
    verified: alreadyVerified,
    verificationQueued: !alreadyVerified,
    processingRunId: runId,
    queuedJobs: INITIAL_PIPELINE_STAGES,
    postProcessingStages: POST_PROCESSING_STAGES,
    idempotent: queueResult?.created === false,
  }, 200, req)
}

// deno-lint-ignore no-explicit-any
async function cancelUpload(admin: any, userId: string, body: Record<string, unknown>, req: Request): Promise<Response> {
  const documentId = clean(body.documentId)
  if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')
  const { data: doc, error } = await admin
    .from('documents')
    .select('id, owner_id, visibility, storage_bucket, storage_path, metadata')
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw new AppError(502, 'upload_lookup_failed', 'Verifica della bozza non riuscita. Riprova senza ricaricare il file.')
  if (!doc) return jsonResponse({ documentId, status: 'cancelled' }, 200, req)
  if (doc.owner_id !== userId) throw errors.badRequest('Non puoi annullare questo upload.')
  if (doc.visibility !== 'private') throw errors.badRequest('Un documento già inviato in revisione non può essere annullato da questo flusso.')
  const uploadState = String(doc.metadata?.upload_state ?? '')
  if (!['awaiting_client_upload', 'verification_failed'].includes(uploadState)) {
    throw errors.badRequest('La verifica del documento è già iniziata: questa bozza non può più essere eliminata dal flusso di upload.')
  }

  const expectedPrefix = `${userId}/incoming/${documentId}/`
  if (doc.storage_bucket === 'processing-temp' && String(doc.storage_path).startsWith(expectedPrefix)) {
    const { error: storageError } = await admin.storage.from('processing-temp').remove([doc.storage_path])
    if (storageError) {
      throw new AppError(502, 'upload_cleanup_failed', 'Pulizia del file temporaneo non riuscita. La bozza è stata conservata per riprovare.')
    }
  }
  const { error: deleteError } = await admin
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('owner_id', userId)
    .eq('visibility', 'private')
  if (deleteError) throw dbFailure('db_error', deleteError, 'Annullamento upload non riuscito')
  return jsonResponse({ documentId, status: 'cancelled' }, 200, req)
}

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  const methodDenied = requireMethod(req, ['POST'])
  if (methodDenied) return methodDenied

  logger.info('document_upload_request', { action: 'start' })

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const action = clean(body.action, 'create').toLowerCase()
    if (!['create', 'finalize', 'cancel'].includes(action)) throw errors.badRequest('Azione upload non supportata.')
    if (action === 'cancel') return await cancelUpload(admin, userId, body, req)
    if (!PDF_WORKER_ENABLED) {
      logger.warn('pdf_worker_unavailable', { documentId: body.documentId })
      throw new AppError(503, 'pdf_worker_unavailable', 'Nuovi caricamenti temporaneamente in pausa: elaborazione documenti non attiva.')
    }
    if (action === 'finalize') return await finalizeUpload(admin, userId, body, req)

    const title = clean(body.title)
    const courseName = clean(body.courseName).slice(0, 120)
    const originalFileSha256 = clean(body.originalFileSha256).toLowerCase()
    const originalSizeBytes = Number(body.originalSizeBytes)
    const mimeType = clean(body.mimeType, 'application/pdf').toLowerCase()

    if (title.length < 3 || title.length > 180) throw errors.badRequest('Titolo non valido.')
    if (!courseName) throw errors.badRequest('Materia obbligatoria.')
    assertPublicTextClean('Titolo', title)
    assertPublicTextClean('Descrizione', clean(body.description).slice(0, 2000))
    if (!HASH_RE.test(originalFileSha256)) throw errors.badRequest('Hash SHA-256 non valido.')
    if (!Number.isFinite(originalSizeBytes) || originalSizeBytes <= 0 || originalSizeBytes > MAX_UPLOAD_BYTES) {
      throw errors.badRequest('Dimensione file non valida o superiore al limite.')
    }
    if (mimeType !== 'application/pdf') {
      throw errors.badRequest('Carica un PDF. I file Word devono essere convertiti in PDF prima del salvataggio.')
    }

    // Il CdL è una FK verso public.degree_programs: va validato qui per dare un
    // errore leggibile invece di un errore di vincolo al momento dell'insert.
    const degreeSlug = clean(body.degreeSlug).toLowerCase().slice(0, 80) || DEFAULT_DEGREE_SLUG
    if (!DEGREE_SLUG_RE.test(degreeSlug)) throw errors.badRequest('Corso di laurea non valido.')
    const { data: degree, error: degreeError } = await admin
      .from('degree_programs')
      .select('slug, name, classe, is_active')
      .eq('slug', degreeSlug)
      .maybeSingle()
    if (degreeError) throw dbFailure('db_error', degreeError, 'Verifica corso di laurea non riuscita')
    if (!degree || degree.is_active !== true) throw errors.badRequest('Corso di laurea sconosciuto o non più attivo.')

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recent = await admin
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .gte('created_at', hourAgo)
    if ((recent.count ?? 0) >= MAX_UPLOADS_PER_HOUR) throw errors.rateLimited('Troppi caricamenti recenti: riprova tra un’ora.')

    let documentId = crypto.randomUUID()
    const fileName = safeName(body.fileName)
    let storageBucket = 'processing-temp'
    let storagePath = `${userId}/incoming/${documentId}/${fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`}`
    let reusedDraft = false
    const tags = parseTags(body.tags)
    // Price is optional at draft time. When set: free (0) or fair marketplace
    // range [8, 250]. Values 1–7 undercut the catalog and are rejected.
    let priceCredits: number | null = null
    if (body.priceCredits != null) {
      const parsed = Number(body.priceCredits)
      if (!Number.isFinite(parsed)) throw errors.badRequest('Prezzo non valido.')
      const rounded = Math.round(parsed)
      if (rounded !== 0 && (rounded < 8 || rounded > 250)) {
        throw errors.badRequest('Il prezzo deve essere 0 (gratuito) oppure tra 8 e 250 crediti.')
      }
      priceCredits = rounded
    }

    const { error: insertError } = await admin.from('documents').insert({
      id: documentId,
      owner_id: userId,
      title,
      course_name: courseName,
      degree_slug: degree.slug,
      professor: clean(body.professor).slice(0, 120) || null,
      academic_year: clean(body.academicYear, '2025/2026').slice(0, 20) || null,
      original_file_sha256: originalFileSha256,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      original_size_bytes: originalSizeBytes,
      mime_type: mimeType,
      compression_status: 'pending',
      flashcard_status: 'not_requested',
      visibility: 'private',
      preview_policy: 'protected',
      price_credits: priceCredits,
      description: clean(body.description).slice(0, 2000) || null,
      exam_type: clean(body.examType).slice(0, 80) || null,
      semester: clean(body.semester).slice(0, 40) || null,
      tags,
      compatible_exams: parseTags(body.compatibleExams),
      metadata: {
        upload_state: 'awaiting_client_upload',
        original_file_name: fileName,
        source_mime_type: mimeType,
        submitted_from: 'document-upload',
        degree_course: clean(body.degreeCourse).slice(0, 160) || `${degree.name} ${degree.classe}`,
      },
    })
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await admin
          .from('documents')
          .select('id, visibility, storage_bucket, storage_path, original_size_bytes, mime_type, metadata')
          .eq('owner_id', userId)
          .eq('original_file_sha256', originalFileSha256)
          .maybeSingle()
        const retryable = existing
          && existing.visibility === 'private'
          && Number(existing.original_size_bytes) === originalSizeBytes
          && existing.mime_type === mimeType
          && ['awaiting_client_upload', 'verification_failed'].includes(String(existing.metadata?.upload_state))
        if (!retryable) throw errors.badRequest('Questo file risulta già inviato o non è riutilizzabile nel tuo account.')
        documentId = existing.id
        storageBucket = existing.storage_bucket
        storagePath = existing.storage_path
        reusedDraft = true
      } else {
        throw errors.badRequest(insertError.message)
      }
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(storageBucket)
      .createSignedUploadUrl(storagePath, { upsert: reusedDraft })
    if (signedError || !signed?.signedUrl) {
      // Do not strand an unusable draft/hash if URL minting failed before the
      // client could upload any bytes. A reused draft may already own an
      // uploaded object, so preserve it for a later signed-URL retry.
      if (!reusedDraft) {
        await admin.from('documents').delete().eq('id', documentId).eq('owner_id', userId)
      }
      throw errors.badRequest(signedError?.message ?? 'Signed upload URL non creato.')
    }

    return jsonResponse({
      documentId,
      storageBucket,
      storagePath,
      signedUploadUrl: signed.signedUrl,
      path: signed.path,
      token: signed.token,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      queuedJobs: [],
      reusedDraft,
    }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
