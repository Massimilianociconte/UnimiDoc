// Embedding provider adapter. The whole RAG pipeline depends only on the
// `EmbeddingProvider` interface, so the model/vendor can be swapped without
// touching the indexer, the query path, or the DB schema — as long as the new
// model keeps the SAME dimension as the rag_chunk_embeddings.embedding column
// (768) OR a migration changes that column and embeddings are regenerated.
//
// Current provider: Google Gemini `gemini-embedding-001` with outputDimensionality
// 768 (the GA embedding model on the same API that already serves the vision
// model). GEMINI_API_KEY is already configured, so no new secret is required.
// Cosine similarity is scale-invariant, so sub-3072 dims (which Gemini returns
// un-normalised) still rank correctly under pgvector's vector_cosine_ops.

import { config } from './env.ts'
import { errors, fetchWithRetry } from './http.ts'

export interface EmbeddingProvider {
  readonly modelName: string
  readonly embeddingModelId: string // stored in embedding_model, e.g. "gemini/gemini-embedding-001"
  readonly embeddingVersion: string
  readonly dimensions: number
  embedText(text: string, kind?: EmbeddingKind): Promise<number[]>
  embedBatch(texts: string[], kind?: EmbeddingKind): Promise<number[][]>
}

// Gemini distinguishes the embedding of a stored passage from that of a query.
export type EmbeddingKind = 'document' | 'query'

// deno-lint-ignore no-explicit-any
const geminiEnv = (globalThis as any).Deno?.env
const EMBEDDING_MODEL = geminiEnv?.get('GEMINI_EMBEDDING_MODEL') ?? 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = Number(geminiEnv?.get('RAG_EMBEDDING_DIMENSIONS') ?? '768')
const EMBEDDING_VERSION = geminiEnv?.get('RAG_EMBEDDING_VERSION') ?? '1'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function taskType(kind: EmbeddingKind): string {
  return kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
}

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = EMBEDDING_MODEL
  readonly embeddingModelId = `gemini/${EMBEDDING_MODEL}`
  readonly embeddingVersion = EMBEDDING_VERSION
  readonly dimensions = EMBEDDING_DIMENSIONS

  async embedText(text: string, kind: EmbeddingKind = 'document'): Promise<number[]> {
    const [vector] = await this.embedBatch([text], kind)
    return vector
  }

  async embedBatch(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][]> {
    if (!config.gemini.apiKey) throw errors.upstream('Servizio embedding non configurato (GEMINI_API_KEY).')
    if (texts.length === 0) return []

    // Gemini caps batchEmbedContents at 100 requests per call.
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += 100) {
      const slice = texts.slice(i, i + 100)
      const requests = slice.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: text.slice(0, 8000) }] },
        taskType: taskType(kind),
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }))

      const res = await fetchWithRetry(
        `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${config.gemini.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        },
      )
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        console.error('Gemini embed failed:', res.status, detail.slice(0, 500))
        throw errors.upstream('Generazione embedding non riuscita.')
      }
      const data = (await res.json()) as { embeddings?: Array<{ values: number[] }> }
      for (const item of data.embeddings ?? []) out.push(item.values)
    }

    if (out.length !== texts.length) throw errors.upstream('Risposta embedding incompleta.')
    return out
  }
}

let singleton: EmbeddingProvider | null = null

/** Returns the configured embedding provider. Swap here to change vendor. */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!singleton) singleton = new GeminiEmbeddingProvider()
  return singleton
}
