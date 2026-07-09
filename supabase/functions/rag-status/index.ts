// POST /functions/v1/rag-status  { documentIds: string[] }
//
// Returns the RAG indexing state for one or more documents plus the latest job
// progress (chunks_embedded / chunks_total) so the dashboard can render
// "Ricerca intelligente: in preparazione — 42/180". Read-only, access-checked.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { requireUser, adminClient } from '../_shared/supabase.ts'

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()

    const body = await req.json().catch(() => null)
    const ids = Array.isArray(body?.documentIds) ? body.documentIds.map((v: unknown) => String(v)).filter(Boolean) : []
    if (ids.length === 0) throw errors.badRequest('documentIds obbligatorio.')

    // Only surface docs the caller may access (owner / buyer / published).
    const { data: accessible } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
    const allowed = new Set((accessible ?? []).map((r: { document_id: string }) => r.document_id))
    const requested = ids.filter((id: string) => allowed.has(id))

    const { data: docs } = await admin
      .from('documents')
      .select('id, rag_status, rag_chunk_count, rag_index_version, rag_indexed_at')
      .in('id', requested.length ? requested : ['00000000-0000-0000-0000-000000000000'])

    const { data: jobs } = await admin
      .from('rag_embedding_jobs')
      .select('document_id, status, chunks_total, chunks_embedded, error_message, created_at')
      .in('document_id', requested.length ? requested : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })

    const latestJob = new Map<string, (typeof jobs)[number]>()
    for (const job of jobs ?? []) if (!latestJob.has(job.document_id)) latestJob.set(job.document_id, job)

    const statuses = (docs ?? []).map((d) => {
      const job = latestJob.get(d.id)
      return {
        documentId: d.id,
        status: d.rag_status,
        chunkCount: d.rag_chunk_count,
        indexVersion: d.rag_index_version,
        indexedAt: d.rag_indexed_at,
        job: job
          ? { status: job.status, chunksTotal: job.chunks_total, chunksEmbedded: job.chunks_embedded, error: job.error_message }
          : null,
      }
    })

    return jsonResponse({ statuses }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
