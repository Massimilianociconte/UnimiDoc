// POST /functions/v1/rag-pack  { documentId }   (future Flutter/ZVec sync)
//
// Returns the vector pack for ONE accessible, indexed document: the chunk
// metadata + embedding needed to populate a local ZVec collection on a native
// mobile app. The full PDF is never included — only chunks + light metadata +
// embeddings, and ONLY for documents the caller may access.
//
// The web app does NOT consume this (ZVec is native-only). It exists so the
// future Flutter app can download packs and search offline; online answers
// still go through rag-query so the server stays the source of truth.

import { preflight, jsonResponse, errorResponse, errors, AppError, parseJsonBody, requireMethod } from '../_shared/http.ts'
import { requireUser, adminClient, enforceRateLimit, getEntitlement, type AdminClient } from '../_shared/supabase.ts'
import { createRequestLogger } from '../_shared/log.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  const methodDenied = requireMethod(req, ['POST'])
  if (methodDenied) return methodDenied

  logger.info('rag_pack_start')

  try {
    const { id: userId } = await requireUser(req)
    const admin: AdminClient = adminClient()
    const provider = getEmbeddingProvider()

    const body = await parseJsonBody(req)
    const documentId = String(body?.documentId ?? '')
    if (!documentId) throw errors.badRequest('documentId obbligatorio.')
    if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')

    // Access gate: reuse the authoritative RPC.
    const { data: accessible } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
    const allowed = new Set((accessible ?? []).map((r: { document_id: string }) => r.document_id))
    if (!allowed.has(documentId)) throw errors.paywall('Non hai accesso a questo documento.')

    // Pack export is heavy (full embeddings). Cap downloads per month.
    const entitlement = await getEntitlement(admin, userId)
    await enforceRateLimit(admin, userId, 'rag_pack', entitlement.isPremium ? 60 : 12)

    const { data: doc } = await admin
      .from('documents')
      .select('id, title, course_name, professor, university, degree_course, rag_index_version')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc) throw new AppError(404, 'not_found', 'Documento non trovato.')

    // Join embeddings -> chunks for this model+version. Cap payload size.
    const MAX_PACK_CHUNKS = entitlement.isPremium ? 800 : 250
    const { data: rows } = await admin
      .from('rag_chunk_embeddings')
      .select('chunk_id, embedding, content_hash, updated_at, pdf_chunks!inner(page_start, page_end, section_path, chunk_index, content)')
      .eq('document_id', documentId)
      .eq('embedding_model', provider.embeddingModelId)
      .eq('embedding_version', provider.embeddingVersion)
      .eq('embedding_status', 'embedded')
      .limit(MAX_PACK_CHUNKS)

    // deno-lint-ignore no-explicit-any
    const chunks = (rows ?? []).map((r: any) => {
      const c = r.pdf_chunks
      const preview = String(c.content ?? '').slice(0, 280)
      return {
        chunk_id: r.chunk_id,
        document_id: documentId,
        page_start: c.page_start,
        page_end: c.page_end,
        chapter: c.section_path?.[0] ?? null,
        section: c.section_path?.[1] ?? null,
        topic: c.section_path?.[c.section_path.length - 1] ?? null,
        content_preview: preview,
        content_hash: r.content_hash,
        embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
        embedding_model: provider.embeddingModelId,
        embedding_version: provider.embeddingVersion,
        updated_at: r.updated_at,
      }
    })

    return jsonResponse(
      {
        document: {
          document_id: doc.id,
          title: doc.title,
          subject: doc.course_name,
          teacher: doc.professor,
          university: doc.university,
          course: doc.degree_course,
          index_version: doc.rag_index_version,
        },
        collection: 'unimidoc_chunks_v1',
        embedding_model: provider.embeddingModelId,
        embedding_version: provider.embeddingVersion,
        dimensions: provider.dimensions,
        chunk_count: chunks.length,
        chunks,
      },
      200,
      req,
    )
  } catch (error) {
    return errorResponse(error, req)
  }
})
