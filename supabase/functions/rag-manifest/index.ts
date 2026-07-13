// POST /functions/v1/rag-manifest  { }   (future Flutter/ZVec sync)
//
// Lists the documents the caller may index LOCALLY on a native mobile app
// (owner / purchased / published) that are already indexed on the server. The
// Flutter app uses this to let the user choose which documents to download as
// "vector packs" (see rag-pack) into a local ZVec collection.
//
// NOTE: this is server-side plumbing prepared NOW for a FUTURE native app. ZVec
// itself is NOT used in the web app. Supabase remains the source of truth; the
// manifest never lists documents the user cannot access.

import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts'
import { requireUser, adminClient } from '../_shared/supabase.ts'
import { createRequestLogger } from '../_shared/log.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre

  logger.info('rag_manifest_start')

  try {
    const { id: userId } = await requireUser(req)
    const admin: AdminClient = adminClient()
    const provider = getEmbeddingProvider()

    const { data: accessible } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
    const ids = (accessible ?? []).map((r: { document_id: string }) => r.document_id)
    if (ids.length === 0) return jsonResponse({ documents: [], embeddingModel: provider.embeddingModelId, dimensions: provider.dimensions }, 200, req)

    const { data: docs } = await admin
      .from('documents')
      .select('id, title, course_name, professor, university, degree_course, academic_year, rag_status, rag_chunk_count, rag_index_version, rag_indexed_at')
      .in('id', ids)
      .in('rag_status', ['indexed', 'partial'])

    const documents = (docs ?? []).map((d) => ({
      document_id: d.id,
      title: d.title,
      subject: d.course_name,
      teacher: d.professor,
      university: d.university,
      course: d.degree_course,
      academic_year: d.academic_year,
      chunk_count: d.rag_chunk_count,
      embedding_model: provider.embeddingModelId,
      embedding_version: provider.embeddingVersion,
      index_version: d.rag_index_version,
      // Rough pack size: 768 float32 + short text preview per chunk (~4 KB/chunk).
      size_estimate_mb: Math.max(1, Math.round((d.rag_chunk_count * 4) / 1024)),
      last_updated: d.rag_indexed_at,
    }))

    return jsonResponse({ documents, embeddingModel: provider.embeddingModelId, dimensions: provider.dimensions }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
