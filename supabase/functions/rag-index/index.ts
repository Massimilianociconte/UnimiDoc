// POST /functions/v1/rag-index  { documentId, force? }
//
// Indexes a document for RAG: ensures pdf_chunks exist (building them from the
// stored per-page text when absent — reusing the flashcard pipeline's chunk
// schema, never a parallel one), generates embeddings via the swappable
// EmbeddingProvider, and upserts them into rag_chunk_embeddings. Heavy work is
// NOT run at upload time or inside a user query — this endpoint is the async
// worker the dashboard triggers ("Avvia analisi") and polls via rag-status.
//
// Access: any user who can access the document (owner / buyer / published) may
// trigger indexing; embeddings belong to the document owner and are shared
// through match_rag_chunks' access rule, so the whole community indexes once.

import { preflight, jsonResponse, errorResponse, errors, AppError } from '../_shared/http.ts'
import { adminClient, requireUser, getEntitlement, sha256Hex } from '../_shared/supabase.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'
import { chunkPages } from '../_shared/chunking.ts'

// Cost guard: max chunks embedded per document, by the *requester's* plan.
const CHUNK_CAP: Record<string, number> = { free: 120, base: 300, premium: 800 }
const EMBED_BATCH = 64
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DbChunk = {
  id: string
  chunk_index: number
  content: string
  content_sha256: string
  page_start: number
  page_end: number
  token_estimate: number
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  let jobId: string | null = null
  let activeDocumentId: string | null = null
  try {
    const { id: userId } = await requireUser(req)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const documentId = String(body.documentId ?? '')
    if (!documentId) throw errors.badRequest('documentId obbligatorio.')
    if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')
    activeDocumentId = documentId
    const force = Boolean(body.force)

    const { data: doc } = await admin
      .from('documents')
      .select('id, owner_id, visibility, rag_status, rag_index_version')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc) throw new AppError(404, 'not_found', 'Documento non trovato.')

    // Authoritative access check (same rule as match_rag_chunks).
    const { data: accessible, error: accessError } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
    if (accessError) throw errors.badRequest(`Verifica accesso non riuscita: ${accessError.message}`)
    const hasAccess = (accessible ?? []).some((row: { document_id: string }) => row.document_id === documentId)
    if (!hasAccess) throw errors.paywall('Non hai accesso a questo documento.')

    // Already indexed → no-op unless force.
    if (!force && doc.rag_status === 'indexed') {
      return jsonResponse({ documentId, status: 'indexed', skipped: true }, 200, req)
    }

    const provider = getEmbeddingProvider()
    const plan = (await getEntitlement(admin, userId)).plan
    const chunkCap = CHUNK_CAP[plan] ?? CHUNK_CAP.free

    // Open a job row + flip the document to "processing".
    const { data: job } = await admin
      .from('rag_embedding_jobs')
      .insert({
        document_id: documentId,
        user_id: userId,
        status: 'processing',
        embedding_model: provider.embeddingModelId,
        embedding_version: provider.embeddingVersion,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    jobId = job?.id ?? null
    await admin.from('documents').update({ rag_status: 'processing' }).eq('id', documentId)

    // 1) Ensure chunks exist (reuse pdf_chunks; build from pdf_pages if empty).
    let { data: chunks } = await admin
      .from('pdf_chunks')
      .select('id, chunk_index, content, content_sha256, page_start, page_end, token_estimate')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })

    if (!chunks || chunks.length === 0) {
      const { data: pages } = await admin
        .from('pdf_pages')
        .select('page_number, native_text')
        .eq('document_id', documentId)
        .order('page_number', { ascending: true })

      const pageTexts = (pages ?? [])
        .filter((p) => (p.native_text ?? '').trim().length > 0)
        .map((p) => ({ pageNumber: p.page_number as number, text: p.native_text as string }))

      if (pageTexts.length === 0) {
        await finishJob(admin, jobId, documentId, 'partial', 0, 0, provider, 'Nessun testo estratto disponibile.')
        return jsonResponse(
          { documentId, status: 'partial', reason: 'no_text', message: 'Documento privo di testo estratto: eseguire prima estrazione/OCR.' },
          200,
          req,
        )
      }

      const built = chunkPages(pageTexts)
      const rows = await Promise.all(
        built.map(async (c) => ({
          document_id: documentId,
          owner_id: doc.owner_id,
          page_start: c.pageStart,
          page_end: c.pageEnd,
          section_path: c.sectionPath,
          chunk_index: c.chunkIndex,
          content: c.content,
          content_sha256: await sha256Hex(c.content),
          token_estimate: c.tokenEstimate,
          structure: {},
          processing_state: 'ready',
        })),
      )
      const { error: insErr } = await admin
        .from('pdf_chunks')
        .upsert(rows, { onConflict: 'document_id,chunk_index' })
      if (insErr) throw errors.badRequest(`Salvataggio chunk non riuscito: ${insErr.message}`)

      const reloaded = await admin
        .from('pdf_chunks')
        .select('id, chunk_index, content, content_sha256, page_start, page_end, token_estimate')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true })
      chunks = reloaded.data
    }

    const allChunks = (chunks ?? []) as DbChunk[]
    const capped = allChunks.slice(0, chunkCap)
    const cappedIds = new Set(capped.map((chunk) => chunk.id))
    const chunksTotal = capped.length
    await admin.from('rag_embedding_jobs').update({ chunks_total: chunksTotal }).eq('id', jobId)

    // 2) Which chunks still need an embedding for THIS model+version?
    const { data: existing } = await admin
      .from('rag_chunk_embeddings')
      .select('chunk_id, embedding_status')
      .eq('document_id', documentId)
      .eq('embedding_model', provider.embeddingModelId)
      .eq('embedding_version', provider.embeddingVersion)
    const done = new Set(
      (existing ?? [])
        .filter((e) => e.embedding_status === 'embedded' && cappedIds.has(e.chunk_id))
        .map((e) => e.chunk_id),
    )
    let pending = force ? capped : capped.filter((c) => !done.has(c.id))

    let embedded = force ? 0 : done.size

    // Reuse embeddings for identical chunk text before calling Gemini. This
    // keeps content_hash dedup useful across re-indexing and repeated documents.
    if (pending.length > 0) {
      const hashes = [...new Set(pending.map((chunk) => chunk.content_sha256))]
      const { data: reusable } = await admin
        .from('rag_chunk_embeddings')
        .select('content_hash, embedding')
        .eq('embedding_model', provider.embeddingModelId)
        .eq('embedding_version', provider.embeddingVersion)
        .eq('embedding_status', 'embedded')
        .in('content_hash', hashes)
      const vectorByHash = new Map<string, unknown>()
      for (const row of reusable ?? []) {
        if (!vectorByHash.has(row.content_hash) && row.embedding) vectorByHash.set(row.content_hash, row.embedding)
      }
      const reusableRows = pending
        .filter((chunk) => vectorByHash.has(chunk.content_sha256))
        .map((chunk) => ({
          chunk_id: chunk.id,
          document_id: documentId,
          owner_id: doc.owner_id,
          embedding: vectorByHash.get(chunk.content_sha256),
          embedding_model: provider.embeddingModelId,
          embedding_version: provider.embeddingVersion,
          embedding_status: 'embedded',
          content_hash: chunk.content_sha256,
          token_count: chunk.token_estimate,
        }))
      if (reusableRows.length > 0) {
        const { error: reuseErr } = await admin
          .from('rag_chunk_embeddings')
          .upsert(reusableRows, { onConflict: 'chunk_id,embedding_model,embedding_version' })
        if (reuseErr) throw errors.badRequest(`Riutilizzo embedding non riuscito: ${reuseErr.message}`)
        embedded += reusableRows.length
        const reusedIds = new Set(reusableRows.map((row) => row.chunk_id))
        pending = pending.filter((chunk) => !reusedIds.has(chunk.id))
        await admin.from('rag_embedding_jobs').update({ chunks_embedded: embedded }).eq('id', jobId)
      }
    }

    // 3) Embed in batches and upsert.
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const batch = pending.slice(i, i + EMBED_BATCH)
      const vectors = await provider.embedBatch(batch.map((c) => c.content), 'document')
      const rows = batch.map((c, idx) => ({
        chunk_id: c.id,
        document_id: documentId,
        owner_id: doc.owner_id,
        embedding: JSON.stringify(vectors[idx]), // pgvector text format: [a,b,c]
        embedding_model: provider.embeddingModelId,
        embedding_version: provider.embeddingVersion,
        embedding_status: 'embedded',
        content_hash: c.content_sha256,
        token_count: c.token_estimate,
      }))
      const { error: upErr } = await admin
        .from('rag_chunk_embeddings')
        .upsert(rows, { onConflict: 'chunk_id,embedding_model,embedding_version' })
      if (upErr) throw errors.badRequest(`Salvataggio embedding non riuscito: ${upErr.message}`)
      embedded += batch.length
      await admin.from('rag_embedding_jobs').update({ chunks_embedded: embedded }).eq('id', jobId)
    }

    const partial = allChunks.length > chunkCap
    const status = partial ? 'partial' : 'completed'
    await finishJob(admin, jobId, documentId, status, chunksTotal, embedded, provider, partial ? `Limitato a ${chunkCap} chunk (piano ${plan}).` : null)

    return jsonResponse(
      {
        documentId,
        status: partial ? 'partial' : 'indexed',
        chunksTotal: allChunks.length,
        chunksEmbedded: embedded,
        chunkCap,
        embeddingModel: provider.embeddingModelId,
        dimensions: provider.dimensions,
      },
      200,
      req,
    )
  } catch (error) {
    if (jobId) {
      const message = error instanceof Error ? error.message : 'Errore indicizzazione.'
      await admin.from('rag_embedding_jobs').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', jobId)
    }
    if (activeDocumentId) {
      await admin.from('documents').update({ rag_status: 'failed' }).eq('id', activeDocumentId)
    }
    return errorResponse(error, req)
  }
})

// deno-lint-ignore no-explicit-any
async function finishJob(admin: any, jobId: string | null, documentId: string, status: string, total: number, embedded: number, provider: { embeddingVersion: string }, message: string | null) {
  const docStatus = status === 'completed' ? 'indexed' : status === 'partial' ? 'partial' : status === 'failed' ? 'failed' : 'processing'
  if (jobId) {
    await admin
      .from('rag_embedding_jobs')
      .update({ status, chunks_total: total, chunks_embedded: embedded, error_message: message, finished_at: new Date().toISOString() })
      .eq('id', jobId)
  }
  const patch: Record<string, unknown> = { rag_status: docStatus, rag_chunk_count: embedded, rag_indexed_at: new Date().toISOString() }
  if (docStatus === 'indexed' || docStatus === 'partial') {
    const { data: cur } = await admin.from('documents').select('rag_index_version').eq('id', documentId).maybeSingle()
    patch.rag_index_version = (cur?.rag_index_version ?? 0) + 1
  }
  await admin.from('documents').update(patch).eq('id', documentId)
}
