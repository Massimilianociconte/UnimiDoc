// POST /functions/v1/rag-index  { documentId, force? }
//
// Indexes a document for RAG: ensures pdf_chunks exist (building them from the
// stored per-page text when absent — reusing the flashcard pipeline's chunk
// schema, never a parallel one), generates embeddings via the swappable
// EmbeddingProvider, and upserts them into rag_chunk_embeddings. Heavy work is
// NOT run at upload time or inside a user query — this endpoint is the async
// worker the dashboard triggers ("Avvia analisi") and polls via rag-status.
//
// Page text is worker-authoritative. Browser-provided `pages` payloads are
// ignored so a modified client cannot poison a published/monetized index. While
// the native PDF worker is still extracting, this endpoint returns `queued`.
//
// Access: only the document owner (or a future trusted worker using the owner's
// workflow) may mutate the shared index. Buyers query the existing embeddings
// through match_rag_chunks but can never rebuild somebody else's document.

import { preflight, jsonResponse, errorResponse, errors, AppError, parseJsonBody, requireMethod, dbFailure} from '../_shared/http.ts'
import { config } from '../_shared/env.ts'
import {
  adminClient,
  requireUser,
  getEntitlement,
  enforceRateLimit,
  recordUsage,
  sha256Hex,
  type AdminClient,
} from '../_shared/supabase.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'
import { chunkPages, CHUNKING_VERSION } from '../_shared/chunking.ts'

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
  section_path: string[] | null
  token_estimate: number
}

