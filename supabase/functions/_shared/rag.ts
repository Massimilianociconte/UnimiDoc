// Shared RAG retrieval helper. Embeds a query and pulls the top accessible
// chunks via the SECURITY DEFINER match_rag_chunks RPC using the CALLER's JWT,
// so the access rule (owner / buyer / published / premium) always applies.
// Used by ai-help (grounding context) and any future LLM feature that can
// benefit from document chunks. rag-query keeps its own path because it also
// builds structured citations.

import { userClient } from './supabase.ts'
import { getEmbeddingProvider } from './embeddings.ts'
import { logError } from './log.ts'
import { config } from './env.ts'

export type RagMatch = {
  chunk_id: string
  document_id: string
  page_start: number
  page_end: number
  section_path: string[]
  chunk_index: number
  content: string
  similarity: number
}

/**
 * Best-effort retrieval: returns null instead of throwing, so LLM features
 * degrade gracefully to their non-RAG behaviour when retrieval is unavailable
 * (document not indexed, embedding provider down, ...).
 */
export async function retrieveRagMatches(
  req: Request,
  params: { query: string; documentIds?: string[] | null; matchCount?: number; minSimilarity?: number },
): Promise<RagMatch[] | null> {
  try {
    const query = params.query.trim().slice(0, 2000)
    if (!query) return null
    const provider = getEmbeddingProvider()
    const vector = await provider.embedText(query, 'query')
    const scoped = userClient(req)
    const { data, error } = await scoped.rpc('match_rag_chunks', {
      query_embedding: JSON.stringify(vector),
      p_embedding_model: provider.embeddingModelId,
      p_embedding_version: provider.embeddingVersion,
      match_count: Math.max(1, Math.min(params.matchCount ?? 4, 12)),
      filter_document_ids: params.documentIds ?? null,
      min_similarity: params.minSimilarity ?? config.rag.minSimilarity,
      query_text: query.slice(0, 1500),   // enable hybrid
      hybrid_alpha: config.rag.hybridAlpha,
    })
    if (error) {
      logError('retrieveRagMatches_rpc_failed', error)
      return null
    }
    const raw = (data ?? []) as any[]
    return raw.map(r => ({
      ...r,
      similarity: r.rank_score ?? r.similarity
    })) as RagMatch[]
  } catch (error) {
    logError('retrieveRagMatches_failed', error)
    return null
  }
}

/** Formats matches as a compact plain-text block for prompt injection.
 *  Now prefers rank_score when hybrid retrieval was used.
 */
export function formatRagContext(matches: RagMatch[], maxChars = config.rag.maxContextChars): string {
  const parts: string[] = []
  let used = 0
  for (const [i, m] of matches.entries()) {
    const pages = m.page_start === m.page_end ? `p. ${m.page_start}` : `pp. ${m.page_start}-${m.page_end}`
    const section = m.section_path?.length ? ` · ${m.section_path.join(' > ')}` : ''
    const score = (m as any).rank_score ? ((m as any).rank_score * 100).toFixed(1) + '%' : ''
    const block = `[#${i + 1}] (${pages}${section})${score ? ' ' + score : ''}\n${m.content}`
    if (used + block.length > maxChars) break
    parts.push(block)
    used += block.length
  }
  return parts.join('\n\n')
}
