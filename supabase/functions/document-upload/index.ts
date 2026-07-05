// POST /functions/v1/document-upload
//
// Creates a private document draft, returns a short-lived signed upload URL in
// processing-temp/{user_id}/..., and queues the deterministic processing jobs.
// The worker must verify bytes/hash and promote the file to private-documents
// before a document can become submitted/published.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const HASH_RE = /^[a-f0-9]{64}$/i
// Anti-abuse: draft creation mints signed upload URLs + queues 6 jobs, so cap
// how many drafts a single account can open per hour.
const MAX_UPLOADS_PER_HOUR = 20

const clean = (value: unknown, fallback = '') => String(value ?? fallback).trim()
const safeName = (value: unknown) =>
  clean(value, 'documento.pdf')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((tag) => clean(tag).slice(0, 40)).filter(Boolean).slice(0, 12)
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')

    const title = clean(body.title)
    const courseName = clean(body.courseName).slice(0, 120)
    const originalFileSha256 = clean(body.originalFileSha256).toLowerCase()
    const originalSizeBytes = Number(body.originalSizeBytes)
    const mimeType = clean(body.mimeType, 'application/pdf').toLowerCase()

    if (title.length < 3 || title.length > 180) throw errors.badRequest('Titolo non valido.')
    if (!courseName) throw errors.badRequest('Materia obbligatoria.')
    if (!HASH_RE.test(originalFileSha256)) throw errors.badRequest('Hash SHA-256 non valido.')
    if (!Number.isFinite(originalSizeBytes) || originalSizeBytes <= 0 || originalSizeBytes > MAX_UPLOAD_BYTES) {
      throw errors.badRequest('Dimensione file non valida o superiore al limite.')
    }
    if (mimeType !== 'application/pdf') {
      throw errors.badRequest('Carica un PDF. I file Word devono essere convertiti in PDF prima del salvataggio.')
    }

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recent = await admin
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .gte('created_at', hourAgo)
    if ((recent.count ?? 0) >= MAX_UPLOADS_PER_HOUR) throw errors.rateLimited('Troppi caricamenti recenti: riprova tra un’ora.')

    const documentId = crypto.randomUUID()
    const fileName = safeName(body.fileName)
    const storageBucket = 'processing-temp'
    const storagePath = `${userId}/incoming/${documentId}/${fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`}`
    const tags = parseTags(body.tags)
    const priceCredits = body.priceCredits == null ? null : Math.max(0, Math.min(250, Number(body.priceCredits) || 0))

    const { error: insertError } = await admin.from('documents').insert({
      id: documentId,
      owner_id: userId,
      title,
      course_name: courseName,
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
      },
    })
    if (insertError) {
      if (insertError.code === '23505') throw errors.badRequest('Questo file risulta già caricato nel tuo account.')
      throw errors.badRequest(insertError.message)
    }

    const jobs = ['compress', 'extract', 'layout', 'figures', 'outline', 'quality_review'].map((job_type) => ({
      document_id: documentId,
      owner_id: userId,
      job_type,
      requested_tier: 'base',
      status: 'queued',
      input_hash: originalFileSha256,
      generation_mode: 'base',
    }))
    const { error: jobsError } = await admin.from('pdf_processing_jobs').insert(jobs)
    if (jobsError) console.error('document-upload jobs failed:', jobsError.message)

    const { data: signed, error: signedError } = await admin.storage
      .from(storageBucket)
      .createSignedUploadUrl(storagePath)
    if (signedError || !signed?.signedUrl) throw errors.badRequest(signedError?.message ?? 'Signed upload URL non creato.')

    return jsonResponse({
      documentId,
      storageBucket,
      storagePath,
      signedUploadUrl: signed.signedUrl,
      path: signed.path,
      token: signed.token,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      queuedJobs: jobs.map((job) => job.job_type),
    }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