// Human-reviewed cards may be saved as soon as upload finalize succeeds, before
// the worker has produced authoritative chunks. Preserve their page provenance
// at save time, then attach the canonical chunk/outline here once it exists.
async function linkReviewedFlashcards(admin: AdminClient, documentId: string, chunks: DbChunk[]): Promise<number> {
  if (chunks.length === 0) return 0
  const { data: cards, error } = await admin
    .from('flashcards')
    .select('id, source_page_start, source_page_end')
    .eq('document_id', documentId)
    .is('chunk_id', null)
    .not('source_page_start', 'is', null)
    .limit(300)
  if (error) throw dbFailure('db_error', error, 'Verifica provenienza flashcard non riuscita')

  let linked = 0
  for (const card of cards ?? []) {
    const start = Number(card.source_page_start)
    const end = Number(card.source_page_end ?? card.source_page_start)
    const chunk = chunks.find((candidate) => candidate.page_start <= start && candidate.page_end >= start)
      ?? chunks.find((candidate) => candidate.page_start <= end && candidate.page_end >= start)
    if (!chunk) continue
    const sectionPath = Array.isArray(chunk.section_path) ? chunk.section_path.filter(Boolean) : []
    const { error: updateError } = await admin
      .from('flashcards')
      .update({
        chunk_id: chunk.id,
        source_outline_path: sectionPath,
        chapter_title: sectionPath[0] ?? null,
        section_title: sectionPath[1] ?? null,
        topic: sectionPath.at(-1) ?? null,
        topic_confidence: 1,
      })
      .eq('id', card.id)
      .is('chunk_id', null)
    if (updateError) throw dbFailure('db_error', updateError, 'Collegamento flashcard-chunk non riuscito')
    linked += 1
  }
  return linked
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function isTrustedPdfWorker(req: Request): Promise<boolean> {
  const expected = Deno.env.get('PDF_WORKER_CALLBACK_SECRET')?.trim() ?? ''
  const supplied = req.headers.get('x-unimidoc-worker-secret')?.trim() ?? ''
  if (expected.length < 32 || supplied.length < 32) return false
  const [expectedHash, suppliedHash] = await Promise.all([sha256Hex(expected), sha256Hex(supplied)])
  return timingSafeEqualHex(expectedHash, suppliedHash)
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  const methodDenied = requireMethod(req, ['POST'])
  if (methodDenied) return methodDenied

  const admin = adminClient()
  let jobId: string | null = null
  let activeDocumentId: string | null = null
  try {
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const documentId = String(body.documentId ?? '')
    if (!documentId) throw errors.badRequest('documentId obbligatorio.')
    if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')
    const force = Boolean(body.force)

    const { data: doc } = await admin
      .from('documents')
      .select('id, owner_id, visibility, rag_status, rag_index_version, analysis_status')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc) throw new AppError(404, 'not_found', 'Documento non trovato.')

    const trustedWorker = await isTrustedPdfWorker(req)
    const userId = trustedWorker ? String(doc.owner_id) : (await requireUser(req)).id

    // Authoritative access check (same rule as match_rag_chunks).
    if (!trustedWorker) {
      const { data: accessible, error: accessError } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
      if (accessError) throw dbFailure('db_error', accessError, 'Verifica accesso non riuscita')
      const hasAccess = (accessible ?? []).some((row: { document_id: string }) => row.document_id === documentId)
      if (!hasAccess) throw errors.paywall('Non hai accesso a questo documento.')
    }

    // Indexing mutates shared chunks/embeddings and spends provider quota. It is
    // therefore an owner/worker operation; buyers can query an existing index
    // but cannot rebuild or downgrade somebody else's document.
    if (doc.owner_id !== userId) {
      throw new AppError(403, 'owner_required', 'Solo il proprietario può indicizzare questo documento.')
    }

    const activePageCount = await admin
      .from('pdf_pages')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .eq('is_active', true)
    if ((activePageCount.count ?? 0) === 0 && ['queued', 'processing'].includes(String(doc.analysis_status))) {
      return jsonResponse({
        documentId,
        status: 'queued',
        reason: 'document_processing',
        message: 'Estrazione e OCR del documento sono ancora in corso.',
      }, 202, req)
    }

    const provider = getEmbeddingProvider()

    // A document marked indexed is reusable only when embeddings for the
    // currently configured model *and version* actually exist. This prevents a
    // model rollout from silently querying vectors produced by an older model.
    if (!force && doc.rag_status === 'indexed') {
      const [currentIndex, currentChunks] = await Promise.all([
        admin
          .from('rag_chunk_embeddings')
          .select('chunk_id, content_hash')
          .eq('document_id', documentId)
          .eq('embedding_model', provider.embeddingModelId)
          .eq('embedding_version', provider.embeddingVersion)
          .eq('embedding_status', 'embedded'),
        admin
          .from('pdf_chunks')
          .select('id, content_sha256')
          .eq('document_id', documentId)
          .eq('is_active', true)
          .neq('processing_state', 'failed'),
      ])
      const indexedHash = new Map(
        (currentIndex.data ?? []).map((embedding: { chunk_id: string; content_hash: string }) => [embedding.chunk_id, embedding.content_hash]),
      )
      const allCurrent = (currentChunks.data ?? []) as Array<{ id: string; content_sha256: string }>
      if (
        !currentIndex.error
        && !currentChunks.error
        && allCurrent.length > 0
        && allCurrent.every((chunk) => indexedHash.get(chunk.id) === chunk.content_sha256)
      ) {
        return jsonResponse({
          documentId,
          status: 'indexed',
          skipped: true,
          embeddingModel: provider.embeddingModelId,
          embeddingVersion: provider.embeddingVersion,
        }, 200, req)
      }
    }

    const entitlement = await getEntitlement(admin, userId)
    const plan = entitlement.plan
    const chunkCap = CHUNK_CAP[plan] ?? CHUNK_CAP.free
    await enforceRateLimit(admin, userId, 'rag_index', config.limits.ragIndexesPerMonth)

    // Open a job row + flip the document to "processing".
    const { data: claimedJobId, error: jobError } = await admin.rpc('claim_rag_embedding_job', {
      p_document: documentId,
      p_user: userId,
      p_embedding_model: provider.embeddingModelId,
      p_embedding_version: provider.embeddingVersion,
    })
    if (jobError || !claimedJobId) {
      if (jobError?.code === '23505') {
        throw new AppError(409, 'already_processing', 'Indicizzazione già in corso per questo documento.')
      }
      throw errors.badRequest(`Avvio indicizzazione non riuscito: ${jobError?.message ?? 'job non creato'}`)
    }
    jobId = String(claimedJobId)
    activeDocumentId = documentId
    const { error: statusError } = await admin.from('documents').update({ rag_status: 'processing' }).eq('id', documentId)
    if (statusError) throw dbFailure('db_error', statusError, 'Stato indicizzazione non aggiornato')

    // 1) Ensure chunks exist. The native worker normally created the active
    // version already; the legacy fallback builds only from active persisted
    // resolved_text and never accepts browser text.
    let { data: chunks } = await admin
      .from('pdf_chunks')
      .select('id, chunk_index, content, content_sha256, page_start, page_end, section_path, token_estimate')
      .eq('document_id', documentId)
      .eq('is_active', true)
      .neq('processing_state', 'failed')
      .order('chunk_index', { ascending: true })

    if (!chunks || chunks.length === 0) {
      const { data: pages } = await admin
        .from('pdf_pages')
        .select('page_number, resolved_text')
        .eq('document_id', documentId)
        .eq('is_active', true)
        .order('page_number', { ascending: true })

      const pageTexts = (pages ?? [])
        .filter((p) => (p.resolved_text ?? '').trim().length > 0)
        .map((p) => ({ pageNumber: p.page_number as number, text: p.resolved_text as string }))

      if (pageTexts.length === 0) {
        await finishJob(admin, jobId, documentId, 'failed', 0, 0, provider, 'Nessun testo estratto disponibile: OCR necessario.')
        return jsonResponse(
          { documentId, status: 'failed', reason: 'no_text', message: 'Documento privo di testo estratto: eseguire prima estrazione/OCR.' },
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
          artifact_version: 'rag-index-legacy',
          is_active: true,
          chunking_version: CHUNKING_VERSION,
        })),
      )
      const { error: insErr } = await admin
        .from('pdf_chunks')
        .upsert(rows, { onConflict: 'document_id,artifact_version,chunk_index' })
      if (insErr) throw dbFailure('db_error', insErr, 'Salvataggio chunk non riuscito')

      const { data: obsoleteChunks, error: obsoleteError } = await admin
        .from('pdf_chunks')
        .select('id')
        .eq('document_id', documentId)
        .eq('artifact_version', 'rag-index-legacy')
        .gte('chunk_index', rows.length)
      if (obsoleteError) throw dbFailure('db_error', obsoleteError, 'Verifica chunk obsoleti non riuscita')
      const obsoleteIds = (obsoleteChunks ?? []).map((chunk: { id: string }) => chunk.id)
      if (obsoleteIds.length > 0) {
        const { error: obsoleteEmbeddingError } = await admin
          .from('rag_chunk_embeddings')
          .delete()
          .in('chunk_id', obsoleteIds)
        if (obsoleteEmbeddingError) {
          throw dbFailure('db_error', obsoleteEmbeddingError, 'Rimozione embedding obsoleti non riuscita')
        }
        const { error: obsoleteChunkError } = await admin
          .from('pdf_chunks')
          .update({ processing_state: 'failed' })
          .in('id', obsoleteIds)
        if (obsoleteChunkError) throw dbFailure('db_error', obsoleteChunkError, 'Archiviazione chunk obsoleti non riuscita')
      }

      const reloaded = await admin
        .from('pdf_chunks')
        .select('id, chunk_index, content, content_sha256, page_start, page_end, section_path, token_estimate')
        .eq('document_id', documentId)
        .eq('is_active', true)
        .neq('processing_state', 'failed')
        .order('chunk_index', { ascending: true })
      chunks = reloaded.data
    }

    const allChunks = (chunks ?? []) as DbChunk[]
    const capped = allChunks.slice(0, chunkCap)
    const cappedIds = new Set(capped.map((chunk) => chunk.id))
    const cappedHashById = new Map(capped.map((chunk) => [chunk.id, chunk.content_sha256]))
    const chunksTotal = capped.length
    await admin.from('rag_embedding_jobs').update({ chunks_total: chunksTotal }).eq('id', jobId)

    // 2) Which chunks still need an embedding for THIS model+version?
    const { data: existing } = await admin
      .from('rag_chunk_embeddings')
      .select('chunk_id, embedding_status, content_hash')
      .eq('document_id', documentId)
      .eq('embedding_model', provider.embeddingModelId)
      .eq('embedding_version', provider.embeddingVersion)
    const done = new Set(
      (existing ?? [])
        .filter((embedding) => {
          if (embedding.embedding_status !== 'embedded' || !cappedIds.has(embedding.chunk_id)) return false
          return embedding.content_hash === cappedHashById.get(embedding.chunk_id)
        })
        .map((e) => e.chunk_id),
    )
    let pending = force ? capped : capped.filter((c) => !done.has(c.id))

    let embedded = force ? 0 : done.size
    let providerInputTokens = 0

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
        if (reuseErr) throw dbFailure('db_error', reuseErr, 'Riutilizzo embedding non riuscito')
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
      providerInputTokens += batch.reduce((sum, chunk) => sum + chunk.token_estimate, 0)
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
      if (upErr) throw dbFailure('db_error', upErr, 'Salvataggio embedding non riuscito')
      embedded += batch.length
      await admin.from('rag_embedding_jobs').update({ chunks_embedded: embedded }).eq('id', jobId)
    }

    const linkedFlashcards = await linkReviewedFlashcards(admin, documentId, allChunks)
    const partial = allChunks.length > chunkCap
    const status = partial ? 'partial' : 'completed'
    await finishJob(admin, jobId, documentId, status, chunksTotal, embedded, provider, partial ? `Limitato a ${chunkCap} chunk (piano ${plan}).` : null)
    await recordUsage(admin, {
      user_id: userId,
      document_id: documentId,
      provider: 'gemini',
      model_used: provider.embeddingModelId,
      feature: 'rag_index',
      input_tokens: providerInputTokens,
      estimated_cost_usd: 0,
    })

    return jsonResponse(
      {
        documentId,
        status: partial ? 'partial' : 'indexed',
        chunksTotal: allChunks.length,
        chunksEmbedded: embedded,
        chunkCap,
        embeddingModel: provider.embeddingModelId,
        dimensions: provider.dimensions,
        linkedFlashcards,
      },
      200,
      req,
    )
  } catch (error) {
    if (jobId) {
      const message = error instanceof Error ? error.message : 'Errore indicizzazione.'
      await admin.from('rag_embedding_jobs').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', jobId)
    }
    if (jobId && activeDocumentId) {
      await admin.from('documents').update({ rag_status: 'failed' }).eq('id', activeDocumentId)
    }
    return errorResponse(error, req)
  }
})

