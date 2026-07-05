// POST /functions/v1/document-access  { documentId }
//
// Returns short-lived (60s) signed URLs for a document's PREVIEW IMAGES only.
// The original PDF is signed ONLY for the owner, or for a buyer when the
// document's preview_policy permits download. A non-entitled viewer receives
// exclusively the free, watermarked preview pages — never the original bytes.

import { preflight, jsonResponse, errorResponse, errors, AppError } from '../_shared/http.ts'
import { adminClient, requireUser, getEntitlement } from '../_shared/supabase.ts'

const SIGNED_TTL_SECONDS = 60

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
    if (!documentId) throw errors.badRequest('documentId obbligatorio.')

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
    const isPublic = document.visibility === 'published' || document.visibility === 'submitted'

    // A private document not owned/purchased by the caller is fully off-limits.
    if (!isOwner && !hasPurchase && !isPublic) throw errors.paywall('Documento privato.')

    // Full access = owner, buyer, or (premium_full policy + premium plan).
    let fullAccess = isOwner || hasPurchase
    if (!fullAccess && document.preview_policy === 'premium_full') {
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
      const { data } = await admin.storage
        .from(document.storage_bucket ?? 'private-documents')
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
