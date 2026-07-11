// POST /functions/v1/document-access  { documentId }
//
// Returns short-lived (60s) signed URLs for a document's PREVIEW IMAGES only.
// The original PDF is signed ONLY for the owner, or for a buyer when the
// document's preview_policy permits download. A non-entitled viewer receives
// exclusively the free, watermarked preview pages — never the original bytes.

import { preflight, jsonResponse, errorResponse, errors, AppError } from '../_shared/http.ts'
import { adminClient, requireUser, getEntitlement } from '../_shared/supabase.ts'

const SIGNED_TTL_SECONDS = 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORIGINAL_BUCKETS = new Set(['private-documents', 'processing-temp'])

function isDocumentStorageObject(
  bucket: string,
  path: string,
  ownerId: string,
  documentId: string,
  kind: 'original' | 'preview',
): boolean {
  const segments = path.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) return false
  if (segments[0] !== ownerId || !segments.includes(documentId)) return false
  return kind === 'preview' ? bucket === 'derived-previews' : ORIGINAL_BUCKETS.has(bucket)
}

type PreviewRow = {
  page_number: number
  storage_bucket: string
  storage_path: string
  is_free_preview: boolean
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
    const documentId = String(body.documentId ?? '')
    if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')

    const { data: document } = await admin
      .from('documents')
      .select('id, owner_id, visibility, preview_policy, storage_bucket, storage_path')
      .eq('id', documentId)
      .maybeSingle()
    if (!document) throw new AppError(404, 'not_found', 'Documento non trovato.')

    const isOwner = document.owner_id === userId
    const { data: purchase } = await admin
      .from('document_purchases')
      .select('id')
      .eq('document_id', documentId)
      .eq('buyer_id', userId)
      .maybeSingle()
    const hasPurchase = Boolean(purchase)
    const isPublic = document.visibility === 'published'

    // A private document not owned/purchased by the caller is fully off-limits.
    if (!isOwner && !hasPurchase && !isPublic) throw errors.paywall('Documento privato.')

    // Full access = owner, buyer, or (premium_full policy + premium plan).
    let fullAccess = isOwner || hasPurchase
    if (!fullAccess && isPublic && document.preview_policy === 'premium_full') {
      fullAccess = (await getEntitlement(admin, userId)).isPremium
    }
    const canDownloadOriginal = isOwner || (hasPurchase && document.preview_policy !== 'owner_full')

    const { data: previewRows } = await admin
      .from('document_previews')
      .select('page_number, storage_bucket, storage_path, is_free_preview')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true })

    const previews = (previewRows ?? []) as PreviewRow[]
    const allowed = fullAccess ? previews : previews.filter((row) => row.is_free_preview)
    const lockedPages = previews.length - allowed.length

    if (allowed.some((row) => !isDocumentStorageObject(
      row.storage_bucket,
      row.storage_path,
      document.owner_id,
      documentId,
      'preview',
    ))) {
      throw new AppError(409, 'invalid_storage_reference', 'Anteprima non disponibile: riferimento Storage non valido.')
    }

    const signed = await Promise.all(
      allowed.map(async (row) => {
        const { data } = await admin.storage
          .from(row.storage_bucket)
          .createSignedUrl(row.storage_path, SIGNED_TTL_SECONDS)
        return data?.signedUrl ? { page: row.page_number, url: data.signedUrl, free: row.is_free_preview } : null
      }),
    )

    let originalUrl: string | null = null
    if (canDownloadOriginal && document.storage_path) {
      const originalBucket = document.storage_bucket ?? 'private-documents'
      if (!isDocumentStorageObject(
        originalBucket,
        document.storage_path,
        document.owner_id,
        documentId,
        'original',
      )) {
        throw new AppError(409, 'invalid_storage_reference', 'Documento non disponibile: riferimento Storage non valido.')
      }
      const { data } = await admin.storage
        .from(originalBucket)
        .createSignedUrl(document.storage_path, SIGNED_TTL_SECONDS)
      originalUrl = data?.signedUrl ?? null
    }

    return jsonResponse({
      documentId,
      fullAccess,
      canDownloadOriginal,
      lockedPages,
      expiresInSeconds: SIGNED_TTL_SECONDS,
      previews: signed.filter(Boolean),
      originalUrl,
    }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
