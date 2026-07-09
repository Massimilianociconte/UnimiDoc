// Concrete retrieval providers. Only SupabasePgvectorProvider is active today.
// The ZVec providers are intentional stubs that document the future native path
// and keep the UI honest: it must treat retrieval as swappable.

import {
  callRagFunction,
  ragIndexDocument,
  fetchRagStatus,
  type RagFunctionResult,
} from '../aiClient'
import type {
  RagRetrievalProvider,
  RagResult,
  RagSearchParams,
  RagAnswer,
  RagIndexStatus,
} from './types'

// --- Provider 1: Supabase Postgres + pgvector (web app, active) -------------
export class SupabasePgvectorProvider implements RagRetrievalProvider {
  readonly id = 'supabase-pgvector'

  async isAvailable(): Promise<boolean> {
    return Boolean(import.meta.env.VITE_SUPABASE_URL)
  }

  async search(params: RagSearchParams): Promise<RagResult> {
    const res: RagFunctionResult<RagAnswer> = await callRagFunction<RagAnswer>('rag-query', {
      query: params.query,
      documentIds: params.documentIds ?? null,
      matchCount: params.matchCount ?? 8,
    })
    if (res.ok) return { ok: true, data: res.data }
    const code =
      res.code === 'login_required' ? 'login_required' : res.code === 'not_configured' ? 'not_configured' : res.code === 'rate_limited' ? 'rate_limited' : 'error'
    return { ok: false, code, message: res.message }
  }
}

// --- Provider 2 (FUTURE, native app only): ZVec as a separate microservice ---
export class ZvecServerProvider implements RagRetrievalProvider {
  readonly id = 'zvec-server'
  async isAvailable(): Promise<boolean> {
    return false // not deployed; scaffolding for a future ZVec microservice
  }
  async search(): Promise<RagResult> {
    return { ok: false, code: 'error', message: 'ZvecServerProvider non ancora implementato.' }
  }
}

// --- Provider 3 (FUTURE, native app only): on-device ZVec in Flutter --------
// Never used in the web/browser. Documented here so the interface stays stable.
export class ZvecMobileLocalProvider implements RagRetrievalProvider {
  readonly id = 'zvec-mobile-local'
  async isAvailable(): Promise<boolean> {
    return false // web build: on-device ZVec is native-only
  }
  async search(): Promise<RagResult> {
    return { ok: false, code: 'error', message: 'ZvecMobileLocalProvider è disponibile solo nell’app nativa Flutter.' }
  }
}

// The web app resolves to pgvector. A native build would pick a ZVec provider
// (with pgvector as the online fallback) behind this same function.
let activeProvider: RagRetrievalProvider | null = null
export function getRagProvider(): RagRetrievalProvider {
  if (!activeProvider) activeProvider = new SupabasePgvectorProvider()
  return activeProvider
}

// Indexing + status are pgvector/server concerns exposed through thin helpers.
export async function indexDocument(documentId: string, force = false) {
  return ragIndexDocument({ documentId, force })
}

export async function getIndexStatuses(documentIds: string[]): Promise<RagIndexStatus[]> {
  const res = await fetchRagStatus({ documentIds })
  return res.ok ? res.data.statuses : []
}
