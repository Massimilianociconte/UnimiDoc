// POST /functions/v1/rag-query  { query, documentIds?, matchCount? }
//
// The RAG answer path: validates the session, embeds the query server-side,
// retrieves the top-k accessible chunks via match_rag_chunks (RLS-safe: the
// RPC runs with the caller's JWT so its auth.uid() access filter applies), then
// asks the LLM to answer USING ONLY those chunks and returns structured
// citations. The model never sees the whole document — only retrieved chunks.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { requireUser, adminClient, userClient, recordUsage } from '../_shared/supabase.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'
import { deepseekChat, deepseekCost } from '../_shared/ai.ts'

const SYSTEM_PROMPT = `Sei l'assistente di studio di UnimiDoc.
Rispondi alla domanda usando ESCLUSIVAMENTE il contesto fornito qui sotto.
Se il contesto non contiene informazioni sufficienti, dillo chiaramente e non inventare.
Non aggiungere dettagli non presenti nei chunk forniti.
Quando possibile, cita la pagina, la sezione o il documento di provenienza usando i marcatori [#n] dei chunk.
Mantieni una spiegazione chiara, didattica e adatta a uno studente universitario. Rispondi in italiano.`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Match = {
  chunk_id: string
  document_id: string
  page_start: number
  page_end: number
  section_path: string[]
  chunk_index: number
  content: string
  structure: Record<string, unknown>
  similarity: number
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    const scoped = userClient(req) // carries the caller JWT -> auth.uid() in the RPC

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const query = String(body.query ?? '').trim()
    if (!query) throw errors.badRequest('query obbligatoria.')
    if (query.length > 2000) throw errors.badRequest('Domanda troppo lunga.')
    const rawDocumentIds = Array.isArray(body.documentIds)
      ? body.documentIds.map((v: unknown) => String(v)).filter(Boolean)
      : null
    const documentIds = rawDocumentIds ? rawDocumentIds.filter((id) => UUID_RE.test(id)) : null
    if (rawDocumentIds && rawDocumentIds.length !== documentIds!.length) throw errors.badRequest('documentIds contiene valori non validi.')
    const requestedMatchCount = Number(body.matchCount ?? 8)
    const matchCount = Number.isFinite(requestedMatchCount) ? Math.max(1, Math.min(requestedMatchCount, 12)) : 8

    // 1) Embed the query (server-side, same model as the documents).
    const provider = getEmbeddingProvider()
    const queryVector = await provider.embedText(query, 'query')

    // 2) Access-safe retrieval via the SECURITY DEFINER RPC (user-scoped client).
    const { data: matchesRaw, error: matchError } = await scoped.rpc('match_rag_chunks', {
      query_embedding: JSON.stringify(queryVector),
      match_count: matchCount,
      filter_document_ids: documentIds,
      min_similarity: 0.15,
    })
    if (matchError) throw errors.badRequest(`Ricerca non riuscita: ${matchError.message}`)
    const matches = (matchesRaw ?? []) as Match[]

    if (matches.length === 0) {
      await logQuery(admin, userId, query, documentIds ?? [], [], null, provider.embeddingModelId)
      return jsonResponse(
        {
          answer:
            'Non ho trovato passaggi rilevanti nei documenti indicizzati a cui hai accesso. ' +
            'Verifica che il documento sia stato indicizzato per la ricerca intelligente, oppure riformula la domanda.',
          sources: [],
          matched: 0,
        },
        200,
        req,
      )
    }

    // 3) Titles for citations (single query, service role — read-only metadata).
    const docIds = [...new Set(matches.map((m) => m.document_id))]
    const { data: docs } = await admin
      .from('documents')
      .select('id, title, course_name, professor')
      .in('id', docIds)
    const titleById = new Map((docs ?? []).map((d) => [d.id, d]))

    // 4) Build the grounded prompt. Only retrieved chunks reach the model.
    const context = matches
      .map((m, i) => {
        const doc = titleById.get(m.document_id)
        const section = m.section_path?.length ? ` · ${m.section_path.join(' > ')}` : ''
        const pages = m.page_start === m.page_end ? `p. ${m.page_start}` : `pp. ${m.page_start}-${m.page_end}`
        return `[#${i + 1}] ${doc?.title ?? 'Documento'} (${pages}${section})\n${m.content}`
      })
      .join('\n\n---\n\n')

    const result = await deepseekChat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Contesto:\n\n${context}\n\n---\n\nDomanda: ${query}` },
      ],
      temperature: 0.2,
      maxTokens: 900,
      userId,
    })

    const sources = matches.map((m, i) => {
      const doc = titleById.get(m.document_id)
      return {
        marker: `#${i + 1}`,
        chunk_id: m.chunk_id,
        document_id: m.document_id,
        title: doc?.title ?? null,
        course_name: doc?.course_name ?? null,
        professor: doc?.professor ?? null,
        page_start: m.page_start,
        page_end: m.page_end,
        section_path: m.section_path ?? [],
        similarity: Number(m.similarity.toFixed(4)),
      }
    })

    // 5) Cost tracking + lightweight log (best-effort, never blocks the answer).
    await recordUsage(admin, {
      user_id: userId,
      provider: 'deepseek',
      model_used: result.model,
      feature: 'rag_query',
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
      cache_hit_tokens: result.usage.cacheHitTokens,
      cache_miss_tokens: result.usage.cacheMissTokens,
      estimated_cost_usd: deepseekCost(result.usage),
    })
    await logQuery(
      admin,
      userId,
      query,
      docIds,
      matches.map((m) => m.chunk_id),
      matches[0]?.similarity ?? null,
      result.model,
    )

    return jsonResponse({ answer: result.content, sources, matched: matches.length }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})

// deno-lint-ignore no-explicit-any
async function logQuery(admin: any, userId: string, query: string, documentIds: string[], chunkIds: string[], topSim: number | null, model: string | null) {
  const { error } = await admin.from('rag_query_logs').insert({
    user_id: userId,
    query: query.slice(0, 2000),
    document_ids: documentIds,
    matched_chunk_ids: chunkIds,
    match_count: chunkIds.length,
    top_similarity: topSim,
    model_used: model,
  })
  if (error) console.error('rag_query_logs insert failed:', error.message)
}