async function finishJob(admin: AdminClient, jobId: string | null, documentId: string, status: string, total: number, embedded: number, provider: { embeddingVersion: string }, message: string | null) {
  const docStatus = status === 'completed' ? 'indexed' : status === 'partial' ? 'partial' : status === 'failed' ? 'failed' : 'processing'
  if (jobId) {
    const { error: jobError } = await admin
      .from('rag_embedding_jobs')
      .update({ status, chunks_total: total, chunks_embedded: embedded, error_message: message, finished_at: new Date().toISOString() })
      .eq('id', jobId)
    if (jobError) throw dbFailure('db_error', jobError, 'Finalizzazione job RAG non riuscita')
  }
  const patch: Record<string, unknown> = { rag_status: docStatus, rag_chunk_count: embedded, rag_indexed_at: new Date().toISOString() }
  if (docStatus === 'indexed' || docStatus === 'partial') {
    const { data: cur } = await admin.from('documents').select('rag_index_version').eq('id', documentId).maybeSingle()
    patch.rag_index_version = (cur?.rag_index_version ?? 0) + 1
  }
  const { error: documentError } = await admin.from('documents').update(patch).eq('id', documentId)
  if (documentError) throw dbFailure('db_error', documentError, 'Finalizzazione documento RAG non riuscita')
}
